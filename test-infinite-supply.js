// Four-petal resource nodes must keep feeding after their initial buffer is consumed.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const files = ['synthesis-engine.js', 'synthesis-config.js', 'levels.js', 'petal-v3.js', 'challenges.js', 'challenge-v3.js', 'core.js', 'sim.js'];
const context = {console, assert, performance, setTimeout(){}, clearTimeout(){},
  window:{addEventListener(){}}, localStorage:{getItem(){return null;},setItem(){}}};
vm.createContext(context);
vm.runInContext(files.map(file => fs.readFileSync(path.join(__dirname, 'js', file), 'utf8')).join('\n') + `
const Render={cv:null,resize(){},drawPreview(){}};
const UI={refreshLevel(){},refreshBudget(){},refreshToolbar(){},syncPause(){},refreshV3(){},toast(){}};
function advance(ticks) { for(let i=0;i<ticks;i++) V3Runtime.tick(); }
function feedToTrash(index,node) {
  V3Runtime.load(index);
  const resource=G.v3.def.resources[node], right=resource.x<10;
  const x=resource.x+(right?1:-1), y=resource.y, dir=right?1:3;
  const extractor=mkCell('extractor',x,y,dir);
  G.grid[y][x]=extractor;
  G.grid[y][x+(right?1:-1)]=mkCell('trash',x+(right?1:-1),y,dir);
  return extractor;
}
for(const index of [0,1,4,5]) for(let node=0;node<3;node++) {
  const extractor=feedToTrash(index,node);
  const ticks=index===0&&node===0?10000:1000;
  advance(ticks);
  const minimum=ticks===10000?1000:100;
  assert(G.v3.emitted>minimum,G.v3.def.id+' source '+node+' must outlast its old finite stock');
  assert(G.v3.discardedItems.length>minimum,'the open outlet must receive continuing material');
  assert(G.v3.discardedItems.every(shape=>shape.stage==='raw'&&
    shape.shapeKind===G.v3.def.resources[node].type),'each output remains a complete source block');
  assert(!extractor.status.includes('耗尽'),'source must never report depletion');
  const ids=V3Runtime.materialIds();
  assert.equal(new Set(ids).size,ids.length,'every emitted raw block keeps unique unit IDs');
  assert(!G.won,'feeding to trash does not end the challenge');
}
feedToTrash(0,0);
G.grid[4][2]=mkCell('extractor',2,4,2);
G.grid[5][2]=mkCell('trash',2,5,2);
advance(600);
assert(G.v3.emitted>100,'two extractors sharing one source continue feeding');
assert.equal(new Set(V3Runtime.materialIds()).size,V3Runtime.materialIds().length,
  'parallel extractors never reuse raw IDs from their shared source');
const blocked=feedToTrash(0,0);
G.grid[blocked.y][blocked.x+1]=null;
advance(100);
assert.equal(G.v3.emitted,1,'a blocked extractor does not keep creating material');
assert(blocked.item,'blocked output retains the first block');
G.grid[blocked.y][blocked.x+1]=mkCell('trash',blocked.x+1,blocked.y,1);
advance(600);
assert(G.v3.emitted>50,'unblocking resumes supply past the old limit');
V3Runtime.resetMaterial();
assert.equal(G.v3.emitted,0);
assert.equal(G.v3.stockByNode[0][0].itemId,'C1:source0:raw0','reset restarts source IDs');
advance(600);
assert(G.v3.emitted>50,'reset does not restore a finite supply cap');
assert.equal(new Set(V3Runtime.materialIds()).size,V3Runtime.materialIds().length);
`, context);
console.log('ALL_INFINITE_SUPPLY_TESTS_PASS');
