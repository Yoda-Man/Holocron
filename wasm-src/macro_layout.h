/**
 * macro_layout.h — Macro Layout (Folder Cluster) Header
 *
 * Declares the Level 1 macro layout: folder-level cluster placement on a
 * sphere using golden-angle distribution. Denser clusters (more files) are
 * placed closer to the centre.
 *
 * @see 02-TSD.md §6.2  — Macro layout specification
 */

#ifndef MACRO_LAYOUT_H
#define MACRO_LAYOUT_H

#include <cstdint>

/**
 * Run the macro layout (Level 1 — folder cluster placement).
 *
 * Computes centroid positions for each cluster and initial node positions
 * within those clusters. Results are written directly into the output
 * positions buffer and the cluster centroid buffer.
 *
 * @param nodeCount     Number of nodes
 * @param sceneRadius   Scene radius in world units (default 20.0)
 * @param positions     Output position buffer (3 floats per node) — initial
 *                      positions are written here before micro-layout refines them
 * @param centroids     Cluster centroid buffer (4 floats per cluster:
 *                      x, y, z, radius) — populated by this function
 * @param clusterCount  Number of distinct clusters (returned)
 * @param nodeMasses    Per-node mass values (for weighted distribution)
 * @param clusterIds    Per-node cluster ID (float, -1 for unclustered)
 * @return              Number of clusters placed
 */
int32_t run_macro_layout(
    int32_t nodeCount,
    float sceneRadius,
    float* positions,
    float* centroids,
    int32_t maxClusterCount,
    const float* nodeMasses,
    const float* clusterIds
);

#endif // MACRO_LAYOUT_H
