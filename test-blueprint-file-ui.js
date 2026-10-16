const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const files = ['synthesis-engine.js', 'synthesis-config.js', 'levels.js', 'blueprint.js', 'challenges.js', 'core.js', 'sim.js', 'input.js'];
const downloads = [];
const store = new Map();
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  appendChild() {}, addEventListener() {}, querySelector: el, click() { downloads.push(this.download); },
  textContent: '', innerHTML: '' });
const context = {
  console, performance, setTimeout() {}, clearTimeout() {},
  window: { addEventListener() {} },
  localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
  document: { getElementById: el, createElement: el },
  Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts.type; } },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
};
vm.createContext(context);
vm.runInContext(files.map(f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8')).join('\n') + `
const Render = { cv:null, resize(){}, drawPreview(){} };
UI.toast = () => {};
UI.refreshBps = () => {};
globalThis.importText = text => UI.importBlueprintText(text);
globalThis.download = bp => UI.downloadBlueprint(bp);
globalThis.save = G.save;
globalThis.blueprints = Blueprints;
`, context);

const bp = { id: 'existing', name: '我的产线', ruleset: 'classic-v1', w: 1, h: 1,
  cells: [{ dx: 0, dy: 0, type: 'belt', dir: 1 }] };
context.save.blueprints.existing = bp;
const text = context.blueprints.exportFile(bp);
const first = context.importText(text);
assert(first, 'valid file imports');
assert.equal(Object.keys(context.save.blueprints).length, 2);
assert.equal(context.save.blueprints.existing.name, '我的产线', 'existing blueprint untouched');
const second = context.importText(text);
assert(second && first.id !== second.id, 'repeated imports get unique IDs');
assert.equal(Object.keys(context.save.blueprints).length, 3);
assert.equal(context.importText('{broken'), false, 'bad JSON rejected');
assert.equal(Object.keys(context.save.blueprints).length, 3, 'bad import does not alter library');
context.download(bp);
assert(downloads.some(name => name.endsWith('.slbp.json')), 'download uses portable blueprint extension');
console.log('ALL_BLUEPRINT_FILE_UI_PASS');
