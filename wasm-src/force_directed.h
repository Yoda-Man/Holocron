/**
 * force_directed.h — Force-Directed Layout Header
 *
 * Declares the micro-layout (Level 2) force simulation: repulsion between
 * all node pairs, attraction along edges, velocity damping, and convergence
 * detection.
 *
 * @see 02-TSD.md §6.3  — Micro layout specification
 * @see 04-WASM-Spec.md §2.2 — Configuration functions
 */

#ifndef FORCE_DIRECTED_H
#define FORCE_DIRECTED_H

#include <cstdint>

/**
 * Configuration parameters for the force-directed simulation.
 * Defaults match 02-TSD.md §6.3.
 */
struct ForceConfig {
  float repulsionK = 1.0f;
  float attractionK = 0.1f;
  float damping = 0.85f;
  float convergenceDelta = 0.001f;
  int32_t maxIterations = 500;
};

/**
 * Per-node runtime state used during the simulation.
 * Not part of the WASM memory layout — allocated as a local scratch buffer.
 */
struct NodeState {
  float vx, vy, vz;       // Velocity
  float fx, fy, fz;       // Force accumulator
};

/**
 * Run the force-directed simulation (Level 2 micro layout).
 *
 * Operates on the globally-allocated node input, edge input, and output
 * position buffers. Nodes are constrained within their cluster sphere
 * (centroid + radius from macro layout).
 *
 * @param config        Algorithm parameters (K constants, damping, threshold)
 * @param nodeCount     Number of nodes
 * @param edgeCount     Number of edges
 * @param edgeSrc       Edge source indices
 * @param edgeTgt       Edge target indices
 * @param edgeWgt       Edge weights
 * @param positions     Output position buffer (3 floats per node)
 * @param velocities    Scratch velocity buffer (3 floats per node)
 * @param forces        Scratch force-accumulator buffer (3 floats per node)
 * @param nodeMasses    Per-node mass values
 * @param centroids     Cluster centroid buffer (4 floats per cluster: x,y,z,radius)
 * @param clusterIds    Per-node cluster ID
 * @return              Remaining energy after convergence or max iterations
 */
float run_force_simulation(
    const ForceConfig& config,
    int32_t nodeCount,
    int32_t edgeCount,
    const int32_t* edgeSrc,
    const int32_t* edgeTgt,
    const int32_t* edgeWgt,
    float* positions,
    float* velocities,
    float* forces,
    const float* nodeMasses,
    const float* centroids,
    const float* clusterIds
);

#endif // FORCE_DIRECTED_H
