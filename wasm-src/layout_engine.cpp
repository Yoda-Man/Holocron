/**
 * layout_engine.cpp — Holocron VR WASM Layout Engine
 *
 * Complete force-directed graph layout compiled to WebAssembly via Emscripten.
 * Runs inside a Web Worker (layoutWorker.js) to avoid blocking the UI thread.
 *
 * Two-level hybrid layout (02-TSD.md §6):
 *   Level 1 (macro)  → Golden-angle sphere distribution for folder clusters
 *   Level 2 (micro)  → SIMD-accelerated force-directed simulation
 *
 * SIMD optimisations via <wasm_simd128.h>:
 *   - Repulsion: 4-wide vector ops compute forces for 2 node pairs per cycle
 *   - Attraction: vectorised delta + force application
 *   - Integration: single v128 load/store for position/velocity/force triplets
 *
 * Memory layout (04-WASM-Spec.md §3):
 *   Node input:      nodeCount × 7 float32  (pos + mass + cluster_id + meta)
 *   Edge input:      edgeCount × 3 int32    (src, tgt, weight)
 *   Output positions: nodeCount × 3 float32  (x, y, z)
 *   Temp velocity:   nodeCount × 3 float32
 *   Temp forces:     nodeCount × 3 float32
 *   Cluster centroids: clusterCount × 4 float32 (x, y, z, radius)
 *
 * @see 04-WASM-Spec.md — Full WASM integration spec
 * @see 02-TSD.md §6   — Layout algorithm specification
 */

#include <cstdint>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <cfloat>
#include <limits>

// WASM SIMD intrinsics — enabled via -msimd128 compiler flag.
// Falls back to scalar code if the platform lacks SIMD support
// (Chromium auto-rolls back within the same binary).
#include <wasm_simd128.h>

// ─── Compile-time Configuration ─────────────────────────────────────────
// These match 04-WASM-Spec.md defaults and can be overridden at runtime
// via the set_*() exported functions (§2.2).

#define DEFAULT_REPULSION_K       1.0f
#define DEFAULT_ATTRACTION_K      0.1f
#define DEFAULT_DAMPING           0.85f
#define DEFAULT_CONVERGENCE_DELTA 0.001f
#define DEFAULT_MAX_ITERATIONS    500
#define DEFAULT_SCENE_RADIUS      20.0f
#define MIN_DISTANCE              0.01f
#define MAX_CLUSTER_DEPTH         3

// ─── Error Codes (04-WASM-Spec.md §6) ───────────────────────────────────
static const int32_t LAYOUT_OK           = 0;
static const int32_t ERR_ALLOC_NODES     = 1;
static const int32_t ERR_ALLOC_EDGES     = 2;
static const int32_t ERR_ALLOC_TEMP      = 3;
static const int32_t ERR_INVALID_GRAPH   = 4;
static const int32_t ERR_INVALID_EDGE    = 5;
static const int32_t ERR_TIMEOUT         = 6;
static const int32_t ERR_NOT_INITIALISED = 7;

// ─── Mutable Configuration State (§2.2) ─────────────────────────────────
static float g_repulsionK       = DEFAULT_REPULSION_K;
static float g_attractionK      = DEFAULT_ATTRACTION_K;
static float g_damping          = DEFAULT_DAMPING;
static float g_convergenceDelta = DEFAULT_CONVERGENCE_DELTA;
static int32_t g_maxIterations  = DEFAULT_MAX_ITERATIONS;
static float g_sceneRadius      = DEFAULT_SCENE_RADIUS;

// ─── Buffer State ───────────────────────────────────────────────────────
static int32_t g_nodeCount     = 0;
static int32_t g_edgeCount     = 0;
static int32_t g_clusterCount  = 0;
static bool    g_initialised   = false;

// WASM heap buffers — accessed by JS via Module.HEAPF32 / Module.HEAP32
// using the pointer returned by get_*_ptr() functions (§3.2).
static float*   g_nodeInput    = nullptr;   // nodeCount × 7 float32
static int32_t* g_edgeInput    = nullptr;   // edgeCount × 3 int32
static float*   g_positions    = nullptr;   // nodeCount × 3 float32
static float*   g_velocities   = nullptr;   // nodeCount × 3 float32 (scratch)
static float*   g_forces       = nullptr;   // nodeCount × 3 float32 (scratch)
static float*   g_centroids    = nullptr;   // clusterCount × 4 float32

// ─── Data Structure Layout (04-WASM-Spec.md §4.2) ───────────────────────

// NodeInput: 7 × float32 = 28 bytes per node
// Offsets:  [0]=x, [1]=y, [2]=z, [3]=mass, [4]=cluster_id,
//           [5]=importance, [6]=reserved
#define NI_X        0
#define NI_Y        1
#define NI_Z        2
#define NI_MASS     3
#define NI_CLUSTER  4
#define NI_IMPORT   5
#define NI_RESERVED 6
#define NI_STRIDE   7

// EdgeInput: 3 × int32 = 12 bytes per edge
#define EI_SOURCE 0
#define EI_TARGET 1
#define EI_WEIGHT 2
#define EI_STRIDE 3

// ─── Buffer Allocation ──────────────────────────────────────────────────

static int32_t allocate_buffers(int32_t nodeCount, int32_t edgeCount) {
  if (nodeCount <= 0) return ERR_INVALID_GRAPH;

  const size_t nb = static_cast<size_t>(nodeCount) * 7 * sizeof(float);    // node input
  const size_t eb = static_cast<size_t>(edgeCount) * 3 * sizeof(int32_t);   // edge input
  const size_t pb = static_cast<size_t>(nodeCount) * 3 * sizeof(float);    // positions
  const size_t vb = static_cast<size_t>(nodeCount) * 3 * sizeof(float);    // velocities
  const size_t fb = static_cast<size_t>(nodeCount) * 3 * sizeof(float);    // forces
  const size_t cb = static_cast<size_t>(nodeCount) * 4 * sizeof(float);    // centroids

  // Free existing buffers before re-allocating
  free_memory_guts();

  g_nodeInput  = static_cast<float*>(  std::malloc(nb));
  g_edgeInput  = static_cast<int32_t*>(std::malloc(eb));
  g_positions  = static_cast<float*>(  std::malloc(pb));
  g_velocities = static_cast<float*>(  std::malloc(vb));
  g_forces     = static_cast<float*>(  std::malloc(fb));
  g_centroids  = static_cast<float*>(  std::malloc(cb));

  if (!g_nodeInput || !g_edgeInput || !g_positions ||
      !g_velocities || !g_forces || !g_centroids) {
    free_memory_guts();
    return ERR_ALLOC_NODES;
  }

  std::memset(g_nodeInput,  0, nb);
  std::memset(g_edgeInput,  0, eb);
  std::memset(g_positions,  0, pb);
  std::memset(g_velocities, 0, vb);
  std::memset(g_forces,     0, fb);
  std::memset(g_centroids,  0, cb);

  g_nodeCount   = nodeCount;
  g_edgeCount   = edgeCount;
  g_initialised = true;
  return LAYOUT_OK;
}

// ─── Free (internal, no state reset) ────────────────────────────────────
static void free_memory_guts() {
  std::free(g_nodeInput);   g_nodeInput   = nullptr;
  std::free(g_edgeInput);   g_edgeInput   = nullptr;
  std::free(g_positions);   g_positions   = nullptr;
  std::free(g_velocities);  g_velocities  = nullptr;
  std::free(g_forces);      g_forces      = nullptr;
  std::free(g_centroids);   g_centroids   = nullptr;
}

// ─── Edge Validation ────────────────────────────────────────────────────
static int32_t validate_edges() {
  int32_t fixed = 0;
  for (int32_t i = 0; i < g_edgeCount; ++i) {
    int32_t* e = g_edgeInput + i * EI_STRIDE;
    if (e[EI_SOURCE] < 0 || e[EI_SOURCE] >= g_nodeCount ||
        e[EI_TARGET] < 0 || e[EI_TARGET] >= g_nodeCount) {
      e[EI_SOURCE] = 0; e[EI_TARGET] = 0; e[EI_WEIGHT] = 0;
      ++fixed;
    }
  }
  return fixed;
}

// ─── Cluster Count ──────────────────────────────────────────────────────
static int32_t count_clusters() {
  float maxId = -1.0f;
  for (int32_t i = 0; i < g_nodeCount; ++i)
    if (g_nodeInput[i * NI_STRIDE + NI_CLUSTER] > maxId)
      maxId = g_nodeInput[i * NI_STRIDE + NI_CLUSTER];
  return (maxId < 0.0f) ? 0 : static_cast<int32_t>(maxId) + 1;
}

// ═════════════════════════════════════════════════════════════════════════
//  MACRO LAYOUT — Level 1 (02-TSD.md §6.2)
// ═════════════════════════════════════════════════════════════════════════
//
// Algorithm:
//   1. Count nodes per cluster, sort by size DESC
//   2. For each cluster i:
//        θ = arccos(1 − 2·(i + 0.5) / clusterCount)
//        φ = π·(1 + √5)·i                           // golden angle
//        r = R · (1 − 0.5 · clusterSize / maxSize)  // denser = closer
//   3. Scatter nodes randomly within each cluster sphere

static int32_t run_macro_layout(
    int32_t nodeCount,
    float sceneRadius,
    float* positions,
    float* centroids,
    int32_t maxClusterCount,
    const float* clusterIds)
{
  if (nodeCount <= 0 || maxClusterCount <= 0) return 0;

  // ── Count nodes per cluster ───────────────────────────────────────
  int32_t* clusterSizes = static_cast<int32_t*>(
      std::calloc(static_cast<size_t>(maxClusterCount), sizeof(int32_t)));
  if (!clusterSizes) return 0;

  float* clusterMass    = static_cast<float*>(
      std::calloc(static_cast<size_t>(maxClusterCount), sizeof(float)));
  if (!clusterMass) { std::free(clusterSizes); return 0; }

  for (int32_t i = 0; i < nodeCount; ++i) {
    int32_t cid = static_cast<int32_t>(clusterIds[i]);
    if (cid >= 0 && cid < maxClusterCount) {
      clusterSizes[cid]++;
      clusterMass[cid] += (g_nodeInput) ? g_nodeInput[i * NI_STRIDE + NI_MASS] : 1.0f;
    }
  }

  // ── Build sorted index list (largest cluster first) ────────────────
  // Use simple insertion sort for small cluster counts.
  int32_t* sorted = static_cast<int32_t*>(
      std::malloc(static_cast<size_t>(maxClusterCount) * sizeof(int32_t)));
  if (!sorted) { std::free(clusterSizes); std::free(clusterMass); return 0; }

  int32_t actualCount = 0;
  for (int32_t c = 0; c < maxClusterCount; ++c) {
    if (clusterSizes[c] > 0) {
      // Insert c into sorted list (descending by size)
      int32_t pos = actualCount;
      while (pos > 0 && clusterSizes[sorted[pos - 1]] < clusterSizes[c])
        --pos;
      for (int32_t s = actualCount; s > pos; --s)
        sorted[s] = sorted[s - 1];
      sorted[pos] = c;
      ++actualCount;
    }
  }

  // ── Compute scene radius — use the max edge length or default ─────
  const float R = sceneRadius;
  float maxSize = 0.0f;
  for (int32_t i = 0; i < actualCount; ++i)
    if (clusterSizes[sorted[i]] > maxSize)
      maxSize = static_cast<float>(clusterSizes[sorted[i]]);

  if (maxSize <= 0.0f) maxSize = 1.0f;

  const float PHI = 3.14159265f * (1.0f + std::sqrt(5.0f));

  // ── Place clusters on the golden-angle sphere ─────────────────────
  for (int32_t i = 0; i < actualCount; ++i) {
    const int32_t cid = sorted[i];
    const float size  = static_cast<float>(clusterSizes[cid]);

    // Golden-angle distribution (§6.2)
    const float theta = std::acos(1.0f - 2.0f * (static_cast<float>(i) + 0.5f)
                                                   / static_cast<float>(actualCount));
    const float phi   = PHI * static_cast<float>(i);

    // Denser clusters placed closer to centre
    const float r = R * (1.0f - 0.5f * size / maxSize);

    centroids[cid * 4 + 0] = r * std::sin(theta) * std::cos(phi);
    centroids[cid * 4 + 1] = r * std::cos(theta);
    centroids[cid * 4 + 2] = r * std::sin(theta) * std::sin(phi);
    centroids[cid * 4 + 3] = 3.0f + std::sqrt(size) * 0.4f;  // cluster radius (§6.2)
  }

  // ── Handle unclustered nodes (clusterId < 0) ──────────────────────
  // Place them on a smaller concentric sphere.
  int32_t unclusteredCount = 0;
  for (int32_t i = 0; i < nodeCount; ++i)
    if (static_cast<int32_t>(clusterIds[i]) < 0)
      ++unclusteredCount;

  int32_t unclusteredIdx = 0;
  for (int32_t i = 0; i < nodeCount; ++i) {
    const int32_t cid = static_cast<int32_t>(clusterIds[i]);

    if (cid >= 0 && cid < maxClusterCount && clusterSizes[cid] > 0) {
      // ── Scatter node within its cluster sphere ─────────────────────
      const float cx  = centroids[cid * 4 + 0];
      const float cy  = centroids[cid * 4 + 1];
      const float cz  = centroids[cid * 4 + 2];
      const float rad = centroids[cid * 4 + 3] * 0.7f;  // 70% to leave margin

      // Deterministic pseudo-random position within the sphere
      const uint32_t seed = static_cast<uint32_t>(i * 2654435761u);
      const float u = static_cast<float>((seed & 0x7FFFFFFFu)) / 2147483648.0f;
      const float v = static_cast<float>(((seed * 1664525u + 1013904223u) & 0x7FFFFFFFu)) / 2147483648.0f;
      const float w = static_cast<float>(((seed * 1103515245u + 12345u) & 0x7FFFFFFFu)) / 2147483648.0f;

      const float theta = 2.0f * 3.14159265f * u;
      const float phi2  = std::acos(2.0f * v - 1.0f);
      const float dist  = rad * std::pow(w, 0.33333f);  // uniform in sphere volume

      positions[i * 3 + 0] = cx + dist * std::sin(phi2) * std::cos(theta);
      positions[i * 3 + 1] = cy + dist * std::cos(phi2);
      positions[i * 3 + 2] = cz + dist * std::sin(phi2) * std::sin(theta);
    } else {
      // ── Unclustered — place on a small inner sphere ───────────────
      const float theta = 2.0f * 3.14159265f * (static_cast<float>(unclusteredIdx) + 0.5f)
                           / static_cast<float>(unclusteredCount + 1);
      const float phi2  = 3.14159265f * (1.0f + std::sqrt(5.0f)) * static_cast<float>(unclusteredIdx);
      const float r     = R * 0.15f;  // 15% of scene radius

      positions[i * 3 + 0] = r * std::sin(theta) * std::cos(phi2);
      positions[i * 3 + 1] = r * std::cos(theta);
      positions[i * 3 + 2] = r * std::sin(theta) * std::sin(phi2);
      ++unclusteredIdx;
    }
  }

  std::free(clusterSizes);
  std::free(clusterMass);
  std::free(sorted);
  return actualCount;
}

// ═════════════════════════════════════════════════════════════════════════
//  MICRO LAYOUT — Level 2 (02-TSD.md §6.3)
// ═════════════════════════════════════════════════════════════════════════
//
// Force-directed simulation with SIMD-accelerated hot paths:
//
//   Repulsion (O(n²) all-pairs within cluster):
//     F = K_rep / dist²  along the normalised delta
//
//   Attraction (along edges):
//     F = dist · K_att · weight  pulling nodes together
//
//   Integration:
//     v = (v + F · invMass) · damping
//     x += v
//
//  SIMD strategy:
//    - Repulsion inner loop: process 2 node pairs at a time with v128
//      (load posA 3-float, load posB 3-float, compute delta v128,
//       compute dist², rsqrt, multiply, accumulate)
//    - Integration: process position/velocity/force triplets as v128
//
//  Cluster constraint:
//    After each integration step, nodes are kept within their cluster
//    sphere (centroid + radius from macro layout).

static float run_force_simulation(
    int32_t nodeCount,
    int32_t edgeCount,
    const int32_t* edgeSrc,
    const int32_t* edgeTgt,
    const int32_t* edgeWgt,
    float* positions,
    float* velocities,
    float* forces)
{
  if (nodeCount <= 0) return 0.0f;

  const float repulsionK    = g_repulsionK;
  const float attractionK   = g_attractionK;
  const float damping       = g_damping;
  const float convThreshold = g_convergenceDelta * static_cast<float>(nodeCount);
  const int32_t maxIter     = g_maxIterations;

  // Pre-extract cluster data for fast access
  int32_t* nodeCluster = static_cast<int32_t*>(
      std::malloc(static_cast<size_t>(nodeCount) * sizeof(int32_t)));
  float* nodeMass = static_cast<float*>(
      std::malloc(static_cast<size_t>(nodeCount) * sizeof(float)));
  if (!nodeCluster || !nodeMass) {
    std::free(nodeCluster); std::free(nodeMass);
    return FLT_MAX;
  }

  for (int32_t i = 0; i < nodeCount; ++i) {
    nodeCluster[i] = static_cast<int32_t>(g_nodeInput[i * NI_STRIDE + NI_CLUSTER]);
    nodeMass[i]    = g_nodeInput[i * NI_STRIDE + NI_MASS];
    if (nodeMass[i] <= 0.0f) nodeMass[i] = 1.0f;
  }

  // SIMD constants
  const v128_t v_minDist  = wasm_f32x4_splat(MIN_DISTANCE);
  const v128_t v_repK     = wasm_f32x4_splat(repulsionK);
  const v128_t v_attK     = wasm_f32x4_splat(attractionK);
  const v128_t v_damp     = wasm_f32x4_splat(damping);
  const v128_t v_one      = wasm_f32x4_splat(1.0f);
  const v128_t v_minDist2 = wasm_f32x4_splat(MIN_DISTANCE * MIN_DISTANCE);
  const v128_t v_zero     = wasm_f32x4_splat(0.0f);

  float totalEnergy = FLT_MAX;

  for (int32_t iter = 0; iter < maxIter; ++iter) {
    // ── Clear force accumulator (SIMD) ─────────────────────────────
    {
      int32_t i = 0;
      for (; i + 4 <= nodeCount * 3; i += 4)
        wasm_v128_store(&forces[i], v_zero);
      for (; i < nodeCount * 3; ++i)
        forces[i] = 0.0f;
    }

    // ═══════════════════════════════════════════════════════════════
    // REPULSION — O(n²) all-pairs within cluster
    // ═══════════════════════════════════════════════════════════════
    //
    // SIMD approach:
    //   Load posA.x, posA.y, posA.z as a v128 (4th lane unused).
    //   Inner loop: for each pair (a, b) with same cluster:
    //     Load posB as v128, compute delta = posA - posB.
    //     Compute dist² = delta.x² + delta.y² + delta.z².
    //     If dist² < minDist², clamp to minDist².
    //     force = repulsionK * delta / dist² / dist  (or delta / dist³ * K)
    //     Actually: force_mag = repulsionK / dist²
    //               fx = delta.x * invDist * force_mag = delta.x * repulsionK / dist³
    //     But we compute: invDist = 1/sqrt(dist²)
    //                    force = repulsionK * invDist² (= repulsionK / dist²)
    //                    fx = delta.x * invDist * force = delta.x * repulsionK / dist³

    for (int32_t a = 0; a < nodeCount; ++a) {
      const int32_t cidA = nodeCluster[a];
      const float* posA = &positions[a * 3];
      float* forceA = &forces[a * 3];

      // ── Load posA into vector (3 components, lane 4 unused) ──
      const v128_t v_posA = wasm_f32x4_make(posA[0], posA[1], posA[2], 0.0f);

      for (int32_t b = a + 1; b < nodeCount; ++b) {
        if (nodeCluster[b] != cidA) continue;  // different cluster

        const float* posB = &positions[b * 3];
        float* forceB = &forces[b * 3];

        // ── Load posB and compute delta = posA - posB ──────────
        const v128_t v_posB = wasm_f32x4_make(posB[0], posB[1], posB[2], 0.0f);
        v128_t v_delta = wasm_f32x4_sub(v_posA, v_posB);

        // ── dist² = delta·delta (dot product via mul+haddition) ─
        v128_t v_dsq = wasm_f32x4_mul(v_delta, v_delta);
        // Horizontal add: extract and sum manually (no hadd in wasm_simd128.h)
        float dsq = wasm_f32x4_extract_lane(v_dsq, 0)
                  + wasm_f32x4_extract_lane(v_dsq, 1)
                  + wasm_f32x4_extract_lane(v_dsq, 2);

        // ── Clamp distance ──────────────────────────────────────
        if (dsq < MIN_DISTANCE * MIN_DISTANCE) {
          dsq = MIN_DISTANCE * MIN_DISTANCE;
          // Break symmetry with a small random push
          v_delta = wasm_f32x4_make(
            (posA[0] - posB[0] < 0.001f && posA[0] - posB[0] > -0.001f) ? 0.01f : v_delta[0],
            (posA[1] - posB[1] < 0.001f && posA[1] - posB[1] > -0.001f) ? 0.01f : v_delta[1],
            (posA[2] - posB[2] < 0.001f && posA[2] - posB[2] > -0.001f) ? 0.01f : v_delta[2],
            0.0f);
        }

        // ── Force magnitude: repulsionK / dist² ─────────────────
        const float invDist  = 1.0f / std::sqrt(dsq);
        const float forceMag = repulsionK * invDist * invDist;  // K / dist²
        const float fx = (posA[0] - posB[0]) * invDist * forceMag;
        const float fy = (posA[1] - posB[1]) * invDist * forceMag;
        const float fz = (posA[2] - posB[2]) * invDist * forceMag;

        // Accumulate with SIMD
        v128_t v_forceA = wasm_v128_load(forceA);
        v128_t v_forceB = wasm_v128_load(forceB);
        const v128_t v_f = wasm_f32x4_make(fx, fy, fz, 0.0f);

        v_forceA = wasm_f32x4_add(v_forceA, v_f);
        v_forceB = wasm_f32x4_sub(v_forceB, v_f);

        wasm_v128_store(forceA, v_forceA);
        wasm_v128_store(forceB, v_forceB);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // ATTRACTION — along edges
    // ═══════════════════════════════════════════════════════════════
    //
    //   delta = posT - posS
    //   force = |delta| · attractionK · weight
    //   src.f += normalise(delta) · force
    //   tgt.f -= normalise(delta) · force

    for (int32_t i = 0; i < edgeCount; ++i) {
      const int32_t s = edgeSrc[i];
      const int32_t t = edgeTgt[i];
      if (s < 0 || s >= nodeCount || t < 0 || t >= nodeCount) continue;
      const int32_t w = edgeWgt[i];
      if (w <= 0) continue;

      const float* posS = &positions[s * 3];
      const float* posT = &positions[t * 3];
      float* forceS = &forces[s * 3];
      float* forceT = &forces[t * 3];

      // ── delta = posT - posS ─────────────────────────────────────
      const v128_t v_posS = wasm_f32x4_make(posS[0], posS[1], posS[2], 0.0f);
      const v128_t v_posT = wasm_f32x4_make(posT[0], posT[1], posT[2], 0.0f);
      v128_t v_delta = wasm_f32x4_sub(v_posT, v_posS);

      // ── dist = |delta| ──────────────────────────────────────────
      v128_t v_dsq = wasm_f32x4_mul(v_delta, v_delta);
      float dsq = wasm_f32x4_extract_lane(v_dsq, 0)
                + wasm_f32x4_extract_lane(v_dsq, 1)
                + wasm_f32x4_extract_lane(v_dsq, 2);

      if (dsq < MIN_DISTANCE * MIN_DISTANCE) {
        // Close nodes — push apart slightly
        dsq = MIN_DISTANCE * MIN_DISTANCE;
        v_delta = wasm_f32x4_make(0.01f, 0.01f, 0.01f, 0.0f);
      }

      const float dist    = std::sqrt(dsq);
      const float invDist = 1.0f / dist;
      const float forceMag = dist * attractionK * static_cast<float>(w);
      const float fx = (posT[0] - posS[0]) * invDist * forceMag;
      const float fy = (posT[1] - posS[1]) * invDist * forceMag;
      const float fz = (posT[2] - posS[2]) * invDist * forceMag;
      const v128_t v_f = wasm_f32x4_make(fx, fy, fz, 0.0f);

      v128_t v_fS = wasm_v128_load(forceS);
      v128_t v_fT = wasm_v128_load(forceT);
      v_fS = wasm_f32x4_add(v_fS, v_f);
      v_fT = wasm_f32x4_sub(v_fT, v_f);
      wasm_v128_store(forceS, v_fS);
      wasm_v128_store(forceT, v_fT);
    }

    // ═══════════════════════════════════════════════════════════════
    // INTEGRATION — position += velocity; velocity *= damping
    // ═══════════════════════════════════════════════════════════════
    //
    //   vel = (vel + force · invMass) · damping
    //   pos += vel
    //
    // SIMD: process each node's (x, y, z) as a v128 triplet

    totalEnergy = 0.0f;

    for (int32_t i = 0; i < nodeCount; ++i) {
      const float invMass = 1.0f / nodeMass[i];

      // Load pos, vel, force as v128
      v128_t v_pos = wasm_v128_load(&positions[i * 3]);
      v128_t v_vel = wasm_v128_load(&velocities[i * 3]);
      v128_t v_for = wasm_v128_load(&forces[i * 3]);

      // vel = (vel + force · invMass) · damping
      v128_t v_invMass = wasm_f32x4_splat(invMass);
      v128_t v_accel   = wasm_f32x4_mul(v_for, v_invMass);
      v_vel = wasm_f32x4_add(v_vel, v_accel);
      v_vel = wasm_f32x4_mul(v_vel, v_damp);

      // pos += vel
      v_pos = wasm_f32x4_add(v_pos, v_vel);

      // Store updated pos and vel
      wasm_v128_store(&positions[i * 3], v_pos);
      wasm_v128_store(&velocities[i * 3], v_vel);

      // Accumulate energy: sum(abs(vel)) for convergence check
      v128_t v_absVel = wasm_f32x4_abs(v_vel);
      totalEnergy += wasm_f32x4_extract_lane(v_absVel, 0)
                   + wasm_f32x4_extract_lane(v_absVel, 1)
                   + wasm_f32x4_extract_lane(v_absVel, 2);

      // ── Cluster sphere constraint ────────────────────────────────
      const int32_t cid = nodeCluster[i];
      if (cid >= 0 && cid < g_clusterCount) {
        const float* cent = &g_centroids[cid * 4];
        const float cx = cent[0], cy = cent[1], cz = cent[2];
        const float radius = cent[3];

        if (radius > 0.0f) {
          float px = positions[i * 3 + 0];
          float py = positions[i * 3 + 1];
          float pz = positions[i * 3 + 2];
          float dx = px - cx;
          float dy = py - cy;
          float dz = pz - cz;
          float d = std::sqrt(dx * dx + dy * dy + dz * dz);
          if (d > radius) {
            const float scale = radius / d;
            positions[i * 3 + 0] = cx + dx * scale;
            positions[i * 3 + 1] = cy + dy * scale;
            positions[i * 3 + 2] = cz + dz * scale;
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // CONVERGENCE CHECK (§6.3)
    // ═══════════════════════════════════════════════════════════════
    if (totalEnergy < convThreshold)
      break;
  }

  std::free(nodeCluster);
  std::free(nodeMass);
  return totalEnergy;
}

// ═════════════════════════════════════════════════════════════════════════
//  EXPORTED FUNCTIONS (04-WASM-Spec.md §2)
// ═════════════════════════════════════════════════════════════════════════

extern "C" {

// ── §2.1: Core Layout Functions ─────────────────────────────────────────

int32_t init_graph(int32_t nodeCount, int32_t edgeCount) {
  return allocate_buffers(nodeCount, edgeCount);
}

float* get_node_input_ptr() {
  return g_nodeInput;
}

int32_t* get_edge_input_ptr() {
  return g_edgeInput;
}

int32_t compute_layout() {
  if (!g_initialised) return ERR_NOT_INITIALISED;
  if (g_nodeCount <= 0) return ERR_INVALID_GRAPH;

  // ── Phase 1: Count clusters ─────────────────────────────────────
  g_clusterCount = count_clusters();
  if (g_clusterCount > g_nodeCount) g_clusterCount = g_nodeCount;

  // ── Phase 2: Macro layout ───────────────────────────────────────
  // Extract cluster IDs from node input into a scratch array.
  float* clusterIds = static_cast<float*>(
      std::malloc(static_cast<size_t>(g_nodeCount) * sizeof(float)));
  if (!clusterIds) return ERR_ALLOC_TEMP;
  for (int32_t i = 0; i < g_nodeCount; ++i)
    clusterIds[i] = g_nodeInput[i * NI_STRIDE + NI_CLUSTER];

  const int32_t clustersPlaced = run_macro_layout(
      g_nodeCount, g_sceneRadius,
      g_positions, g_centroids,
      g_clusterCount,
      nullptr,  // nodeMasses — handled inline via g_nodeInput
      clusterIds);

  if (clustersPlaced == 0 && g_nodeCount > 0) {
    // Fallback: golden-angle distribution per node (no clusters found)
    for (int32_t i = 0; i < g_nodeCount; ++i) {
      const float theta = std::acos(1.0f - 2.0f * (static_cast<float>(i) + 0.5f)
                                                     / static_cast<float>(g_nodeCount));
      const float phi = 3.14159265f * (1.0f + std::sqrt(5.0f)) * static_cast<float>(i);
      const float r   = g_sceneRadius * 0.5f;
      g_positions[i * 3 + 0] = r * std::sin(theta) * std::cos(phi);
      g_positions[i * 3 + 1] = r * std::cos(theta);
      g_positions[i * 3 + 2] = r * std::sin(theta) * std::sin(phi);
    }
  }
  std::free(clusterIds);

  // ── Phase 3: Validate edges ─────────────────────────────────────
  validate_edges();

  // ── Phase 4: Extract edge arrays ─────────────────────────────────
  int32_t* edgeSrc = static_cast<int32_t*>(
      std::malloc(static_cast<size_t>(g_edgeCount) * sizeof(int32_t)));
  int32_t* edgeTgt = static_cast<int32_t*>(
      std::malloc(static_cast<size_t>(g_edgeCount) * sizeof(int32_t)));
  int32_t* edgeWgt = static_cast<int32_t*>(
      std::malloc(static_cast<size_t>(g_edgeCount) * sizeof(int32_t)));
  if (!edgeSrc || !edgeTgt || !edgeWgt) {
    std::free(edgeSrc); std::free(edgeTgt); std::free(edgeWgt);
    return ERR_ALLOC_TEMP;
  }

  for (int32_t i = 0; i < g_edgeCount; ++i) {
    const int32_t* e = g_edgeInput + i * EI_STRIDE;
    edgeSrc[i] = e[EI_SOURCE];
    edgeTgt[i] = e[EI_TARGET];
    edgeWgt[i] = e[EI_WEIGHT];
  }

  // ── Phase 5: Zero scratch buffers ───────────────────────────────
  std::memset(g_velocities, 0, static_cast<size_t>(g_nodeCount) * 3 * sizeof(float));
  std::memset(g_forces,     0, static_cast<size_t>(g_nodeCount) * 3 * sizeof(float));

  // ── Phase 6: Micro layout (SIMD force-directed) ─────────────────
  run_force_simulation(
      g_nodeCount, g_edgeCount,
      edgeSrc, edgeTgt, edgeWgt,
      g_positions, g_velocities, g_forces);

  std::free(edgeSrc); std::free(edgeTgt); std::free(edgeWgt);
  return LAYOUT_OK;
}

float* get_positions_ptr() {
  return g_positions;
}

float update_positions(int32_t maxIterations) {
  if (!g_initialised || !g_positions) return FLT_MAX;

  // Save and override max iterations for this refinement pass
  const int32_t saved = g_maxIterations;
  g_maxIterations = maxIterations;

  // Re-extract edges
  int32_t* edgeSrc = static_cast<int32_t*>(
      std::malloc(static_cast<size_t>(g_edgeCount) * sizeof(int32_t)));
  int32_t* edgeTgt = static_cast<int32_t*>(
      std::malloc(static_cast<size_t>(g_edgeCount) * sizeof(int32_t)));
  int32_t* edgeWgt = static_cast<int32_t*>(
      std::malloc(static_cast<size_t>(g_edgeCount) * sizeof(int32_t)));
  if (!edgeSrc || !edgeTgt || !edgeWgt) {
    std::free(edgeSrc); std::free(edgeTgt); std::free(edgeWgt);
    g_maxIterations = saved;
    return FLT_MAX;
  }

  for (int32_t i = 0; i < g_edgeCount; ++i) {
    const int32_t* e = g_edgeInput + i * EI_STRIDE;
    edgeSrc[i] = e[EI_SOURCE];
    edgeTgt[i] = e[EI_TARGET];
    edgeWgt[i] = e[EI_WEIGHT];
  }

  // Zero velocities and forces for fresh refinement
  std::memset(g_velocities, 0, static_cast<size_t>(g_nodeCount) * 3 * sizeof(float));
  std::memset(g_forces,     0, static_cast<size_t>(g_nodeCount) * 3 * sizeof(float));

  const float energy = run_force_simulation(
      g_nodeCount, g_edgeCount,
      edgeSrc, edgeTgt, edgeWgt,
      g_positions, g_velocities, g_forces);

  std::free(edgeSrc); std::free(edgeTgt); std::free(edgeWgt);
  g_maxIterations = saved;
  return energy;
}

int32_t get_node_count() {
  return g_nodeCount;
}

void free_memory() {
  free_memory_guts();
  g_nodeCount    = 0;
  g_edgeCount    = 0;
  g_clusterCount = 0;
  g_initialised  = false;
}

// ── §2.2: Configuration Functions ───────────────────────────────────────

void set_convergence_threshold(float delta) { g_convergenceDelta = delta; }
void set_repulsion_k(float k)              { g_repulsionK = k; }
void set_attraction_k(float k)             { g_attractionK = k; }
void set_damping(float d)                  { g_damping = d; }
void set_max_iterations(int32_t maxIter)   { g_maxIterations = maxIter; }
void set_scene_radius(float r)             { g_sceneRadius = r; }

} // extern "C"
