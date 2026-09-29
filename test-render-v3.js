const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'js', 'render.js'), 'utf8');
const calls = [];
const ctx = new Proxy({}, { get(_target, name) {
  if (name === 'canvas') return { width: 32, height: 32 };
  if (name === 'createLinearGradient') return (...args) => { calls.push([name, ...args]); return { addColorStop() {} }; };
  return (...args) => { calls.push([name, ...args]); };
}, set() { return true; } });
const context = { console, Math, TILE: 32, MOVE_EVERY: 2, GRID_W: 12, GRID_H: 12,
  DIRV: [[0,-1],[1,0],[0,1],[-1,0]],
  G: { tickCount: 0, v2: null, v3: null },
  document: { createElement() { return { width: 32, height: 32, getContext() { return ctx; } }; } },
  SHAPE_COLOR: { T: '#58a6ff', R: '#58a6ff', C: '#ffbb66', S: '#cc88ff' } };
vm.createContext(context);
vm.runInContext(src + `
Render.u = 1;
Render.dpr = 1;
Render._anims = new Map();
Render._base = () => ({});
Render.chevron = () => { beltMarks++; };
let beltMarks = 0;
globalThis.RenderForTest = Render;
globalThis.drawShape = (ctx, shape) => Render.shapeIcon(ctx, shape, 0, 0, 10);
globalThis.paintBeltBase = () => { beltMarks = 0; Render._paintBase({type:'belt',x:5,y:6,dir:0}); return beltMarks; };
globalThis.drawBelt = (ctx, dir, tick, now, lowFx) => {
  beltMarks = 0; G.tickCount = tick; Render.lowFx = lowFx;
  Render.machine(ctx, {type:'belt',x:5,y:6,dir}, 0, now);
  return beltMarks;
};
`, context);

context.drawShape(ctx, ['T', 'T', 'T', 'T']);
assert.equal(calls.filter(c => c[0] === 'fill').length, 4, 'full trapezoid has four drawable petals');
assert(!calls.some(c => c[0] === 'rect'), 'trapezoid petals are not squares');
assert(calls.some(c => c[0] === 'lineTo' && c[1] === 6 && c[2] === -10), 'top half uses narrow trapezoid edge');
assert(calls.some(c => c[0] === 'lineTo' && c[1] === 8 && c[2] === 0), 'horizontal cut uses the shape height midpoint');
calls.length = 0;
context.drawShape(ctx, ['R', 'R', 'R', 'R']);
assert(!calls.some(c => c[0] === 'rect'), 'old square shape ID must render as trapezoid during migration');

calls.length = 0;
context.drawShape(ctx, { kind: 'petal-v3', stage: 'quarter', orientation: 0,
  units: [{ resource: 'T', slot: 'TL' }] });
assert.equal(calls.filter(c => c[0] === 'fill').length, 1, 'one petal draws once');
assert(calls.some(c => c[0] === 'lineTo' && c[1] === -6 && c[2] === -10), 'petal retains trapezoid top corner');
assert(calls.some(c => c[0] === 'lineTo' && c[1] === -8 && c[2] === 0), 'petal uses horizontal midline');
calls.length = 0;
context.drawShape(ctx, { kind: 'petal-v3', stage: 'quarter', orientation: 0,
  units: [{ resource: 'C', slot: 'BR' }] });
assert(calls.some(c => c[0] === 'arc'), 'circle petal retains curved edge');
calls.length = 0;
context.drawShape(ctx, { kind: 'petal-v3', stage: 'quarter', orientation: 0,
  units: [{ resource: 'S', slot: 'TR' }] });
assert(calls.some(c => c[0] === 'lineTo'), 'star petal retains point geometry');

calls.length = 0;
assert.equal(context.paintBeltBase(), 0, 'belt base has no static direction symbol');
for (const dir of [0,1,2,3]) {
  calls.length = 0;
  assert.equal(context.drawBelt(ctx, dir, 0, 1000, true), 0, 'animated belt has no chevrons');
  assert(calls.some(c => c[0] === 'translate' && c[1] === 160 && c[2] === 192),
    'animation anchors to its own grid cell, even away from origin');
  assert(calls.some(c => c[0] === 'rotate' && c[1] === (dir-1)*Math.PI/2),
    'animation rotates with actual transport direction');
  const atStart = calls.filter(c => c[0] === 'moveTo').map(c => c.slice(1));
  assert(atStart.length >= 2, 'moving stripes remain visible in low-FX mode');
  calls.length = 0;
  context.drawBelt(ctx, dir, 0, 1040, true);
  const later = calls.filter(c => c[0] === 'moveTo').map(c => c.slice(1));
  assert.notDeepStrictEqual(later, atStart, 'stripe positions advance smoothly even before C4 starts feeding');
}
for (const dir of [0,1,2,3]) {
  const icons=[];
  const d=context.DIRV[dir], r=context.DIRV[(dir+1)%4];
  const cut={type:'cutter',x:5,y:6,dir,
    outA:{shape:{stage:'vertical-half'},fx:5,fy:6,moveTick:0},
    outB:{shape:{stage:'vertical-half'},fx:5,fy:6,moveTick:0}};
  context.G.v3={}; context.G.tickCount=2;
  context.G.grid=Array.from({length:12},()=>Array(12).fill(null));
  context.G.grid[6][5]=cut;
  context.drawCutterOutputs=(canvas)=>{
    const original=context.RenderForTest.shapeIcon;
    context.RenderForTest.shapeIcon=(_g,_shape,x,y,size)=>icons.push([x,y,size]);
    context.RenderForTest.items(canvas,0);
    context.RenderForTest.shapeIcon=original;
  };
  context.drawCutterOutputs(ctx);
  assert.deepEqual(icons.map(icon=>icon.slice(0,2)),[
    [5*32+16+d[0]*9,6*32+16+d[1]*9],
    [5*32+16+r[0]*9,6*32+16+r[1]*9]
  ],'two cut products visibly rest in separate outlet trays away from the blade');
  assert(icons.every(icon=>icon[2]<=7),'exit products fit in their trays at normal scale');
}
calls.length=0;
context.G.hover={x:5,y:6};
context.G.grid[6][5].status='前出口未连接，产物待取；侧出口未连接，产物待取';
context.RenderForTest.shapeIcon=()=>{};
context.RenderForTest.v2Hover(ctx);
const hoverTexts=calls.filter(call=>call[0]==='fillText').map(call=>call[1]);
assert(hoverTexts.some(line=>line.includes('前出口:半块') && line.includes('侧出口:半块')),
  'hover identifies both halves in their outlet trays');
assert(hoverTexts.some(line=>line.includes('前出口未连接')),
  'hover explains why products are waiting');
console.log('ALL_RENDER_V3_PASS');
