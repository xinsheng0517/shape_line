const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'js', 'blueprint.js'), 'utf8');
const context = {
  console,
  Date,
  G: { v2: null, grid: [[null, null, null], [null, null, null]], budget: { belt: Infinity, cutter: Infinity, merger: Infinity } },
  MACHINE_TYPES: ['belt', 'cutter', 'merger'],
  GRID_W: 3,
  GRID_H: 2,
  TOOLS: [{ id: 'belt', name: '传送带' }, { id: 'cutter', name: '切割机' }, { id: 'merger', name: '合并机' }],
};
vm.createContext(context);
vm.runInContext(source + '\nglobalThis.Blueprints = Blueprints;', context);
const { Blueprints, G } = context;

const cutter = { type: 'cutter', dir: 1, machineMode: 'fine', item: { id: 'moving' }, stock: [1], queueA: [2], queueB: [3], locked: true };
const merger = { type: 'merger', dir: 2, machineMode: 'final', status: 'busy' };
G.grid[0][0] = cutter;
G.grid[1][1] = merger;

const legacy = Blueprints.fromRegion(0, 0, 1, 1);
assert(legacy);
assert(!Object.hasOwn(legacy, 'ruleset'));
assert.deepStrictEqual(JSON.parse(JSON.stringify(legacy.cells)), [
  { dx: 0, dy: 0, type: 'cutter', dir: 1 },
  { dx: 1, dy: 1, type: 'merger', dir: 2 },
]);

G.v2 = {};
const bp = Blueprints.fromRegion(0, 0, 1, 1);
assert.strictEqual(bp.ruleset, 'trapezoid-v2');
assert.deepStrictEqual(JSON.parse(JSON.stringify(bp.cells)), [
  { dx: 0, dy: 0, type: 'cutter', dir: 1, machineMode: 'fine' },
  { dx: 1, dy: 1, type: 'merger', dir: 2, machineMode: 'final' },
]);
for (const transformed of [Blueprints.clone(bp), Blueprints.rotate(bp), Blueprints.mirror(bp)]) {
  assert.strictEqual(transformed.ruleset, 'trapezoid-v2');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(transformed.cells.map(c => c.machineMode))), ['fine', 'final']);
  assert(transformed.cells.every(c => !('item' in c) && !('stock' in c) && !('queueA' in c) && !('locked' in c)));
}
assert.strictEqual(Blueprints.check(legacy, 2, 2).reason, '蓝图规则集不匹配');
assert.strictEqual(Blueprints.check({ ...bp, cells: [{ dx: 0, dy: 0, type: 'cutter', dir: 1, machineMode: 'half' }] }, 2, 2).reason, '切割机模式无效');
assert.strictEqual(Blueprints.check({ ...bp, cells: [{ dx: 0, dy: 0, type: 'merger', dir: 1, machineMode: 'rough' }] }, 2, 2).reason, '合并机模式无效');
assert.strictEqual(Blueprints.check(bp, 2, 2).reason, '超出边界');

G.v2 = null;
assert.strictEqual(Blueprints.check(bp, 2, 2).reason, '蓝图规则集不匹配');
assert.strictEqual(Blueprints.check(legacy, 2, 2).reason, '超出边界');
assert(!Object.hasOwn(Blueprints.clone({ ...legacy, cells: [{ dx: 0, dy: 0, type: 'belt', dir: 1 }] }), 'ruleset'));
console.log('ALL_BLUEPRINT_V2_TESTS_PASS');
