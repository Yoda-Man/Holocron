/**
 * A tiny stand-in for React, enough to render a function component in Node.
 *
 * React is supplied by YodaMan at runtime and is not a dependency here. This
 * runtime keeps hook state between renders, runs effects, and, like React,
 * throws when a component calls a different list of hooks than last time.
 * JSX compiles to plain `{ type, props }` trees.
 */
let current = null;

const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

function slot(kind, init) {
  const i = current.index++;
  current.kinds.push(kind);
  if (!(i in current.slots)) current.slots[i] = init();
  return current.slots[i];
}

export function useState(initial) {
  const s = slot('state', () => ({ v: typeof initial === 'function' ? initial() : initial }));
  return [s.v, (next) => { s.v = typeof next === 'function' ? next(s.v) : next; }];
}
export const useRef = (value) => slot('ref', () => ({ current: value }));
export function useMemo(fn, deps) {
  const s = slot('memo', () => ({}));
  if (changed(s.deps, deps)) { s.v = fn(); s.deps = deps; }
  return s.v;
}
export const useCallback = (fn, deps) => useMemo(() => fn, deps);
export function useEffect(fn, deps) {
  const s = slot('effect', () => ({}));
  if (changed(s.deps, deps)) {
    s.deps = deps;
    current.effects.push(() => { if (typeof s.cleanup === 'function') s.cleanup(); s.cleanup = fn(); });
  }
}

export const Fragment = 'Fragment';
export const jsx = (type, props) => ({ type, props: props || {} });
export const jsxs = jsx;
export default { useState, useRef, useMemo, useCallback, useEffect, Fragment };

/** Render `Component` and return a handle whose `render(props)` renders it again. */
export function mount(Component, props) {
  const inst = { slots: [], props };
  inst.render = (p = inst.props) => {
    inst.props = p;
    Object.assign(inst, { index: 0, kinds: [], effects: [] });
    current = inst;
    try { inst.tree = Component(p); } finally { current = null; }
    if (inst.prev && inst.prev.join() !== inst.kinds.join()) {
      throw new Error(`Hook order changed: ${inst.prev.length} hooks before, ${inst.kinds.length} now`);
    }
    inst.prev = inst.kinds;
    for (const run of inst.effects) run();
    return inst.tree;
  };
  inst.render();
  return inst;
}

/** Every element in a tree, depth first. */
export function elements(tree) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    out.push(n);
    walk(n.props.children);
  };
  walk(tree);
  return out;
}

/** All text inside an element. */
export const text = (n) => elements(n).flatMap((e) => [].concat(e.props.children).filter((c) => typeof c === 'string')).join('');
