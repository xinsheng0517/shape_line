'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    style: {}, textContent: '',
    querySelector(selector) { return element(id + '-' + selector); },
  });
  return elements.get(id);
}
const context = vm.createContext({
  console, Math, Date, JSON, Map, Set, Infinity,
  performance: { now: () => 0 },
  window: { addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {} },
  setTimeout(fn) { fn(); }, clearTimeout() {},
  document: { getElementById: element },
  Render: { drawPreview() {}, resize() {} },
});
for (const file of ['synthesis-engine.js', 'synthesis-config.js', 'levels.js', 'blueprint.js', 'challenges.js', 'core.js', 'sim.js', 'input.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'js', file), 'utf8'), context, { filename: file });
}
vm.runInContext(`
  UI.els = { modal: ge('modal'), winStars: ge('win-stars'), winInfo: ge('win-info'), btnNext: ge('btn-next') };
  UI.refreshLevel = UI.refreshBudget = UI.refreshToolbar = UI.syncPause = UI.refreshLevels = UI.toast = UI.renderAchievements = () => {};
`, context);
const run = code => vm.runInContext(code, context);
const beltBlueprint = "{ name: '测试蓝图', ruleset: 'classic-v1', w: 1, h: 1, cells: [{ dx: 0, dy: 0, type: 'belt', dir: 1 }] }";

run('loadLevel(5); UI.refreshTargetCond();');
assert.match(element('target-cond').textContent, /3★.*蓝图/, 'L6 explains its three-star requirement');
assert.match(run('LEVELS[5].hint'), /蓝图/, 'L6 hint teaches blueprint use');
run(`G.paste = ${beltBlueprint};`);
assert.strictEqual(run('G.blueprintUsed'), false, 'selecting a blueprint does not count as using it');
run('Input.pasteAt(19, 8);'); // Hub is occupied.
assert.strictEqual(run('G.blueprintUsed'), false, 'failed paste does not count');
run('G.delivered = 1; winLevel();');
assert.strictEqual(element('win-stars').textContent, '★★☆', 'manual completion earns at most two stars');

run('loadLevel(5);');
run(`G.paste = ${beltBlueprint}; Input.pasteAt(10, 10);`);
assert.strictEqual(run('G.blueprintUsed'), true, 'successful blueprint placement counts');
assert.strictEqual(run("G.grid[10][10].type"), 'belt');
run('G.used.belt = 30; G.delivered = 1; winLevel();');
assert.strictEqual(element('win-stars').textContent, '★★★', 'one successful paste earns three stars regardless of device count');
assert.match(element('win-info').textContent, /3★.*蓝图/, 'result explains the L6 rule');

run('loadLevel(5);');
assert.strictEqual(run('G.blueprintUsed'), false, 'restarting L6 resets blueprint use');
run('G.used.belt = 28; G.delivered = 1; winLevel();');
assert.strictEqual(element('win-stars').textContent, '★☆☆', 'the old two-star device threshold remains');

run('loadLevel(4); G.delivered = 1; winLevel();');
assert.strictEqual(element('win-stars').textContent, '★★★', 'other tutorial levels keep their device-count rule');
console.log('L6_BLUEPRINT_STARS_TESTS_PASS');
