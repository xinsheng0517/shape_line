const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');
const files = ['levels.js', 'blueprint.js', 'synthesis-engine.js', 'synthesis-config.js', 'petal-v3.js', 'challenges.js', 'core.js', 'sim.js', 'input.js'];
const elements = new Map();
function element(tag = 'div') {
  return {tagName:tag,style:{},children:[],listeners:{},value:'',textContent:'',innerHTML:'',
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    appendChild(child){this.children.push(child);return child;},
    addEventListener(name,cb){this.listeners[name]=cb;},querySelector(){return element();},getContext(){return {};}};
}
const document = {getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element};
const context = {console,performance,setTimeout(){},clearTimeout(){},document,window:{addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}}};
vm.createContext(context);
vm.runInContext(files.map(f=>fs.readFileSync(path.join(__dirname,'js',f),'utf8')).join('\n')+`
const Render={cv:null,resize(){},drawPreview(){},shapeIcon(){}};
const V3Runtime={occupied(c){return !!c.busy;}};
UI.els={bpbar:ge('bpbar'),toast:ge('toast')}; UI.bpOpen=true;
G.mode='free';G.v3={toolModes:{cutter:'auto',merger:'auto'},selected:{x:4,y:4},sources:[]};
G.grid=Array.from({length:16},()=>Array(24).fill(null));
G.grid[4][4]={type:'cutter',machineMode:'auto',busy:true};
G.budget={belt:Infinity,extractor:Infinity,cutter:Infinity,rotator:Infinity,merger:Infinity,trash:Infinity};
G.used={belt:0,extractor:0,cutter:0,rotator:0,merger:0,trash:0};
UI.refreshBudget=()=>{};
globalThis.api={UI,Input,Blueprints,G,PetalV3,Undo};
`,context);
const {UI,Blueprints,G} = context.api;
const descendants=element=>element.children.flatMap(child=>[child,...descendants(child)]);
let failed = 0;
function check(name,fn){try{fn();console.log('PASS',name);}catch(error){failed++;console.error('FAIL',name, error.message);}}
check('occupied mode change keeps machine and default unchanged',()=>{
  UI.refreshBps();
  const select=elements.get('bpbar').children.flatMap(c=>c.children).find(c=>c.tagName==='select');
  select.value='horizontal';select.listeners.change();
  assert.equal(G.v3.toolModes.cutter,'auto'); assert.equal(G.grid[4][4].machineMode,'auto');assert.equal(select.value,'auto');
});
check('rule survives blueprint transforms and file roundtrip',()=>{
  const bp={id:'rules',name:'three',w:1,h:1,ruleset:'petal-v3',cells:[{dx:0,dy:0,type:'merger',dir:1,machineMode:'auto',ruleId:'triple-copper'}]};
  for(const copy of [Blueprints.clone(bp),Blueprints.rotate(bp),Blueprints.mirror(bp)])assert.equal(copy.cells[0].ruleId,'triple-copper');
  assert.equal(Blueprints.importFile(Blueprints.exportFile(bp)).blueprint.cells[0].ruleId,'triple-copper');
});
check('legacy and geometric merger modes remain portable',()=>{
  for(const mode of ['auto','half','final','join','stack']){
    const bp={name:mode,w:1,h:1,ruleset:'petal-v3',cells:[{dx:0,dy:0,type:'merger',dir:0,machineMode:mode}]};
    assert.equal(Blueprints.importFile(Blueprints.exportFile(bp)).blueprint.cells[0].machineMode,mode);
  }
});
check('configuration editor exports and atomically rejects malformed JSON',()=>{
  assert.equal(typeof UI.exportSynthesisConfig,'function');assert.equal(typeof UI.importSynthesisConfig,'function');
  const before=UI.exportSynthesisConfig();
  assert.throws(()=>UI.importSynthesisConfig('{invalid'),/JSON/);
  assert.equal(UI.exportSynthesisConfig(),before);
  assert.throws(()=>UI.importSynthesisConfig(JSON.stringify({materials:{bad:{color:5}},rules:[]})));
  assert.equal(UI.exportSynthesisConfig(),before);
  assert.throws(()=>UI.importSynthesisConfig(JSON.stringify({materials:[{id:'no-partial',name:'Should not exist',color:'#abcdef',outline:'circle'}],rules:[{id:'bad-rule',inputs:[],operation:'join'}]})));
  assert.equal(UI.exportSynthesisConfig(),before,'valid preceding material is not partially applied');
});
check('layer inspection preserves every real layer and material name',()=>{
  assert.equal(typeof UI.synthesisLayers,'function');
  const shape={units:[{shapeKind:'T',slot:'TL',layer:0},{shapeKind:'C',slot:'TL',layer:7}],layers:Array.from({length:8},()=>({}))};
  const layers=UI.synthesisLayers(shape);assert.equal(layers.length,8);assert.equal(layers[7].TL,'C');
});
check('layer inspection reports world slots after rotation',()=>{
  const layers=UI.synthesisLayers({orientation:90,units:[{shapeKind:'T',slot:'TL',layer:0}]});
  assert.equal(layers[0].TR,'T');assert.equal(layers[0].TL,undefined);
});
check('registered rule selection reaches placement and blocks occupied changes',()=>{
  const {PetalV3,Input}=context.api;
  vm.runInContext("PetalV3.registerRule({id:'triple-copper',inputs:[{material:'T',count:3}],operation:'stack'})",context);
  G.v3.selected=null;UI.refreshBps();
  let select=descendants(elements.get('bpbar')).filter(el=>el.id==='synthesis-rule').pop();
  assert(select.children.some(option=>option.value==='triple-copper'));
  select.value='triple-copper';select.listeners.change();
  assert.equal(Input.tryPlace(5,5,'merger',1,true),true);assert.equal(G.grid[5][5].ruleId,'triple-copper');
  G.v3.selected={x:5,y:5};G.grid[5][5].busy=true;
  UI.refreshBps();select=descendants(elements.get('bpbar')).filter(el=>el.id==='synthesis-rule').pop();
  select.value='';select.listeners.change();assert.equal(G.v3.toolRuleId,'triple-copper');assert.equal(G.grid[5][5].ruleId,'triple-copper');
});
check('config text editor applies valid editable JSON and renders every layer',()=>{
  const config=JSON.parse(UI.exportSynthesisConfig());config.materials.push({id:'copper-wire',name:'铜线',color:'#123456',outline:'circle'});
  UI.importSynthesisConfig(JSON.stringify(config));assert.equal(context.api.PetalV3.engine.getMaterial('copper-wire').name,'铜线');
  const bar=element();UI.showSynthesisLayers({units:[{shapeKind:'copper-wire',slot:'TL',layer:0},{shapeKind:'T',slot:'BR',layer:2}],layers:[{},{},{}]},bar);
  const rows=descendants(bar).filter(el=>el.className==='synthesis-layer');assert.equal(rows.length,3);
  assert(rows[0].children.some(el=>el.textContent.includes('铜线 [copper-wire]')));
});
check('placement undo and redo retain explicit rule and mode',()=>{
  const {Input,Undo}=context.api;Undo.clear();G.v3.selected=null;
  assert(Input.tryPlace(6,5,'merger',1,true,'stack','triple-copper'));
  Undo.undo();assert.equal(G.grid[5][6],null);Undo.redoOp();
  assert.equal(G.grid[5][6].machineMode,'stack');assert.equal(G.grid[5][6].ruleId,'triple-copper');
});
check('empty machine mode and rule edits are undoable',()=>{
  const {Undo}=context.api;G.v3.selected={x:6,y:5};Undo.clear();
  UI.setSynthesisMode('merger',{value:'join'});assert.equal(G.grid[5][6].machineMode,'join');
  Undo.undo();assert.equal(G.grid[5][6].machineMode,'stack');assert.equal(G.grid[5][6].ruleId,'triple-copper');
  Undo.redoOp();assert.equal(G.grid[5][6].machineMode,'join');
  G.v3.selected={x:6,y:5};UI.refreshBps();const select=descendants(elements.get('bpbar')).filter(el=>el.id==='synthesis-rule').pop();
  select.value='';select.listeners.change();assert.equal(G.grid[5][6].ruleId,undefined,'clear rule on live machine');
  Undo.undo();assert.equal(G.grid[5][6].ruleId,'triple-copper');Undo.redoOp();assert.equal(G.grid[5][6].ruleId,undefined,'redo clear rule');
});
check('source and bundle load synthesis dependencies before facade',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  const build=fs.readFileSync(path.join(__dirname,'build.js'),'utf8');
  for(const text of [html,build])assert(text.indexOf('synthesis-engine.js')<text.indexOf('synthesis-config.js')&&text.indexOf('synthesis-config.js')<text.indexOf('petal-v3.js'));
});
if(failed)process.exitCode=1;else console.log('ALL_SYNTHESIS_UI_PASS');
