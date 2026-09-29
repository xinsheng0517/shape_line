const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const files = ['levels.js', 'blueprint.js', 'petal-v3.js', 'challenges.js', 'core.js', 'sim.js', 'input.js'];
const elements = new Map();
const el = () => ({style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},
  appendChild(){},addEventListener(){},querySelector:el,textContent:'',innerHTML:''});
const document = {getElementById(id){if(!elements.has(id)) elements.set(id,el());return elements.get(id);},createElement:el};
const context = {console,assert,performance,setTimeout(){},clearTimeout(){},window:{addEventListener(){}},
  document,localStorage:{getItem(){return null;},setItem(){}}};
vm.createContext(context);
vm.runInContext(files.map(f=>fs.readFileSync(path.join(__dirname,'js',f),'utf8')).join('\n')+`
const Render={cv:null,resize(){},drawPreview(){}};
const V3Runtime={occupied(){return false;}};
UI.els={tabs:ge('tabs'),lvlName:ge('lvl-name'),toolbar:ge('toolbar'),toast:ge('toast'),
  hint:ge('hint'),modal:ge('modal'),winStars:ge('win-stars'),winInfo:ge('win-info'),
  btnNext:ge('btn-next'),bpbar:ge('bpbar'),menu:ge('menu'),statRate:ge('stat-rate')};
G.v3={running:false,orders:[{recipeId:'F_TC_TC',need:3,delivered:0}],toolModes:{cutter:'auto',merger:'auto'},sources:[]};
G.mode='challenge';G.chalIndex=0;G.chal={elapsed:0,done:false};
G.chalDef={id:'C1',name:'四瓣',ruleset:'petal-v3',recipeId:'F_TC_TC',need:3,target:PetalV3.preview('F_TC_TC')};
G.target=G.chalDef.target;
globalThis.refresh=()=>UI.refreshLevel();
globalThis.hint=()=>UI.els.hint.textContent;
globalThis.stockText=()=>UI.v3StockText();
G.grid=Array.from({length:16},()=>Array(24).fill(null));
G.budget={belt:Infinity,extractor:Infinity,cutter:Infinity,rotator:Infinity,merger:Infinity,trash:Infinity};
G.used={belt:0,extractor:0,cutter:0,rotator:0,merger:0,trash:0};
globalThis.placeCutter=()=>{
  G.v3.toolModes.cutter='horizontal';
  Input.tryPlace(4,4,'cutter',1,true);
  const before=cellAt(4,4).machineMode;
  Undo.undo(); Undo.redoOp();
  return {before,after:cellAt(4,4).machineMode};
};
`,context);
context.refresh();
assert.equal(elements.get('btn-hint').style.display,'none','challenge route hint button hidden');
assert.equal(context.hint(),'','new challenges expose no layout advice in hint strip');
assert.equal(elements.get('c4-start').style.display,'none','V3 challenges do not show a supply button');
assert.match(context.stockText(),/持续供料 ∞/,'V3 stock UI shows unlimited supply');
const placed = context.placeCutter();
assert.equal(placed.before,'horizontal','new cutter uses selected cut mode');
assert.equal(placed.after,'horizontal','undo/redo preserves cut mode');
console.log('ALL_V3_UI_PASS');
