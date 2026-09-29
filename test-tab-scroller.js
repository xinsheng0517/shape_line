'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert.match(html, /id="tabs-viewport"[^>]*>\s*<div id="tabs"/, 'tabs need a dedicated scroll viewport');
assert.match(html, /#tabs\s*\{[^}]*overflow-x:auto;[^}]*touch-action:pan-x/s, 'touch uses native horizontal scrolling');
assert.match(html, /#tabs-viewport\.can-right::after/, 'hidden tabs have a right-edge cue');
assert.doesNotMatch(html, /#topbar\.c4-mode #tabs(?:,|\s*\{)/, 'small C4 screens must keep the tab bar visible');
assert.match(html, /@media \(max-width:1440px\)\s*\{\s*#topbar\.has-tabs/, 'crowded widths give tabs their own topbar row');

function makeElement() {
  const classes = new Set();
  const listeners = new Map();
  return {
    scrollWidth: 340, clientWidth: 120, scrollLeft: 0,
    classList: {
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
    },
    addEventListener(type, listener) { (listeners.get(type) || listeners.set(type, []).get(type)).push(listener); },
    dispatch(type, event = {}) { for (const listener of listeners.get(type) || []) listener(event); },
    getBoundingClientRect() { return { left: 0, right: this.clientWidth }; },
    querySelector() { return this.active || null; },
    setPointerCapture(id) { this.captured = id; },
    releasePointerCapture(id) { this.released = id; },
    hasPointerCapture(id) { return this.captured === id && this.released !== id; },
  };
}
const tabs = makeElement(), viewport = makeElement(), win = makeElement();
const timers = [];
const context = vm.createContext({
  console, window: win, tabs, viewport,
  setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/input.js'), 'utf8'), context);
vm.runInContext('TabScroller.init(tabs, viewport);', context);
assert(viewport.classList.contains('scrollable'));
assert(viewport.classList.contains('can-right'));
assert(!viewport.classList.contains('can-left'));

const mouse = (type, x) => ({ pointerType: 'mouse', button: 0, pointerId: 7, clientX: x,
  prevented: false, preventDefault() { this.prevented = true; } });
tabs.dispatch('pointerdown', mouse('pointerdown', 100));
const move = mouse('pointermove', 70);
tabs.dispatch('pointermove', move);
assert.strictEqual(tabs.scrollLeft, 30, 'mouse drag moves only the tab strip');
assert(move.prevented && tabs.classList.contains('dragging'));
assert(viewport.classList.contains('can-left') && viewport.classList.contains('can-right'));
tabs.dispatch('pointerup', mouse('pointerup', 70));
assert(!tabs.classList.contains('dragging'));
const dragClick = { prevented: false, stopped: false,
  preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
tabs.dispatch('click', dragClick);
assert(dragClick.prevented && dragClick.stopped, 'releasing a drag must not select a level');
for (const timer of timers.splice(0)) timer();
const ordinaryClick = { prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
tabs.dispatch('click', ordinaryClick);
assert(!ordinaryClick.prevented, 'ordinary level clicks still work');

const touch = { pointerType: 'touch', button: 0, pointerId: 8, clientX: 90,
  prevented: false, preventDefault() { this.prevented = true; } };
tabs.dispatch('pointerdown', touch);
tabs.dispatch('pointermove', touch);
assert(!touch.prevented, 'touch gestures remain available for native smooth scrolling');
tabs.scrollLeft = 220; tabs.dispatch('scroll');
assert(viewport.classList.contains('can-left') && !viewport.classList.contains('can-right'));

tabs.clientWidth = 400; win.dispatch('resize');
assert(!viewport.classList.contains('scrollable'), 'overflow mode turns off after expansion');
assert.strictEqual(tabs.scrollLeft, 0);
tabs.clientWidth = 120; win.dispatch('resize');
assert(viewport.classList.contains('scrollable'), 'overflow mode returns after shrinking');

tabs.active = { getBoundingClientRect() { return { left: 180, right: 210 }; } };
vm.runInContext('TabScroller.revealActive();', context);
assert(tabs.scrollLeft >= 90, 'selected tabs are brought into the visible strip');
console.log('TAB_SCROLLER_TESTS_PASS');
