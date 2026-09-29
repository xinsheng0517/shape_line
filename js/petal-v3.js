'use strict';

// Pure, trusted rules for the four-petal challenge ruleset. A quarter denotes
// one of four positions, not necessarily one quarter of the outline's area.
const PetalV3 = (() => {
  const KIND = 'petal-v3';
  const SHAPES = Object.freeze(['T', 'C', 'S']);
  const GEOMETRY = Object.freeze(Object.fromEntries(SHAPES.map(shape => [shape,
    Object.freeze({ vertical: 0.5, horizontal: 0.5, equalAreaRequired: false })])));
  const ORDER = Object.freeze(['TC', 'CT', 'TS', 'ST', 'CS', 'SC']);
  const HALF_RECIPES = Object.freeze(Object.fromEntries(ORDER.map(pair => [
    `H_${pair}`, Object.freeze({ top: pair[0], bottom: pair[1] })
  ])));
  const FINAL_RECIPES = Object.freeze(Object.fromEntries(ORDER.flatMap(left =>
    ORDER.map(right => [`F_${left}_${right}`, Object.freeze({ left: `H_${left}`, right: `H_${right}` })]))));
  const SLOT_ORDER = Object.freeze(['TL', 'BL', 'TR', 'BR']);
  const known = new WeakSet();

  function make(stage, units, orientation, recipeId, region, itemId, side = null, quadrant = null, trusted = true) {
    const frozenUnits = Object.freeze(units.map(unit => Object.freeze({
      ...unit, resource: unit.shapeKind, slot: unit.quadrant
    })));
    const kinds = new Set(frozenUnits.map(unit => unit.shapeKind));
    const sources = new Set(frozenUnits.map(unit => unit.sourceId));
    const result = Object.freeze({
      kind: KIND, ruleset: KIND, stage,
      shapeKind: kinds.size === 1 ? frozenUnits[0].shapeKind : null,
      sourceId: sources.size === 1 ? frozenUnits[0].sourceId : null,
      units: frozenUnits,
      unitIds: Object.freeze(frozenUnits.map(unit => unit.id)),
      orientation, recipeId, side, quadrant,
      region: Object.freeze({ ...region }), itemId
    });
    if (trusted) known.add(result);
    return result;
  }
  function valid(item, stage) {
    const count = { raw: 4, 'vertical-half': 2, quarter: 1, 'mixed-half': 2, finished: 4 };
    return Boolean(item && typeof item === 'object' && known.has(item) &&
      item.stage === stage && item.kind === KIND && item.units.length === count[stage] &&
      new Set(item.unitIds).size === item.unitIds.length);
  }
  function separate(a, b) {
    if (!a || !b || !Array.isArray(a.units) || !Array.isArray(b.units)) return false;
    if (a.orientation !== b.orientation) return false;
    const units = [...a.units, ...b.units];
    if (new Set(units.map(unit => unit.id)).size !== units.length) return false;
    // A source ID names one physical original; it cannot change its base shape.
    const bySource = new Map();
    for (const unit of units) {
      if (bySource.has(unit.sourceId) && bySource.get(unit.sourceId) !== unit.shapeKind) return false;
      bySource.set(unit.sourceId, unit.shapeKind);
    }
    return true;
  }
  function raw(shapeKind, id, orientation = 0) {
    if (!SHAPES.includes(shapeKind) || (typeof id !== 'string' && typeof id !== 'number') ||
        ![0, 90, 180, 270].includes(orientation)) return null;
    const sourceId = String(id);
    if (!sourceId) return null;
    return make('raw', SLOT_ORDER.map(quadrant => ({
      id: `${sourceId}:${quadrant}`, sourceId, shapeKind, quadrant, cutStage: 0
    })), orientation, null, { x0: 0, x1: 1, y0: 0, y1: 1 }, sourceId);
  }
  function cut(item, mode = 'auto') {
    if (!['auto', 'vertical', 'horizontal'].includes(mode)) return null;
    if (valid(item, 'raw') && mode !== 'horizontal') {
      return ['L', 'R'].map(side => {
        const units = item.units.filter(unit => unit.quadrant[1] === side)
          .map(unit => ({ ...unit, cutStage: 1 }));
        const region = side === 'L'
          ? { x0: 0, x1: 0.5, y0: 0, y1: 1 }
          : { x0: 0.5, x1: 1, y0: 0, y1: 1 };
        return make('vertical-half', units, item.orientation, null, region,
          `${item.itemId}:V:${side}`, side);
      });
    }
    if (valid(item, 'vertical-half') && mode !== 'vertical') {
      return item.units.map(unit => {
        const upper = unit.quadrant[0] === 'T';
        const region = {
          x0: item.region.x0, x1: item.region.x1,
          y0: upper ? 0 : 0.5, y1: upper ? 0.5 : 1
        };
        return make('quarter', [{ ...unit, cutStage: 2 }], item.orientation, null,
          region, `${item.itemId}:H:${unit.quadrant}`, item.side, unit.quadrant);
      });
    }
    return null;
  }
  function merge(a, b) {
    const quarters = valid(a, 'quarter') && valid(b, 'quarter');
    const halves = valid(a, 'mixed-half') && valid(b, 'mixed-half');
    if ((!quarters && !halves) || !separate(a, b)) return null;
    if (quarters) {
      if (a.side !== b.side || a.quadrant[0] === b.quadrant[0]) return null;
      const [top, bottom] = a.quadrant[0] === 'T' ? [a, b] : [b, a];
      const recipeId = `H_${top.shapeKind}${bottom.shapeKind}`;
      if (!Object.hasOwn(HALF_RECIPES, recipeId)) return null;
      const region = a.side === 'L'
        ? { x0: 0, x1: 0.5, y0: 0, y1: 1 }
        : { x0: 0.5, x1: 1, y0: 0, y1: 1 };
      return make('mixed-half', [...top.units, ...bottom.units], a.orientation,
        recipeId, region, `${top.itemId}+${bottom.itemId}`, a.side);
    }
    if (halves) {
      if (a.side === b.side) return null;
      const [left, right] = a.side === 'L' ? [a, b] : [b, a];
      const recipeId = `F_${left.recipeId.slice(2)}_${right.recipeId.slice(2)}`;
      if (!Object.hasOwn(FINAL_RECIPES, recipeId)) return null;
      return make('finished', [...left.units, ...right.units], a.orientation,
        recipeId, { x0: 0, x1: 1, y0: 0, y1: 1 }, `${left.itemId}+${right.itemId}`);
    }
    return null;
  }
  function rotate(item) {
    if (!item || !known.has(item)) return null;
    return make(item.stage, item.units, (item.orientation + 90) % 360,
      item.recipeId, item.region, item.itemId, item.side, item.quadrant);
  }
  function preview(recipeId) {
    const half = HALF_RECIPES[recipeId];
    const final = FINAL_RECIPES[recipeId];
    if (!half && !final) return null;
    const pairs = half ? [[half, 'L']] : [
      [HALF_RECIPES[final.left], 'L'], [HALF_RECIPES[final.right], 'R']
    ];
    const units = pairs.flatMap(([pair, side]) => ['T', 'B'].map((row, i) => ({
      id: `preview:${recipeId}:${row}${side}`, sourceId: 'preview',
      shapeKind: i === 0 ? pair.top : pair.bottom,
      quadrant: `${row}${side}`, cutStage: 2
    })));
    return make(half ? 'mixed-half' : 'finished', units, 0, recipeId,
      half ? { x0: 0, x1: 0.5, y0: 0, y1: 1 } : { x0: 0, x1: 1, y0: 0, y1: 1 },
      `preview:${recipeId}`, half ? 'L' : null, null, false);
  }
  function isFinished(item, recipeIds = []) {
    const allowed = typeof recipeIds === 'string' ? [recipeIds] : recipeIds;
    return Boolean(valid(item, 'finished') && item.orientation === 0 &&
      Array.isArray(allowed) && allowed.includes(item.recipeId) &&
      Object.hasOwn(FINAL_RECIPES, item.recipeId) &&
      item.units.every((unit, i) => unit.quadrant === SLOT_ORDER[i] && unit.cutStage === 2));
  }
  return Object.freeze({ raw, cut, merge, rotate, preview, isFinished,
    SHAPES, GEOMETRY, HALF_RECIPES, FINAL_RECIPES });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PetalV3;
