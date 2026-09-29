// Grid and machine-port regression tests for the standalone four-petal runtime.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const files = ['levels.js', 'petal-v3.js', 'challenges.js', 'challenge-v3.js', 'core.js', 'sim.js'];
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
const wrong=belt(4,5,1,PetalV3.raw('T','wrong-stage'));
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

// One first-stage cutter feeds two second-stage cutters through real belts.
// All transport uses permanent grid cells; no item is injected after start.
function reference(index) {
  V3Runtime.load(index);
  const def=G.chalDef;
  const required=new Set(G.target.units.map(unit=>unit.shapeKind));
  const bx=8;
  const firstCut=machine('cutter',bx,5,1,'auto');
  const upperCut=machine('cutter',bx+3,5,1,'auto');
  const lowerCut=machine('cutter',bx+1,8,1,'auto');
  const autoMerger=machine('merger',bx+9,12,1,'auto');
  for(let x=4;x<bx;x++) belt(x,5,1);
  belt(bx+1,5,1); belt(bx+2,5,1);
  belt(bx,6,2); belt(bx,7,2); belt(bx,8,1);
  for(const [x,start] of [[bx+4,5],[bx+3,6],[bx+2,8],[bx+1,9]]) {
    for(let y=start;y<12;y++) belt(x,y,2);
    belt(x,12,1);
  }
  for(let x=bx+5;x<bx+9;x++) belt(x,12,1);
  for(const resource of def.resources) {
    if(!required.has(resource.type)) continue;
    if(resource.x===2) {
      machine('extractor',3,resource.y,1);
      if(resource.y<5) {
        for(let y=resource.y;y<5;y++) if(!G.grid[y][4]) belt(4,y,2);
      } else {
        for(let y=6;y<=resource.y;y++) if(!G.grid[y][4]) belt(4,y,0);
      }
    } else {
      machine('extractor',19,resource.y,3);
      for(let x=18;x>bx;x--) belt(x,2,3);
      belt(bx,2,2); belt(bx,3,2); belt(bx,4,2);
    }
  }
  const hx=def.hub.x-1, hy=def.hub.y;
  for(let x=bx+10;x<=hx;x++)
    belt(x,12,x===hx?(hy<12?0:hy>12?2:1):1);
  if(hy<12) for(let y=11;y>=hy;y--) belt(hx,y,y===hy?1:0);
  if(hy>12) for(let y=13;y<=hy;y++) belt(hx,y,y===hy?1:2);
  G.v3.running=true;
  assertSupplyConserved(def.id+' initial');
  for(let i=0;i<4000 && !G.won;i++) {
    V3Runtime.tick();
    if(i%10===0) assertSupplyConserved(def.id);
  }
  if(G.delivered!==def.need) console.log('REFERENCE_DIAG',def.id,G.delivered,G.v3.emitted,
    firstCut.status,firstCut.queueA?.length,firstCut.queueB?.length,
    upperCut.status,lowerCut.status,
    autoMerger.status,autoMerger.queueA?.length,autoMerger.queueB?.length,
    autoMerger.autoHalves?.map(h=>h.recipeId),
    autoMerger.queueA?.map(q=>q.shape.quadrant+q.shape.shapeKind),
    autoMerger.queueB?.map(q=>q.shape.quadrant+q.shape.shapeKind),
    G.v3.discardedItems.length,
    def.resources.map((r,i)=>[r.type,G.v3.stockByNode[i].length]));
  assert.equal(G.delivered,def.need,
    def.id+' external two-stage cutter layout must finish');
  assert(firstCut && upperCut && lowerCut && autoMerger);
  assert(G.v3.discardedItems.length>0);
  assert(G.v3.discardReasons.every(row=>row.reason==='非目标瓣'));
  if(Number.isFinite(def.budget.extractor))
    assert(G.grid.flat().filter(c=>c?.type==='extractor').length<=def.budget.extractor);
  if(Number.isFinite(def.budget.belt))
    assert(G.grid.flat().filter(c=>c?.type==='belt').length<=def.budget.belt);
  assertSupplyConserved(def.id+' completed');
  const belts=G.grid.flat().filter(c=>c?.type==='belt').length;
  const extractors=G.grid.flat().filter(c=>c?.type==='extractor').length;
  assert.equal(G.used.belt,belts);
  assert.equal(G.used.extractor,extractors);
  if(index===0||index===4) assert.equal(def.stars(G),3,'low-difficulty route meets three-star belt threshold');
  console.log(def.id+' external two-stage reference PASS at tick '+G.tickCount+
    ', belts '+belts+', extractors '+extractors);
}
for(const index of [0,1,4,5]) reference(index);
console.log('ALL_V3_RUNTIME_TESTS_PASS');
`, context);
