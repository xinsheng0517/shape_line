'use strict';
// Read-only diagnostic: reproduces current C1 behavior, including two scheduler gaps.
// Run from anywhere: node <project>/docs/diagnostics/c1-merge-repro.js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..', '..');
const files = ['levels.js', 'petal-v3.js', 'challenges.js', 'challenge-v3.js', 'core.js', 'sim.js'];
const context = {
  console, performance, assert, setTimeout: () => 0, clearTimeout() {},
  window: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
};
vm.createContext(context);
vm.runInContext(files.map(file => fs.readFileSync(path.join(root, 'js', file), 'utf8')).join('\n') + String.raw`
const Render = { cv: null, resize() {}, drawPreview() {} };
const UI = { refreshLevel() {}, refreshBudget() {}, refreshToolbar() {}, syncPause() {},
  refreshLevels() {}, showChalWin() {}, refreshV3() {}, toast() {} };
function machine(type, x, y, dir, mode = 'auto') {
  assert(!G.grid[y][x], 'fixture overwrote cell at ' + x + ',' + y);
  const c = mkCell(type, x, y, dir); c.machineMode = mode; G.grid[y][x] = c;
  return c;
}
function belt(x, y, dir) { return machine('belt', x, y, dir); }
function advance(n) { for (let i = 0; i < n; i++) V3Runtime.tick(); }
function quarters(kind, id, orientation = 0) {
  return PetalV3.cut(PetalV3.raw(kind, id, orientation)).flatMap(h => PetalV3.cut(h));
}
function q(kind, id, quadrant, orientation = 0) {
  return quarters(kind, id, orientation).find(s => s.quadrant === quadrant);
}
function half(side, id) {
  return PetalV3.merge(q('T', id + ':T', 'T' + side), q('C', id + ':C', 'B' + side));
}
function put(c, port, shape) { (c[port] ||= []).push(V3Runtime.item(shape, c)); }
function summary(c) {
  return { status: c.status, queueA: c.queueA.length, queueB: c.queueB.length,
    slotsA: [...new Set(c.queueA.map(it => it.shape.quadrant))],
    slotsB: [...new Set(c.queueB.map(it => it.shape.quadrant))],
    internal: c.autoHalves.map(s => s.side + ':' + s.recipeId),
    proc: c.proc && c.proc.shape.recipeId, out: c.outA && c.outA.shape.recipeId };
}
function assertConserved() {
  const ids = V3Runtime.materialIds();
  assert.equal(ids.length, G.v3.nextRawByNode.reduce((a, b) => a + b, 0) * 4);
  assert.equal(new Set(ids).size, ids.length);
}

// Pure rule matrix: each independent failure has distinct inputs.
const matrix = [
  ['legal left T-top + C-bottom', q('T','ok-t','TL'),q('C','ok-c','BL'),'H_TC'],
  ['legal right T-top + C-bottom',q('T','okr-t','TR'),q('C','okr-c','BR'),'H_TC'],
  ['same material, correct side/rows',q('T','same-t1','TL'),q('T','same-t2','BL'),null],
  ['opposite sides, correct rows/materials',q('T','side-t','TL'),q('C','side-c','BR'),null],
  ['both upper, correct side/different materials',q('T','row-t','TL'),q('C','row-c','TL'),null],
  ['both lower, correct side/different materials',q('T','row2-t','BL'),q('C','row2-c','BL'),null],
  ['raw inputs',PetalV3.raw('T','raw-t'),PetalV3.raw('C','raw-c'),null],
  ['uncut vertical halves',PetalV3.cut(PetalV3.raw('T','vh-t'))[0],PetalV3.cut(PetalV3.raw('C','vh-c'))[0],null],
  ['mixed stages',q('T','stage-t','TL'),half('L','stage-h'),null],
  ['different orientation',q('T','rot-t','TL'),q('C','rot-c','BL',90),null],
  ['source shape conflict',q('T','conflict','TL'),q('C','conflict','BL'),null],
];
for (const [name,a,b,expected] of matrix) {
  const result = PetalV3.merge(a,b);
  assert.equal(result && result.recipeId, expected, name);
  console.log('RULE', name, '=>', result ? result.recipeId : 'rejected');
}
const duplicate = q('T','duplicate','TL');
assert.equal(PetalV3.merge(duplicate,duplicate),null);
assert.equal(PetalV3.merge({...q('T','copy','TL')},q('C','copy-c','BL')),null);

// Topology from the reported screenshot: one T source, one initial cutter,
// two second cutters, ONLY both front/top outputs routed to A/B of one merger.
// Both side/bottom outputs go to trash. Coordinates merely fit the same topology.
V3Runtime.load(0);
machine('extractor',3,3,1);
for(let x=4;x<7;x++) belt(x,3,1);
const first=machine('cutter',7,3,1);
belt(8,3,1); belt(9,3,1);
const left=machine('cutter',10,3,1);
belt(7,4,2); belt(7,5,1);
const right=machine('cutter',8,5,1);
machine('trash',10,4,0); machine('trash',8,6,0);
for(let y=3;y<6;y++) belt(11,y,2);
for(let x=11;x<14;x++) belt(x,6,1);
belt(9,5,2); belt(9,6,2);
for(let x=9;x<14;x++) belt(x,7,1);
belt(14,7,0);
const stuck=machine('merger',14,6,1);
let saturatedAt=null;
for(let i=0;i<1500;i++) {
  V3Runtime.tick();
  if(i%10===0) assertConserved();
  if(stuck.queueA.length===64 && stuck.queueB.length===64) { saturatedAt=G.tickCount; break; }
}
assert(saturatedAt,'both queues must reproduce screenshot saturation');
assert.equal(G.delivered,0);
assert.equal(stuck.status,'等待可配对材料');
assert(stuck.queueA.every(it=>it.shape.quadrant==='TL' && it.shape.shapeKind==='T'));
assert(stuck.queueB.every(it=>it.shape.quadrant==='TR' && it.shape.shapeKind==='T'));
assert.equal(stuck.proc,null); assert.equal(stuck.outA,null); assert.equal(stuck.autoHalves.length,0);
assert(G.v3.discardedItems.length>0 && G.v3.discardedItems.every(s=>s.quadrant[0]==='B'));
assert(G.v3.discardReasons.every(row=>row.reason==='玩家垃圾桶'));
assert.equal(V3Runtime.accepts(stuck,13,6,V3Runtime.item(q('T','capacity','TL'),stuck)),null);
advance(80); assertConserved();
console.log('SCREENSHOT_TOPOLOGY',JSON.stringify({saturatedAt,tick:G.tickCount,delivered:G.delivered,
  merger:summary(stuck),discarded:G.v3.discardedItems.length,
  inletAStatus:G.grid[6][13].status,inletBStatus:G.grid[7][14].status,
  firstStatus:first.status,leftStatus:left.status,rightStatus:right.status}));

// A/B are transport buffers; matching scans their union. All four target quarters
// can enter A alone, B alone, or both; all cases make F_TC_TC.
for(const ports of [['queueA','queueA','queueA','queueA'],['queueB','queueB','queueB','queueB'],
                    ['queueA','queueB','queueA','queueB']]) {
  V3Runtime.load(0); const c=machine('merger',12,8,1);
  const inputs=[q('T','legal-tL','TL'),q('C','legal-cL','BL'),q('T','legal-tR','TR'),q('C','legal-cR','BR')];
  inputs.forEach((s,i)=>put(c,ports[i],s)); advance(30);
  assert.equal(c.outA.shape.recipeId,'F_TC_TC'); assert(PetalV3.isFinished(c.outA.shape,['F_TC_TC']));
  assert.deepEqual([...c.outA.shape.unitIds].sort(),inputs.flatMap(s=>[...s.unitIds]).sort());
  console.log('LEGAL_TARGET',ports.join('+'),JSON.stringify(summary(c)));
}

// Invalid stages remain conserved but are currently admitted to merger buffers.
// This is a runtime validation gap, independent of the screenshot's valid quarters.
for(const stage of ['raw','vertical-half']) {
  V3Runtime.load(0); const c=machine('merger',12,8,1);
  const rawT=PetalV3.raw('T','wrong-'+stage+'-T'), rawC=PetalV3.raw('C','wrong-'+stage+'-C');
  const a=stage==='raw'?rawT:PetalV3.cut(rawT)[0], b=stage==='raw'?rawC:PetalV3.cut(rawC)[0];
  assert.equal(PetalV3.merge(a,b),null);
  assert.equal(V3Runtime.accepts(c,11,8,V3Runtime.item(a,c)),'queueA');
  const incomingA=belt(11,8,1), incomingB=belt(12,9,0);
  incomingA.item=V3Runtime.item(a,incomingA); incomingB.item=V3Runtime.item(b,incomingB);
  advance(30); assert.equal(incomingA.item,null); assert.equal(incomingB.item,null);
  assert.equal(c.proc,null); assert.equal(c.outA,null);
  assert.deepEqual(c.queueA[0].shape.unitIds,a.unitIds); assert.deepEqual(c.queueB[0].shape.unitIds,b.unitIds);
  console.log('KNOWN_DEFECT_STAGE_VALIDATION_GAP',stage,JSON.stringify(summary(c)));
}

// Confirm a second independent runtime gap: a legal pair split between the
// auto-generated internal bank and an external mixed-half queue is never joined.
V3Runtime.load(0); const mixed=machine('merger',12,8,1);
put(mixed,'queueA',q('T','split-t','TL')); put(mixed,'queueA',q('C','split-c','BL'));
advance(20); assert.equal(mixed.autoHalves.length,1);
const externalRight=half('R','external-right');
const expected=PetalV3.merge(mixed.autoHalves[0],externalRight);
assert.equal(expected.recipeId,'F_TC_TC');
assert.equal(V3Runtime.accepts(mixed,12,9,V3Runtime.item(externalRight,mixed)),'queueB');
const externalBelt=belt(12,9,0); externalBelt.item=V3Runtime.item(externalRight,externalBelt);
advance(100); assert.equal(externalBelt.item,null,'external half physically entered queue B');
assert.equal(mixed.autoHalves.length,1); assert.equal(mixed.queueB.length,1);
assert.equal(mixed.proc,null); assert.equal(mixed.outA,null);
console.log('KNOWN_DEFECT_SPLIT_HALF_POOL',JSON.stringify({legalCombinedRecipe:expected.recipeId,merger:summary(mixed)}));

// Control: the same two external mixed halves in the two ordinary queues finish.
V3Runtime.load(0); const control=machine('merger',12,8,1);
const controlA=belt(11,8,1), controlB=belt(12,9,0);
controlA.item=V3Runtime.item(half('L','control-left'),controlA);
controlB.item=V3Runtime.item(half('R','control-right'),controlB);
advance(10); assert.equal(control.outA.shape.recipeId,'F_TC_TC');
console.log('EXTERNAL_HALF_CONTROL',JSON.stringify(summary(control)));
console.log('C1_MERGE_DIAGNOSTIC_PASS: current behavior and KNOWN_DEFECT cases reproduced; this is not a fix verification');
`,context,{filename:'c1-merge-repro.vm.js'});
