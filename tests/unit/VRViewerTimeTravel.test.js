/**
 * VRViewerTimeTravel.test.js — Git time-travel behavior tests
 */

import { jest } from '@jest/globals';
import { setTimeout, clearTimeout } from 'node:timers';

let VRViewer;

jest.unstable_mockModule('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    constructor() { this.target = { set() {}, copy() {} }; }
    update() {}
    dispose() {}
  },
}));

beforeAll(async () => {
  VRViewer = (await import('../../frontend/VRViewer.js')).default;
});

function fakeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    style: {},
    className: '',
    textContent: '',
    value: '',
    min: '',
    max: '',
    step: '',
    type: '',
    disabled: false,
    parentNode: null,
    _listeners: {},
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute(name, value) { this[name] = String(value); },
    addEventListener(name, fn) { this._listeners[name] = fn; },
    querySelector(selector) {
      const className = selector.startsWith('.') ? selector.slice(1) : selector;
      const stack = [...this.children];
      while (stack.length) {
        const node = stack.shift();
        if ((node.className || '').split(/\s+/).includes(className)) return node;
        stack.push(...(node.children || []));
      }
      return null;
    },
  };
  return el;
}

function installDom() {
  const body = fakeElement('body');
  global.document = { body, createElement: jest.fn((tag) => fakeElement(tag)) };
  global.window = { setTimeout, clearTimeout };
  global.performance = { now: () => 1000 };
}

describe('VRViewer Git time travel', () => {
  beforeEach(() => {
    installDom();
    jest.useFakeTimers();
    VRViewer.clearGitHistoryCache?.();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.document;
    delete global.window;
    delete global.fetch;
  });

  test('enableTimeTravelMode fetches history once per workspace and creates a commit-index slider', async () => {
    const container = fakeElement('section');
    const commits = [
      { hash: 'aaa111', date: '2026-06-01T00:00:00Z', message: 'first', filesChanged: ['src/a.dart'] },
      { hash: 'bbb222', date: '2026-06-02T00:00:00Z', message: 'second', filesChanged: ['src/b.dart'] },
    ];
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => commits }));

    const viewer = new VRViewer(container, { workspacePath: '/workspace/app' });
    await viewer.enableTimeTravelMode();
    await viewer.enableTimeTravelMode();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/git/history?path=%2Fworkspace%2Fapp');
    expect(viewer._timeTravel.commits).toEqual(commits);
    expect(viewer._timeTravel.slider.max).toBe('1');
    expect(container.querySelector('.holocron-time-travel-overlay')).not.toBeNull();
  });

  test('setTimeTravelIndex highlights changed file nodes and emits commit context', async () => {
    const container = fakeElement('section');
    const viewer = new VRViewer(container, { workspacePath: '/workspace/app' });
    viewer.nodeIdMap = new Map([
      ['src/auth_service.dart', 0],
      ['src/login.dart', 1],
    ]);
    viewer.nodeData = [
      { id: 'src/auth_service.dart', color: { restored: 'auth' }, scale: 0.2 },
      { id: 'src/login.dart', color: { restored: 'login' }, scale: 0.15 },
    ];
    viewer.updateNodeColor = jest.fn();
    viewer.updateNodeScale = jest.fn();
    const events = [];
    viewer.on('time-travel-change', (event) => events.push(event));

    await viewer.setTimeTravelIndex(0, {
      hash: 'abc1234',
      date: '2026-06-03T10:00:00Z',
      message: 'touch auth',
      filesChanged: ['src/auth_service.dart', 'missing.dart'],
    });

    expect(viewer.updateNodeColor).toHaveBeenCalledWith(0, 0xffffff);
    expect(viewer.updateNodeScale).toHaveBeenCalledWith(0, expect.any(Number));
    expect(events[0]).toMatchObject({ commitIndex: 0, commit: { hash: 'abc1234' }, files: ['src/auth_service.dart', 'missing.dart'] });

    jest.advanceTimersByTime(2000);
    expect(viewer.updateNodeColor).toHaveBeenCalledWith(0, viewer.nodeData[0].color);
    expect(viewer.updateNodeScale).toHaveBeenCalledWith(0, viewer.nodeData[0].scale);
  });
});
