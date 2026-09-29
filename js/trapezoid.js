'use strict';

// Trapezoid materials are separate from the four-quadrant legacy shape model.
const Trapezoid = (() => {
  const COLORS = Object.freeze({ A: '#4DA3FF', B: '#F2AA4C', C: '#B58AE8', D: '#55C7AB' });
  const NAMES = Object.freeze({ A: '蓝晶', B: '铜矿', C: '紫晶', D: '青玉' });
  const PAIRS = Object.freeze({ AB: ['A', 'A', 'B', 'B'], AC: ['A', 'A', 'C', 'C'], CD: ['C', 'C', 'D', 'D'] });
  const HALF_RECIPES = Object.freeze({ AB: 'H_AB', AC: 'H_AC', CD: 'H_CD' });
  const FINAL_RECIPES = Object.freeze({ 'H_AB|H_AB': 'F_AB', 'H_AC|H_AC': 'F_AC', 'H_AB|H_CD': 'F_ABCD' });
  const known = new WeakSet();

  function freeze(payload, trusted = true) {
    const units = Object.freeze(payload.units.map(unit => Object.freeze({ ...unit })));
    const result = Object.freeze({ ...payload, units, span: Object.freeze([...payload.span]) });
    if (trusted) known.add(result);
    return result;
  }
  function base(stage, units, orientation, recipeId, span, itemId) {
    return freeze({ kind: 'trapezoid-v2', itemId, stage, units, orientation, recipeId, span });
  }
  function valid(payload, stage) {
    return payload && typeof payload === 'object' && known.has(payload) && payload.kind === 'trapezoid-v2' &&
      payload.stage === stage && Array.isArray(payload.units) &&
      payload.units.length === ({ raw: 4, 'rough-half': 2, quarter: 1, 'mixed-half': 2, finished: 4 })[stage] &&
      new Set(payload.units.map(unit => unit.id)).size === payload.units.length;
  }
  function enabled(list, recipe) { return Array.isArray(list) && list.includes(recipe); }
  function disjoint(a, b) {
    const ids = [...a.units, ...b.units].map(unit => unit.id);
    return new Set(ids).size === ids.length;
  }
  function canonical(a, b) { return [a, b].sort((x, y) => x.units[0].resource.localeCompare(y.units[0].resource)); }

  function raw(pair, id, orientation = 0) {
    if (!Object.hasOwn(PAIRS, pair) || (typeof id !== 'string' && typeof id !== 'number') ||
        ![0, 90, 180, 270].includes(orientation)) return null;
    const sourceId = String(id);
    if (!sourceId) return null;
    return base('raw', PAIRS[pair].map((resource, i) => ({
      id: `${sourceId}:${i}`, resource, sourceId, cutStage: 0
    })), orientation, null, [0, 1], sourceId);
  }
  function rough(payload) {
    if (!valid(payload, 'raw') || payload.orientation !== 0 || payload.recipeId !== null ||
        payload.units.some(unit => unit.cutStage !== 0)) return null;
    return [0, 1].map(i => base('rough-half', payload.units.slice(i * 2, i * 2 + 2).map(unit =>
      ({ ...unit, cutStage: 1 })), 0, null, [i / 2, (i + 1) / 2], `${payload.itemId}:rough:${i}`));
  }
  function fine(payload) {
    if (!valid(payload, 'rough-half') || payload.recipeId !== null ||
        payload.units.some(unit => unit.cutStage !== 1) ||
        payload.units[0].resource !== payload.units[1].resource) return null;
    const start = payload.span[0];
    return payload.units.map((unit, i) => base('quarter', [{ ...unit, cutStage: 2 }],
      payload.orientation, null, [start + i / 4, start + (i + 1) / 4], `${payload.itemId}:fine:${i}`));
  }
  function merge(a, b, allowedHalf = [], allowedFinal = []) {
    if (!a || !b || !Array.isArray(a.units) || !Array.isArray(b.units) || !disjoint(a, b)) return null;
    if (valid(a, 'quarter') && valid(b, 'quarter')) {
      const [first, second] = canonical(a, b);
      const pair = first.units[0].resource + second.units[0].resource;
      const recipeId = HALF_RECIPES[pair];
      if (!recipeId || !enabled(allowedHalf, recipeId) ||
          first.units[0].cutStage !== 2 || second.units[0].cutStage !== 2) return null;
      return base('mixed-half', [first.units[0], second.units[0]], first.orientation,
        recipeId, [0, 1], `${first.itemId}+${second.itemId}`);
    }
    if (valid(a, 'mixed-half') && valid(b, 'mixed-half')) {
      const [first, second] = [a, b].sort((x, y) => x.recipeId.localeCompare(y.recipeId));
      const recipeId = FINAL_RECIPES[`${first.recipeId}|${second.recipeId}`];
      if (!recipeId || !enabled(allowedFinal, recipeId) ||
          [...first.units, ...second.units].some(unit => unit.cutStage !== 2)) return null;
      const units = recipeId === 'F_ABCD'
        ? [...first.units, ...second.units]
        : [first.units[0], first.units[1], second.units[0], second.units[1]];
      return base('finished', units, first.orientation, recipeId, [0, 1], `${first.itemId}+${second.itemId}`);
    }
    return null;
  }
  function rotate(payload) {
    if (!payload || !known.has(payload)) return null;
    return base(payload.stage, payload.units, (payload.orientation + 90) % 360,
      payload.recipeId, payload.span, payload.itemId);
  }
  function preview(recipeId) {
    const resources = ({ H_AB: 'AB', H_AC: 'AC', H_CD: 'CD',
      F_AB: 'ABAB', F_AC: 'ACAC', F_ABCD: 'ABCD' })[recipeId];
    if (!resources) return null;
    return freeze({ kind: 'trapezoid-v2', itemId: `preview:${recipeId}`,
      stage: resources.length === 2 ? 'mixed-half' : 'finished',
      units: [...resources].map((resource, i) => ({ id: `preview:${recipeId}:${i}`, resource,
        sourceId: 'preview', cutStage: 2 })), orientation: 0, recipeId, span: [0, 1] }, false);
  }
  function cutHeight(f) {
    if (typeof f !== 'number' || f < 0 || f > 1) return null;
    return (-0.6 + Math.sqrt(0.36 + 0.64 * f)) / 0.4;
  }
  function massUnits(payload) { return payload && Array.isArray(payload.units) ? payload.units.length : 0; }
  function isFinished(payload, allowedFinal = []) {
    const layers = { F_AB: 'ABAB', F_AC: 'ACAC', F_ABCD: 'ABCD' };
    return Boolean(valid(payload, 'finished') && payload.orientation === 0 &&
      enabled(allowedFinal, payload.recipeId) &&
      layers[payload.recipeId] === payload.units.map(unit => unit.resource).join('') &&
      payload.units.every(unit => unit.cutStage === 2));
  }
  return Object.freeze({ raw, rough, fine, merge, rotate, preview, cutHeight, massUnits, isFinished,
    COLORS, NAMES, HALF_RECIPES, FINAL_RECIPES });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Trapezoid;
