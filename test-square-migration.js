const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const files = ['levels.js', 'challenges.js', 'core.js'];
const context = { console, window: { addEventListener() {} }, localStorage: { getItem() { return null; } },
  UI: {}, performance, setTimeout() {} };
vm.createContext(context);
vm.runInContext(files.map(f => fs.readFileSync(path.join(__dirname, 'js', f), 'utf8')).join('\n') + `
const all = [
  ...LEVELS.flatMap(level => [...level.resources.map(r => r.type), ...level.target]),
  ...FREE.resources.map(r => r.type),
  ...FREE_TARGETS.flatMap(t => t.shape),
  ...CHALLENGES.flatMap(level => [...level.resources.map(r => r.type), ...level.target]),
];
globalThis.shapeIds = all.filter(Boolean);
globalThis.colors = SHAPE_COLOR;
globalThis.names = SHAPE_NAME;
`, context);
assert(!context.shapeIds.includes('R'), 'square material ID must be removed from all current game data');
assert(context.shapeIds.includes('T'), 'trapezoid material must exist in current game data');
assert(context.colors.T && context.names.T === '梯形', 'trapezoid has a stable color and name');
console.log('ALL_SQUARE_MIGRATION_PASS');
