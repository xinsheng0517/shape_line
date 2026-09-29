'use strict';
const assert = require('node:assert/strict');
const Trapezoid = require('./js/trapezoid.js');

function ids(parts) { return parts.flatMap(part => part.units.map(unit => unit.id)).sort(); }
function quarters(pair, id, orientation = 0) {
  const raw = Trapezoid.raw(pair, id, orientation);
  const halves = Trapezoid.rough(raw);
  return { raw, halves, quarters: halves.flatMap(half => Trapezoid.fine(half)) };
}
{
  const { raw, halves, quarters: q } = quarters('AB', 'lot-1');
  assert.equal(raw.kind, 'trapezoid-v2');
  assert.equal(raw.stage, 'raw');
  assert.deepEqual(raw.units.map(u => u.resource), ['A', 'A', 'B', 'B']);
  assert.deepEqual(ids(q), ids([raw]));
  assert.deepEqual(halves.map(h => h.stage), ['rough-half', 'rough-half']);
  assert.deepEqual(q.map(u => u.stage), ['quarter', 'quarter', 'quarter', 'quarter']);
  assert.ok(q.every(u => u.units[0].cutStage === 2));
  const h1 = Trapezoid.merge(q[0], q[2], ['H_AB'], []);
  const h2 = Trapezoid.merge(q[1], q[3], ['H_AB'], []);
  const done = Trapezoid.merge(h2, h1, [], ['F_AB']);
  assert.equal(done.stage, 'finished');
  assert.equal(done.recipeId, 'F_AB');
  assert.equal(Trapezoid.isFinished(done, ['F_AB']), true);
  assert.equal(Trapezoid.isFinished(done, ['F_AC']), false);
  assert.equal(Trapezoid.isFinished(Trapezoid.rotate(done), ['F_AB']), false);
  assert.deepEqual(done.units.map(u => u.resource), ['A', 'B', 'A', 'B']);
  assert.deepEqual(ids([done]), ids([raw]));
  assert.equal(Trapezoid.massUnits(done), 4);
  assert.deepEqual(Trapezoid.rough(raw), halves);
  assert.deepEqual(raw.units.map(u => u.cutStage), [0, 0, 0, 0]);
  assert.ok(Object.isFrozen(raw) && Object.isFrozen(raw.units) && Object.isFrozen(raw.units[0]));
  assert.ok(Object.isFrozen(done));
}

{
  const ac = quarters('AC', 'ac');
  assert.deepEqual(ac.raw.units.map(unit => unit.resource), ['A', 'A', 'C', 'C']);
  const h1 = Trapezoid.merge(ac.quarters[0], ac.quarters[2], ['H_AC'], []);
  const h2 = Trapezoid.merge(ac.quarters[1], ac.quarters[3], ['H_AC'], []);
  const done = Trapezoid.merge(h1, h2, [], ['F_AC']);
  assert.equal(done.recipeId, 'F_AC');
  assert.deepEqual(done.units.map(unit => unit.resource), ['A', 'C', 'A', 'C']);
  assert.deepEqual(ids([done]), ids([ac.raw]));
}

{
  const ab = quarters('AB', 'ab');
  const cd = quarters('CD', 'cd');
  const ab1 = Trapezoid.merge(ab.quarters[0], ab.quarters[2], ['H_AB', 'H_CD'], []);
  const cd1 = Trapezoid.merge(cd.quarters[0], cd.quarters[2], ['H_AB', 'H_CD'], []);
  assert.equal(ab1.recipeId, 'H_AB');
  assert.equal(cd1.recipeId, 'H_CD');
  const done = Trapezoid.merge(cd1, ab1, [], ['F_ABCD']);
  assert.equal(done.recipeId, 'F_ABCD');
  assert.deepEqual(done.units.map(u => u.resource), ['A', 'B', 'C', 'D']);
  assert.deepEqual(ids([done]), ids([ab.quarters[0], ab.quarters[2], cd.quarters[0], cd.quarters[2]]));
}

{
  const ab = quarters('AB', 'invalid');
  const q = ab.quarters;
  assert.equal(Trapezoid.rough(Trapezoid.rotate(ab.raw)), null);
  assert.equal(Trapezoid.rough(ab.halves[0]), null);
  assert.equal(Trapezoid.fine(ab.raw), null);
  assert.equal(Trapezoid.fine(q[0]), null);
  assert.equal(Trapezoid.merge(q[0], q[1], ['H_AB'], []), null);
  assert.equal(Trapezoid.merge({}, q[0], ['H_AB'], []), null);
  assert.equal(Trapezoid.merge(q[0], q[0], ['H_AB'], []), null);
  assert.equal(Trapezoid.merge(q[0], q[2], [], []), null);
  const h1 = Trapezoid.merge(q[0], q[2], ['H_AB'], []);
  const h2 = Trapezoid.merge(q[1], q[3], ['H_AB'], []);
  assert.equal(Trapezoid.merge(h1, h2, [], ['F_ABCD']), null);
  assert.equal(Trapezoid.merge(ab.halves[0], ab.halves[1], ['H_AB'], ['F_AB']), null);
  assert.equal(Trapezoid.merge(ab.raw, h1, ['H_AB'], ['F_AB']), null);
  assert.equal(Trapezoid.merge({ ...q[0], stage: 'rough-half' }, q[2], ['H_AB'], []), null);
  assert.equal(Trapezoid.isFinished({ ...h1, stage: 'finished', recipeId: 'F_AB' }, ['F_AB']), false);
  assert.equal(Trapezoid.merge({ ...q[0], units: [{ ...q[0].units[0], cutStage: 1 }] }, q[2], ['H_AB'], []), null);
  assert.equal(Trapezoid.merge({ ...q[0], units: [{ ...q[0].units[0], id: 'forged' }] }, q[2], ['H_AB'], []), null);
  assert.equal(Trapezoid.merge({ ...q[0], units: [q[2].units[0]] }, q[2], ['H_AB'], []), null);
  const turned = Trapezoid.rotate(Trapezoid.raw('AB', 'turn', 270));
  assert.equal(turned.orientation, 0);
  assert.equal(Trapezoid.rough(turned).length, 2);
  assert.equal(Trapezoid.raw('AB', 'turn', 270).orientation, 270);
  assert.equal(Trapezoid.rotate(Trapezoid.rotate(Trapezoid.rotate(Trapezoid.rotate(ab.raw)))).orientation, 0);
  assert.equal(Trapezoid.preview('F_AB').recipeId, 'F_AB');
  assert.equal(Trapezoid.preview('H_AC').recipeId, 'H_AC');
  assert.equal(Trapezoid.isFinished(Trapezoid.preview('F_AB'), ['F_AB']), false);
  assert.equal(Trapezoid.merge(Trapezoid.preview('H_AB'), h2, [], ['F_AB']), null);
  assert.equal(Trapezoid.preview('bad'), null);
  assert.ok(Math.abs(Trapezoid.cutHeight(0.5) - 0.5615528128) < 1e-8);
  assert.equal(Trapezoid.cutHeight(0), 0);
  assert.equal(Trapezoid.cutHeight(1), 1);
  assert.throws(() => { ab.raw.units[0].resource = 'D'; }, TypeError);
  assert.throws(() => { ab.raw.units.push(q[0].units[0]); }, TypeError);
}

console.log('ALL_TRAPEZOID_PASS');
