const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const old = { id: 'old-layout', name: '旧梯形布局', ruleset: 'trapezoid-v2', w: 2, h: 1,
  cells: [
    { dx: 0, dy: 0, type: 'cutter', dir: 1, machineMode: 'rough' },
    { dx: 1, dy: 0, type: 'merger', dir: 1, machineMode: 'half' },
  ] };
const data = JSON.stringify({ unlocked: 1, blueprints: { [old.id]: old } });
const context = { console, setTimeout() {}, window: { addEventListener() {} },
  localStorage: { getItem() { return data; }, setItem() {} } };
vm.createContext(context);
const source = ['levels.js', 'blueprint.js', 'core.js']
  .map(name => fs.readFileSync(path.join(__dirname, 'js', name), 'utf8')).join('\n');
vm.runInContext(source + '\nglobalThis.saved = G.save;', context);
assert.equal(context.saved.blueprints['old-layout'].ruleset, 'trapezoid-v2');
assert.equal(context.saved.blueprints['old-layout'].cells[0].machineMode, 'rough');
const preview = context.saved.blueprints['old-layout-v3-preview'];
assert(preview && preview.ruleset === 'petal-v3');
assert.equal(preview.cells[0].machineMode, 'vertical');
assert.equal(preview.cells[1].machineMode, 'auto');
assert.equal(preview.migrationPending, true);
console.log('ALL_BLUEPRINT_LEGACY_LOCAL_PASS');
