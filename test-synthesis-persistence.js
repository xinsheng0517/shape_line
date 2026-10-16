'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const KEY = 'shape-line-save-v1';
const plain = value => JSON.parse(JSON.stringify(value));
function element(tag = 'div') {
  return {tagName:tag,style:{},children:[],listeners:{},textContent:'',innerHTML:'',value:'',
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    appendChild(child){this.children.push(child);return child;},
    addEventListener(name,callback){this.listeners[name]=callback;},querySelector(){return element();}};
}
function boot(save, classic = false) {
  const storage = new Map(save ? [[KEY,JSON.stringify(save)]] : []), callbacks={}, messages=[],elements=new Map();
  const context = vm.createContext({console,performance,setTimeout(){},clearTimeout(){},setInterval(){},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element},
    window:{addEventListener(name,callback){callbacks[name]=callback;}},
    Render:{cv:null,init(){},resize(){},drawPreview(){}},requestAnimationFrame(){}});
  const files = classic ? ['levels.js','core.js','input.js']
    : ['synthesis-engine.js','synthesis-config.js','petal-v3.js','levels.js','core.js','input.js'];
  for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'js',file),'utf8'),context,{filename:file});
  vm.runInContext(`globalThis.api={G,UI,restore:typeof restoreSynthesisConfig==='function'?restoreSynthesisConfig:null,
    engine:typeof PetalV3==='undefined'?null:PetalV3.engine,
    startup(){Input.init=()=>{};for(const name of ['refreshLevel','refreshBudget','refreshToolbar','syncPause','showMenu'])UI[name]=()=>{};},
    controls(bar){G.v3={toolModes:{cutter:'auto',merger:'auto'},sources:[]};UI.synthesisControls(bar);}}`,context);
  context.api.UI.toast=message=>messages.push(message);
  return {api:context.api,storage,messages,startup(){context.api.startup();callbacks.load();}};
}
const config = {materials:[{id:'saved-copper',name:'铜',color:'#abcdef',outline:'circle'}],
  rules:[{id:'saved-triple',inputs:[{material:'saved-copper',count:3}],operation:'stack'}]};
const first=boot();
const applied=first.api.UI.importSynthesisConfig(JSON.stringify(config));
assert.ok(first.api.G.save.synthesisConfig,'successful import must save its validated snapshot');
assert.deepEqual(plain(first.api.G.save.synthesisConfig),JSON.parse(applied),'successful import must save the validated snapshot');
assert.deepEqual(JSON.parse(first.storage.get(KEY)).synthesisConfig,JSON.parse(applied),'successful import must persist to localStorage');
const snapshot=plain(first.api.G.save.synthesisConfig),version=first.api.engine.stats().version,stored=first.storage.get(KEY);
assert.throws(()=>first.api.UI.importSynthesisConfig(JSON.stringify({materials:[{id:'partial',outline:'star'}],
  rules:[{id:'bad',inputs:[],operation:'join'}]})));
assert.deepEqual(plain(first.api.G.save.synthesisConfig),snapshot);
assert.equal(first.api.engine.stats().version,version);assert.equal(first.api.engine.getMaterial('partial'),null);
assert.equal(first.storage.get(KEY),stored);
const refreshed=boot({...JSON.parse(first.storage.get(KEY)),unlocked:5,stars:{2:3},challengeV3:{C1:{best:12}}});
assert.equal(refreshed.api.engine.getMaterial('saved-copper').name,'铜');
assert.equal(refreshed.api.engine.listRules().find(rule=>rule.id==='saved-triple').operation,'stack');
assert.equal(refreshed.api.G.save.stars[2],3);assert.equal(refreshed.api.G.save.challengeV3.C1.best,12);
assert.equal(refreshed.api.G.synthesisConfigError,null);

// A JS operator is not serialized. Reload must report it and preserve the original JSON.
const unavailable={materials:[{id:'unrestored-copper',name:'保留原件'}],rules:[{
  id:'javascript-rule',inputs:[{material:'unrestored-copper'}],operation:'runtime-only-operator'}]};
const damagedSave={unlocked:7,stars:{5:3},sound:false,challengeV3:{C2:{best:18}},synthesisConfig:unavailable};
const damaged=boot(damagedSave);
assert.equal(damaged.api.engine.getMaterial('unrestored-copper'),null,'failed restore must not partially import materials');
assert.equal(damaged.api.engine.getMaterial('T').name,'梯形');
assert.deepEqual(plain(damaged.api.G.save.synthesisConfig),unavailable);
assert.equal(damaged.api.G.save.stars[5],3);assert.equal(damaged.api.G.save.challengeV3.C2.best,18);
assert.match(damaged.api.G.synthesisConfigError,/合成配置恢复失败/);
damaged.startup();
assert(damaged.messages.some(message=>message.includes('合成配置恢复失败')&&message.includes('unknown-operation')));
assert.deepEqual(JSON.parse(damaged.api.UI.exportSavedSynthesisConfig()),unavailable);
const editor=element();damaged.api.controls(editor);
const descendants=el=>el.children.flatMap(child=>[child,...descendants(child)]);
const recover=descendants(editor).find(el=>el.textContent==='导出未恢复的存档配置');
assert(recover,'failed restore must offer a visible export action');recover.listeners.click();
assert.deepEqual(JSON.parse(descendants(editor).find(el=>el.id==='synthesis-config-text').value),unavailable);
damaged.api.UI.importSynthesisConfig(JSON.stringify(config));
assert.equal(damaged.api.G.synthesisConfigError,null);
assert.equal(JSON.parse(damaged.storage.get(KEY)).stars[5],3);
for (const corrupted of [null,false,0,'']) {
  const invalid=boot({unlocked:2,stars:{0:3},synthesisConfig:corrupted});
  assert.match(invalid.api.G.synthesisConfigError,/合成配置恢复失败/,'an explicitly saved malformed config must not be silently skipped');
  assert.equal(JSON.parse(invalid.api.UI.exportSavedSynthesisConfig()),corrupted);
  assert.equal(invalid.api.G.save.stars[0],3);
}

const classic=boot({unlocked:3,stars:{1:2},synthesisConfig:unavailable},true);
assert.equal(classic.api.G.save.stars[1],2);
assert.deepEqual(plain(classic.api.G.save.synthesisConfig),unavailable);
console.log('ALL_SYNTHESIS_PERSISTENCE_PASS');
