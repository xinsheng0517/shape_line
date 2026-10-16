'use strict';

// Read-only evidence for the current C1 cutter behavior; PASS does not mean fixed.
// Run from any directory: node docs/diagnostics/c1-cutter-repro.js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const runtimeFiles = ['levels.js', 'petal-v3.js', 'challenges.js',
  'challenge-v3.js', 'core.js', 'sim.js'];
const source = files => files.map(file =>
  fs.readFileSync(path.join(root, 'js', file), 'utf8')).join('\n');
const runtimeContext = {
  console, performance, assert, setTimeout: () => 0, clearTimeout() {},
  window: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
};
vm.createContext(runtimeContext);
vm.runInContext(source(runtimeFiles) + `
const Render = { cv: null, resize() {}, drawPreview() {} };
const UI = { refreshLevel() {}, refreshBudget() {}, refreshToolbar() {},
  syncPause() {}, refreshLevels() {}, showChalWin() {}, refreshV3() {}, toast() {} };
function advance(n) { for (let i = 0; i < n; i++) V3Runtime.tick(); }
function ids() { return V3Runtime.materialIds().slice().sort(); }
function cutter(x, y, dir, mode) {
  const c = mkCell('cutter', x, y, dir);
  c.machineMode = mode; G.grid[y][x] = c; return c;
}
function incoming(c, side, shape) {
  const delta = DIRV[(c.dir + (side === 'back' ? 2 : 3)) % 4];
  const dir = (c.dir + (side === 'back' ? 0 : 1)) % 4;
  const b = mkCell('belt', c.x + delta[0], c.y + delta[1], dir);
  b.item = V3Runtime.item(shape, b); G.grid[b.y][b.x] = b; return b;
}
let acceptedCases = 0, rejectedCases = 0;
let rejectionEvidence = null, successEvidence = null;
for (const kind of ['T', 'C', 'S']) {
  for (const orientation of [0, 90, 180, 270]) {
    for (const dir of [0, 1, 2, 3]) {
      for (const side of ['back', 'left']) {
        for (const stage of ['raw', 'vertical-half']) {
          for (const mode of ['auto', 'vertical', 'horizontal']) {
            V3Runtime.load(0);
            const tag = [kind, orientation, dir, side, stage, mode].join('-');
            const raw = PetalV3.raw(kind, 'diagnostic-' + tag, orientation);
            const halves = PetalV3.cut(raw, 'vertical');
            const shape = stage === 'raw' ? raw : halves[0];
            // Keep the unused half in stock so the added original's four units remain accounted for.
            if (stage !== 'raw') G.v3.stockByNode[0].push(halves[1]);
            const c = cutter(10, 10, dir, mode);
            const b = incoming(c, side, shape);
            const item = b.item, before = ids();
            const expectedAccepted = stage === 'raw' ? mode !== 'horizontal' : mode !== 'vertical';
            const port = V3Runtime.accepts(c, b.x, b.y, item);
            assert.equal(port, expectedAccepted ? (side === 'back' ? 'queueA' : 'queueB') : null, tag);
            advance(12);
            assert.deepEqual(ids(), before, tag + ': no unit loss or duplication');
            assert.equal(new Set(ids()).size, ids().length, tag + ': unit IDs unique');
            assert.equal(c.proc, null, tag + ': processing must finish or never start');
            assert.equal(c.queueA.length + c.queueB.length, 0, tag + ': no invalid item in queues');
            if (expectedAccepted) {
              acceptedCases++;
              assert.equal(b.item, null, tag + ': accepted input leaves belt');
              const outputStage = stage === 'raw' ? 'vertical-half' : 'quarter';
              assert.equal(c.outA.shape.stage, outputStage, tag);
              assert.equal(c.outB.shape.stage, outputStage, tag);
              assert.equal(c.outA.shape.orientation, orientation, tag);
              assert.equal(c.outB.shape.orientation, orientation, tag);
              if (stage === 'vertical-half' && mode === 'horizontal' && !successEvidence) {
                successEvidence = { inputStage: stage, mode, port,
                  outputStages: [c.outA.shape.stage, c.outB.shape.stage] };
              }
            } else {
              rejectedCases++;
              assert.equal(b.item, item, tag + ': rejected item remains identical on source belt');
              assert.equal(c.outA, null, tag); assert.equal(c.outB, null, tag);
              assert.equal(b.status, '下游入口未对齐或缓存已满', tag);
              assert.equal(c.status, '等待材料', tag);
              if (stage === 'raw' && !rejectionEvidence) {
                rejectionEvidence = { inputStage: stage, mode, port,
                  beltStatus: b.status, cutterStatus: c.status, itemRetained: true };
              }
            }
          }
        }
      }
    }
  }
}
console.log('PASS_CURRENT_RULES_MATRIX', JSON.stringify({
  acceptedCases, rejectedCases, total: acceptedCases + rejectedCases,
  shapes: ['T', 'C', 'S'], itemOrientations: [0, 90, 180, 270],
  machineDirections: [0, 1, 2, 3], validInputSides: ['back', 'left'],
  conservation: 'all original unit IDs retained exactly once',
}));
console.log('CURRENT_RAW_HORIZONTAL_REJECTION', JSON.stringify(rejectionEvidence));
console.log('CURRENT_HALF_HORIZONTAL_SUCCESS', JSON.stringify(successEvidence));
`, runtimeContext, { filename: 'c1-cutter-runtime-probe.js' });

// Exercise the actual input.js DOM listener with lightweight DOM stubs.
const selects = [], elements = new Map();
function element(tag = 'div') {
  const el = { tag, style: {}, children: [], listeners: {}, textContent: '', innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(child) { this.children.push(child); },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    querySelector() { return element(); },
  };
  if (tag === 'select') selects.push(el);
  return el;
}
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  },
  createElement: element,
};
const inputContext = {
  console, performance, assert, document, setTimeout: () => 0, clearTimeout() {},
  window: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
};
vm.createContext(inputContext);
const inputFiles = ['levels.js', 'blueprint.js', 'petal-v3.js', 'challenges.js',
  'challenge-v3.js', 'core.js', 'sim.js', 'input.js'];
vm.runInContext(source(inputFiles) + `
const Render = { cv: null, resize() {}, drawPreview() {} };
UI.els = { tabs: ge('tabs'), lvlName: ge('lvl-name'), toolbar: ge('toolbar'),
  toast: ge('toast'), hint: ge('hint'), modal: ge('modal'), winStars: ge('win-stars'),
  winInfo: ge('win-info'), btnNext: ge('btn-next'), bpbar: ge('bpbar'),
  menu: ge('menu'), statRate: ge('stat-rate') };
G.v3 = { running: false, toolModes: { cutter: 'auto', merger: 'auto' },
  stockByNode: [], discardedItems: [], selected: { x: 4, y: 4 } };
G.mode = 'challenge'; G.chalIndex = 0; G.chal = { elapsed: 0, done: false };
G.chalDef = CHALLENGES[0]; G.target = G.chalDef.target;
G.grid = Array.from({ length: 16 }, () => Array(24).fill(null));
G.budget = { belt: Infinity, extractor: Infinity, cutter: Infinity,
  rotator: Infinity, merger: Infinity, trash: Infinity };
G.used = { belt: 0, extractor: 0, cutter: 0, rotator: 0, merger: 0, trash: 0 };
const c = mkCell('cutter', 4, 4, 1); c.machineMode = 'auto';
c.queueA = [V3Runtime.item(PetalV3.raw('T', 'occupied-probe'), c)]; G.grid[4][4] = c;
UI.bpOpen = true; UI.refreshBps();
globalThis.probeState = () => ({ selectedMachineMode: c.machineMode,
  futureMachineDefault: G.v3.toolModes.cutter, toast: UI.els.toast.textContent });
globalThis.placeNext = () => {
  assert.equal(Input.tryPlace(8, 8, 'cutter', 1, true), true);
  return cellAt(8, 8).machineMode;
};
`, inputContext, { filename: 'c1-cutter-input-probe.js' });
const select = selects[0];
select.value = 'horizontal';
select.listeners.change();
const blockedSwitch = inputContext.probeState();
const futureMachineMode = inputContext.placeNext();
assert.equal(blockedSwitch.selectedMachineMode, 'auto');
assert.equal(select.value, 'auto');
assert.equal(blockedSwitch.toast, '机器有物品时不能切换模式');
assert.equal(blockedSwitch.futureMachineDefault, 'horizontal');
assert.equal(futureMachineMode, 'horizontal');
console.log('EXPECTED_KNOWN_DEFECT_OCCUPIED_DEFAULT_POLLUTION', JSON.stringify({
  ...blockedSwitch, visibleSelectMode: select.value, futureMachineMode,
}));
console.log('EVIDENCE_CAPTURE_COMPLETE: current behavior verified; no gameplay fix applied.');
