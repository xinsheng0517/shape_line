'use strict';

// Physical-identity facade. Geometry, material registration and combination rules
// belong to SynthesisEngine; previews deliberately never enter the trust set.
const PetalV3 = (() => {
  const Engine = typeof module !== 'undefined' && module.exports
    ? require('./synthesis-engine.js') : SynthesisEngine;
  const config = typeof module !== 'undefined' && module.exports
    ? require('./synthesis-config.js') : SynthesisConfig;
  const engine = Engine.create(config);
  const KIND = 'petal-v3';
  const SHAPES = Object.freeze(['T', 'C', 'S']);
  const GEOMETRY = Object.freeze(Object.fromEntries(SHAPES.map(shape => [shape,
    Object.freeze({ vertical: .5, horizontal: .5, equalAreaRequired: false })])));
  const SLOTS = Object.freeze(['TL', 'BL', 'TR', 'BR']);
  const CLOCKWISE = Object.freeze({ TL: 'TR', TR: 'BR', BR: 'BL', BL: 'TL' });
  const known = new WeakSet();
  function worldSlot(slot, orientation) {
    for (let turns = ((orientation % 360) + 360) % 360 / 90; turns > 0; turns--) slot = CLOCKWISE[slot];
    return slot;
  }
  function layout(units, orientation = 0) {
    const layers = Array.from({ length: Math.max(...units.map(u => u.layer || 0)) + 1 }, () => ({}));
    for (const unit of units) layers[unit.layer || 0][worldSlot(unit.quadrant || unit.slot, orientation)] = unit.shapeKind;
    return Object.freeze(layers.map(layer => Object.freeze(layer)));
  }
  function regionFor(units) {
    const slots = units.map(unit => unit.quadrant);
    return Object.freeze({
      x0: slots.some(slot => slot[1] === 'L') ? 0 : .5,
      x1: slots.some(slot => slot[1] === 'R') ? 1 : .5,
      y0: slots.some(slot => slot[0] === 'T') ? 0 : .5,
      y1: slots.some(slot => slot[0] === 'B') ? 1 : .5
    });
  }
  function classify(units, stage) {
    const slots = new Set(units.map(unit => unit.quadrant));
    const side = [...slots].every(slot => slot[1] === 'L') ? 'L'
      : [...slots].every(slot => slot[1] === 'R') ? 'R' : null;
    const quadrant = slots.size === 1 ? [...slots][0] : null;
    const singleLayer = units.every(unit => (unit.layer || 0) === 0);
    if (!stage) stage = singleLayer && units.length === 4 && slots.size === 4 ? 'finished'
      : singleLayer && units.length === 2 && side ? 'mixed-half' : 'composite';
    let recipeId = null;
    if (singleLayer && units.every(unit => SHAPES.includes(unit.shapeKind))) {
      const at = slot => units.find(unit => unit.quadrant === slot)?.shapeKind;
      if (stage === 'finished') recipeId = `F_${at('TL')}${at('BL')}_${at('TR')}${at('BR')}`;
      else if (stage === 'mixed-half') recipeId = `H_${at(`T${side}`)}${at(`B${side}`)}`;
    }
    return { stage, side, quadrant, recipeId };
  }
  function make(units, orientation, itemId, { stage, trusted = true, ruleId = null } = {}) {
    const frozenUnits = Object.freeze(units.map(unit => Object.freeze({
      ...unit, layer: unit.layer || 0, resource: unit.shapeKind, slot: unit.quadrant
    })).sort((a, b) => a.layer - b.layer || SLOTS.indexOf(a.quadrant) - SLOTS.indexOf(b.quadrant)));
    const kinds = new Set(frozenUnits.map(unit => unit.shapeKind));
    const sources = new Set(frozenUnits.map(unit => unit.sourceId));
    const tags = classify(frozenUnits, stage);
    const result = Object.freeze({
      kind: KIND, ruleset: KIND, ...tags,
      shapeKind: kinds.size === 1 ? frozenUnits[0].shapeKind : null,
      sourceId: sources.size === 1 ? frozenUnits[0].sourceId : null,
      units: frozenUnits, unitIds: Object.freeze(frozenUnits.map(unit => unit.id)),
      orientation, region: regionFor(frozenUnits), itemId, ruleId,
      layers: layout(frozenUnits), key: engine.signature({ units: frozenUnits, orientation })
    });
    if (trusted) known.add(result);
    return result;
  }
  function validItem(item) {
    return Boolean(item && typeof item === 'object' && known.has(item));
  }
  function raw(shapeKind, id, orientation = 0) {
    if (!engine.getMaterial(shapeKind) || (typeof id !== 'string' && typeof id !== 'number') ||
        ![0, 90, 180, 270].includes(orientation)) return null;
    const sourceId = String(id);
    if (!sourceId) return null;
    return make(SLOTS.map(quadrant => ({
      id: `${sourceId}:${quadrant}`, sourceId, shapeKind, quadrant, cutStage: 0, layer: 0
    })), orientation, sourceId, { stage: 'raw' });
  }
  function cut(item, mode = 'auto') {
    if (!validItem(item) || !['auto', 'vertical', 'horizontal'].includes(mode)) return null;
    const columns = new Set(item.units.map(unit => unit.quadrant[1]));
    const rows = new Set(item.units.map(unit => unit.quadrant[0]));
    if (mode === 'auto') mode = columns.size === 2 ? 'vertical' : rows.size === 2 ? 'horizontal' : null;
    if (mode === 'vertical' ? columns.size !== 2 : mode === 'horizontal' ? rows.size !== 2 : true) return null;
    const vertical = mode === 'vertical';
    return (vertical ? ['L', 'R'] : ['T', 'B']).map(part => {
      const units = item.units.filter(unit => unit.quadrant[vertical ? 1 : 0] === part)
        .map(unit => ({ ...unit, cutStage: (unit.cutStage || 0) + 1 }));
      const slots = new Set(units.map(unit => unit.quadrant));
      const singleLayer = units.every(unit => unit.layer === 0);
      const stage = singleLayer && units.length === 1 ? 'quarter'
        : singleLayer && units.length === 2 && slots.size === 2
          ? vertical ? 'vertical-half' : 'horizontal-half' : 'composite';
      return make(units, item.orientation, `${item.itemId}:${vertical ? 'V' : 'H'}:${part}`, { stage });
    });
  }
  function mergeMany(items, options = {}) {
    if (!Array.isArray(items) || items.length < 1 || !items.every(validItem)) return null;
    const mode = options.mode === 'half' || options.mode === 'final' ? 'join' : options.mode;
    const result = engine.combine(items, { ...options, ...(mode ? { mode } : {}) });
    if (!result.ok) return null;
    return make(result.units, 0, items.map(item => item.itemId).join('+'), { ruleId: result.ruleId || null });
  }
  function merge(a, b, options) { return mergeMany([a, b], options); }
  function rotate(item) {
    return validItem(item) ? make(item.units, (item.orientation + 90) % 360, item.itemId,
      { stage: item.stage, ruleId: item.ruleId }) : null;
  }
  function preview(recipeId) {
    if (typeof recipeId !== 'string') return null;
    const half = /^H_([TCS])([TCS])$/.exec(recipeId);
    const final = /^F_([TCS])([TCS])_([TCS])([TCS])$/.exec(recipeId);
    if (!half && !final) return null;
    const materials = (half || final).slice(1);
    const slots = half ? SLOTS.slice(0, 2) : SLOTS;
    return make(slots.map((quadrant, i) => ({
      id: `preview:${recipeId}:${quadrant}`, sourceId: `preview:${recipeId}:${quadrant}`,
      shapeKind: materials[i], quadrant, layer: 0, cutStage: 2
    })), 0, `preview:${recipeId}`, { stage: half ? 'mixed-half' : 'finished', trusted: false });
  }
  function targetStructure(target) {
    return typeof target === 'string' ? preview(target) : target;
  }
  function describe(item) {
    if (!item || !Array.isArray(item.units) || !item.units.length) return null;
    const key = engine.signature(item);
    return key ? Object.freeze({ key, layers: layout(item.units, item.orientation || 0) }) : null;
  }
  function matches(item, target) {
    const structure = targetStructure(target);
    return Boolean(validItem(item) && structure && engine.matches(item, structure));
  }
  function isFinished(item, recipeIds = []) {
    const targets = Array.isArray(recipeIds) ? recipeIds : [recipeIds];
    return validItem(item) && targets.some(target => matches(item, target));
  }
  function derive(target, options) { return engine.derive(targetStructure(target), options); }
  function registerMaterial(id, descriptor) { return engine.registerMaterial(id, descriptor); }
  function registerRule(definition) { return engine.registerRule(definition); }
  return Object.freeze({ raw, cut, merge, mergeMany, rotate, preview, isFinished, validItem,
    engine, describe, matches, registerMaterial, registerRule, derive, SHAPES, GEOMETRY });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PetalV3;
