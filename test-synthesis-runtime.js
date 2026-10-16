'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const files = ['levels.js','blueprint.js','synthesis-engine.js','synthesis-config.js','petal-v3.js',
  'challenges.js','challenge-v3.js','core.js','sim.js'];
const context = { console, performance, assert, setTimeout(){},clearTimeout(){},
  window:{addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}} };
vm.createContext(context);
vm.runInContext(files.map(file=>fs.readFileSync(path.join(__dirname,'js',file),'utf8')).join('\n') + `
const Render={cv:null,resize(){},drawPreview(){}};
const UI={refreshLevel(){},refreshBudget(){},refreshToolbar(){},syncPause(){},refreshLevels(){},
 showChalWin(){},refreshV3(){},toast(){}};
function machine(type,x,y,dir=1,mode='auto') {
 const c=mkCell(type,x,y,dir); c.machineMode=mode; G.grid[y][x]=c; return c;
}
function put(c,port,shape) { (c[port] ||= []).push(V3Runtime.item(shape,c)); }
function advance(n) { for(let i=0;i<n;i++) V3Runtime.tick(); }
function q(kind,id,slot) {
 return PetalV3.cut(PetalV3.raw(kind,id),'vertical').flatMap(h=>PetalV3.cut(h,'horizontal'))
  .find(s=>s.quadrant===slot);
}
function ids() { return V3Runtime.materialIds().slice().sort(); }
function conserved(before,label) { assert.deepEqual(ids(),before,label); }
V3Runtime.load(0);
let c=machine('merger',10,10);
const halves=PetalV3.cut(PetalV3.raw('T','original'),'vertical');
put(c,'queueA',halves[0]); put(c,'queueB',halves[1]);
let before=ids(); advance(12);
assert(c.outA,'two original halves must recombine through the real merger');
assert.equal(c.outA.shape.units.length,4);
conserved(before,'original halves preserve identity');

V3Runtime.load(0); c=machine('merger',10,10);
put(c,'queueA',q('T','same1','TL')); put(c,'queueB',q('T','same2','BL'));
before=ids(); advance(12);
assert(c.outA,'same-material quarters must synthesize');
assert.equal(c.outA.shape.units.length,2); conserved(before,'same-material units retained');

V3Runtime.load(0); c=machine('merger',10,10);
put(c,'queueA',q('T','overlap1','TL')); put(c,'queueB',q('C','overlap2','TL'));
before=ids(); advance(12);
assert.equal(c.outA.shape.layers.length,2,'overlapping occupied slots stack');
conserved(before,'stacking preserves both layers');

V3Runtime.load(0); c=machine('merger',10,10);
const left=PetalV3.merge(q('T','internalT','TL'),q('C','internalC','BL'));
const right=PetalV3.merge(q('T','externalT','TR'),q('C','externalC','BR'));
c.autoHalves=[left];
const feeder=machine('belt',10,11,0); feeder.item=V3Runtime.item(right,feeder);
before=ids(); advance(12);
assert.equal(c.outA.shape.recipeId,'F_TC_TC','internal and externally arriving half must meet');
assert.equal(feeder.item,null); assert.equal(c.autoHalves.length,0);
conserved(before,'cross-pool units retained once');

V3Runtime.load(0); c=machine('merger',10,10);
PetalV3.registerRule({id:'three-T-inputs',inputs:[{material:'T',count:3}],operation:'join',priority:100});
c.ruleId='three-T-inputs';
put(c,'queueA',q('T','n1','TL')); put(c,'queueA',q('T','n2','BL'));
advance(12); assert.equal(c.outA,null,'partial n-ary recipe waits without consuming');
assert.equal(c.queueA.length,2);
put(c,'queueB',q('T','n3','TR')); before=ids(); advance(12);
assert.equal(c.outA.shape.units.length,3,'registered three-input rule runs in actual machine');
conserved(before,'n-ary units retained');
PetalV3.engine.unregisterRule('three-T-inputs');

V3Runtime.load(0); c=machine('merger',10,10);
PetalV3.registerRule({id:'forty-T-inputs',inputs:[{material:'T',count:40}],operation:'auto'});
c.ruleId='forty-T-inputs';
for(let i=0;i<39;i++) put(c,i%2?'queueB':'queueA',q('T','many-'+i,'TL'));
before=ids();advance(12);
assert.equal(c.proc,null,'a bound large recipe waits for its final input');
conserved(before,'waiting large recipe retains all inputs');
put(c,'queueB',q('T','many-39','TL'));before=ids();advance(12);
assert(c.outA,'ordinary forty-input rule runs with the default runtime budget');
assert.equal(c.outA.shape.units.length,40);
assert.equal(c.outA.shape.layers.length,40,'all overlapping layers survive actual machine synthesis');
assert.equal(c.queueA.length+c.queueB.length,0);
conserved(before,'large recipe consumes each physical unit exactly once');
PetalV3.engine.unregisterRule('forty-T-inputs');

V3Runtime.load(0); c=machine('merger',10,10);
PetalV3.registerMaterial('alloy',{name:'合金',color:'#91a4b6',outline:'diamond'});
PetalV3.registerRule({id:'transform-to-alloy',inputs:[{material:'T'}],operation:'transform',output:{material:'alloy'}});
c.ruleId='transform-to-alloy';
const ore=PetalV3.raw('T','unary-ore');put(c,'queueA',ore);before=ids();advance(12);
assert(c.outA,'a registered unary transformation runs through a real machine');
assert(c.outA.shape.units.every(unit=>unit.shapeKind==='alloy'&&unit.originKind==='T'));
conserved(before,'material transformation preserves physical origin');
PetalV3.engine.unregisterRule('transform-to-alloy');

V3Runtime.load(0); c=machine('merger',10,10);
const nonTarget=q('S','free-material','TL');
assert.equal(V3Runtime.accepts(c,9,10,V3Runtime.item(nonTarget,c)),'queueA',
 'non-target valid material must not be discarded');
assert.equal(V3Runtime.accepts(c,9,10,V3Runtime.item({...nonTarget},c)),null,'forged identity rejected');
const a=q('T','reject-copy','TL'); put(c,'queueA',a); put(c,'queueB',a);
before=ids(); advance(12); assert.equal(c.outA,null,'same physical unit cannot be consumed twice');
conserved(before,'failed pair never consumes');

V3Runtime.load(0); c=machine('merger',10,10);
put(c,'queueA',q('T','pauseT','TL')); put(c,'queueB',q('C','pauseC','BL'));
before=ids(); G.paused=true; advance(12);
assert.equal(c.proc,null); assert.equal(c.queueA.length,1); conserved(before,'pause retains inputs');
G.paused=false; advance(12); assert(c.outA);
const output=c.outA; put(c,'queueA',q('T','backpressureT','TR'));
put(c,'queueB',q('C','backpressureC','BR')); before=ids(); advance(12);
assert.equal(c.outA,output,'blocked outlet cannot be overwritten');
assert.equal(c.queueA.length,1); conserved(before,'backpressure retains all inputs');
V3Runtime.resetMaterial(); assert.equal(c.outA,null); assert.equal(c.queueA.length,0);
assert.equal(c.autoHalves.length,0);
console.log('ALL_SYNTHESIS_RUNTIME_PASS');
`,context,{filename:'test-synthesis-runtime.vm.js'});
