// C4 regression: supply and its 60-second simulation clock begin only on explicit start.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(html, /id="c4-start"/, 'C4 needs an explicit supply button');
assert.doesNotMatch(html, /id="v2-start"/, 'legacy supply button must not remain in game HTML');
assert.match(html, /#c4-start\.supply-attention[\s\S]*?box-shadow/, 'C4 start button needs a high-contrast attention style');
assert.match(html, /id="c4-timer"/, 'C4 countdown must have its own topbar element');
assert.match(html, /<header id="topbar">[\s\S]*?id="c4-timer"[\s\S]*?<\/header>/, 'countdown belongs in the always-visible topbar');

const elements = new Map();
function element(id) {
  const classes = new Set();
  if (!elements.has(id)) elements.set(id, {
    id, style: {}, textContent: '', innerHTML: '', value: '',
    classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      toggle(name, force) { if (force === undefined ? !classes.has(name) : force) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); } },
    listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild() {}, querySelector() { return element(id + '-child'); },
  });
  return elements.get(id);
}
const ctx = vm.createContext({
  console, Math, Date, JSON, Map, Set, Infinity, performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem() {} },
  setInterval() {}, setTimeout() {}, clearTimeout() {}, requestAnimationFrame() {},
  window: { addEventListener() {} },
  document: { getElementById: element, createElement: () => element('created-' + Math.random()) },
  Render: { cv: null, resize() {}, drawPreview() {}, draw() {} },
});
for (const file of ['synthesis-engine.js', 'synthesis-config.js', 'levels.js', 'blueprint.js', 'challenges.js', 'core.js', 'sim.js', 'input.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), ctx, { filename: file });
}
vm.runInContext('UI.init(); loadChallenge(3);', ctx);
assert.strictEqual(vm.runInContext('CHALLENGES[3].passNeed', ctx), 120, 'C4 passes at the original 120-delivery requirement');
for (const [delivered, stars] of [[0, 0], [119, 0], [120, 1], [219, 1], [220, 2], [299, 2], [300, 3], [360, 3]]) {
  assert.strictEqual(vm.runInContext(`CHALLENGES[3].stars({ delivered: ${delivered} })`, ctx), stars,
    `C4 ${delivered} deliveries should award ${stars} stars`);
}
assert.match(vm.runInContext('CHALLENGES[3].hint', ctx), /★≥120 · ★★≥220 · ★★★≥300/);
assert.match(element('target-cond').textContent, /交付≥120/, 'topbar displays the C4 pass requirement');
vm.runInContext("UI.showChalWin(0, '交付 119 个', false);", ctx);
assert.strictEqual(element('modal-child').textContent, '未达标', 'below 120 deliveries is a failed C4 attempt');
assert.strictEqual(element('btn-next').style.display, 'none', 'failed C4 attempt cannot advance from the result dialog');
vm.runInContext("UI.showChalWin(1, '交付 120 个', false); UI.hideModal();", ctx);
assert.strictEqual(element('modal-child').textContent, '过关！', '120 deliveries passes C4');
assert.notStrictEqual(element('btn-next').style.display, 'none', 'passing C4 permits moving to the next challenge');
const state = () => vm.runInContext('({ started: G.chal.started, tick: G.tickCount, delivered: G.delivered, won: G.won, paused: G.paused, item: G.grid[5][4] && G.grid[5][4].item, remaining: UI.c4Remaining() })', ctx);
vm.runInContext("G.grid[5][4] = mkCell('extractor', 4, 5, 1);", ctx);
assert.strictEqual(state().started, false, 'loading C4 leaves supply stopped');
assert.notStrictEqual(element('c4-start').style.display, 'none', 'C4 start button is visible');
assert(element('c4-start').classList.contains('supply-attention'), 'C4 start button is highlighted while waiting');
vm.runInContext('for (let i = 0; i < 20; i++) { Sim.tick(); challengeTick(); } UI.refreshChalProgress();', ctx);
assert.strictEqual(state().tick, 0, 'idle C4 does not consume simulation time');
assert.strictEqual(state().item, null, 'idle C4 extractor does not feed');
assert.strictEqual(state().remaining, 60, 'idle countdown shows full 60 seconds');
assert.match(element('c4-timer').textContent, /60/);
assert.notStrictEqual(element('c4-timer').style.display, 'none', 'timer remains visible while idle');

element('c4-start').listeners.click();
assert.strictEqual(state().started, true, 'button starts supply');
assert(!element('c4-start').classList.contains('supply-attention'), 'highlight clears after starting');
vm.runInContext('Sim.tick(); challengeTick(); UI.refreshChalProgress();', ctx);
assert.strictEqual(state().tick, 1);
assert.ok(state().item, 'extractor feeds after start');
vm.runInContext('for (let i = 0; i < 7; i++) { Sim.tick(); challengeTick(); } UI.refreshChalProgress();', ctx);
assert.ok(state().remaining < 60);

vm.runInContext('G.paused = true; frame(1000); frame(1150);', ctx);
assert.strictEqual(state().tick, 8, 'pause freezes the clock');
vm.runInContext('G.paused = false; for (let i = 0; i < 399 && !G.won; i++) { Sim.tick(); challengeTick(); }', ctx);
assert.strictEqual(state().tick, 400);
assert.strictEqual(state().won, true, 'C4 settles at exactly 400 ticks');
assert.strictEqual(state().remaining, 0);

vm.runInContext('loadChallenge(3); UI.refreshChalProgress();', ctx);
assert.strictEqual(state().started, false, 'restart clears started state');
assert.strictEqual(state().tick, 0, 'restart restores full clock');
assert.strictEqual(state().remaining, 60);
vm.runInContext('loadChallenge(2);', ctx);
assert.strictEqual(element('c4-timer').style.display, 'none', 'other challenges hide C4 countdown');
assert.strictEqual(element('c4-start').style.display, 'none', 'C3 hides supply button');
for (const index of [0,1,4,5]) {
  vm.runInContext(`loadChallenge(${index});`, ctx);
  assert.strictEqual(element('c4-start').style.display, 'none', 'non-C4 challenge hides supply button');
}
for (const expression of ['loadLevel(0)', 'loadFree()', 'loadDaily()']) {
  vm.runInContext(expression, ctx);
  assert.strictEqual(element('c4-start').style.display, 'none', 'other game modes hide supply button');
}
console.log('C4_START_TESTS_PASS');
