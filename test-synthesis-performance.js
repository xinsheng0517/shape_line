'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const Engine=require('./js/synthesis-engine.js');
const Config=require('./js/synthesis-config.js');
function item(material,id,slot='TL'){return {units:[{id,sourceId:id,shapeKind:material,quadrant:slot}]};}
function measure(fn,runs=31){const times=[];for(let i=0;i<runs;i++){const start=performance.now();fn();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return {medianMs:+times[Math.floor(runs/2)].toFixed(4),p95Ms:+times[Math.floor(runs*.95)].toFixed(4)};}
const rows=[];
for(const count of [10,1000,10000,100000]){
 const engine=Engine.create(Config);engine.registerMaterial('unused-a',{});engine.registerMaterial('unused-b',{});
 const start=performance.now();
 for(let i=0;i<count;i++)engine.registerRule({id:`unrelated-${i}`,inputs:[{material:'unused-a'},{material:'unused-b'}],operation:'join'});
 engine.registerRule({id:'hit',inputs:[{material:'T'},{material:'C'}],operation:'join'});
 const registrationMs=+(performance.now()-start).toFixed(2);
 const hit=[item('T','t'),item('C','c','BL')],miss=[item('S','s'),item('S','s2','BL')];
 let before=engine.stats().candidateChecks;assert.equal(engine.select(hit).ok,true);const hitChecks=engine.stats().candidateChecks-before;
 before=engine.stats().candidateChecks;assert.equal(engine.select(miss).ok,true);const missChecks=engine.stats().candidateChecks-before;
 assert.equal(hitChecks,2,'one selection check plus one exact combine check, independent of R');assert.equal(missChecks,0);
 rows.push({rules:count,registrationMs,hitChecks,missChecks,hit:measure(()=>engine.select(hit)),miss:measure(()=>engine.select(miss))});
}
const queue=[];
const shared=[];
for(const count of [10,1000,10000,100000]){
 const engine=Engine.create(Config);
 for(let i=0;i<count;i++){engine.registerMaterial(`noise-${i}`,{});engine.registerRule({id:`shared-${i}`,inputs:[{material:'T'},{material:`noise-${i}`}],operation:'join'});}
 const pool=[item('T','shared-t'),item('C','shared-c','BL')];
 let before=engine.stats().candidateChecks;const automatic=engine.select(pool);const genericChecks=engine.stats().candidateChecks-before;
 assert.equal(automatic.ok,true);assert.equal(genericChecks,0,`incomplete noise recipes must not block generic synthesis or trigger candidate checks`);
 engine.registerRule({id:'actual',inputs:[{material:'T'},{material:'C'}],operation:'join'});
 before=engine.stats().candidateChecks;assert.equal(engine.select(pool).ok,true);const hitChecks=engine.stats().candidateChecks-before;assert.ok(hitChecks<=3);
 shared.push({rules:count,genericChecks,hitChecks,...measure(()=>engine.select(pool),11)});
}
for(const count of [10,100,1000,10000]){
 const engine=Engine.create(Config);
 const items=Array.from({length:count},(_,i)=>item('T',`q-${i}`,i%2?'BL':'TL'));
 const before=engine.stats().poolItems;
 assert.equal(engine.select(items).ok,true);assert.equal(engine.stats().poolItems-before,count);
 queue.push({items:count,candidateChecks:engine.stats().candidateChecks,...measure(()=>engine.select(items),11)});
}
const wildcard=[];
for(const count of [10,1000,100000]){
 const engine=Engine.create(Config);for(let i=0;i<count;i++)engine.registerRule({id:`wild-${i}`,inputs:[{material:'*',count:3}],operation:'join'});
 const pool=[item('T','wild-t'),item('C','wild-c','BL')],before=engine.stats().candidateChecks;
 assert.equal(engine.select(pool).ok,true);assert.equal(engine.stats().candidateChecks-before,0,'arity-incomplete wildcard rules are excluded before ranking');wildcard.push({rules:count,candidateChecks:engine.stats().candidateChecks-before,...measure(()=>engine.select(pool),11)});
}
console.log(JSON.stringify({exactRules:rows,sharedMaterialRules:shared,queue,wildcardFallback:wildcard},null,2));
console.log('PASS synthesis performance: exact candidate count independent of unrelated rules; queue visited once per selection');
