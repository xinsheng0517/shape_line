'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(html, /id="landscape-gate"[\s\S]*?id="landscape-action"/, 'mobile portrait needs an orientation prompt and action');
assert.doesNotMatch(html, /#game\s*\{[^}]*rotate\(90deg\)/s, 'canvas alone must not rotate behind portrait UI');
assert.match(html, /@media \(max-width:800px\)[\s\S]*?#tray\s*\{[^}]*overflow-x:auto/s, 'small landscape toolbars remain reachable');
assert.match(html, /#tray\.v2-mode:not\(\.min\)\s*\{[^}]*max-height:36vh;[^}]*overflow-y:auto/s,
  'advanced controls scroll instead of covering a short landscape viewport');

function element() {
  const listeners = new Map();
  return {
    hidden: true,
    addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
    dispatch(type) { for (const fn of listeners.get(type) || []) fn(); },
  };
}
const gate = element(), action = element(), viewport = element(), win = element(), orientation = element();
let portrait = true, fullscreenCalls = 0, lockMode = '', resizes = 0;
win.innerWidth = 390; win.innerHeight = 844; win.visualViewport = viewport;
win.matchMedia = query => ({ matches: query === '(orientation: portrait)' ? portrait : query === '(pointer: coarse)' });
const doc = { getElementById: id => id === 'landscape-gate' ? gate : action,
  fullscreenElement: null, documentElement: { async requestFullscreen() { fullscreenCalls++; doc.fullscreenElement = doc.documentElement; } },
  addEventListener() {} };
const screen = { width: 390, height: 844, orientation };
orientation.lock = async mode => { lockMode = mode; };
const context = vm.createContext({
  console, window: win, document: doc, screen,
  navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', maxTouchPoints: 5 },
  G: { orientationBlocked: false }, Render: { cv: {}, resize() { resizes++; } },
});
vm.runInContext(fs.readFileSync(path.join(root, 'js/input.js'), 'utf8'), context);

async function main() {
  vm.runInContext('Landscape.init();', context);
  assert.strictEqual(gate.hidden, false, 'mobile portrait is prompted immediately');
  assert.strictEqual(context.G.orientationBlocked, true, 'portrait freezes gameplay');
  await vm.runInContext('Landscape.request();', context);
  assert.strictEqual(fullscreenCalls, 1, 'a user action requests fullscreen');
  assert.strictEqual(lockMode, 'landscape', 'fullscreen is followed by orientation lock');

  portrait = false; win.innerWidth = 844; win.innerHeight = 390;
  win.dispatch('orientationchange');
  assert.strictEqual(gate.hidden, true, 'landscape resumes the game');
  assert.strictEqual(context.G.orientationBlocked, false);
  portrait = true; win.dispatch('resize');
  assert.strictEqual(gate.hidden, false, 'rotating back to portrait restores the prompt');
  assert.strictEqual(context.G.orientationBlocked, true);
  portrait = false; viewport.dispatch('resize');
  assert.strictEqual(gate.hidden, true, 'visual viewport changes refresh orientation state');

  context.navigator.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  context.navigator.maxTouchPoints = 0;
  win.matchMedia = query => ({ matches: query === '(orientation: portrait)' });
  portrait = true;
  vm.runInContext('Landscape.update();', context);
  assert.strictEqual(gate.hidden, true, 'a desktop portrait window is not blocked');
  assert.strictEqual(context.G.orientationBlocked, false);
  assert(resizes >= 0);

  const renderContext = vm.createContext({
    console, window: { innerWidth: 390, innerHeight: 844, devicePixelRatio: 3,
      visualViewport: { width: 667, height: 320 } },
    document: { getElementById: id => ({ offsetHeight: id === 'topbar' ? 82 : 46 }) },
    TILE: 32, GRID_W: 24, GRID_H: 16,
    computeTile: (w, h) => Math.max(1, Math.min(Math.floor(w / 24), Math.floor(h / 16))),
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/render.js'), 'utf8'), renderContext);
  vm.runInContext(`Render.cv = { style: {}, getContext() { return {}; } }; Render._buildFloor = () => {}; Render.resize();`, renderContext);
  const layout = vm.runInContext('({ w: Render.cssW, h: Render.cssH, tile: TILE, top: Render.oy, bottom: Render.oy + GRID_H * TILE })', renderContext);
  assert.strictEqual(layout.w, 667, 'canvas uses visible mobile viewport width');
  assert.strictEqual(layout.h, 320, 'canvas uses visible mobile viewport height');
  assert(layout.bottom <= layout.h - 46, 'the game grid stays above the bottom toolbar');

  const coreContext = vm.createContext({
    console, window: { addEventListener() {} }, localStorage: { getItem() { return null; }, setItem() {} },
    requestAnimationFrame() {}, Render: { cv: null, draw() {} },
    Sim: { tick() { coreContext.ticks++; } }, ticks: 0,
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/core.js'), 'utf8'), coreContext);
  assert.strictEqual(vm.runInContext('computeTile(643, 160)', coreContext), 10,
    'a short landscape viewport can shrink below the old 12px tile floor');
  vm.runInContext('G.orientationBlocked = true; G.chal = { elapsed: 0, done: false, started: true }; G.chalDef = { id: "C4" }; frame(1000); frame(1200);', coreContext);
  assert.strictEqual(coreContext.ticks, 0, 'portrait does not advance simulation');
  assert.strictEqual(vm.runInContext('G.tickCount', coreContext), 0);
  assert.strictEqual(vm.runInContext('G.chal.elapsed', coreContext), 0, 'portrait does not consume challenge time');
  console.log('MOBILE_LANDSCAPE_TESTS_PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
