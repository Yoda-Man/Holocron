/**
 * The shipped VRViewer, driven without WebGL: three.js meshes build in Node,
 * and only the renderer is stubbed.
 */
import { jest } from '@jest/globals';
import * as THREE from 'three';

const { default: VRViewer } = await import('../../frontend/VRViewer.js');

function sceneViewer(nodes, edges = []) {
  const v = new VRViewer({ clientWidth: 100, clientHeight: 100 });
  v.scene = new THREE.Scene();
  v.camera = new THREE.PerspectiveCamera();
  v.camera.position.set(0, 0, 3);
  v.renderer = { render: jest.fn() };
  const positions = new Float32Array(nodes.length * 3);
  nodes.forEach((_, i) => { positions[i * 3] = i; });
  v.render(nodes, edges, positions);
  return v;
}

const colourAt = (mesh, i) => new THREE.Color().fromArray(mesh.instanceColor.array, i * 3).getHex();
const scaleAt = (mesh, i) => {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixScale(m).x;
};

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
  delete global.requestAnimationFrame;
});

test('start() renders the first frames, with edges in the scene', () => {
  const frames = [];
  global.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  const v = sceneViewer(
    [{ id: 'a', size: 10 }, { id: 'b', size: 10 }],
    [{ source: 'a', target: 'b', type: 'import' }],
  );
  v.start();
  frames.at(-1)(); // frame 2
  frames.at(-1)(); // frame 3 updates edge visibility
  expect(v.renderer.render).toHaveBeenCalledTimes(3);
});

test('string cluster ids draw a cluster line between src/auth and src/db', () => {
  const v = sceneViewer(
    [
      { id: 'a', clusterId: 'src/auth' }, { id: 'b', clusterId: 'src/auth' },
      { id: 'c', clusterId: 'src/db' }, { id: 'd', clusterId: 'src/db' },
    ],
    [{ source: 'a', target: 'c', type: 'import' }],
  );
  expect(v._clusterAggregateMesh).not.toBeNull();
  expect(v._clusterAggregateMesh.geometry.attributes.position.count).toBe(2);
});

describe('glow follows its own node when only some nodes glow', () => {
  const NODES = [
    { id: 'src/tests/a_test.js', importance: 0 },
    { id: 'src/b.js', importance: 10 },
    { id: 'src/c.js', importance: 0 },
  ];

  test('selecting a node colours its glow, not another node\'s', () => {
    const v = sceneViewer(NODES);
    const before = colourAt(v.glowMesh, 0);
    v.selectNodeById('src/tests/a_test.js');
    expect(colourAt(v.glowMesh, 0)).toBe(before);
    v.selectNodeById('src/b.js');
    expect(colourAt(v.glowMesh, 0)).toBe(0x22d3ee);
  });

  test('hiding a node without glow leaves the visible glow alone', () => {
    const v = sceneViewer(NODES);
    v.setFilter('tests', true);
    expect(scaleAt(v.nodesMesh, 0)).toBe(0);
    expect(scaleAt(v.glowMesh, 0)).toBeGreaterThan(0);
  });
});

describe('language filters', () => {
  const NODES = [
    { id: 'a.ts', language: 'ts' }, { id: 'b.tsx', language: 'tsx' }, { id: 'c.js', language: 'js' },
    { id: 'd.py', language: 'py' }, { id: 'e.md', language: 'md' }, { id: 'f.dart', language: 'dart' },
  ];

  it.each([
    ['typescript', ['a.ts', 'b.tsx']],
    ['javascript', ['c.js']],
    ['python', ['d.py']],
    ['markdown', ['e.md']],
    ['dart', ['f.dart']],
  ])('the %s chip shows only its files', (key, shown) => {
    const v = sceneViewer(NODES);
    v.setFilter(key, true);
    expect(v.getFilters()[key]).toBe(true);
    const visible = NODES.filter((_, i) => v._instanceVisible[i]).map((n) => n.id);
    expect(visible).toEqual(shown);
  });
});
