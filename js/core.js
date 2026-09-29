'use strict';
/* core.js — 常量、全局状态 G、主循环（固定步长模拟 + rAF 插值渲染）、存档、音效
 * 数据流约定：input.js 只写 G；Sim 只被 tick 调用；Render 只读 G（粒子属表现层状态）。
 */

// ===== 常量 =====
// TILE/GRID_W/GRID_H 为活值（宪法3双豁免）：GRID_W/H 按模式取值（D11）；
// TILE 名义值由 setGridSize 设定（无头环境与兜底用），浏览器中由 Render.resize() 用
// computeTile 按视口动态覆盖（D16）——窗口多大，格子就多大。
let TILE = 32;
let GRID_W = 24, GRID_H = 16;
const MAX_TILE = 56; // 上限，防超大屏格子过粗（4.3）
const MIN_TILE = 1; // 小屏横屏时优先保证整张网格不被裁切
function setGridSize(w, h, tile) {
  GRID_W = w; GRID_H = h; TILE = tile;
  if (typeof Render !== 'undefined' && Render.cv) Render.resize(); // 画布随网格尺寸重设（无头环境无 Render）
}
// 视口驱动 TILE（D16）：可用区域 ÷ 逻辑网格，夹在 [MIN_TILE, MAX_TILE]
function computeTile(availW, availH) {
  const t = Math.min(Math.floor(availW / GRID_W), Math.floor(availH / GRID_H), MAX_TILE);
  return Math.max(MIN_TILE, t);
}
const TICK_MS = 150;      // 固定模拟步长
const MOVE_EVERY = 2;     // 传送带每 2 tick 移动一格
const PROC_TICKS = 2;     // 加工机处理耗时（tick）
const DIRV = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // 0上 1右 2下 3左（R 键 +1 顺时针）

const SHAPE_COLOR = { C: '#f2a93b', T: '#58a6ff', S: '#c586ff' };
const SHAPE_NAME = { C: '圆形', T: '梯形', S: '星形' };

const TOOLS = [
  { id: 'belt',      name: '传送带', key: '1', glyph: '▥' },
  { id: 'extractor', name: '采集器', key: '2', glyph: '⛏' },
  { id: 'cutter',    name: '切割机', key: '3', glyph: '✂' },
  { id: 'rotator',   name: '旋转机', key: '4', glyph: '↻' },
  { id: 'merger',    name: '合并机', key: '5', glyph: '⋈' },
  { id: 'trash',     name: '垃圾桶', key: '6', glyph: '✕' },
  { id: 'bulldoze',  name: '拆除',   key: '7', glyph: '⌫' },
];
const MACHINE_TYPES = ['belt', 'extractor', 'cutter', 'rotator', 'merger', 'trash'];
const MODES = { tutorial: '教程模式', free: '自由模式', challenge: '挑战模式', daily: '每日挑战' };
const SPEEDS = [1, 2, 4]; // 可选模拟速度倍率

// ===== 存档 =====
const SAVE_KEY = 'shape-line-save-v1';
function loadSave() {
  const DEF = { unlocked: 1, stars: {}, sound: true, last: 0, blueprints: {}, challenges: {}, challengeV2: {}, challengeV3: {}, achievements: {}, daily: {} };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s === 'object' && s.unlocked) {
      const saved = Object.assign(DEF, s);
      if (!saved.blueprints || typeof saved.blueprints !== 'object') saved.blueprints = {};
      for (const [id, bp] of Object.entries(saved.blueprints)) {
        if (!bp || bp.ruleset !== 'trapezoid-v2') continue;
        const previewId = id + '-v3-preview';
        if (saved.blueprints[previewId]) continue;
        try {
          const migration = Blueprints.importFile(JSON.stringify(bp));
          if (migration.preview) saved.blueprints[previewId] = {
            ...migration.preview, id: previewId, name: bp.name + '（迁移预览）',
            migrationPending: true,
          };
        } catch (e) { /* 保留无法验证的旧蓝图原件，供用户导出 */ }
      }
      return saved;
    }
  } catch (e) { /* file:// 或隐私模式下可能不可用 */ }
  return DEF;
}
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.save)); } catch (e) { /* 忽略 */ }
}

// ===== 全局状态 =====
const G = {
  v2: null,
  v3: null,
  mode: 'tutorial', // tutorial | free | challenge | daily
  levelIndex: 0,
  grid: [],          // grid[y][x] = cell | null
  target: null,      // 目标形状（四元数组）
  budget: {},        // 剩余预算（Infinity = 不限）
  used: {},          // 当前已放置数量
  tickCount: 0,
  delivered: 0,
  blueprintUsed: false, // 当前教程关是否成功粘贴过蓝图
  won: false,
  paused: false,
  orientationBlocked: false, // 手机竖屏提示期间冻结模拟，不改玩家的暂停状态
  speed: 1,          // 模拟速度倍率 ∈ SPEEDS（主步长 = TICK_MS / speed）
  stats: { log: [] }, // 交付时间戳，30 秒滚动窗口算件/分
  tool: 'belt',
  toolDir: 1,        // 默认朝右
  hover: { x: -1, y: -1 },
  particles: [],
  hubPulse: 0,
  clip: null,        // 剪贴板蓝图（框选复制的结果）
  chalIndex: 0,      // 当前挑战关索引
  chal: null,        // 挑战运行时状态 { elapsed, done }；非挑战模式为 null
  chalDef: null,     // 当前挑战定义（挑战=CHALLENGES[i]，每日=dailyDef()）
  paste: null,       // 粘贴态：正在放置的蓝图（随 R 旋转）
  selMode: false,    // 框选态开关（B 键进入）
  sel: null,         // 框选矩形 { x0, y0, x1, y1 }
  save: loadSave(),
};

function mkCell(type, x, y, dir) {
  return { type, x, y, dir: dir || 0, item: null, inA: null, inB: null, proc: null, outA: null, outB: null, cd: 1 };
}

function demolishCell(x, y) {
  const c = cellAt(x, y);
  if (!c || !MACHINE_TYPES.includes(c.type)) return false;
  if (G.v2 || G.v3) {
    const shapes = [];
    for (const slot of ['item', 'inA', 'inB', 'outA', 'outB'])
      if (c[slot]) shapes.push(c[slot].shape);
    for (const queue of ['queueA', 'queueB'])
      for (const it of c[queue] || []) shapes.push(it.shape);
    if (c.proc) {
      shapes.push(c.proc.shape);
      if (c.proc.shapeB) shapes.push(c.proc.shapeB);
    }
    if (G.v3) {
      shapes.push(...(c.autoHalves || []));
      G.v3.discardedItems = G.v3.discardedItems || [];
      G.v3.discardReasons = G.v3.discardReasons || [];
      G.v3.discardedItems.push(...shapes);
      for (const shape of shapes) G.v3.discardReasons.push({ itemId: shape.itemId, reason: '拆除装置' });
    } else {
      G.v2.discardedItems = G.v2.discardedItems || [];
      G.v2.discardedItems.push(...shapes);
    }
  }
  for (const state of [G.v2, G.v3])
    if (state && state.selected && state.selected.x === x && state.selected.y === y) state.selected = null;
  G.grid[y][x] = null;
  if (G.budget[c.type] !== Infinity) G.budget[c.type]++;
  G.used[c.type]--;
  return true;
}

// ===== 撤销/重做：统一动作栈，一切网格变更经 tryPlace/removeAt 写入 =====
// 动作组：[{ type:'place'|'remove', x, y, mtype, dir }]；一次拖拽/一次粘贴 = 一组
const Undo = {
  stack: [], redo: [], cur: null,
  begin() { if (!this.cur) this.cur = []; }, // 拖拽/粘贴开始时成组
  rec(type, x, y, mtype, dir) {
    const a = { type, x, y, mtype, dir };
    if(G.v2 || G.v3) { const c=cellAt(x,y); if(c&&c.machineMode) a.machineMode=c.machineMode; if(c&&c.locked) a.locked=true; }
    if (this.cur) this.cur.push(a);
    else { this.stack.push([a]); this.trim(); } // 单击 = 单动作组
  },
  end() {
    if (this.cur && this.cur.length) { this.stack.push(this.cur); this.trim(); }
    this.cur = null;
  },
  trim() { if (this.stack.length > 200) this.stack.shift(); this.redo.length = 0; },
  clear() { this.stack.length = 0; this.redo.length = 0; this.cur = null; },
  _remove(a) { // 拆掉一格并退还预算
    demolishCell(a.x, a.y);
  },
  _place(a) { // 放回一格并扣预算
    if (G.grid[a.y][a.x]) return;
    G.grid[a.y][a.x] = mkCell(a.mtype, a.x, a.y, a.dir);
    if(a.machineMode) G.grid[a.y][a.x].machineMode=a.machineMode;
    if(a.locked) G.grid[a.y][a.x].locked=true;
    if (G.budget[a.mtype] !== Infinity) G.budget[a.mtype]--;
    G.used[a.mtype]++;
  },
  undo() {
    const g = this.stack.pop();
    if (!g) return false;
    for (let i = g.length - 1; i >= 0; i--) { // 反向回退
      if (g[i].type === 'place') this._remove(g[i]); else this._place(g[i]);
    }
    this.redo.push(g);
    UI.refreshBudget();
    if (typeof UI.refreshBps === 'function') UI.refreshBps();
    return true;
  },
  redoOp() {
    const g = this.redo.pop();
    if (!g) return false;
    for (const a of g) { if (a.type === 'place') this._place(a); else this._remove(a); }
    this.stack.push(g);
    UI.refreshBudget();
    if (typeof UI.refreshBps === 'function') UI.refreshBps();
    return true;
  },
};
function mkItem(shape, x, y) {
  return { shape: shape.slice(), fx: x, fy: y, moveTick: G.tickCount };
}
function cellAt(x, y) {
  return (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) ? null : G.grid[y][x];
}
function usedTotal() {
  let n = 0;
  for (const k of MACHINE_TYPES) n += G.used[k] || 0;
  return n;
}
// 在途物品数（统计 HUD）：所有机器槽位 + 加工中的物品
function inTransit() {
  const SLOTS = ['item', 'inA', 'inB', 'outA', 'outB'];
  let n = 0;
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
    const c = G.grid[y][x];
    if (!c) continue;
    if (G.v2 || G.v3) { n+=(c.queueA||[]).length+(c.queueB||[]).length; }
    for (const s of SLOTS) if (c[s]) n++;
    if (c.proc) n++;
  }
  return n;
}

// 粒子（表现层，由渲染帧推进）
function burst(gx, gy, color, n) {
  const cx = gx * TILE + TILE / 2, cy = gy * TILE + TILE / 2;
  for (let i = 0; i < (n || 14); i++) {
    if (G.particles.length >= 300) break;
    const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 2.4;
    G.particles.push({
      x: cx, y: cy,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2,
      life: 0.6 + Math.random() * 0.5, color, s: 2 + Math.random() * 2.5,
    });
  }
}

// ===== 关卡装载 =====
function loadLevel(i) {
  G.v2 = null;
  G.v3 = null;
  i = Math.max(0, Math.min(LEVELS.length - 1, i));
  const L = LEVELS[i];
  G.mode = 'tutorial';
  setGridSize(24, 16, 32); // 教程固定小网格
  G.levelIndex = i;
  G.grid = [];
  for (let y = 0; y < GRID_H; y++) G.grid.push(new Array(GRID_W).fill(null));
  for (const r of L.resources) G.grid[r.y][r.x] = { type: 'resource', x: r.x, y: r.y, shapeType: r.type };
  G.grid[L.hub.y][L.hub.x] = mkCell('hub', L.hub.x, L.hub.y, 0);
  G.target = L.target.slice();
  G.budget = {};
  for (const k in L.budget) G.budget[k] = L.budget[k];
  G.used = {};
  for (const k of MACHINE_TYPES) G.used[k] = 0;
  G.tickCount = 0; G.delivered = 0; G.blueprintUsed = false; G.won = false; G.paused = false;
  G.particles.length = 0; G.hubPulse = 0;
  G.tool = 'belt'; G.toolDir = 1; G.hover = { x: -1, y: -1 };
  G.paste = null; G.selMode = false; G.sel = null; // 切关退出粘贴/框选
  Undo.clear(); // 切关清撤销栈
  G.save.last = i; persist();
  UI.refreshLevel(); UI.refreshBudget(); UI.refreshToolbar(); UI.syncPause();
}

// ===== 模式切换：清理一切跨模式残留状态 =====
function setMode(mode) {
  if (mode === G.mode) { // 回到当前局（主菜单 Esc / 再次点击当前模式）
    UI.hideMenu();
    if (!G.won) { G.paused = false; UI.syncPause(); }
    return;
  }
  Undo.clear();
  G.paste = null; G.selMode = false; G.sel = null;
  G.particles.length = 0;
  G.stats.log.length = 0;
  G.chal = null; G.chalDef = null; // 模式切换清挑战态（由目标模式的 loader 重建）
  if (mode === 'free') loadFree(); // challenges.js
  else if (mode === 'challenge') loadChallenge(G.save.lastChal || 0);
  else if (mode === 'daily') loadDaily();
  else loadLevel(Math.min(G.save.last || 0, G.save.unlocked - 1)); // 内含 G.mode 与网格尺寸复位
  UI.hideMenu();
}

// ===== 速度控制 =====
function setSpeed(s) {
  if (SPEEDS.indexOf(s) < 0) return;
  G.speed = s;
  UI.syncSpeed();
}

// ===== 过关 =====
function winLevel() {
  if (G.mode === 'free') { // 自由模式：交付即庆祝并自动换新目标，产线继续跑
    AudioFX.win();
    nextFreeTarget();
    UI.toast('目标达成！已刷新新目标');
    return;
  }
  if (G.mode === 'challenge' || G.mode === 'daily') { // 挑战/每日：交付达标即结算（时间类约束由 challengeTick 结算）
    const C = G.chalDef;
    if (C.need && G.delivered >= C.need) challengeWin();
    return;
  }
  if (G.won) return;
  G.won = true;
  const L = LEVELS[G.levelIndex], total = usedTotal();
  const stars = L.blueprintThreeStar
    ? (G.blueprintUsed ? 3 : total <= L.par[1] ? 2 : 1)
    : (total <= L.par[0] ? 3 : total <= L.par[1] ? 2 : 1);
  const i = G.levelIndex;
  G.save.stars[i] = Math.max(G.save.stars[i] || 0, stars);
  G.save.unlocked = Math.max(G.save.unlocked, Math.min(LEVELS.length, i + 2));
  persist();
  AudioFX.win();
  checkAchievements();
  UI.refreshLevels();
  setTimeout(() => UI.showWin(stars, total), 700);
}

// ===== 音效（Web Audio 振荡器合成，无外部资源） =====
const AudioFX = {
  ctx: null, gain: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0.12;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f, dur, type, delay) {
    if (!G.save.sound || !this.ctx) return;
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.gain);
    o.start(t); o.stop(t + dur);
  },
  place() { this.tone(660, 0.07, 'square'); },
  remove() { this.tone(220, 0.09, 'square'); },
  deny() { this.tone(140, 0.12, 'sawtooth'); },
  deliver() { this.tone(880, 0.08, 'sine'); this.tone(1318, 0.14, 'sine', 0.08); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, 'triangle', i * 0.12)); },
};

// ===== 主循环 =====
let _acc = 0, _last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!_last) _last = now;
  let dt = now - _last;
  _last = now;
  if (dt > 250) dt = 250;
  if (!G.paused && !G.won && !G.orientationBlocked) {
    _acc += dt;
    const step = TICK_MS / G.speed; // 速度倍率：步长缩短 = 模拟加速
    let guard = 0;
    while (_acc >= step && guard++ < 8) { Sim.tick(); _acc -= step; }
    G._alpha = _acc / step;
    if (G.chal && !G.chal.done && (!G.v3 || G.v3.running) &&
        !(G.chalDef && G.chalDef.id === 'C4' && !G.chal.started)) { // 挑战/每日：供料后才计时
      G.chal.elapsed += dt / 1000;
      challengeTick();
    }
  }
  if (G.orientationBlocked) { _acc = 0; G._alpha = 0; }
  Render.draw(G._alpha || 0);
}
window.addEventListener('load', () => {
  Render.init();
  Input.init();
  loadLevel(Math.min(G.save.last || 0, G.save.unlocked - 1));
  UI.showMenu(); // 启动先出主菜单，游戏在后台暂停
  requestAnimationFrame(frame);
});
