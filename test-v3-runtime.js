// Grid and machine-port regression tests for the standalone four-petal runtime.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const files = ['synthesis-engine.js', 'synthesis-config.js', 'levels.js', 'petal-v3.js', 'challenges.js', 'challenge-v3.js', 'core.js', 'sim.js'];
const context = {
  console, performance, assert, setTimeout: () => 0, clearTimeout() {},
  window: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
};
vm.createContext(context);
vm.runInContext(files.map(file => fs.readFileSync(path.join(__dirname, 'js', file), 'utf8')).join('\n') + `
const Render = {cv:null,resize(){},drawPreview(){}};
const UI = {refreshLevel(){},refreshBudget(){},refreshToolbar(){},syncPause(){},refreshLevels(){},showChalWin(){},refreshV3(){},toast(){}};
function belt(x,y,dir,shape) {
  assert(!G.grid[y][x], 'reference cannot overwrite a grid cell at '+x+','+y);
  assert(G.budget.belt > 0, 'belt budget exhausted');
  const c=mkCell('belt',x,y,dir); G.grid[y][x]=c;
  if (G.budget.belt !== Infinity) G.budget.belt--;
  G.used.belt++;
  if(shape) c.item=V3Runtime.item(shape,c);
  return c;
}
function machine(type,x,y,dir,mode) {
  assert(!G.grid[y][x], 'reference cannot overwrite a grid cell');
  assert(G.budget[type] > 0, type+' budget exhausted');
  const c=mkCell(type,x,y,dir); c.machineMode=mode||'auto'; G.grid[y][x]=c;
  if (G.budget[type] !== Infinity) G.budget[type]--;
  G.used[type]++;
  return c;
}
function advance(n) { for(let i=0;i<n;i++) V3Runtime.tick(); }
function assertSupplyConserved(label) {
  const ids=V3Runtime.materialIds();
  const created=G.v3.nextRawByNode.reduce((sum,count)=>sum+count,0);
  assert.equal(ids.length,created*4,label+' must account for every generated unit');
  assert.equal(new Set(ids).size,ids.length,label+' must not duplicate any unit');
}

for(const [index,recipe,need] of [[0,'F_TC_TC',3],[1,'F_TC_TS',6],[4,'F_CS_CS',4],[5,'F_TC_SC',8]]) {
  const def=CHALLENGES[index];
  assert.equal(def.ruleset,'petal-v3'); assert.equal(def.need,need);
  assert.equal(def.recipeId,recipe);
  assert.deepEqual(def.resources.map(r=>r.type).sort(),['C','S','T']);
  assert(!def.guide && !def.hint && !def.preplaced,'challenge exposes no solution hint');
  V3Runtime.load(index);
  assert.equal(G.v3.running,true,'new V3 level starts feeding automatically');
  assert.equal(G.grid.flat().filter(c=>c&&MACHINE_TYPES.includes(c.type)).length,0);
  assert.equal(G.v3.stockByNode.length,3);
  assert.equal(G.v3.stockByNode.flat().length, index===0||index===4?3:6,
    'low/high challenge starts with the requested 3/6 extractable blocks');
  assert.deepEqual(G.v3.stockByNode.map(items=>items.length),def.initial);
  assert.deepEqual(G.v3.nextRawByNode,def.initial);
  assert.equal(new Set(V3Runtime.materialIds()).size,V3Runtime.materialIds().length);
  const before=V3Runtime.materialIds().slice().sort();
  G.paused=true; advance(10);
  assert.equal(G.tickCount,0,'pause does not spend material');
  G.paused=false;
  assert.deepEqual(V3Runtime.materialIds().slice().sort(),before);
}
assert(CHALLENGES[0].budget.belt===Infinity && CHALLENGES[1].budget.extractor===Infinity);
for(const index of [4,5]) {
  assert.equal(CHALLENGES[index].budget.extractor,3);
  assert.equal(CHALLENGES[index].budget.belt,80);
  assert.equal(CHALLENGES[index].budget.cutter,Infinity);
  assert.equal(CHALLENGES[index].budget.merger,Infinity);
}

// Actual belt-to-cutter port movement, one processing slot, two independent exits.
for (const kind of ['T','C','S']) for (const dir of [0,1,2,3]) {
  V3Runtime.load(0);
  const cut=machine('cutter',10,10,dir,'auto');
  const d=[[0,-1],[1,0],[0,1],[-1,0]][dir];
  const raw=PetalV3.raw(kind,'unconnected-'+kind+'-'+dir);
  belt(10-d[0],10-d[1],dir,raw);
  advance(100);
  assert(cut.outA && cut.outB, 'both half products must reach separate exit trays');
  assert.equal(cut.outA.shape.stage,'vertical-half');
  assert.equal(cut.outB.shape.stage,'vertical-half');
  assert.equal(cut.proc,null,'an unconnected outlet must not trigger a second cut');
  assert.equal(cut.autoQueue?.length||0,0,'no half may remain in an internal cutting queue');
  assert.deepEqual([...(cut.outA.shape.unitIds),...(cut.outB.shape.unitIds)].sort(),raw.unitIds.slice().sort());
  assert(cut.status.includes('前出口未连接') && cut.status.includes('侧出口未连接'));
}

V3Runtime.load(0);
const staged=machine('cutter',10,10,1,'auto');
const stagedRaw=PetalV3.raw('T','staged');
belt(9,10,1,stagedRaw);
advance(8);
const frontHalf=staged.outA.shape, sideHalf=staged.outB.shape;
belt(11,10,1);
advance(2);
assert.equal(staged.outA,null,'connected front outlet releases its half');
assert.equal(G.grid[10][11].item.shape,frontHalf);
assert.equal(staged.outB.shape,sideHalf,'unconnected side outlet retains its own half');
assert(V3Runtime.occupied(staged),'a cutter with one retained output remains occupied for mode changes');
advance(10);
assert.equal(staged.proc,null,'one blocked side still prevents new processing');
belt(10,11,2);
advance(2);
assert.equal(staged.outB,null,'side outlet resumes after a belt is connected');
assert.equal(G.grid[11][10].item.shape,sideHalf);

V3Runtime.load(0);
const removedExit=machine('cutter',10,10,1,'auto');
belt(9,10,1,PetalV3.raw('S','removed-exit'));
belt(11,10,1); belt(10,11,2);
advance(2);
assert(removedExit.proc,'cutting has started with two connected outlets');
G.grid[10][11]=null; G.grid[11][10]=null;
advance(10);
assert.equal(removedExit.outA.shape.stage,'vertical-half');
assert.equal(removedExit.outB.shape.stage,'vertical-half');
G.paused=true;
const pauseIds=[removedExit.outA.shape.itemId,removedExit.outB.shape.itemId];
advance(20);
assert.deepEqual([removedExit.outA.shape.itemId,removedExit.outB.shape.itemId],pauseIds);
G.paused=false;

V3Runtime.load(0);
const recirculating=machine('cutter',10,10,1,'auto');
belt(9,10,1,PetalV3.raw('T','external-loop'));
belt(11,10,0); belt(11,9,3); belt(10,9,2);
belt(10,11,3); belt(9,11,0);
let halfReturned=false, secondCutStarted=false;
for(let i=0;i<100 && !secondCutStarted;i++) {
  V3Runtime.tick();
  halfReturned ||= [...(recirculating.queueA||[]),...(recirculating.queueB||[])]
    .some(it=>it.shape.stage==='vertical-half');
  secondCutStarted=!!(recirculating.proc && recirculating.proc.shape.stage==='quarter');
}
assert(halfReturned && secondCutStarted,'one cutter performs the second cut only after a half returns from external belts');

V3Runtime.load(0);
const secondCut=machine('cutter',10,10,1,'auto');
const halfInput=PetalV3.cut(PetalV3.raw('C','external-half'),'vertical')[0];
belt(9,10,1,halfInput);
advance(8);
assert.equal(secondCut.outA.shape.stage,'quarter');
assert.equal(secondCut.outB.shape.stage,'quarter');
assert.deepEqual([...(secondCut.outA.shape.unitIds),...(secondCut.outB.shape.unitIds)].sort(),halfInput.unitIds.slice().sort());
V3Runtime.load(0);
const rejectingQuarter=machine('cutter',10,10,1,'auto');
const quarterInput=PetalV3.cut(PetalV3.cut(PetalV3.raw('S','quarter-reject'),'vertical')[0],'horizontal')[0];
const quarterBelt=belt(9,10,1,quarterInput);
advance(8);
assert.equal(quarterBelt.item.shape,quarterInput,'quarter is rejected at the source belt');
assert.equal(rejectingQuarter.proc,null);

V3Runtime.load(0); G.v3.running=true;
const cutter=machine('cutter',5,5,1,'vertical');
const raw=PetalV3.raw('T','port-raw');
const input=belt(4,5,1,raw), front=belt(6,5,1), side=belt(5,6,2);
advance(2); assert.equal(cutter.queueA.length,0); assert(cutter.proc);
advance(2); assert(cutter.outA && cutter.outB);
assert.equal(cutter.outA.shape.stage,'vertical-half');
assert.equal(cutter.outB.shape.stage,'vertical-half');
advance(2); assert(front.item && side.item,'both cutter exits flow through real belts');

// Invalid stages must remain on the incoming belt, never clog the cutter queue.
V3Runtime.load(0); G.v3.running=true;
const rejecting=machine('cutter',5,5,1,'horizontal');
const wrong=belt(4,5,1,PetalV3.cut(PetalV3.cut(PetalV3.raw('T','wrong-stage'),'vertical')[0],'horizontal')[0]);
advance(2); assert(wrong.item && !rejecting.queueA?.length);

// Blocking one outlet retains both results and prevents a second processing job.
V3Runtime.load(0); G.v3.running=true;
const blocked=machine('cutter',5,5,1,'vertical');
belt(4,5,1,PetalV3.raw('C','blocked-1'));
belt(6,5,3,PetalV3.raw('S','occupy-front'));
belt(5,6,2);
advance(6); assert(blocked.outA && !blocked.outB);
const stuck=blocked.outA.shape.itemId;
advance(10); assert.equal(blocked.outA.shape.itemId,stuck,'blocked product is retained');

// Horizontal cut of a vertical half through the same cutter type.
V3Runtime.load(0); G.v3.running=true;
const hcut=machine('cutter',5,5,1,'horizontal');
belt(4,5,1,PetalV3.cut(PetalV3.raw('T','horizontal'), 'vertical')[0]);
belt(6,5,1); belt(5,6,2);
advance(6); assert.equal(G.grid[5][6].item.shape.stage,'quarter');
assert.equal(G.grid[6][5].item.shape.stage,'quarter');

// Both merger stages use the same machine type and physical back/side ports.
V3Runtime.load(0); G.v3.running=true;
const merge1=machine('merger',8,5,1,'half');
const tq=PetalV3.cut(PetalV3.cut(PetalV3.raw('T','merge-T'))[0])[0];
const cq=PetalV3.cut(PetalV3.cut(PetalV3.raw('C','merge-C'))[0])[1];
belt(7,5,1,tq); belt(8,6,0,cq); belt(9,5,1);
advance(2); assert(merge1.proc);
advance(2); assert(merge1.outA && merge1.outA.shape.recipeId==='H_TC');

V3Runtime.load(0); G.v3.running=true;
const merge2=machine('merger',8,5,1,'final');
function half(kindTop,kindBottom,side,tag) {
  const sideIndex=side==='L'?0:1;
  const a=PetalV3.cut(PetalV3.cut(PetalV3.raw(kindTop,tag+'t'))[sideIndex])[0];
  const b=PetalV3.cut(PetalV3.cut(PetalV3.raw(kindBottom,tag+'b'))[sideIndex])[1];
  return PetalV3.merge(a,b);
}
belt(7,5,1,half('T','C','L','L')); belt(8,6,0,half('T','C','R','R')); belt(9,5,1);
advance(5); assert(merge2.outA && merge2.outA.shape.recipeId==='F_TC_TC');
assert(PetalV3.isFinished(merge2.outA.shape,['F_TC_TC']));

// Valid finished product enters the hub through real belt movement.
V3Runtime.load(0); G.v3.running=true;
const hub=G.grid[G.chalDef.hub.y][G.chalDef.hub.x];
const finished=PetalV3.merge(half('T','C','L','hubL'),half('T','C','R','hubR'));
const incoming=belt(hub.x-1,hub.y,1,finished);
advance(2); assert.equal(G.delivered,1);
assert.equal(incoming.item,null);

// Reset reconstructs the deterministic initial buffer without disturbing player machines.
V3Runtime.load(5); G.v3.running=true;
const extract=machine('extractor',3,2,1);
advance(12);
const initialIds=V3Runtime.materialIds().slice().sort();
assert(G.v3.emitted>0);
V3Runtime.resetMaterial();
assert.equal(G.v3.running,true,'reset resumes automatic supply');
assert.equal(G.tickCount,0);
assert.deepEqual(V3Runtime.materialIds().slice().sort(),initialIds);
assert.equal(G.grid[2][3],extract);

// A blocked output does not consume more supply or lose existing structural units.
V3Runtime.load(0); G.v3.running=true;
machine('extractor',3,3,1);
const allUnits=V3Runtime.materialIds().slice().sort();
for(let i=0;i<80;i++) {
  V3Runtime.tick();
  assert.deepEqual(V3Runtime.materialIds().slice().sort(),allUnits);
}
assert(G.v3.emitted>0);

'use strict';
// Real-grid reference factories. No items are injected and resource coordinates
// remain the public challenge coordinates. Unused halves go to player trash.
function buildSynthesisReference(index) {
  V3Runtime.load(index);
  const def=G.chalDef;
  function place(type,x,y,dir=1,mode='auto') {
    if(!G.grid[y] || G.grid[y][x]) throw Error('reference cell occupied '+x+','+y);
    if(!(G.budget[type]>0)) throw Error('reference budget exhausted '+type);
    const c=mkCell(type,x,y,dir); c.machineMode=mode; G.grid[y][x]=c;
    G.used[type]++; if(G.budget[type]!==Infinity)G.budget[type]--;
    return c;
  }
  function route(points,endDir) {
    const cells=[];
    for(let i=0;i<points.length-1;i++) {
      let [x,y]=points[i]; const [tx,ty]=points[i+1];
      if(x!==tx&&y!==ty)throw Error('reference diagonal route');
      const dx=Math.sign(tx-x),dy=Math.sign(ty-y);
      const dir=dx===1?1:dx===-1?3:dy===1?2:0;
      while(x!==tx||y!==ty){cells.push([x,y,dir]);x+=dx;y+=dy;}
    }
    cells.push([...points[points.length-1],endDir]);
    for(const [x,y,dir] of cells)place('belt',x,y,dir);
  }
  function leftHorizontal(y) {
    place('extractor',3,y,1); place('belt',4,y,1);
    return place('cutter',5,y,1,'horizontal');
  }
  place('merger',12,10,2,'join');
  if(index===0) {
    leftHorizontal(3); place('trash',5,4);
    route([[6,3],[12,3],[12,9]],2);
    leftHorizontal(8); place('trash',6,8);
    route([[5,9],[11,9],[11,10]],1);
  } else if(index===4) {
    leftHorizontal(8); place('trash',5,9);
    route([[6,8],[12,8],[12,9]],2);
    leftHorizontal(13); place('trash',6,13);
    route([[5,14],[11,14],[11,10]],1);
  } else if(index===1) {
    leftHorizontal(3); place('trash',5,4);
    route([[6,3],[12,3],[12,9]],2);
    leftHorizontal(12); place('trash',6,12);
    route([[5,13],[6,13]],1); place('cutter',7,13,1,'vertical');
    place('trash',7,14);
    route([[8,13],[8,11],[9,11],[9,10],[11,10]],1);
    place('extractor',19,2,3); place('belt',18,2,3);
    place('cutter',17,2,3,'horizontal'); place('trash',16,2);
    route([[17,1],[16,1]],3); place('cutter',15,1,3,'vertical');
    place('trash',14,1);
    route([[15,0],[22,0],[22,14],[17,14]],0);
  } else if(index===5) {
    leftHorizontal(2); place('trash',5,3);
    route([[6,2],[7,2]],1); place('cutter',8,2,1,'vertical');
    place('trash',8,3); route([[9,2],[12,2],[12,9]],2);
    leftHorizontal(13); place('trash',6,13);
    route([[5,14],[11,14],[11,10]],1);
    place('extractor',19,2,3); place('belt',18,2,3);
    place('cutter',17,2,3,'horizontal'); place('trash',17,1);
    route([[16,2],[15,2]],3); place('cutter',14,2,3,'vertical');
    place('trash',13,2);
    route([[14,1],[14,0],[22,0],[22,14],[17,14]],0);
  } else throw Error('unsupported reference challenge');
  if(index===0 || index===4) {
    route([[12,11],[12,12],[20,12],[20,8]],1);
  } else {
    route([[12,11],[12,12],[16,12],[16,13]],1);
    place('merger',17,13,1,'join');
    route([[18,13],[19,13]],1);
  }
  return def;
}


function reference(index) {
 const def=buildSynthesisReference(index);
 assertSupplyConserved(def.id+' initial');
 for(let i=0;i<4000&&!G.won;i++){V3Runtime.tick();if(i%10===0)assertSupplyConserved(def.id);}
 assert.equal(G.delivered,def.need,def.id+' free synthesis factory must finish');
 assert(G.v3.discardedItems.length>0,'unused material has a player-built trash route');
 assert(G.v3.discardReasons.every(row=>row.reason==='玩家垃圾桶'),'no automatic target-based discard');
 assertSupplyConserved(def.id+' complete');
 if(Number.isFinite(def.budget.belt))assert(G.used.belt<=def.budget.belt);
 if(Number.isFinite(def.budget.extractor))assert(G.used.extractor<=def.budget.extractor);
 if(index===0||index===4)assert.equal(def.stars(G),3);
 console.log(def.id+' free synthesis reference PASS at tick '+G.tickCount+', belts '+G.used.belt+', extractors '+G.used.extractor);
}
for(const index of [0,1,4,5]) reference(index);
console.log('ALL_V3_RUNTIME_TESTS_PASS');
`, context);
