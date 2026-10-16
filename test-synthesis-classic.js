'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const context={console,assert,performance,window:{addEventListener(){}},
 localStorage:{getItem(){return null;},setItem(){}},setTimeout(){},clearTimeout(){}};
vm.createContext(context);
vm.runInContext(['synthesis-engine.js','synthesis-config.js','levels.js','challenges.js','core.js','sim.js']
 .map(f=>fs.readFileSync(path.join(__dirname,'js',f),'utf8')).join('\n')+`
const overlapped=mergeShapes(['T',null,null,null],['C',null,null,null]);
assert.equal(overlapped.layers?.length,2,'classic overlapping shapes must retain both layers');
assert.equal(overlapped.units.length,2);
assert.equal(shapeEq(overlapped,['T',null,null,null]),false,'extra layers cannot be mistaken for a target');
const complementary=mergeShapes(['T','T',null,null],[null,null,'C','C']);
assert.deepEqual(complementary,['T','T','C','C'],'classic non-overlapping outputs remain arrays');
let rotated=overlapped;for(let i=0;i<4;i++)rotated=rotCW(rotated);
assert(shapeEq(rotated,overlapped),'four rotations preserve every layer');
const full=mergeShapes(['T','T','T','T'],['C','C','C','C']);
const pieces=cutV(full);
assert.equal(pieces[0].units.length,4);assert.equal(pieces[1].units.length,4);
const reconstructed=mergeShapes(pieces[0],pieces[1]);
assert(shapeEq(reconstructed,full),'cut and recombine works on classic multilayer output');
console.log('ALL_SYNTHESIS_CLASSIC_PASS');
`,context);
