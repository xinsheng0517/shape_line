'use strict';
const assert = require('node:assert/strict');
const P = require('./js/petal-v3.js');
const SLOTS = ['TL','BL','TR','BR'];
function split(kind,id,orientation=0) {
  const original=P.raw(kind,id,orientation), halves=P.cut(original,'vertical');
  return {original,halves,quarters:halves.flatMap(half=>P.cut(half,'horizontal'))};
}
function q(kind,id,slot) { return split(kind,id).quarters.find(part=>part.quadrant===slot); }
function conserve(output,inputs) { assert.deepEqual(output.unitIds.slice().sort(),inputs.flatMap(item=>item.unitIds).sort()); }
// RED: the fixed table rejected same-material complementary quarters.
const same=P.merge(q('T','same-top','TL'),q('T','same-bottom','BL'));
assert.ok(same,'same-material complementary quarters must merge');
assert.equal(same.recipeId,'H_TT');
for(const kind of ['T','C','S']) {
  const {original,halves,quarters}=split(kind,`source-${kind}`);
  assert.equal(original.kind,'petal-v3'); assert.equal(original.ruleset,'petal-v3');
  assert.equal(original.stage,'raw'); assert.deepEqual(halves.map(p=>p.side),['L','R']);
  assert.deepEqual(quarters.map(p=>p.quadrant),SLOTS);
  assert.deepEqual(quarters.map(p=>p.units[0].slot),SLOTS);
  assert.ok(quarters.every(p=>p.units[0].resource===kind));
  conserve(P.mergeMany(quarters),[original]);
  assert.equal(P.cut(halves[0],'vertical'),null); assert.equal(P.cut(quarters[0]),null);
  assert.ok(Object.isFrozen(original)&&Object.isFrozen(original.units)&&Object.isFrozen(original.units[0]));
  assert.throws(()=>{original.units[0].shapeKind='S';},TypeError);
  assert.throws(()=>{original.unitIds.push('forged');},TypeError);
  assert.deepEqual(quarters.map(p=>[p.region.x0,p.region.x1,p.region.y0,p.region.y1]),[
    [0,.5,0,.5],[0,.5,.5,1],[.5,1,0,.5],[.5,1,.5,1]]);
  const horizontal=P.cut(original,'horizontal');
  assert.deepEqual(horizontal.map(p=>p.units.map(u=>u.slot)),[['TL','TR'],['BL','BR']]);
  assert.deepEqual(horizontal.map(p=>p.stage),['horizontal-half','horizontal-half']);
  assert.deepEqual(horizontal.flatMap(p=>P.cut(p,'vertical')).flatMap(p=>p.unitIds).sort(),original.unitIds.slice().sort());
  conserve(P.merge(...halves),[original]);
}
assert.equal(P.GEOMETRY.T.vertical,.5); assert.equal(P.GEOMETRY.T.equalAreaRequired,false);
assert.equal(P.raw('R','bad'),null); assert.equal(P.raw('T',''),null); assert.equal(P.raw('T','id',45),null);
assert.equal(P.cut({},'vertical'),null);
assert.equal(P.describe({units:[null]}),null);
assert.equal(P.describe({...P.raw('T','invalid-description'),orientation:45}),null);
let combinations=0;
for(const tl of ['T','C','S']) for(const bl of ['T','C','S']) for(const tr of ['T','C','S']) for(const br of ['T','C','S']) {
  const inputs=[tl,bl,tr,br].map((kind,i)=>q(kind,`all-${combinations}-${i}`,SLOTS[i]));
  const done=P.merge(P.merge(inputs[0],inputs[1]),P.merge(inputs[2],inputs[3]));
  const expected=`F_${tl}${bl}_${tr}${br}`;
  assert.equal(done.recipeId,expected); assert.equal(done.stage,'finished');
  assert.equal(P.isFinished(done,[expected]),true); assert.equal(P.matches(done,expected),true);
  assert.equal(P.matches(done,P.preview(expected)),true); assert.equal(P.isFinished(done,['bad']),false);
  assert.deepEqual(done.units.map(u=>u.quadrant),SLOTS); assert.equal(done.orientation,0); conserve(done,inputs);
  combinations++;
}
assert.equal(combinations,81);
{
  P.registerMaterial('alloy:blue',{color:'#123456',outline:'circle'});
  P.registerMaterial('__proto__',{color:'#654321',outline:'star'});
  const inputs=[q('alloy:blue','dynamic-1','TL'),q('__proto__','dynamic-2','BL'),q('T','dynamic-3','TR')];
  const three=P.mergeMany(inputs); assert.ok(three); assert.equal(three.stage,'composite'); conserve(three,inputs);
  assert.ok(three.key.includes('alloy:blue')); assert.equal(P.describe(three).key,three.key);
  assert.equal(P.matches(three,three),true);
  P.registerRule({id:'three-petal',inputs:[{material:'alloy:blue'},{material:'__proto__'},{material:'T'}],operation:'join'});
  assert.equal(P.mergeMany(inputs,{ruleId:'three-petal'}).ruleId,'three-petal');
  const four=P.mergeMany([...inputs,q('C','dynamic-4','BR')]); assert.equal(four.stage,'finished');
  assert.equal(P.matches(four,P.describe(four)),true);
  assert.equal(P.derive(three,{sources:inputs,maxStates:100,maxDepth:3}).status,'found');
}
{
  const inputs=[P.raw('T','stack-1'),P.raw('C','stack-2'),P.raw('S','stack-3')];
  const stack=P.mergeMany(inputs); assert.equal(stack.layers.length,3); assert.equal(stack.units.length,12);
  assert.equal(stack.stage,'composite'); conserve(stack,inputs);
  const halves=P.cut(stack,'vertical'); assert.deepEqual(halves.map(p=>p.units.length),[6,6]);
  assert.equal(halves[0].layers.length,3); conserve(P.merge(...halves),[stack]);
  const quarters=halves.flatMap(p=>P.cut(p,'horizontal'));
  assert.deepEqual(quarters.map(p=>p.units.length),[3,3,3,3]); conserve(P.mergeMany(quarters),[stack]);
  assert.equal(P.cut(quarters[0]),null);
  const more=P.merge(stack,P.raw('T','stack-4')); assert.equal(more.layers.length,4);
  assert.equal(P.merge(more,P.raw('C','stack-5')).layers.length,5);
  assert.equal(P.merge(P.raw('T','join-only-1'),P.raw('C','join-only-2'),{mode:'half'}),null);
}
{
  const top=q('T','rotate-top','TL'),right=P.rotate(q('C','rotate-right','TL'));
  const joined=P.merge(top,right); assert.equal(joined.orientation,0);
  assert.deepEqual(joined.units.map(u=>u.slot),['TL','TR']); assert.equal(joined.layers.length,1);
  const bottom=P.rotate(q('S','rotate-bottom','TR'));
  const done=P.mergeMany([joined,bottom,q('T','rotate-left','BL')]); assert.equal(done.recipeId,'F_TT_CS');
  assert.equal(P.matches(P.rotate(done),'F_TT_CS'),false);
  assert.equal(P.rotate(P.rotate(P.rotate(P.rotate(done)))).orientation,0);
  assert.deepEqual(P.cut(P.rotate(done),'vertical').map(p=>p.units.map(u=>u.slot)),[['TL','BL'],['TR','BR']]);
  assert.equal(P.rotate(P.raw('T','turn',270)).orientation,0);
  const stack=P.merge(P.raw('T','rotated-stack-1'),P.raw('C','rotated-stack-2'));
  const rotated=P.rotate(stack),halves=P.cut(rotated,'horizontal');
  assert.equal(P.matches(P.merge(...halves),rotated),true);
  conserve(P.merge(...halves),[rotated]);
}
{
  const a=split('T','same-source'); assert.equal(P.merge(a.quarters[0],a.quarters[0]),null);
  assert.ok(P.merge(a.quarters[0],a.quarters[2])); assert.ok(P.merge(a.halves[0],q('C','overlap-valid','BL')));
  assert.equal(P.merge({},a.quarters[1]),null); assert.equal(P.merge({orientation:0,units:[null]},a.quarters[1]),null);
  assert.equal(P.merge({...a.quarters[0]},q('C','other','BL')),null);
  assert.equal(P.validItem({...a.original}),false); assert.equal(P.validItem(a.original),true);
  assert.equal(P.merge(q('T','source-conflict','TL'),q('C','source-conflict','BL')),null);
  assert.equal(P.mergeMany([a.original]),null); assert.equal(P.mergeMany([a.original,null]),null); assert.equal(P.mergeMany('bad'),null);
  assert.equal(P.merge(a.original,P.preview('H_TC')),null); assert.equal(P.cut(P.preview('H_TC'),'horizontal'),null);
  assert.equal(P.rotate(P.preview('H_TC')),null); assert.equal(P.validItem(P.preview('H_TT')),false);
  assert.equal(P.preview('bad'),null); assert.equal(P.isFinished(P.preview('F_TC_TC'),['F_TC_TC']),false);
  assert.equal(P.isFinished({...same,stage:'finished'},['F_TC_TC']),false); assert.equal(P.rotate({...same}),null);
}
{
  P.engine.registerOperator('identity-facade',items=>items[0].units);
  P.registerRule({id:'unary-petal',inputs:[{material:'T',slot:'TL'}],operation:'identity-facade'});
  const input=q('T','unary-source','TL');
  const selected=P.engine.select([input],{ruleId:'unary-petal'});
  assert.equal(selected.ok,true);
  const output=P.mergeMany(selected.indices.map(index=>[input][index]),{ruleId:selected.result.ruleId});
  assert.ok(output,'registered unary operator must be available through the physical facade');
  assert.equal(output.ruleId,'unary-petal'); conserve(output,[input]);
  assert.equal(output.key,selected.result.key);
  assert.equal(P.validItem(output),true);
  assert.equal(P.mergeMany([P.raw('C','unary-no-rule')]),null);
  assert.equal(P.mergeMany([input],{ruleId:'unknown-unary-rule'}),null);
  assert.equal(P.mergeMany([P.preview('H_TC')],{ruleId:'unary-petal'}),null);
  assert.equal(P.mergeMany([{...input}],{ruleId:'unary-petal'}),null);
}
console.log('ALL_PETAL_V3_PASS (81 combinations, dynamic materials/rules/operators, identity, layers, recutting, rotations)');
