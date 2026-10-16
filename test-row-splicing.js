'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const files=['levels.js','blueprint.js','synthesis-engine.js','synthesis-config.js','petal-v3.js','challenges.js','challenge-v3.js','core.js','sim.js'];
let production=files.map(file=>fs.readFileSync(path.join(__dirname,'js',file),'utf8')).join('\n');
if(process.argv[2]){
 const inline=[...fs.readFileSync(process.argv[2],'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
 assert.equal(inline.length,11,'the distribution contains all eleven production scripts');
 production=inline.slice(0,9).join('\n');
}
const context={console,performance,assert,setTimeout(){},clearTimeout(){},window:{addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}}};
vm.createContext(context);
vm.runInContext(production+'\n'+fs.readFileSync(path.join(__dirname,'test-support/row-splicing-reference.js'),'utf8')+`
const Render={cv:null,resize(){},drawPreview(){}};
const UI={refreshLevel(){},refreshBudget(){},refreshToolbar(){},syncPause(){},refreshLevels(){},showChalWin(){},refreshV3(){},toast(){}};
function setup(mode='auto'){V3Runtime.load(0);const c=mkCell('merger',12,4,1);c.machineMode=mode;G.grid[4][12]=c;return c;}
function quarter(material,id,slot){return PetalV3.cut(PetalV3.raw(material,id),'vertical').flatMap(half=>PetalV3.cut(half,'horizontal')).find(piece=>piece.quadrant===slot);}
function enqueue(c,port,shape){(c[port] ||= []).push(V3Runtime.item(shape,c));}
function advance(n=12){for(let i=0;i<n;i++)V3Runtime.tick();}
function ids(){return V3Runtime.materialIds().slice().sort();}
function assertRow(shape,material,row){assert(shape);assert.equal(shape.layers.length,1);assert.equal(shape.units.length,2);assert.deepEqual(shape.units.map(u=>u.slot).sort(),(row==='top'?['TL','TR']:['BL','BR']).sort());assert(shape.units.every(u=>u.shapeKind===material&&u.layer===0));}

// Repeated early input must not be consumed before its complementary row part arrives.
for(const material of ['T','C','S'])for(const row of ['top','bottom'])for(const earlyPort of ['queueA','queueB']){
 const c=setup(),left=row==='top'?'TL':'BL',right=row==='top'?'TR':'BR';
 const latePort=earlyPort==='queueA'?'queueB':'queueA';
 enqueue(c,earlyPort,quarter(material,material+row+earlyPort+'-1',left));
 enqueue(c,earlyPort,quarter(material,material+row+earlyPort+'-2',left));
 const before=ids();advance();
 assert.equal(c.proc,null,'auto must wait for a complementary part instead of stacking two early copies');
 assert.equal(c.outA,null);assert.equal(c[earlyPort].length,2);assert.deepEqual(ids(),before);
 enqueue(c,latePort,quarter(material,material+row+earlyPort+'-3',right));const withLate=ids();advance();
 assertRow(c.outA.shape,material,row);assert.equal(c[earlyPort].length,1);assert.equal(c[latePort].length,0);assert.deepEqual(ids(),withLate);
 assert.match(c.status,/前出口未连接/,'completed product remains safely in the unconnected tray');
}

// A full backlog must not hide a later complementary input or consume earlier duplicates.
for(const material of ['T','C','S'])for(const row of ['top','bottom']){
 const c=setup(),left=row==='top'?'TL':'BL',right=row==='top'?'TR':'BR';
 for(let i=0;i<64;i++)enqueue(c,'queueA',quarter(material,'backlog-'+material+row+i,left));
 for(let i=0;i<32;i++)enqueue(c,'queueB',quarter(material,'other-'+material+row+i,right));
 const before=ids();advance();assertRow(c.outA.shape,material,row);assert.equal(c.queueA.length,63);assert.equal(c.queueB.length,31);assert.deepEqual(ids(),before);
}

// Complementary pieces on a shared inlet still work, and explicit stacking remains available.
let c=setup();enqueue(c,'queueA',quarter('T','single-TL','TL'));enqueue(c,'queueA',quarter('T','single-TR','TR'));advance();assertRow(c.outA.shape,'T','top');
c=setup('stack');enqueue(c,'queueA',quarter('T','stack-1','TL'));enqueue(c,'queueA',quarter('T','stack-2','TL'));advance();assert.equal(c.outA.shape.layers.length,2);
c=setup();enqueue(c,'queueA',quarter('T','cross-1','TL'));enqueue(c,'queueB',quarter('C','cross-2','TL'));advance();assert.equal(c.outA.shape.layers.length,2);

// Registered operators still receive the actual machine mode while generic pairing prefers joins.
const modes=[];
PetalV3.engine.registerOperator('requires-auto',(items,options)=>{modes.push(options.mode);if(options.mode!=='auto')throw Error('operator-requires-auto');return items.flatMap(item=>item.units);});
PetalV3.registerRule({id:'mode-sensitive-pair',inputs:[{material:'T'},{material:'C'}],operation:'requires-auto'});
c=setup();enqueue(c,'queueA',quarter('T','mode-T','TL'));enqueue(c,'queueA',quarter('C','mode-C','TR'));advance();
assert(c.outA,'a registered rule must retain auto mode on a shared inlet');assert.equal(c.outA.shape.ruleId,'mode-sensitive-pair');assert(modes.length&&modes.every(mode=>mode==='auto'));
PetalV3.engine.unregisterRule('mode-sensitive-pair');

// Reproduce the screenshot with actual mining/cutting, including building the lower branch late.
for(const material of ['T','C','S'])for(const row of ['top','bottom']){
 const ref=buildRowSplicingReference({material,row,connectLower:false});advance(45);
 assert.equal(ref.merger.outA,null,'building the upper branch first must not create a duplicate stack');
 assert.equal(ref.merger.proc,null);ref.completeLower();advance(24);
 assertRow(ref.merger.outA.shape,material,row);assert.match(ref.merger.status,/合成完成.*前出口未连接/);
 const product=ref.merger.outA;advance(20);assert.equal(ref.merger.outA,product,'unconnected output uses safe backpressure');
 ref.connectOutput();const first=ref.products().length;advance(120);
 assert(ref.products().length>=first+10,'connecting the forward belt must resume continuous row production');
 ref.products().forEach(shape=>assertRow(shape,material,row));
 const all=ids();assert.equal(new Set(all).size,all.length,'real-grid production must not duplicate any physical unit');
 const expected=G.v3.nextRawByNode.reduce((sum,n)=>sum+n,0)*4;
 assert.equal(all.length,expected,'all mined, queued, processed and trashed units remain accounted for');
}
console.log('ALL_ROW_SPLICING_PASS');
`,context,{filename:'test-row-splicing.vm.js'});
