/**
 * layoutStore.js — IndexedDB Layout Cache
 *
 * Persists computed 3D positions so that repeated launches of the same
 * workspace graph skip the full layout computation.
 *
 * The cache key is `workspacePath|graphHash` — if the graph data changes
 * (different hash), a new layout is computed automatically and the old
 * entry is evicted.
 *
 * ── Storage Schema ───────────────────────────────────────────────────────
 *
 * Database:    "constellation-vr-layout-cache" (v1)
 * ObjectStore: "layouts"
 *
 * Key:         workspacePath|graphHash  (compound string key)
 * Index:       by-workspace             (workspacePath, multi-entry)
 *
 * Value (LayoutCacheEntry, per 02-TSD.md §5.4):
 *   workspacePath:  string              — Workspace identifier
 *   graphHash:      string              — SHA-256 of node+edge data
 *   timestamp:      number              — Unix ms of cache write
 *   positions:      Float32Array        — [x0,y0,z0, x1,y1,z1, ...]
 *   nodeCount:      number              — Number of nodes
 *   clusterCentroids: Float32Array|null — [cx0,cy0,cz0,r0, ...] per cluster
 *   engine:         string              — "wasm" or "js"
 *   layoutTimeMs:   number              — Time taken to compute
 *   version:        number              — Schema version (currently 1)
 *
 * ── Error Handling ───────────────────────────────────────────────────────
 *
 * All methods fail gracefully when IndexedDB is unavailable (private
 * browsing, quota exceeded, browser restrictions). The plugin continues
 * without caching — layouts are recomputed on every launch.
 *
 * @see 02-TSD.md §5.4 — LayoutCacheEntry data model
 * @see 02-TSD.md §10  — Error handling: IndexedDB unavailable
 */

// ─── Constants ──────────────────────────────────────────────────────────

/** IndexedDB database name. */
const DB_NAME = 'constellation-vr-layout-cache';

/** Object store name for layout entries. */
const STORE_NAME = 'layouts';

/** Schema version — bump to trigger onupgradeneeded for migrations. */
const DB_VERSION = 1;

/** Current cache entry schema version. */
const ENTRY_VERSION = 1;

/** Index name for querying by workspace. */
const WORKSPACE_INDEX = 'by-workspace';

/** Maximum number of entries per workspace before LRU eviction. */
const MAX_ENTRIES_PER_WORKSPACE = 10;

/**
 * Estimated overhead bytes per IndexedDB entry (key, metadata, indexes).
 * Used for getStats() estimation.
 */
const ENTRY_OVERHEAD_BYTES = 256;

// ─── Module-level State ─────────────────────────────────────────────────

/** Database connection handle (opened once, reused). */
let db = null;

/** Whether IndexedDB is available in this environment. */
let indexedDBAvailable = true;

/** Pending open promise to coalesce concurrent open requests. */
let openPromise = null;

// ─── Internal Helpers ───────────────────────────────────────────────────

/**
 * Build the compound cache key from workspace path and graph hash.
 *
 * @param {string} workspacePath
 * @param {string} graphHash
 * @returns {string} Compound key
 */
function buildKey(workspacePath, graphHash) {
  return `${workspacePath}|${graphHash}`;
}

/**
 * Detect whether IndexedDB is available and has reasonable quota.
 *
 * Private browsing in some browsers (Firefox, Safari) disables IndexedDB
 * or throws quota errors. This function returns false so the cache is
 * skipped gracefully (02-TSD.md §10: "IndexedDB unavailable").
 *
 * @returns {boolean}
 */
function isIndexedDBAvailable() {
  try {
    if (typeof indexedDB === 'undefined') return false;
    // Test that indexedDB is not null (can happen in some restricted contexts)
    if (indexedDB === null) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Wrap an IDBRequest in a Promise.
 *
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function idbRequestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      // Handle quota errors gracefully
      const error = request.error;
      if (error && (error.name === 'QuotaExceededError' || error.name === 'AbortError')) {
        indexedDBAvailable = false;
        resolve(null);
      } else {
        reject(error);
      }
    };
  });
}

// ─── Database Lifecycle ─────────────────────────────────────────────────

/**
 * Open (or create/upgrade) the IndexedDB database.
 *
 * @returns {Promise<IDBDatabase|null>} Database handle, or null on failure
 */
async function openDatabase() {
  // Return existing connection if already open
  if (db) return db;

  // Coalesce concurrent open calls
  if (openPromise) return openPromise;

  if (!isIndexedDBAvailable()) {
    indexedDBAvailable = false;
    return null;
  }

  openPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const database = request.result;

        // Create the layouts object store
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: false,
          });

          // Create an index on workspacePath for efficient per-workspace queries
          store.createIndex(WORKSPACE_INDEX, 'workspacePath', { unique: false });
        }
      };

      request.onsuccess = () => {
        db = request.result;

        // Handle unexpected close (e.g., private browsing mode in Safari)
        db.onclose = () => {
          db = null;
          indexedDBAvailable = false;
        };

        // Handle versionchange (another tab opened a newer version)
        db.onversionchange = () => {
          db.close();
          db = null;
        };

        resolve(db);
      };

      request.onerror = () => {
        console.warn('[VR] IndexedDB open failed:', request.error);
        indexedDBAvailable = false;
        resolve(null);
      };

      request.onblocked = () => {
        console.warn('[VR] IndexedDB open blocked (another tab may have the DB open)');
        // Continue without caching
        indexedDBAvailable = false;
        resolve(null);
      };
    } catch (err) {
      console.warn('[VR] IndexedDB unavailable:', err);
      indexedDBAvailable = false;
      resolve(null);
    }
  });

  try {
    const result = await openPromise;
    return result;
  } finally {
    openPromise = null;
  }
}

// ─── Cache Operations ───────────────────────────────────────────────────

/**
 * Save a layout result to the IndexedDB cache.
 *
 * Stores the Float32Array positions directly as an IndexedDB-compatible
 * value. The data is keyed by `workspacePath|graphHash` so a cache hit
 * requires both an exact workspace and graph match.
 *
 * @param {string}           workspacePath — Workspace identifier
 * @param {string}           graphHash     — SHA-256 of graph data
 * @param {Float32Array}     positions     — 3D positions (3 × nodeCount)
 * @param {object}           [metadata]    — Additional data to cache
 * @param {number}           [metadata.nodeCount]
 * @param {Float32Array|null} [metadata.clusterCentroids]
 * @param {string}           [metadata.engine]
 * @param {number}           [metadata.layoutTimeMs]
 * @returns {Promise<boolean>} true if saved successfully, false otherwise
 */
async function save(workspacePath, graphHash, positions, metadata = {}) {
  if (!indexedDBAvailable) return false;

  const database = await openDatabase();
  if (!database) return false;

  try {
    const key = buildKey(workspacePath, graphHash);

    // Build the cache entry (02-TSD.md §5.4)
    const entry = {
      id: key,
      workspacePath,
      graphHash,
      timestamp: Date.now(),
      positions,
      nodeCount: metadata.nodeCount ?? (positions ? positions.length / 3 : 0),
      clusterCentroids: metadata.clusterCentroids ?? null,
      engine: metadata.engine ?? 'unknown',
      layoutTimeMs: metadata.layoutTimeMs ?? 0,
      version: ENTRY_VERSION,
    };

    // Wrap positions in a sanitized object for structured cloning
    // Float32Array is cloneable natively in modern browsers.

    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // LRU eviction: if the workspace has too many entries, delete the oldest
    await evictLeastRecentlyUsed(store, workspacePath);

    // Write the entry
    const request = store.put(entry);
    await idbRequestToPromise(request);

    return true;
  } catch (err) {
    // Quota exceeded or private browsing — disable cache
    console.warn('[VR] Cache write failed:', err);
    indexedDBAvailable = false;
    return false;
  }
}

/**
 * Load a cached layout result.
 *
 * @param {string} workspacePath — Workspace identifier
 * @param {string} graphHash     — SHA-256 of graph data
 * @returns {Promise<LayoutCacheEntry|null>} Cached entry, or null if miss
 */
async function load(workspacePath, graphHash) {
  if (!indexedDBAvailable) return null;

  const database = await openDatabase();
  if (!database) return null;

  try {
    const key = buildKey(workspacePath, graphHash);
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    const result = await idbRequestToPromise(request);

    if (!result) return null;

    // Validate entry structure
    if (!result.positions || !(result.positions instanceof Float32Array)) {
      // Corrupt entry — remove it and return null
      console.warn('[VR] Corrupt cache entry detected; removing');
      await remove(key);
      return null;
    }

    // Validate the positions array has the expected length
    const expectedLength = (result.nodeCount || 0) * 3;
    if (expectedLength > 0 && result.positions.length !== expectedLength) {
      console.warn('[VR] Cache entry has mismatched position length; removing');
      await remove(key);
      return null;
    }

    // Update timestamp to mark as recently used
    result.timestamp = Date.now();
    const touchTx = database.transaction(STORE_NAME, 'readwrite');
    const touchStore = touchTx.objectStore(STORE_NAME);
    // Fire-and-forget timestamp update (non-critical)
    touchStore.put(result).onerror = () => { /* ignore */ };

    return result;
  } catch (err) {
    console.warn('[VR] Cache read failed:', err);
    indexedDBAvailable = false;
    return null;
  }
}

/**
 * Remove a specific cache entry.
 *
 * @param {string} key — Compound key (workspacePath|graphHash)
 * @returns {Promise<boolean>}
 */
async function remove(key) {
  if (!indexedDBAvailable) return false;
  const database = await openDatabase();
  if (!database) return false;

  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    await idbRequestToPromise(store.delete(key));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove all cached layout entries for a given workspace.
 *
 * Used when the user switches workspaces or manually clears the cache.
 *
 * @param {string} workspacePath — Workspace to clear
 * @returns {Promise<boolean>} true if cleared successfully
 */
async function clear(workspacePath) {
  if (!indexedDBAvailable) return false;

  const database = await openDatabase();
  if (!database) return false;

  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index(WORKSPACE_INDEX);

    // Get all entries for this workspace and delete them
    const range = IDBKeyRange.only(workspacePath);
    const cursorRequest = index.openCursor(range);

    await new Promise((resolve, reject) => {
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });

    return true;
  } catch (err) {
    console.warn('[VR] Cache clear failed:', err);
    indexedDBAvailable = false;
    return false;
  }
}

/**
 * Get cache statistics.
 *
 * @returns {Promise<object>} { entryCount, estimatedSizeBytes, available }
 */
async function getStats() {
  const stats = {
    entryCount: 0,
    estimatedSizeBytes: 0,
    available: indexedDBAvailable,
  };

  if (!indexedDBAvailable) return stats;

  const database = await openDatabase();
  if (!database) return { ...stats, available: false };

  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const countRequest = store.count();

    const count = await idbRequestToPromise(countRequest);
    stats.entryCount = count ?? 0;

    // Estimate size by reading each entry's positions buffer size
    // This is approximate — IndexedDB adds its own indexing overhead.
    if (stats.entryCount > 0) {
      const cursorRequest = store.openCursor();
      let totalBytes = 0;

      await new Promise((resolve, reject) => {
        cursorRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const entry = cursor.value;
            // Positions buffer size
            if (entry.positions instanceof Float32Array) {
              totalBytes += entry.positions.byteLength;
            }
            // Cluster centroids
            if (entry.clusterCentroids instanceof Float32Array) {
              totalBytes += entry.clusterCentroids.byteLength;
            }
            // Overhead per entry
            totalBytes += ENTRY_OVERHEAD_BYTES;
            cursor.continue();
          } else {
            resolve();
          }
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
      });

      stats.estimatedSizeBytes = totalBytes;
    }

    return stats;
  } catch (err) {
    console.warn('[VR] Cache stats failed:', err);
    return { ...stats, available: false };
  }
}

// ─── Internal: LRU Eviction ─────────────────────────────────────────────

/**
 * Evict the oldest entries for a workspace if the count exceeds the limit.
 *
 * Keeps only the most recent MAX_ENTRIES_PER_WORKSPACE entries by timestamp.
 *
 * @param {IDBObjectStore} store — Layout object store (readwrite tx)
 * @param {string}         workspacePath
 * @returns {Promise<void>}
 */
async function evictLeastRecentlyUsed(store, workspacePath) {
  try {
    const index = store.index(WORKSPACE_INDEX);
    const range = IDBKeyRange.only(workspacePath);
    const countRequest = index.count(range);
    const currentCount = await idbRequestToPromise(countRequest);

    if (currentCount < MAX_ENTRIES_PER_WORKSPACE) return;

    // Count how many to evict
    const toEvict = currentCount - MAX_ENTRIES_PER_WORKSPACE + 1; // +1 for the new entry

    // Collect entries sorted oldest-first
    const entries = [];
    const cursorRequest = index.openCursor(range);

    await new Promise((resolve, reject) => {
      cursorRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          entries.push({
            key: cursor.primaryKey,
            timestamp: cursor.value.timestamp ?? 0,
          });
          cursor.continue();
        } else {
          resolve();
        }
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });

    // Sort by timestamp ascending (oldest first)
    entries.sort((a, b) => a.timestamp - b.timestamp);

    // Delete the oldest entries
    for (let i = 0; i < Math.min(toEvict, entries.length); i++) {
      store.delete(entries[i].key);
    }
  } catch (err) {
    // Non-critical — warn but don't fail the save
    console.warn('[VR] LRU eviction failed:', err);
  }
}

// ─── Cleanup ────────────────────────────────────────────────────────────

/**
 * Close the database connection.
 * Useful for testing and cleanup.
 */
function close() {
  if (db) {
    db.close();
    db = null;
  }
  indexedDBAvailable = isIndexedDBAvailable();
}

// ─── Exports ────────────────────────────────────────────────────────────

export {
  save,
  load,
  clear,
  getStats,
  close,
};
