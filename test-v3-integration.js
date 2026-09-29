const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const files = ['levels.js', 'blueprint.js', 'petal-v3.js', 'challenges.js', 'challenge-v3.js',
  'core.js', 'sim.js', 'input.js'];
const el = () => ({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},
  appendChild(){},addEventListener(){},querySelector:el,textContent:'',innerHTML:''});
const context = {console, assert, performance, setTimeout(){},clearTimeout(){},setInterval(){},
  window:{addEventListener(){}},document:{getElementById:el,createElement:el},
  localStorage:{getItem(){return null;},setItem(){}}};
vm.createContext(context);
vm.runInContext(files.filter(f => fs.existsSync(path.join(__dirname, 'js', f)))
  .map(f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8')).join('\n') + `
const Render={cv:null,resize(){},drawPreview(){}};
for(const name of ['refreshLevel','refreshBudget','refreshToolbar','syncPause','refreshLevels',
  'showChalWin','refreshChalProgress','refreshBps','toast']) UI[name]=()=>{};
globalThis.run=(index)=>{loadChallenge(index);return {state:G.v3,def:G.chalDef,budget:G.budget,
  resources:G.grid.flat().filter(c=>c&&c.type==='resource'),
  placed:G.grid.flat().filter(c=>c&&MACHINE_TYPES.includes(c.type)),tick:G.tickCount};};
globalThis.step=()=>Sim.tick();
globalThis.start=()=>{G.v3.running=true;};
globalThis.snapshot=()=>({tick:G.tickCount,emitted:G.v3&&G.v3.emitted});
globalThis.switchLevel=()=>loadLevel(0);
globalThis.v3=()=>G.v3;
`,context);
for (const index of [0,1,4,5]) {
  const s = context.run(index);
  assert.equal(s.def.ruleset,'petal-v3');
  assert(s.state, 'V3 state must load');
  assert.equal(s.resources.length,3,'three distinct base shape sources available');
  assert.equal(s.placed.length,0,'challenge has no preplaced reference solution');
  assert(!s.def.guide && !s.def.hint,'challenge has no route hint payload');
  assert.equal(s.budget.extractor,index===4||index===5?3:Infinity);
  assert.equal(s.budget.belt,index===4||index===5?80:Infinity);
  assert.equal(s.state.running,true,'V3 challenge supplies automatically without a button');
  context.step();
  assert.equal(context.snapshot().tick,1,'automatic supply advances simulation');
}
context.switchLevel();
assert.equal(context.v3(),null,'classic level unloads V3 state');
console.log('ALL_V3_INTEGRATION_PASS');
