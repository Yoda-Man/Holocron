/**
 * VRController against a fake WebXR session: setup, the per-eye frame loop
 * and trigger selection, on the shipped module.
 */
import { jest } from '@jest/globals';
import * as THREE from 'three';
import VRController from '../../frontend/VRController.js';

const POSE = { position: { x: 1, y: 1.6, z: 2 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };

function fakeSession() {
  const listeners = {};
  const session = {
    frames: [],
    inputSources: [],
    addEventListener: (name, fn) => { listeners[name] = fn; },
    fire: (name, event) => listeners[name](event),
    updateRenderState: jest.fn(),
    requestReferenceSpace: async () => ({}),
    requestAnimationFrame: (fn) => session.frames.push(fn),
    cancelAnimationFrame: () => {},
    end: async () => {},
  };
  return session;
}

function view() {
  const t = new THREE.Matrix4().makeTranslation(POSE.position.x, POSE.position.y, POSE.position.z);
  return {
    projectionMatrix: new THREE.Matrix4().toArray(),
    transform: { ...POSE, matrix: t.toArray(), inverse: { matrix: t.clone().invert().toArray() } },
  };
}

function viewer() {
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1), new THREE.MeshBasicMaterial(), 1);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(1, 1.6, -3));
  const camera = new THREE.PerspectiveCamera();
  const seen = [];
  return {
    camera, scene: new THREE.Scene(), nodesMesh: mesh, nodeIdMap: new Map([['src/app.js', 0]]), seen,
    renderer: { render: () => seen.push(camera.position.clone()) },
  };
}

let session;
beforeEach(() => {
  session = fakeSession();
  global.navigator = { xr: { isSessionSupported: async () => true, requestSession: async () => session } };
  global.XRWebGLLayer = class {
    constructor() {
      this.context = { FRAMEBUFFER: 1, bindFramebuffer() {}, viewport() {} };
      this.framebuffer = {};
    }
    getViewport() { return { x: 0, y: 0, width: 1, height: 1 }; }
  };
  global.performance = { now: () => 0 };
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  delete global.navigator;
  delete global.XRWebGLLayer;
});

test('each XR frame renders once per eye with the camera at the view pose', async () => {
  const v = viewer();
  const controller = new VRController(v);
  const ready = jest.fn();
  controller.on('vr-ready', ready);
  await controller.requestVRSession({});
  expect(ready).toHaveBeenCalled();

  session.frames.at(-1)(0, { getViewerPose: () => ({ views: [view(), view()] }) });
  expect(v.seen).toHaveLength(2);
  expect(v.seen[0].toArray().map((n) => +n.toFixed(3))).toEqual([1, 1.6, 2]);
});

test('a short trigger press on a node selects it', async () => {
  const v = viewer();
  const controller = new VRController(v);
  const selected = jest.fn();
  controller.on('node-select', selected);
  await controller.requestVRSession({});
  controller.xrFrame = { getPose: () => ({ transform: POSE }) };

  const inputSource = { handedness: 'right', targetRaySpace: {} };
  session.fire('selectstart', { inputSource });
  session.fire('selectend', { inputSource });
  expect(selected).toHaveBeenCalledWith({ nodeId: 'src/app.js', instanceIdx: 0 });
});
