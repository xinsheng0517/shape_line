// Occupied machines must be removable through the same input and undo paths as empty ones.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function boot(rule) {
  const files = ['synthesis-engine.js', 'synthesis-config.js', 'levels.js', 'blueprint.js'];
  if (rule === 'v2') files.push('trapezoid.js');
  if (rule === 'v3') files.push('petal-v3.js');
  files.push('challenges.js');
  if (rule === 'v2') files.push('challenge-v2.js');
  if (rule === 'v3') files.push('challenge-v3.js');
  files.push('core.js', 'sim.js', 'input.js');
  const el = () => ({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    appendChild(){},addEventListener(){},querySelector:el,textContent:'',innerHTML:''});
  const context = {console,assert,performance,setTimeout(){},clearTimeout(){},setInterval(){},
    window:{addEventListener(){}},document:{getElementById:el,createElement:el},
    localStorage:{getItem(){return null;},setItem(){}}};
  vm.createContext(context);
  vm.runInContext(files.map(f=>fs.readFileSync(path.join(__dirname,'js',f),'utf8')).join('\n')+`
const Render={cv:null,resize(){},drawPreview(){}};
for(const name of ['refreshLevel','refreshBudget','refreshToolbar','syncPause','refreshLevels',
  'showWin','showChalWin','refreshChalProgress','refreshBps','refreshV2','refreshV3','toast']) UI[name]=()=>{};
`,context);
  return (code) => vm.runInContext(code,context);
}

const classic = boot('classic');
classic(`
loadLevel(0);
assert(Input.tryPlace(8,8,'belt',1,true));
cellAt(8,8).item=mkItem(['C','C','C','C'],8,8);
G.tool='bulldoze'; Input.click(8,8);
assert.equal(cellAt(8,8),null,'a loaded classic belt can be demolished');
assert.equal(G.used.belt,0);
assert(Undo.undo(),'demolition remains undoable');
assert(cellAt(8,8)&&!cellAt(8,8).item,'undo restores an empty device');
G.paused=true; G.tool='bulldoze'; Input.click(8,8);
assert.equal(cellAt(8,8),null,'paused gameplay does not prevent demolition');
assert(Input.tryPlace(8,8,'belt',1,true)===false,'pause still prevents placement');
G.paused=false; assert(Input.tryPlace(8,8,'belt',1,true));
G.won=true; Input.click(8,8);
assert.equal(cellAt(8,8),null,'completed gameplay does not prevent demolition');
`);

const v2 = boot('v2');
v2(`
loadChallenge(0);
const locked=cellAt(5,7);
assert(locked.locked);
locked.item=V2Runtime.item(G.v2.initial.shift(),locked);
const before=V2Runtime.materialIds().slice().sort().join(',');
Input.removeAt(5,7);
assert.equal(cellAt(5,7),null,'loaded preplaced cutter can be demolished');
assert.equal(V2Runtime.materialIds().slice().sort().join(','),before,'removed material is accounted for');
assert.equal(G.v2.discardedItems.length,1);
assert(Undo.undo(),'removal of a loaded machine can be undone');
assert(cellAt(5,7)&&!cellAt(5,7).item,'undo does not resurrect disposed material');
assert.equal(V2Runtime.materialIds().slice().sort().join(','),before);
`);

const v3 = boot('v3');
v3(`
for(const type of MACHINE_TYPES) {
  V3Runtime.load(0);
  assert(Input.tryPlace(8,8,type,1,true));
  const cell=cellAt(8,8), raw=G.v3.stockByNode[0].shift();
  cell.item=V3Runtime.item(raw,cell);
  const before=V3Runtime.materialIds().slice().sort().join(',');
  G.v3.selected={x:8,y:8};
  Input.removeAt(8,8);
  assert.equal(cellAt(8,8),null,type+' with an item can be demolished');
  assert.equal(G.used[type],0,type+' budget is returned');
  assert.equal(V3Runtime.materialIds().slice().sort().join(','),before,'material survives in discard ledger');
  assert.equal(G.v3.discardedItems[0],raw);
  assert.equal(G.v3.selected,null,'inspector does not point to a removed machine');
}
V3Runtime.load(0);
assert(Input.tryPlace(8,8,'cutter',1,true));
G.tool=null;
const previousPos=Input.pos;
Input.pos=()=>({x:8,y:8});
Input._down({button:0}); Input._up();
Input.pos=previousPos;
assert.equal(cellAt(8,8),null,'empty-tool click reaches demolition instead of machine selection');
V3Runtime.load(0);
assert(Input.tryPlace(8,8,'cutter',1,true));
const cutter=cellAt(8,8), raw=G.v3.stockByNode[0].shift();
const halves=PetalV3.cut(raw,'auto');
cutter.outA=V3Runtime.item(halves[0],cutter);
cutter.outB=V3Runtime.item(halves[1],cutter);
const before=V3Runtime.materialIds().slice().sort().join(',');
Input.removeAt(8,8);
assert.equal(cellAt(8,8),null,'both occupied cutter trays can be removed');
assert.equal(G.v3.discardedItems.length,2);
assert.equal(V3Runtime.materialIds().slice().sort().join(','),before);
V3Runtime.load(0);
assert(Input.tryPlace(8,8,'cutter',1,true));
const processing=cellAt(8,8), processingRaw=G.v3.stockByNode[0].shift();
const processingHalves=PetalV3.cut(processingRaw,'auto');
processing.proc={shape:processingHalves[0],shapeB:processingHalves[1],t:1};
const processingIds=V3Runtime.materialIds().slice().sort().join(',');
Input.removeAt(8,8);
assert.equal(cellAt(8,8),null,'a machine can be removed during processing');
assert.equal(G.v3.discardedItems.length,2);
assert.equal(V3Runtime.materialIds().slice().sort().join(','),processingIds);
V3Runtime.load(0);
assert(Input.tryPlace(8,8,'merger',1,true));
const merger=cellAt(8,8), held=G.v3.stockByNode[0].shift();
merger.queueA=[V3Runtime.item(held,merger)];
const queued=V3Runtime.materialIds().slice().sort().join(',');
assert(Undo.undo(),'undo placement removes a machine with queued material');
assert.equal(cellAt(8,8),null);
assert.equal(V3Runtime.materialIds().slice().sort().join(','),queued);
assert(Undo.redoOp(),'redo can restore the empty device');
assert(cellAt(8,8)&&!cellAt(8,8).queueA?.length);
`);

console.log('ALL_DEMOLITION_TESTS_PASS');
