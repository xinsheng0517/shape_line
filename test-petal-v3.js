'use strict';
const assert = require('node:assert/strict');
const PetalV3 = require('./js/petal-v3.js');

function split(kind, id, orientation = 0) {
  const original = PetalV3.raw(kind, id, orientation);
  const halves = PetalV3.cut(original, 'vertical');
  const quarters = halves.flatMap(half => PetalV3.cut(half, 'horizontal'));
  return { original, halves, quarters };
}
function q(kind, id, slot) {
  return split(kind, id).quarters.find(part => part.quadrant === slot);
}

for (const kind of ['T', 'C', 'S']) {
  const { original, halves, quarters } = split(kind, `source-${kind}`);
  assert.equal(original.kind, 'petal-v3');
  assert.equal(original.ruleset, 'petal-v3');
  assert.equal(original.stage, 'raw');
  assert.deepEqual(halves.map(part => part.side), ['L', 'R']);
  assert.deepEqual(quarters.map(part => part.quadrant), ['TL', 'BL', 'TR', 'BR']);
  assert.deepEqual(quarters.map(part => part.units[0].slot), ['TL', 'BL', 'TR', 'BR']);
  assert.ok(quarters.every(part => part.units[0].resource === kind));
  assert.deepEqual(quarters.map(part => part.units.length), [1, 1, 1, 1]);
  assert.deepEqual(quarters.flatMap(part => part.unitIds).sort(), [...original.unitIds].sort());
  assert.equal(PetalV3.cut(original, 'horizontal'), null);
  assert.equal(PetalV3.cut(halves[0], 'vertical'), null);
  assert.equal(PetalV3.cut(quarters[0], 'auto'), null);
  assert.ok(Object.isFrozen(original) && Object.isFrozen(original.units) && Object.isFrozen(original.units[0]));
  assert.throws(() => { original.units[0].shapeKind = 'S'; }, TypeError);
  assert.throws(() => { original.unitIds.push('forged'); }, TypeError);
  assert.equal(original.region.x0, 0);
  assert.equal(original.region.x1, 1);
  assert.equal(original.region.y0, 0);
  assert.equal(original.region.y1, 1);
  assert.deepEqual(quarters.map(part => [part.region.x0, part.region.x1, part.region.y0, part.region.y1]), [
    [0, 0.5, 0, 0.5], [0, 0.5, 0.5, 1],
    [0.5, 1, 0, 0.5], [0.5, 1, 0.5, 1]
  ]);
}

assert.equal(PetalV3.GEOMETRY.T.vertical, 0.5);
assert.equal(PetalV3.GEOMETRY.T.horizontal, 0.5);
assert.equal(PetalV3.GEOMETRY.T.equalAreaRequired, false);
assert.equal(PetalV3.raw('R', 'bad'), null);
assert.equal(PetalV3.raw('T', ''), null);
assert.equal(PetalV3.raw('T', 'id', 45), null);
assert.equal(PetalV3.cut({}, 'vertical'), null);

const halfIds = Object.keys(PetalV3.HALF_RECIPES);
assert.deepEqual(halfIds, ['H_TC', 'H_CT', 'H_TS', 'H_ST', 'H_CS', 'H_SC']);
assert.equal(Object.keys(PetalV3.FINAL_RECIPES).length, 36);
for (const top of ['T', 'C', 'S']) {
  for (const bottom of ['T', 'C', 'S']) {
    const upper = q(top, `upper-${top}-${bottom}`, 'TL');
    const lower = q(bottom, `lower-${top}-${bottom}`, 'BL');
    const mixed = PetalV3.merge(lower, upper);
    if (top === bottom) assert.equal(mixed, null);
    else {
      assert.equal(mixed.recipeId, `H_${top}${bottom}`);
      assert.equal(mixed.stage, 'mixed-half');
      assert.equal(mixed.side, 'L');
      assert.deepEqual(mixed.units.map(unit => unit.shapeKind), [top, bottom]);
    }
  }
}

for (const leftId of halfIds) {
  for (const rightId of halfIds) {
    const left = PetalV3.merge(
      q(leftId[2], `L-top-${leftId}-${rightId}`, 'TL'),
      q(leftId[3], `L-bottom-${leftId}-${rightId}`, 'BL'));
    const right = PetalV3.merge(
      q(rightId[2], `R-top-${leftId}-${rightId}`, 'TR'),
      q(rightId[3], `R-bottom-${leftId}-${rightId}`, 'BR'));
    const done = PetalV3.merge(right, left);
    const expected = `F_${leftId.slice(2)}_${rightId.slice(2)}`;
    assert.equal(done.recipeId, expected);
    assert.equal(done.stage, 'finished');
    assert.equal(PetalV3.isFinished(done, [expected]), true);
    assert.equal(PetalV3.isFinished(done, ['F_TC_TC'].filter(id => id !== expected)), false);
    assert.deepEqual(done.units.map(unit => unit.quadrant), ['TL', 'BL', 'TR', 'BR']);
  }
}

{
  const a = split('T', 'same');
  assert.equal(PetalV3.merge(a.quarters[0], a.quarters[0]), null);
  assert.equal(PetalV3.merge(a.quarters[0], a.quarters[2]), null);
  assert.equal(PetalV3.merge(a.halves[0], a.quarters[1]), null);
  assert.equal(PetalV3.merge({}, a.quarters[1]), null);
  assert.equal(PetalV3.merge({ orientation: 0, units: [null] }, a.quarters[1]), null);
  assert.equal(PetalV3.merge({ ...a.quarters[0] }, q('C', 'other', 'BL')), null);
  const top = q('T', 'dup', 'TL');
  const bottomSameSource = q('C', 'dup', 'BL');
  assert.equal(PetalV3.merge(top, bottomSameSource), null);
  const half = PetalV3.merge(top, q('C', 'unique', 'BL'));
  assert.equal(PetalV3.merge(half, half), null);
  assert.equal(PetalV3.merge(half, PetalV3.preview('H_TC')), null);
  assert.equal(PetalV3.cut(PetalV3.preview('H_TC'), 'horizontal'), null);
  assert.equal(PetalV3.preview('bad'), null);
  assert.equal(PetalV3.isFinished(PetalV3.preview('F_TC_TC'), ['F_TC_TC']), false);
  assert.equal(PetalV3.isFinished({ ...half, stage: 'finished' }, ['F_TC_TC']), false);
  assert.equal(PetalV3.merge(q('T', 'facing-1', 'TL'), PetalV3.rotate(q('C', 'facing-2', 'BL'))), null);
  assert.equal(PetalV3.rotate({ ...half }), null);
  assert.equal(PetalV3.rotate(PetalV3.raw('T', 'turn', 270)).orientation, 0);
  assert.equal(PetalV3.rotate(PetalV3.rotate(PetalV3.rotate(PetalV3.rotate(half)))).orientation, 0);
}

console.log('ALL_PETAL_V3_PASS');
