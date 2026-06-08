/**
 * VRViewer.js — Holocron VR Three.js Scene Manager
 *
 * Builds and manages the 3D constellation scene using instanced rendering.
 * All nodes share a single InstancedMesh (O(1) draw calls) with per-instance
 * colour, scale, and optional glow overlay for important nodes.
 * Edges use per-type LineSegments (§5.3).
 *
 * Performance targets (06-Performance-Spec.md §1):
 *   Desktop: 60 FPS  |  VR: 72+ FPS  |  Low-end: 30 FPS
 *
 * @see 06-Performance-Spec.md §4  — LOD tiers
 * @see 06-Performance-Spec.md §5  — Instanced rendering
 * @see 06-Performance-Spec.md §8  — GC strategy
 * @see 02-TSD.md §8              — LOD transitions
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ═════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════

const BG_COLOR          = 0x0d0d1a;
const CAMERA_NEAR       = 0.1;
const CAMERA_FAR        = 200;
const CAMERA_FOV        = 60;

/** Sphere geometry detail — 16 radial × 16 height segments. */
const SPHERE_SEGMENTS   = { radial: 16, height: 16 };
const SPHERE_RADIUS     = 1;

/** Low-detail sphere for MID LOD. */
const SPHERE_SEGMENTS_MID = { radial: 8, height: 8 };

/** Scale range based on lines of code. */
const SCALE_MIN = 0.05;
const SCALE_MAX = 0.3;

/** Lines-of-code thresholds for scale mapping. */
const LOC_MIN = 0;
const LOC_MAX = 2000;

/** Node is "important" when incoming dependency count > this. */
const IMPORTANCE_GLOW_THRESHOLD = 5;

/** Glow overlay sphere scale multiplier (slightly larger than node). */
const GLOW_SCALE_MULT = 1.6;

// ─── Per-type colour palette ────────────────────────────────────────────
// Mapped from node.language + path heuristics (06-Performance-Spec.md §5.3).
const TYPE_COLORS = {
  dart:      new THREE.Color(0x60a5fa),   // Blue
  js:        new THREE.Color(0xfbbf24),   // Amber
  ts:        new THREE.Color(0x60a5fa),   // Blue (TS shades)
  tsx:       new THREE.Color(0x60a5fa),
  json:      new THREE.Color(0x34d399),   // Green
  yaml:      new THREE.Color(0x34d399),   // Green (config siblings)
  toml:      new THREE.Color(0x34d399),
  md:        new THREE.Color(0xf472b6),   // Pink (docs)
  css:       new THREE.Color(0xf59e0b),   // Amber/Yellow (styles)
  scss:      new THREE.Color(0xf59e0b),
  html:      new THREE.Color(0xf97316),   // Orange
  py:        new THREE.Color(0x3b82f6),   // Blue-ish
  rs:        new THREE.Color(0xf59e0b),   // Rust orange
  go:        new THREE.Color(0x22d3ee),   // Cyan
  java:      new THREE.Color(0xef4444),   // Red
  kotlin:    new THREE.Color(0x8b5cf6),   // Purple
  swift:     new THREE.Color(0xf97316),
  _test:     new THREE.Color(0x9ca3af),   // Grey (test files)
  _asset:    new THREE.Color(0xfbbf24),   // Yellow (static assets)
  _folder:   new THREE.Color(0x6b7280),   // Dim grey
};

const COLOR_DEFAULT = new THREE.Color(0x6b7280); // Grey fallback

// ─── LOD thresholds (06-Performance-Spec.md §4) ─────────────────────────
const LOD_NEAR   = 5;
const LOD_MID    = 15;
const LOD_FAR    = 30;
const HYSTERESIS = 0.5;

const EDGE_CULL_DIST = 15;
const CLUSTER_AGGREGATE_DIST = 20;
const FPS_WINDOW   = 30;
const LOW_FPS_THR  = 45;

// ─── Edge colour map (03-UI-Spec.md §6) ─────────────────────────────────
const EDGE_COLORS = {
  import:       0xffffff,   // White
  call:         0xff8c42,   // Orange
  inheritance:  0xc084fc,   // Purple
  composition:  0x4ecdc4,   // Teal
};
const EDGE_COLOR_DEFAULT = 0x6b7280;

/** Edge linewidth (WebGL ignores > 1 on most platforms; see fallback below). */
const EDGE_LINEWIDTH = 1;

// ─── LOD tier enum ─────────────────────────────────────────────────────
const LOD = Object.freeze({ FULL: 0, MID: 1, DOT: 2, CULLED: 3 });

// ─── Pooled scratch objects (§8.1) ──────────────────────────────────────
const _vec3   = new THREE.Vector3();
const _quat   = new THREE.Quaternion();
const _mat4   = new THREE.Matrix4();
const _color  = new THREE.Color();
const _pos       = new THREE.Vector3();
const _center    = new THREE.Vector3();
const _scaleVec  = new THREE.Vector3();  // Pooled for setFromMatrixScale
const _raycaster = new THREE.Raycaster();

// ═════════════════════════════════════════════════════════════════════════
//  HELPER — Map path to file-type colour
// ═════════════════════════════════════════════════════════════════════════

/**
 * Pick instance colour from a node's language and path heuristics.
 *
 * Rules:
 *   - Path matching /test/ or /spec/ or ending _test → test grey
 *   - Path matching /assets/ or /static/ or /images/ → asset yellow
 *   - type === 'folder' → dim grey
 *   - Otherwise → lookup by node.language
 */
function getNodeColor(node) {
  const p = (node.path || node.id || '').toLowerCase();
  const lang = (node.language || '').toLowerCase();

  if (node.type === 'folder') return TYPE_COLORS._folder;
  if (/\/test(s)?\//.test(p) || /\/spec\//.test(p) || /_test\./.test(p) || /\.spec\./.test(p)) {
    return TYPE_COLORS._test;
  }
  if (/\/assets?\//.test(p) || /\/static\//.test(p) || /\/images?\//.test(p) || /\/fonts?\//.test(p)) {
    return TYPE_COLORS._asset;
  }
  return TYPE_COLORS[lang] || COLOR_DEFAULT;
}

// ═════════════════════════════════════════════════════════════════════════
//  HELPER — Map LOC to scale in [SCALE_MIN, SCALE_MAX]
// ═════════════════════════════════════════════════════════════════════════

function locToScale(loc) {
  const clamped = Math.max(LOC_MIN, Math.min(LOC_MAX, loc || 0));
  const t = clamped / LOC_MAX; // 0..1
  return SCALE_MIN + t * (SCALE_MAX - SCALE_MIN);
}

// ═════════════════════════════════════════════════════════════════════════
//  VRViewer
// ═════════════════════════════════════════════════════════════════════════

class VRViewer {
  /**
   * @param {HTMLElement} container  — DOM mount point
   * @param {object}      [options]
   */
  constructor(container, options = {}) {
    if (!container) throw new Error('VRViewer requires a container element');

    this.container = container;
    this.config = {
      lodNear:  options.lodNear  ?? LOD_NEAR,
      lodMid:   options.lodMid   ?? LOD_MID,
      lodFar:   options.lodFar   ?? LOD_FAR,
      maxNodes: options.maxNodes ?? 3000,
    };

    this.isVRActive  = false;
    this.animationId = null;
    this.clock       = new THREE.Clock();

    // Three.js objects
    this.scene    = null;
    this.camera   = null;
    this.renderer = null;
    this.controls = null;

    // Scene contents
    this.nodesMesh          = null;  // Main InstancedMesh
    this.glowMesh           = null;  // Glow overlay InstancedMesh
    this.edgeSegments       = [];
    this._clusterAggregateMesh = null;
    this._clusterCentroids  = [];
    this._clusterIds        = [];
    this.lodData            = [];    // { tier, prevTier, scale }
    this.nodeIdMap          = null;  // nodeId → instance index
    this.nodeData           = null;  // instance index → { id, importance }

    // FPS / perf
    this._frameTimes        = [];
    this._frameCount        = 0;
    this._edgeUpdateCounter = 0;
    this.lowPerfMode        = false;
    this._firstFrameLogged  = false;

    // LOD geometry cache
    this._sphereGeomFull = null;
    this._sphereGeomMid  = null;
    this._glowGeom       = null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════════════════

  async init() {
    this.renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(BG_COLOR, 1);
    this.renderer.shadowMap.enabled = false;
    if (this.renderer.xr) this.renderer.xr.enabled = true;

    this.container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);
    this.scene.fog = new THREE.Fog(BG_COLOR, 40, 80);

    // Camera
    const aspect = this.container.clientWidth / this.container.clientHeight || 1;
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, CAMERA_NEAR, CAMERA_FAR);
    this.camera.position.set(0, 5, 20);
    this.camera.lookAt(0, 0, 0);

    // Lights
    this._setupLights();

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance   = 2;
    this.controls.maxDistance   = 80;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    // Click handler (node selection)
    this._attachClickHandler();

    // Resize
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    console.log('[VR] Three.js scene initialised');
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0x404060, 0.6));

    const positions = [
      { x: 20, y: 15, z: 20, color: 0x7c3aed, i: 80 },
      { x: -20, y: 10, z: -15, color: 0x2563eb, i: 60 },
      { x: 10, y: -10, z: -25, color: 0x8b5cf6, i: 50 },
    ];
    for (const p of positions) {
      const l = new THREE.PointLight(p.color, p.i, 60);
      l.position.set(p.x, p.y, p.z);
      this.scene.add(l);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  RENDER — Build / update the full scene
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Build or update the scene with graph data.
   * Called once after layout computation completes.
   *
   * @param {object[]}       nodes     — GraphNode[]
   * @param {object[]}       edges     — GraphEdge[]
   * @param {Float32Array}   positions — Flat [x,y,z, x,y,z, ...]
   */
  render(nodes, edges, positions) {
    if (!this.scene) return;
    this._disposeSceneObjects();

    const maxNodes = Math.min(nodes.length, this.config.maxNodes);
    this.nodeIdMap = new Map();
    this.nodeData  = new Array(maxNodes);

    // Build geometry cache
    this._sphereGeomFull = new THREE.SphereGeometry(SPHERE_RADIUS, SPHERE_SEGMENTS.radial, SPHERE_SEGMENTS.height);
    this._sphereGeomMid  = new THREE.SphereGeometry(SPHERE_RADIUS, SPHERE_SEGMENTS_MID.radial, SPHERE_SEGMENTS_MID.height);
    this._glowGeom       = new THREE.SphereGeometry(SPHERE_RADIUS, SPHERE_SEGMENTS_MID.radial, SPHERE_SEGMENTS_MID.height);

    // ── Main node InstancedMesh ───────────────────────────────────────
    const nodeMat = new THREE.MeshStandardMaterial({
      roughness:    0.6,
      metalness:    0.1,
      vertexColors: true,
    });
    this.nodesMesh = new THREE.InstancedMesh(this._sphereGeomMid, nodeMat, maxNodes);
    this.nodesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const colorArray = new Float32Array(maxNodes * 3);
    this.nodesMesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
    this.nodesMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // ── Glow overlay InstancedMesh ─────────────────────────────────────
    // Important nodes (incoming deps > threshold) get a translucent
    // outer sphere. Only instantiated if any nodes qualify.
    let glowCount = 0;
    for (let i = 0; i < maxNodes; i++) {
      if ((nodes[i].importance ?? 0) > IMPORTANCE_GLOW_THRESHOLD) glowCount++;
    }

    let glowInstances = 0;
    if (glowCount > 0) {
      const glowMat = new THREE.MeshBasicMaterial({
        color:        0x7c3aed,
        transparent:  true,
        opacity:      0.12,
        depthWrite:   false,
      });
      this.glowMesh = new THREE.InstancedMesh(this._glowGeom, glowMat, glowCount);
      this.glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }

    // ── Populate instances ────────────────────────────────────────────
    for (let i = 0, gi = 0; i < maxNodes; i++) {
      const node = nodes[i];
      this.nodeIdMap.set(node.id, i);
      const path = (node.path || node.id || '').toLowerCase();
      const lang = (node.language || '').toLowerCase();
      this.nodeData[i] = {
        id: node.id,
        importance: node.importance ?? 0,
        color: null,
        scale: locToScale(node.size ?? 0),
        language: lang,
        changeFrequency: node.changeFrequency ?? 0,
        isTest: /\/test(s)?\//.test(path) || /_test\./.test(path) || /\/spec\//.test(path) || /\.spec\./.test(path),
        isThirdParty: /\/node_modules\//.test(path) || /\/\.pub-cache\//.test(path) || /\/vendor\//.test(path),
        isGenerated: /\.g\.dart$/.test(path) || /\.freezed\.dart$/.test(path) || /\/generated\//.test(path),
      };

      // Position
      const px = positions[i * 3]     ?? 0;
      const py = positions[i * 3 + 1] ?? 0;
      const pz = positions[i * 3 + 2] ?? 0;

      // Scale from LOC
      const scale = locToScale(node.size ?? 0);

      // Instance matrix (position + uniform scale)
      _mat4.identity();
      _mat4.makeScale(scale, scale, scale);
      _mat4.setPosition(px, py, pz);
      this.nodesMesh.setMatrixAt(i, _mat4);

      // Colour
      const c = getNodeColor(node);
      this.nodesMesh.setColorAt(i, c);
      this.nodeData[i].color = c.clone(); // ← store for restore

      // Glow overlay
      if (this.glowMesh && (node.importance ?? 0) > IMPORTANCE_GLOW_THRESHOLD) {
        const gScale = scale * GLOW_SCALE_MULT;
        _mat4.identity();
        _mat4.makeScale(gScale, gScale, gScale);
        _mat4.setPosition(px, py, pz);
        this.glowMesh.setMatrixAt(gi, _mat4);
        gi++;
      }
    }

    this.nodesMesh.instanceMatrix.needsUpdate = true;
    if (this.nodesMesh.instanceColor) this.nodesMesh.instanceColor.needsUpdate = true;
    this.scene.add(this.nodesMesh);

    if (this.glowMesh) {
      this.glowMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(this.glowMesh);
    }

    // ── LOD state ──────────────────────────────────────────────────────
    this.lodData = new Array(maxNodes);
    for (let i = 0; i < maxNodes; i++) {
      this.lodData[i] = { tier: LOD.MID, prevTier: LOD.MID, scale: locToScale(nodes[i].size ?? 0) };
    }

    // ── Cluster centroids (for edge aggregation) ──────────────────────
    this._clusterCentroids = [];
    this._clusterIds = new Int32Array(maxNodes);
    for (let i = 0; i < maxNodes; i++) {
      this._clusterIds[i] = nodes[i].clusterId ?? -1;
      const cid = this._clusterIds[i];
      if (cid >= 0 && !this._clusterCentroids[cid]) {
        // Extract centroid from node's initial seed position
        this._clusterCentroids[cid] = [
          positions[i * 3] ?? 0,
          positions[i * 3 + 1] ?? 0,
          positions[i * 3 + 2] ?? 0,
        ];
      }
    }

    // ── Edges ──────────────────────────────────────────────────────────
    this._buildEdgeSegments(edges, positions, maxNodes);

    // ── Camera framing ────────────────────────────────────────────────
    this._frameScene(positions, maxNodes);

    // ── Initialise filter state ────────────────────────────────────
    this._instanceVisible = new Array(maxNodes).fill(true);
    this._filters = Object.fromEntries(
      Object.keys(this._filters).map((k) => [k, false])
    );
    this._applyFilters();

    console.log(`[VR] Scene rendered: ${maxNodes} nodes (${glowCount} glow) ${edges.length} edges`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PER-INSTANCE UPDATES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Update the instance colour for a single node.
   * Pooled _color — no GC pressure (06-Performance-Spec.md §8.1).
   *
   * @param {number}   index  — Instance index
   * @param {THREE.Color|number|string} colour — Colour value
   */
  updateNodeColor(index, colour) {
    if (!this.nodesMesh || !this.nodesMesh.instanceColor) return;
    _color.set(colour);
    this.nodesMesh.setColorAt(index, _color);
    this.nodesMesh.instanceColor.needsUpdate = true;
  }

  /**
   * Update the instance scale for a single node.
   *
   * @param {number} index  — Instance index
   * @param {number} scale  — Uniform scale factor
   */
  updateNodeScale(index, scale) {
    if (!this.nodesMesh) return;
    const clamped = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale));

    this.nodesMesh.getMatrixAt(index, _mat4);
    const pos = _pos.setFromMatrixPosition(_mat4);

    _mat4.identity();
    _mat4.makeScale(clamped, clamped, clamped);
    _mat4.setPosition(pos);
    this.nodesMesh.setMatrixAt(index, _mat4);
    this.nodesMesh.instanceMatrix.needsUpdate = true;

    // Update glow if applicable
    if (this.glowMesh && this.nodeData && this.nodeData[index]) {
      const gi = this._glowIndex(index);
      if (gi >= 0) {
        const gScale = clamped * GLOW_SCALE_MULT;
        this.glowMesh.getMatrixAt(gi, _mat4);
        _mat4.identity();
        _mat4.makeScale(gScale, gScale, gScale);
        _mat4.setPosition(pos);
        this.glowMesh.setMatrixAt(gi, _mat4);
        this.glowMesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /** Find glow instance index for a node instance (linear scan — called rarely). */
  _glowIndex(nodeIdx) {
    if (!this.nodeData) return -1;
    if ((this.nodeData[nodeIdx]?.importance ?? 0) <= IMPORTANCE_GLOW_THRESHOLD) return -1;
    let gi = 0;
    for (let i = 0; i < nodeIdx; i++) {
      if ((this.nodeData[i]?.importance ?? 0) > IMPORTANCE_GLOW_THRESHOLD) gi++;
    }
    return gi;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  EDGES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Build per-type LineSegments for all edges and cluster aggregation lines.
   *
   * Edge colour + thickness per 03-UI-Spec.md §6:
   *   import      → white,     0.01 units
   *   call        → orange,    0.02 units
   *   inheritance → purple,    0.015 units
   *   composition → teal,      0.01 units
   *
   * Since WebGL linewidth is ignored on most platforms, thickness is
   * encoded visually via opacity and colour brightness instead.
   * A future pass may use three/addons LineSegments2 for true thickness.
   *
   * Cluster aggregation (§6.2): when individual edges per cluster pair
   * exceed CLUSTER_AGGREGATE_DIST from camera, a single aggregated line
   * is shown between cluster centroids instead.
   */
  _buildEdgeSegments(edges, positions, maxNodes) {
    // ── Build per-edge-type vertex arrays ────────────────────────────
    // Store per-edge metadata (source/target positions + cluster IDs)
    // for per-segment culling and cluster aggregation.
    const groups = {};
    for (const e of edges) {
      if (!groups[e.type]) groups[e.type] = { edges: [], positions: [] };
      const g = groups[e.type];
      const si = this.nodeIdMap.get(e.source);
      const ti = this.nodeIdMap.get(e.target);
      if (si === undefined || ti === undefined || si >= maxNodes || ti >= maxNodes) continue;

      const sx = positions[si * 3], sy = positions[si * 3 + 1], sz = positions[si * 3 + 2];
      const tx = positions[ti * 3], ty = positions[ti * 3 + 1], tz = positions[ti * 3 + 2];
      g.positions.push(sx, sy, sz, tx, ty, tz);
      g.edges.push({
        sx, sy, sz, tx, ty, tz,
        srcCluster: this._getClusterId(si),
        tgtCluster: this._getClusterId(ti),
      });
    }
    this.edgeSegments = [];

    for (const [type, g] of Object.entries(groups)) {
      if (g.positions.length === 0) continue;

      const col = EDGE_COLORS[type] ?? EDGE_COLOR_DEFAULT;
      const geom = new THREE.BufferGeometry();
      const attr = new THREE.Float32BufferAttribute(g.positions, 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('position', attr);

      // Opacity inversely proportional to thickness — thicker = less transparent
      const thicknessHint = { import: 0.35, call: 0.45, inheritance: 0.40, composition: 0.35 };
      const opacity = thicknessHint[type] ?? 0.3;

      const mat = new THREE.LineBasicMaterial({
        color: col,
        transparent: true,
        opacity,
        linewidth: EDGE_LINEWIDTH,
      });

      const seg = new THREE.LineSegments(geom, mat);
      this.scene.add(seg);
      this.edgeSegments.push({ mesh: seg, type, metadata: g.edges });
    }

    // ── Build cluster aggregation lines ──────────────────────────────
    // One line per pair of connected clusters, at half opacity.
    if (this._clusterCentroids && this._clusterCentroids.length > 0) {
      this._buildClusterAggregationLines(edges, positions, maxNodes);
    }
  }

  /**
   * Build aggregated lines between cluster centroids for distant viewing.
   * Runs once during render(); visibility is toggled in _updateEdgeVisibility.
   */
  _buildClusterAggregationLines(edges, positions, maxNodes) {
    const pairs = new Map();
    for (const e of edges) {
      const si = this.nodeIdMap.get(e.source);
      const ti = this.nodeIdMap.get(e.target);
      if (si === undefined || ti === undefined) continue;

      const sc = this._getClusterId(si);
      const tc = this._getClusterId(ti);
      if (sc === tc || sc < 0 || tc < 0) continue;

      const key = sc < tc ? `${sc}|${tc}` : `${tc}|${sc}`;
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
    if (pairs.size === 0) return;

    const arr = [];
    for (const [key, count] of pairs) {
      const [a, b] = key.split('|').map(Number);
      const ca = this._clusterCentroids[a];
      const cb = this._clusterCentroids[b];
      if (!ca || !cb) continue;
      arr.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2]);
    }
    if (arr.length === 0) return;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x6b7280,
      transparent: true,
      opacity: 0.12,
    });
    const mesh = new THREE.LineSegments(geom, mat);
    mesh.visible = false;  // Only shown when camera is far enough
    this.scene.add(mesh);
    this._clusterAggregateMesh = mesh;
  }

  /**
   * Return the cluster ID for a node instance index, or -1 if unknown.
   */
  _getClusterId(instanceIdx) {
    if (!this._clusterIds || instanceIdx >= this._clusterIds.length) return -1;
    return this._clusterIds[instanceIdx];
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CAMERA FRAMING
  // ═══════════════════════════════════════════════════════════════════════

  _frameScene(positions, count) {
    if (count === 0) return;
    let [minX, maxX, minY, maxY, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    const n = Math.min(count, this.config.maxNodes);
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
    if (this.controls) {
      this.controls.target.set(cx, cy, cz);
      this.camera.position.set(cx, cy + size * 0.5, cz + size * 1.5);
      this.controls.update();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ANIMATION LOOP
  // ═══════════════════════════════════════════════════════════════════════

  start() {
    if (this.animationId !== null) return;
    const startTime = performance.now();

    const animate = () => {
      this.animationId = requestAnimationFrame(animate);

      if (!this._firstFrameLogged) {
        console.log(`[VR PERF] first_frame_ms: ${(performance.now() - startTime).toFixed(1)}`);
        this._firstFrameLogged = true;
      }

      this.clock.getDelta();

      if (this.nodesMesh && this.lodData.length > 0) this._updateLOD();

      // Process LOD transitions (10-frame interpolation)
      this._processLODTransitions();

      this._edgeUpdateCounter++;
      if (this._edgeUpdateCounter % 3 === 0) this.updateEdgeVisibility();

      if (this.controls) this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this._trackFPS();
    };
    animate();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  LOD — Per-frame tier updates (§4)
  // ═══════════════════════════════════════════════════════════════════════

  _updateLOD() {
    const camPos = this.camera.position;
    const { lodNear, lodMid, lodFar } = this.config;

    // Throttle: geometry swaps every 3 frames max (§6.3)
    this._lodSwapThrottle++;
    const allowSwap = this._lodSwapThrottle % 3 === 0;

    for (let i = 0; i < this.lodData.length; i++) {
      this.nodesMesh.getMatrixAt(i, _mat4);
      _pos.setFromMatrixPosition(_mat4);
      const dist = camPos.distanceTo(_pos);
      const prev = this.lodData[i].tier;

      let tier;
      if      (dist < lodNear)                                          tier = LOD.FULL;
      else if (dist < lodNear + HYSTERESIS && prev === LOD.FULL)        tier = LOD.FULL;
      else if (dist < lodMid)                                           tier = LOD.MID;
      else if (dist < lodMid + HYSTERESIS && prev === LOD.MID)          tier = LOD.MID;
      else if (dist < lodFar)                                           tier = LOD.DOT;
      else if (dist < lodFar + HYSTERESIS && prev === LOD.DOT)          tier = LOD.DOT;
      else                                                              tier = LOD.CULLED;

      if (tier !== prev) {
        this.lodData[i].tier = tier;
        this.lodData[i].prevTier = prev;
        // Queue 10-frame linear interpolation transition (§4: transition)
        this._lodTransitions.push({
          index: i,
          fromScale: this._lodScaleFactor(prev),
          toScale: this._lodScaleFactor(tier),
          frame: 0, maxFrames: 10,
        });
        // Apply visual change immediately (throttled)
        if (allowSwap) this._applyLODVisual(i, tier);
      }
    }
  }

  /**
   * Apply a new LOD tier to a node instance.
   *
   * FULL  → high-detail sphere, normal colour
   * MID   → mid-detail sphere, slightly dimmed
   * DOT   → point sprite (small sphere), no glow
   * CULLED→ invisible
   */
  _lodScaleFactor(tier) {
    switch (tier) {
      case LOD.FULL:   return 1.0;
      case LOD.MID:    return 0.7;
      case LOD.DOT:    return 0.15;
      case LOD.CULLED: return 0;
      default:         return 0.7;
    }
  }

  /** Apply LOD visual change (throttled to every 3 frames). */
  _applyLODVisual(index, tier) {
    if (!this.nodesMesh) return;
    this.nodesMesh.getMatrixAt(index, _mat4);
    const pos = _pos.setFromMatrixPosition(_mat4);
    const baseScale = this.lodData[index]?.scale ?? SCALE_MIN;
    const sf = this._lodScaleFactor(tier);
    const finalScale = baseScale * sf;

    if (tier === LOD.CULLED) {
      _mat4.identity(); _mat4.makeScale(0,0,0); _mat4.setPosition(pos);
      this.nodesMesh.setMatrixAt(index, _mat4);
      this.nodesMesh.instanceMatrix.needsUpdate = true;
      if (this.glowMesh) {
        const gi = this._glowIndex(index);
        if (gi >= 0) {
          _mat4.identity(); _mat4.makeScale(0,0,0); _mat4.setPosition(pos);
          this.glowMesh.setMatrixAt(gi, _mat4);
          this.glowMesh.instanceMatrix.needsUpdate = true;
        }
      }
      return;
    }

    _mat4.identity(); _mat4.makeScale(finalScale,finalScale,finalScale); _mat4.setPosition(pos);
    this.nodesMesh.setMatrixAt(index, _mat4);
    this.nodesMesh.instanceMatrix.needsUpdate = true;

    if (this.glowMesh) {
      const gi = this._glowIndex(index);
      if (gi >= 0) {
        if (tier === LOD.DOT) {
          _mat4.identity(); _mat4.makeScale(0,0,0); _mat4.setPosition(pos);
        } else {
          _mat4.identity(); _mat4.makeScale(baseScale*GLOW_SCALE_MULT*sf,baseScale*GLOW_SCALE_MULT*sf,baseScale*GLOW_SCALE_MULT*sf); _mat4.setPosition(pos);
        }
        this.glowMesh.setMatrixAt(gi, _mat4);
        this.glowMesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  LOD TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Process queued LOD transitions: interpolate scale over 10 frames.
   * Called every frame from the animation loop.
   */
  _processLODTransitions() {
    if (this._lodTransitions.length === 0) return;
    const remaining = [];
    for (const t of this._lodTransitions) {
      t.frame++;
      const progress = t.frame / t.maxFrames;
      const eased = progress; // linear interpolation
      const currentScale = t.fromScale + (t.toScale - t.fromScale) * eased;
      const baseScale = this.lodData[t.index]?.scale ?? SCALE_MIN;
      const finalScale = baseScale * currentScale;

      this.nodesMesh.getMatrixAt(t.index, _mat4);
      const tpos = _pos.setFromMatrixPosition(_mat4);
      _mat4.identity(); _mat4.makeScale(finalScale,finalScale,finalScale); _mat4.setPosition(tpos);
      this.nodesMesh.setMatrixAt(t.index, _mat4);
      this.nodesMesh.instanceMatrix.needsUpdate = true;

      if (t.frame < t.maxFrames) remaining.push(t);
    }
    this._lodTransitions = remaining;
  }

  /**
   * Auto-reduce LOD thresholds when FPS drops below 45 for 3+ seconds (§10).
   */
  _checkAutoLODReduction(currentFps) {
    if (currentFps >= 45) {
      this._lowFpsStart = 0;
      return;
    }
    if (this._lowFpsStart === 0) {
      this._lowFpsStart = performance.now();
      return;
    }
    if (this._autoReduced) return;
    if (performance.now() - this._lowFpsStart < 3000) return;

    // Reduce thresholds by 30%
    this.config.lodNear = Math.round(this.config.lodNear * 0.7);
    this.config.lodMid  = Math.round(this.config.lodMid  * 0.7);
    this.config.lodFar  = Math.round(this.config.lodFar  * 0.7);
    this._autoReduced = true;
    console.warn(`[VR] Auto-reduced LOD thresholds (FPS < 45 for 3s): Near=${this.config.lodNear} Mid=${this.config.lodMid} Far=${this.config.lodFar}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  EDGE VISIBILITY CULLING (06-Performance-Spec.md §6)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Public method: update edge visibility based on camera position.
   * Called from the animation loop every 3 frames (§6.3).
   *
   * For each per-type edge segment:
   *   1. Per-segment culling: edge visible only if both endpoints < 15 units
   *   2. Cluster aggregation: when cluster centroids are > 20 units from
   *      camera, show aggregated inter-cluster lines instead of individual edges
   *
   * @param {THREE.Camera} [camera] — Override camera (defaults to this.camera)
   */
  updateEdgeVisibility(camera) {
    const p = camera || this.camera;
    if (!p) return;
    this._updateEdgeVisibility(p);
  }

  /**
   * Internal per-segment and cluster-aggregation edge culling.
   * Runs every 3 frames from the animation loop.
   */
  _updateEdgeVisibility(camPos) {
    // ── Per-segment culling (§6.1) ───────────────────────────────────
    for (const seg of this.edgeSegments) {
      const arr = seg.mesh.geometry.attributes.position.array;
      let anyVisible = false;
      for (let i = 0; i < arr.length; i += 6) {
        _vec3.set(arr[i], arr[i + 1], arr[i + 2]);
        const sd = camPos.distanceTo(_vec3);
        _vec3.set(arr[i + 3], arr[i + 4], arr[i + 5]);
        const td = camPos.distanceTo(_vec3);
        if (sd < EDGE_CULL_DIST && td < EDGE_CULL_DIST) {
          anyVisible = true;
          break;
        }
      }
      seg.mesh.visible = anyVisible;
    }

    // ── Cluster aggregation lines (§6.2) ─────────────────────────────
    if (!this._clusterAggregateMesh || this._clusterCentroids.length === 0) return;
    const centroids = this._clusterCentroids;
    let anyClusterFar = false;
    for (let c = 0; c < centroids.length; c++) {
      const cent = centroids[c];
      if (!cent) continue;
      _vec3.set(cent[0], cent[1], cent[2]);
      if (camPos.distanceTo(_vec3) > CLUSTER_AGGREGATE_DIST) {
        anyClusterFar = true;
        break;
      }
    }
    // Show aggregate lines when any cluster is far, AND hide individual
    // edges that cross the threshold
    this._clusterAggregateMesh.visible = anyClusterFar;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  FPS TRACKING
  // ═══════════════════════════════════════════════════════════════════════

  _trackFPS() {
    this._frameTimes.push(performance.now());
    this._frameCount++;
    while (this._frameTimes.length > FPS_WINDOW) this._frameTimes.shift();

    if (this._frameTimes.length >= 2 && this._frameCount % 60 === 0) {
      const elapsed = this._frameTimes[this._frameTimes.length - 1] - this._frameTimes[0];
      const fps = (this._frameTimes.length - 1) / (elapsed / 1000);
      console.log(`[VR PERF] fps_rolling: ${fps.toFixed(1)}`);
      this._checkAutoLODReduction(fps);
      if (fps < LOW_FPS_THR && !this.lowPerfMode) {
        this.lowPerfMode = true;
        console.warn(`[VR] Low perf mode (FPS: ${fps.toFixed(1)})`);
        this.config.lodNear = Math.round(this.config.lodNear * 0.7);
        this.config.lodMid  = Math.round(this.config.lodMid * 0.7);
        this.config.lodFar  = Math.round(this.config.lodFar * 0.7);
        for (const s of this.edgeSegments) s.mesh.material.opacity = 0.15;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  NODE SELECTION & HIGHLIGHT
  // ═══════════════════════════════════════════════════════════════════════

  /** Currently selected node ID, or null. */
  _selectedNodeId = null;

  /** Active filters: { type: enabled, ... } */
  _filters = {
    tests:       false,
    thirdParty:  false,
    generated:   false,
    recent:      false,
    // Language filters — disabled by default (show all languages)
    dart:        false,
    json:        false,
    yaml:        false,
    markdown:    false,
  };

  /** Per-instance visibility flags (true = visible). */
  _instanceVisible = [];

  /** Dirty flag: instance matrix needs update after filter change. */
  _filterDirty = false;

  /** Minimum changeFrequency for 'recent' filter. */
  _recentThreshold = 3;

  /** Previously selected node ID (for restore on deselect). */
  _prevSelectedNodeId = null;

  /** Generic event listeners. */
  _viewerListeners = {};

  /** Event listeners for selection changes. */
  _selectListeners = [];

  /**
   * Register a general viewer event listener.
   * @param {'node-selected'|'node-deselected'} event
   * @param {Function} fn
   */
  on(event, fn) {
    if (!this._viewerListeners[event]) this._viewerListeners[event] = [];
    this._viewerListeners[event].push(fn);
  }
  _emit(event, data) {
    for (const fn of (this._viewerListeners[event] || [])) {
      try { fn(data); } catch (e) { console.warn('[VR] event error:', e); }
    }
  }

  /**
   * Register a callback for node selection changes.
   * @param {Function} fn — Called with (nodeId | null, instanceIdx | -1)
   */
  onSelect(fn) { this._selectListeners.push(fn); }

  /**
   * Remove a previously registered selection callback.
   * @param {Function} fn
   */
  offSelect(fn) {
    const i = this._selectListeners.indexOf(fn);
    if (i !== -1) this._selectListeners.splice(i, 1);
  }

  /** Notify all selection listeners. */
  _emitSelect(nodeId, instanceIdx) {
    for (const fn of this._selectListeners) {
      try { fn(nodeId, instanceIdx); } catch (e) {
        console.warn('[VR] select listener error:', e);
      }
    }
  }

  /**
   * Select a node by screen-space coordinates (desktop click).
   * Returns the selected node ID or null.
   * @param {number} x — Normalised device X (-1 to 1)
   * @param {number} y — Normalised device Y (-1 to 1)
   * @returns {string|null}
   */
  selectNode(x, y) {
    if (!this.nodesMesh || !this.camera) return null;
    _raycaster.setFromCamera({ x, y }, this.camera);
    const hits = _raycaster.intersectObject(this.nodesMesh);
    if (hits.length === 0) {
      this.clearSelection();
      return null;
    }
    const idx = hits[0].instanceId;
    for (const [id, i] of this.nodeIdMap) {
      if (i === idx) {
        this._setSelection(id, idx);
        return id;
      }
    }
    this.clearSelection();
    return null;
  }

  /**
   * Select a node by its node ID (used by VR controller).
   * @param {string} nodeId
   */
  selectNodeById(nodeId) {
    const idx = this.nodeIdMap?.get(nodeId);
    if (idx === undefined) { this.clearSelection(); return; }
    this._setSelection(nodeId, idx);
  }

  /**
   * Clear the current selection and restore normal colours.
   */
  clearSelection() {
    if (this._selectedNodeId === null) return;
    this._restoreNodeColor(this._prevSelectedNodeId);
    this._selectedNodeId = null;
    this._prevSelectedNodeId = null;
    this._emitSelect(null, -1);
  }

  /**
   * Internal — set selection, apply highlight to new node,
   * restore previous node's colour.
   */
  _setSelection(nodeId, instanceIdx) {
    // Restore previous node colour
    if (this._selectedNodeId !== null && this._prevSelectedNodeId !== null) {
      this._restoreNodeColor(this._prevSelectedNodeId);
    }
    this._prevSelectedNodeId = this._selectedNodeId;
    this._selectedNodeId = nodeId;

    // Highlight new node
    this._highlightNode(instanceIdx);
    this._emitSelect(nodeId, instanceIdx);
  }

  /**
   * Apply highlight visual to a node instance.
   * Uses bright cyan colour + glow mesh activation.
   * @param {number} instanceIdx
   */
  _highlightNode(instanceIdx) {
    if (!this.nodesMesh) return;
    _color.set(0x22d3ee); // Cyan highlight
    this.nodesMesh.setColorAt(instanceIdx, _color);
    this.nodesMesh.instanceColor.needsUpdate = true;

    // Also highlight glow mesh if present
    if (this.glowMesh) {
      _color.set(0x22d3ee);
      this.glowMesh.setColorAt(instanceIdx, _color);
      this.glowMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Restore a node's colour from nodeData cache.
   * @param {string} nodeId
   */
  _restoreNodeColor(nodeId) {
    if (!this.nodesMesh || !this.nodeData || !this.nodeIdMap) return;
    const idx = this.nodeIdMap.get(nodeId);
    if (idx === undefined) return;
    const data = this.nodeData[idx];
    if (data?.color) {
      this.nodesMesh.setColorAt(idx, data.color);
      this.nodesMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Get the current selected node ID.
   * @returns {string|null}
   */
  getSelectedNodeId() { return this._selectedNodeId; }

  /**
   * Get the instance index for a node ID.
   * @param {string} nodeId
   * @returns {number|undefined}
   */
  getNodeIndex(nodeId) { return this.nodeIdMap?.get(nodeId); }

  /**
   * Get cached node data by index.
   * @param {number} idx
   * @returns {object|undefined}
   */
  getNodeData(idx) { return this.nodeData?.[idx]; }

  // ═══════════════════════════════════════════════════════════════════════
  //  FILTER SYSTEM
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Set a filter on/off and reapply visibility to all instances.
   *
   * Supported filter types:
   *   'tests'      — files matching /test|_test|/spec/ in path
   *   'thirdParty' — files under node_modules, .pub-cache, vendor/
   *   'generated'  — files matching .g.dart, .freezed.dart, generated/
   *   'recent'     — only show files with changeFrequency > threshold
   *   Any language string — 'dart', 'json', 'yaml', etc.
   *
   * When a language filter is enabled, ONLY nodes of that language are shown.
   * When disabled, all languages are shown (unless other filters apply).
   *
   * @param {string}  type     — Filter type key
   * @param {boolean} enabled  — true = activate, false = deactivate
   */
  setFilter(type, enabled) {
    if (!(type in this._filters)) {
      console.warn(`[VR] Unknown filter type: ${type}`);
      return;
    }
    this._filters[type] = enabled;
    this._applyFilters();
    this._filterDirty = true;
    this._emit('filter-change', { type, enabled, filters: { ...this._filters } });
  }

  /**
   * Get the current filter state.
   * @returns {object}
   */
  getFilters() { return { ...this._filters }; }

  /**
   * Set a filter threshold for 'recent' mode.
   * @param {number} threshold  — Minimum changeFrequency (default 3)
   */
  setRecentThreshold(threshold = 3) {
    this._recentThreshold = threshold;
    if (this._filters.recent) this._applyFilters();
  }

  /**
   * Recompute per-instance visibility based on all active filters.
   *
   * A node is visible if it passes ALL active filters (AND logic).
   * When no filters are active, all nodes are visible.
   */
  _applyFilters() {
    if (!this.nodesMesh || !this.nodeData) return;

    const activeFilters = Object.entries(this._filters)
      .filter(([, enabled]) => enabled)
      .map(([type]) => type);

    const anyFilterActive = activeFilters.length > 0;

    for (let i = 0; i < this._instanceVisible.length; i++) {
      const data = this.nodeData[i];
      if (!data) { this._instanceVisible[i] = true; continue; }

      if (!anyFilterActive) {
        this._instanceVisible[i] = true;
      } else {
        this._instanceVisible[i] = activeFilters.every(
          (type) => this._passesFilter(i, type)
        );
      }
    }

    // Apply visibility to instance matrix (scale = 0 for hidden)
    this._applyInstanceVisibility();
  }

  /**
   * Check whether a single node passes a specific filter.
   * @param {number} idx  — Instance index
   * @param {string} type — Filter type
   * @returns {boolean}
   */
  _passesFilter(idx, type) {
    const data = this.nodeData[idx];
    if (!data) return true;

    // Language filter: show nodes of this language ONLY
    // (AND with other filter types)
    const langFilters = ['dart', 'json', 'yaml', 'markdown', 'javascript', 'python', 'go', 'rust', 'typescript'];
    if (langFilters.includes(type)) {
      return (data.language || '').toLowerCase() === type;
    }

    switch (type) {
      case 'tests':
        // Hide test files — node passes filter if NOT a test file
        return !data.isTest;

      case 'thirdParty':
        // Hide third-party files — passes if NOT third-party
        return !data.isThirdParty;

      case 'generated':
        // Hide generated files — passes if NOT generated
        return !data.isGenerated;

      case 'recent':
        // Only show recently changed files
        return (data.changeFrequency ?? 0) >= (this._recentThreshold ?? 3);

      default:
        return true;
    }
  }

  /**
   * Apply per-instance visibility by setting scale to 0 for hidden nodes.
   * This is more efficient than recreating the mesh.
   */
  _applyInstanceVisibility() {
    if (!this.nodesMesh) return;

    for (let i = 0; i < this._instanceVisible.length; i++) {
      const visible = this._instanceVisible[i];

      // Get the current scale from the instance matrix
      this.nodesMesh.getMatrixAt(i, _mat4);
      const pos = _pos.setFromMatrixPosition(_mat4);

      // Check current scale magnitude — if it matches hidden state, skip
      const curScale = _scaleVec.setFromMatrixScale(_mat4);
      const isHidden = curScale.x < 0.001;

      if (visible && isHidden) {
        // Restore — use the nodeData's stored scale
        const s = this.nodeData?.[i]?.scale ?? 0.3;
        _mat4.makeScale(s, s, s);
        _mat4.setPosition(pos);
        this.nodesMesh.setMatrixAt(i, _mat4);
      } else if (!visible && !isHidden) {
        // Hide — set scale to 0
        _mat4.makeScale(0, 0, 0);
        _mat4.setPosition(pos);
        this.nodesMesh.setMatrixAt(i, _mat4);
      }
    }

    this.nodesMesh.instanceMatrix.needsUpdate = true;

    // Also update glow mesh visibility
    if (this.glowMesh) {
      for (let i = 0; i < this._instanceVisible.length; i++) {
        if (!this._instanceVisible[i]) {
          _mat4.identity();
          _mat4.makeScale(0, 0, 0);
          _mat4.setPosition(0, 0, 0);
          this.glowMesh.setMatrixAt(i, _mat4);
        }
      }
      this.glowMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Attach a click listener on the renderer's canvas for desktop selection.
   */
  _attachClickHandler() {
    if (!this.renderer) return;
    this.renderer.domElement.addEventListener('click', (event) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const nodeId = this.selectNode(x, y);
      if (nodeId) {
        this._emit('node-selected', { nodeId, source: 'click' });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CAMERA CONTROL
  // ═══════════════════════════════════════════════════════════════════════

  flyToNode(nodeId) {
    if (!this.nodeIdMap || !this.nodesMesh || !this.controls) return;
    const idx = this.nodeIdMap.get(nodeId);
    if (idx === undefined) return;
    this.nodesMesh.getMatrixAt(idx, _mat4);
    _pos.setFromMatrixPosition(_mat4);
    this.controls.target.copy(_pos);
    this.camera.position.set(_pos.x + 5, _pos.y + 3, _pos.z + 8);
    this.controls.update();
  }

  restoreCamera(state) {
    if (!state) return;
    if (state.position)  this.camera.position.set(state.position[0], state.position[1], state.position[2]);
    if (state.quaternion) { _quat.set(state.quaternion[0], state.quaternion[1], state.quaternion[2], state.quaternion[3]); this.camera.quaternion.copy(_quat); }
    if (this.controls) this.controls.update();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CONFIG HOT-RELOAD
  // ═══════════════════════════════════════════════════════════════════════

  applyConfig(patch) { Object.assign(this.config, patch); }

  logMemoryStats() {
    if (!this.renderer) return;
    const i = this.renderer.info;
    console.log(`[VR PERF] threejs_mem: geometries=${i.memory.geometries} textures=${i.memory.textures} draws=${i.render.calls} tris=${i.render.triangles}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  MEMORY MANAGEMENT & DISPOSE (§8)
  // ═══════════════════════════════════════════════════════════════════════

  /** WeakRef registry for event handlers referencing node data. */
  _handlerRefs = new Set();

  _registerWeakHandler(fn) {
    const ref = new WeakRef(fn);
    const wrapper = (...args) => { const f = ref.deref(); if (f) f(...args); };
    this._handlerRefs.add(wrapper);
    return wrapper;
  }

  _cleanupWeakRefs() { this._handlerRefs.clear(); }

  _checkMemoryUsage() {
    try { if (performance.memory?.usedJSHeapSize) return performance.memory.usedJSHeapSize / (1024 * 1024); } catch {}
    return 0;
  }

  _logMemoryLeakCheck(beforeMB) {
    if (!beforeMB) return;
    setTimeout(() => {
      const afterMB = this._checkMemoryUsage();
      if (afterMB) {
        const d = (afterMB - beforeMB).toFixed(1);
        if (parseFloat(d) > 20) console.warn(`[VR] Memory leak: +${d} MB`);
        else console.log(`[VR PERF] heap: ${afterMB.toFixed(1)} MB (${d > 0 ? '+' : ''}${d} MB)`);
      }
    }, 100);
  }

  dispose() {
    const memBefore = this._checkMemoryUsage();
    if (this.animationId !== null) { cancelAnimationFrame(this.animationId); this.animationId = null; }
    window.removeEventListener('resize', this._onResize);
    this._cleanupWeakRefs();
    if (this.controls) { this.controls.dispose(); this.controls = null; }
    // Terminate layout worker
    if (this._layoutWorker) { try { this._layoutWorker.terminate(); } catch {} this._layoutWorker = null; }
    // Release WASM memory
    if (typeof Module !== 'undefined' && Module?.free_memory) { try { Module.free_memory(); } catch {} }
    this._disposeSceneObjects();
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement?.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      this.renderer = null;
    }
    this.scene = this.camera = this.nodeIdMap = null;
    this.lodData = []; this.edgeSegments = []; this._clusterAggregateMesh = null;
    this._frameTimes = []; this._lodTransitions = [];
    this._sphereGeomFull?.dispose(); this._sphereGeomMid?.dispose(); this._glowGeom?.dispose();
    this._sphereGeomFull = this._sphereGeomMid = this._glowGeom = null;
    this._logMemoryLeakCheck(memBefore);
    console.log('[VR] Scene disposed');
  }

  _disposeSceneObjects() {
    if (this.nodesMesh) {
      this.scene.remove(this.nodesMesh);
      this.nodesMesh.geometry?.dispose(); this.nodesMesh.material?.dispose();
      this.nodesMesh = null;
    }
    if (this.glowMesh) {
      this.scene.remove(this.glowMesh);
      this.glowMesh.geometry?.dispose(); this.glowMesh.material?.dispose();
      this.glowMesh = null;
    }
    for (const s of this.edgeSegments) {
      this.scene.remove(s.mesh);
      s.mesh.geometry?.dispose(); s.mesh.material?.dispose();
    }
    this.edgeSegments = [];
    if (this._clusterAggregateMesh) {
      this.scene.remove(this._clusterAggregateMesh);
      this._clusterAggregateMesh.geometry?.dispose();
      this._clusterAggregateMesh.material?.dispose();
      this._clusterAggregateMesh = null;
    }
  }

  _onResize() {
    if (!this.renderer || !this.camera) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}

export default VRViewer;
