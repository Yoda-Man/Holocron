/**
 * The shipped layout worker, run in-process. `self` is a stub that records
 * posted messages; the compiled engine is replaced by a recording fake so the
 * test can see exactly what the worker writes into engine memory.
 */
import { jest } from '@jest/globals';
import { LAYOUT_ENGINE_EXPORTS } from '../../frontend/bindLayoutEngine.js';

const NODES = [
  { id: 'src/auth/a.js', clusterId: 'src/auth' },
  { id: 'src/auth/b.js', clusterId: 'src/auth' },
  { id: 'src/db/c.js', clusterId: 'src/db' },
];
const EDGES = [{ source: 'src/auth/a.js', target: 'src/db/c.js', weight: 1 }];
const NODE_PTR = 0, EDGE_PTR = 4096, POS_PTR = 8192;

function fakeEngine() {
  const buf = new ArrayBuffer(1 << 16);
  const state = { nodes: 0 };
  const m = { HEAPF32: new Float32Array(buf), HEAP32: new Int32Array(buf), state };
  for (const name of LAYOUT_ENGINE_EXPORTS) m[`_${name}`] = () => 0;
  m._init_graph = (n) => { state.nodes = n; return 0; };
  m._get_node_input_ptr = () => NODE_PTR;
  m._get_edge_input_ptr = () => EDGE_PTR;
  m._get_positions_ptr = () => POS_PTR;
  m._compute_layout = () => { m.HEAPF32.fill(1, POS_PTR / 4, POS_PTR / 4 + state.nodes * 3); return 0; };
  m._get_node_count = () => state.nodes;
  m._update_positions = () => (state.nodes ? 0.5 : Number.MAX_VALUE);
  m._free_memory = () => { state.nodes = 0; };
  return m;
}

async function loadWorker(engineFactory) {
  jest.resetModules();
  const posted = [];
  global.self = { postMessage: (msg) => posted.push(msg) };
  jest.unstable_mockModule('../../frontend/layout_engine.mjs', () => ({ default: engineFactory }));
  await import(`../../frontend/layoutWorker.js?${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { posted, send: (data) => global.self.onmessage({ data }) };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); delete global.self; });

describe('WASM path', () => {
  let engine;
  let worker;
  beforeEach(async () => {
    engine = fakeEngine();
    worker = await loadWorker(async () => engine);
    await worker.send({ type: 'layout', nodes: NODES, edges: EDGES, config: {} });
  });

  test('folder cluster ids reach the engine as distinct integers', () => {
    const clusterOf = (i) => engine.HEAPF32[NODE_PTR / 4 + i * 7 + 4];
    expect([0, 1, 2].map(clusterOf)).toEqual([0, 0, 1]);
  });

  test('edges given by node id reach the engine as node indexes', () => {
    expect(Array.from(engine.HEAP32.subarray(EDGE_PTR / 4, EDGE_PTR / 4 + 3))).toEqual([0, 2, 1]);
  });

  test('refine after a layout returns positions', async () => {
    await worker.send({ type: 'refine' });
    const partial = worker.posted.find((m) => m.type === 'partial');
    expect(partial.positions).toHaveLength(9);
    expect(partial.energy).toBe(0.5);
  });
});

test('JS fallback pulls nodes joined by an edge given by node id', async () => {
  const worker = await loadWorker(async () => { throw new Error('no engine'); });
  const nodes = [
    { id: 'a', seedX: -5, seedY: 0, seedZ: 0 },
    { id: 'c', seedX: 5, seedY: 0, seedZ: 0 },
  ];
  await worker.send({ type: 'layout', nodes, edges: [{ source: 'a', target: 'c' }], config: { maxIterations: 20 } });
  const result = worker.posted.find((m) => m.type === 'result');
  expect(result.engine).toBe('js');
  const [ax, , , cx] = result.positions;
  expect(cx - ax).toBeLessThan(10);
});
