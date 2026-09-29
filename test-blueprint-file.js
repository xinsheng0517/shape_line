'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'js', 'blueprint.js'), 'utf8');
const context = {
  console, Date,
  G: { v2: null, v3: {}, grid: [[null, null]], budget: { belt: Infinity, cutter: Infinity, merger: Infinity } },
  MACHINE_TYPES: ['belt', 'extractor', 'cutter', 'rotator', 'merger', 'trash'],
  GRID_W: 2, GRID_H: 1,
  TOOLS: [{ id: 'belt', name: '传送带' }, { id: 'extractor', name: '采集器' }, { id: 'cutter', name: '切割机' }, { id: 'merger', name: '混合机' }],
};
vm.createContext(context);
vm.runInContext(source + '\nglobalThis.Blueprints = Blueprints;', context);
const { Blueprints } = context;
const plain = x => JSON.parse(JSON.stringify(x));

const bp = {
  id: 'local-1', name: '四瓣 T/C', ruleset: 'petal-v3', w: 2, h: 1,
  cells: [
    { dx: 0, dy: 0, type: 'cutter', dir: 1, machineMode: 'vertical' },
    { dx: 1, dy: 0, type: 'merger', dir: 1, machineMode: 'auto' },
  ],
};
const text = Blueprints.exportFile(bp);
const file = JSON.parse(text);
assert.strictEqual(file.format, 'shape-line-blueprint');
assert.strictEqual(file.version, 3);
assert.strictEqual(file.ruleset, 'petal-v3');
assert.deepStrictEqual(plain(file.size), { w: 2, h: 1 });
assert(!Object.hasOwn(file, 'id'));
assert.deepStrictEqual(plain(Blueprints.importFile(text).blueprint.cells), bp.cells);
assert.strictEqual(Blueprints.importFile(text).blueprint.ruleset, 'petal-v3');
assert.notStrictEqual(Blueprints.importFile(text).blueprint.id, bp.id);
const finalMixer = { ...bp, cells: [{ ...bp.cells[0] }, { ...bp.cells[1], machineMode: 'final' }] };
assert.strictEqual(Blueprints.importFile(Blueprints.exportFile(finalMixer)).blueprint.cells[1].machineMode, 'final');
for (const machineMode of ['auto', 'vertical', 'horizontal']) {
  for (let dir = 0; dir < 4; dir++) {
    const cutter = { ...bp, cells: [{ dx: 0, dy: 0, type: 'cutter', dir, machineMode }] };
    const restored = Blueprints.importFile(Blueprints.exportFile(cutter)).blueprint.cells[0];
    assert.strictEqual(restored.machineMode, machineMode);
    assert.strictEqual(restored.dir, dir);
  }
}

const base = () => JSON.parse(text);
const reject = (mutate, pattern) => {
  const f = base(); mutate(f);
  assert.throws(() => Blueprints.importFile(JSON.stringify(f)), pattern);
};
reject(f => { f.version = 99; }, /版本/);
reject(f => { f.format = 'pretend-blueprint'; }, /格式/);
reject(f => { f.ruleset = 'unknown'; }, /规则集/);
reject(f => { f.cells.push({ ...f.cells[0] }); }, /重复/);
reject(f => { f.cells[0].dx = 2; }, /坐标/);
reject(f => { f.cells[0].dir = 4; }, /方向/);
reject(f => { f.cells[0].type = 'resource'; }, /机器类型/);
reject(f => { f.cells[0].machineMode = 'fine'; }, /模式/);
reject(f => { f.cells[1].machineMode = 'rough'; }, /模式/);
reject(f => { f.cells[0].item = { sourceId: 'forged' }; }, /字段/);
reject(f => { f.size.w = 1024; }, /尺寸/);
reject(f => { f.cells = Array.from({ length: 513 }, (_, i) => ({ dx: i, dy: 0, type: 'belt', dir: 1 })); }, /数量/);
assert.throws(() => Blueprints.importFile('x'.repeat(128 * 1024 + 1)), /大小/);
assert.throws(() => Blueprints.importFile('<html>not a blueprint</html>'), /JSON/);

const dirty = base();
dirty.name = ' <img src=x onerror=alert(1)> & “工厂” ';
const cleaned = Blueprints.importFile(JSON.stringify(dirty)).blueprint;
assert(!/[<>&"'`]/.test(cleaned.name));
assert(cleaned.name.includes('工厂'));

const legacy = { id: 'old', name: '旧四象限', w: 1, h: 1, cells: [{ dx: 0, dy: 0, type: 'belt', dir: 1 }] };
const old = Blueprints.importFile(JSON.stringify(legacy));
assert.strictEqual(old.blueprint.ruleset, 'classic-v1');
assert.strictEqual(old.original.ruleset, undefined);
assert.strictEqual(old.original.id, 'old');
assert.strictEqual(old.migrated, true);

const v2 = { id: 'old-v2', name: '旧梯形', ruleset: 'trapezoid-v2', w: 2, h: 1, cells: [
  { dx: 0, dy: 0, type: 'cutter', dir: 1, machineMode: 'rough' },
  { dx: 1, dy: 0, type: 'merger', dir: 1, machineMode: 'half' },
] };
const converted = Blueprints.importFile(JSON.stringify(v2));
assert.strictEqual(converted.original.cells[0].machineMode, 'rough');
assert.strictEqual(converted.blueprint.ruleset, 'trapezoid-v2');
assert.strictEqual(converted.preview.ruleset, 'petal-v3');
assert.strictEqual(converted.preview.cells[0].machineMode, 'vertical');
assert.strictEqual(converted.preview.cells[1].machineMode, 'auto');
assert.strictEqual(converted.safeToPaste, false);
assert.strictEqual(v2.cells[0].machineMode, 'rough');
const wrappedV2 = Blueprints.importFile(Blueprints.exportFile(v2));
assert.strictEqual(wrappedV2.preview.ruleset, 'petal-v3');
assert.strictEqual(wrappedV2.safeToPaste, false);

assert.strictEqual(Blueprints.fromRegion(0, 0, 0, 0), null);
context.G.grid[0][0] = { type: 'cutter', dir: 1, machineMode: 'horizontal' };
const selected = Blueprints.fromRegion(0, 0, 0, 0);
assert.strictEqual(selected.ruleset, 'petal-v3');
assert.strictEqual(selected.cells[0].machineMode, 'horizontal');
assert.strictEqual(Blueprints.check(selected, 1, 0), null);
assert.strictEqual(Blueprints.check(v2, 1, 0).reason, '蓝图规则集不匹配');
context.G.budget.belt = 1;
context.G.grid[0][0] = null;
const twoBelts = { ruleset: 'petal-v3', w: 2, h: 1, cells: [
  { dx: 0, dy: 0, type: 'belt', dir: 1 }, { dx: 1, dy: 0, type: 'belt', dir: 1 },
] };
assert.match(Blueprints.check(twoBelts, 0, 0).reason, /预算不足/);
context.G.budget.belt = 80;
context.G.grid[0][0] = { type: 'cutter' };
assert.match(Blueprints.check(twoBelts, 0, 0).reason, /占用/);

console.log('ALL_BLUEPRINT_FILE_TESTS_PASS');
