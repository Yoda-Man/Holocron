/**
 * Map cluster ids to dense integers for typed arrays and the layout engine.
 *
 * Graphify cluster ids are folder strings such as `src/auth`. Written straight
 * into an Int32Array they all became 0, so every node shared one cluster.
 *
 * @param {Array<{clusterId?: string|number|null}>} nodes
 * @param {number} [count=nodes.length]
 * @returns {Int32Array} 0..k-1 per distinct id, -1 for none
 */
export function clusterIndices(nodes, count = nodes.length) {
  const ids = new Int32Array(count);
  const seen = new Map();
  for (let i = 0; i < count; i++) {
    const id = nodes[i]?.clusterId;
    if (id === undefined || id === null || id === '' || (typeof id === 'number' && id < 0)) {
      ids[i] = -1;
      continue;
    }
    if (!seen.has(id)) seen.set(id, seen.size);
    ids[i] = seen.get(id);
  }
  return ids;
}
