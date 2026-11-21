/**
 * Regression: VR goes through three.js's WebXR support (renderer.xr), not a
 * hand-built XRWebGLLayer loop. The real VRViewer and VRController run against
 * a fake navigator.xr session and a renderer stub that records renderer.xr calls.
 */
import { jest } from '@jest/globals';
import * as THREE from 'three';

const { default: VRViewer } = await import('../../frontend/VRViewer.js');
const { default: VRController } = await import('../../frontend/VRController.js');

let session, windowFrames, xrLoop, renderer, rafDuringSession;

function makeSession() {
  const listeners = {};
  return {
    inputSources: [],
    addEventListener: (name, fn) => { listeners[name] = fn; },
    fire: (name, e = {}) => listeners[name]?.(e),
    end: async () => listeners.end?.({}),
  };
}

function makeRenderer() {
  const groups = [0, 1].map(() => new THREE.Group());
  const grips = [0, 1].map(() => new THREE.Group());
  return {
    render: jest.fn(),
    setAnimationLoop: jest.fn((fn) => { xrLoop = fn; }),
    xr: {
      enabled: false,
      setReferenceSpaceType: jest.fn(),
      setSession: jest.fn(async () => {}),
      getController: jest.fn((i) => groups[i]),
      getControllerGrip: jest.fn((i) => grips[i]),
    },
  };
}

function makeViewer() {
  const v = new VRViewer({ clientWidth: 100, clientHeight: 100 });
  v.scene = new THREE.Scene();
  v.camera = new THREE.PerspectiveCamera();
  v.renderer = renderer;
  return v;
}

beforeEach(() => {
  session = makeSession();
  windowFrames = [];
  xrLoop = null;
  rafDuringSession = 0;
  renderer = makeRenderer();
  global.navigator = { xr: { isSessionSupported: async () => true, requestSession: jest.fn(async () => session) } };
  global.requestAnimationFrame = (fn) => {
    if (xrLoop) rafDuringSession++;
    windowFrames.push(fn);
    return windowFrames.length;
  };
  global.cancelAnimationFrame = () => {};
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  delete global.navigator;
  delete global.requestAnimationFrame;
  delete global.cancelAnimationFrame;
});

test('the session, loop and controllers go through renderer.xr, and the desktop loop resumes on end', async () => {
  const v = makeViewer();
  v.start();
  expect(windowFrames).toHaveLength(1);

  const c = new VRController(v);
  await c.requestVRSession();

  expect(navigator.xr.requestSession).toHaveBeenCalledWith('immersive-vr', {
    requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'],
  });
  expect(renderer.xr.enabled).toBe(true);
  expect(renderer.xr.setReferenceSpaceType).toHaveBeenCalledWith('local-floor');
  expect(renderer.xr.setSession).toHaveBeenCalledWith(session);
  expect(renderer.xr.getController).toHaveBeenCalledWith(0);
  expect(renderer.xr.getController).toHaveBeenCalledWith(1);
  expect(renderer.xr.getControllerGrip).toHaveBeenCalledWith(0);
  expect(renderer.xr.getControllerGrip).toHaveBeenCalledWith(1);
  expect(v.scene.children).toContain(renderer.xr.getController(0));
  expect(typeof xrLoop).toBe('function');

  // XR frames render through setAnimationLoop.
  renderer.render.mockClear();
  xrLoop(0, {});
  xrLoop(1, {});
  expect(renderer.render).toHaveBeenCalledTimes(2);

  // The old window loop is dead: running a stale callback queues nothing new.
  const before = windowFrames.length;
  session.fire('end');
  expect(renderer.setAnimationLoop).toHaveBeenLastCalledWith(null);
  expect(windowFrames.length).toBe(before + 1); // desktop loop restarted
});

test('a select on a three.js controller selects the node it points at', async () => {
  const v = makeViewer();
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial(), 1);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, -5));
  v.nodesMesh = mesh;
  v.nodeIdMap = new Map([['src/app.js', 0]]);
  const c = new VRController(v);
  const selected = jest.fn();
  c.on('node-select', selected);
  await c.requestVRSession();

  const ray = renderer.xr.getController(0);
  ray.dispatchEvent({ type: 'connected', data: { handedness: 'right' } });
  ray.updateMatrixWorld();
  ray.dispatchEvent({ type: 'selectstart' });
  ray.dispatchEvent({ type: 'selectend' });
  expect(selected).toHaveBeenCalledWith({ nodeId: 'src/app.js', instanceIdx: 0 });
});

test('guard: nothing calls requestAnimationFrame while a session is active', async () => {
  const v = makeViewer();
  v.start();
  windowFrames.at(-1)();
  const c = new VRController(v);
  await c.requestVRSession();
  const desktop = windowFrames.at(-1);
  desktop(); // a stale desktop frame must not keep the window loop alive
  for (let i = 0; i < 5; i++) xrLoop(i, {});
  v.start(); // a stray start() must not restart the window loop mid-session
  expect(rafDuringSession).toBe(0);
});
