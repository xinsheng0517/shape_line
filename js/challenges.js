'use strict';
/* challenges.js — 自由模式配置与目标池（D11）；挑战/每日挑战数据在 D12/D13 加入本文件
 * 目标池原则（宪法）：全部目标必须可由 全形→切半→旋转→合并 得到，且参考解已过 test-headless.js。
 * 形状象限约定：0=右上 1=右下 2=左下 3=左上；'C'圆 'T'梯形 'S'星。
 */

// ===== 自由模式：32×20 大图、格子 24px（画布仍 768 宽）、全机器解锁、不限预算 =====
const FREE = {
  w: 32, h: 20, tile: 24,
  resources: [
    { x: 3, y: 4, type: 'C' },
    { x: 3, y: 10, type: 'T' },
    { x: 3, y: 16, type: 'S' },
  ],
  hub: { x: 28, y: 10 },
};

// ===== 目标池：8 关现有目标 + 12 个新增；par = 自由网格实测参考解设备数（仅作参考展示） =====
const FREE_TARGETS = [
  { shape: ['C', 'C', 'C', 'C'], par: 30 },   // L1 全圆（y=4 含拐弯）
  { shape: ['C', 'C', null, null], par: 28 }, // L2 右半圆
  { shape: [null, 'C', 'C', null], par: 30 }, // L3 下半圆
  { shape: ['C', 'C', 'T', 'T'], par: 61 },   // L4 右圆左方（双拼实测）
  { shape: ['S', 'S', null, null], par: 28 }, // L5 右半星
  { shape: [null, null, 'S', 'S'], par: 32 }, // L6 左半星
  { shape: ['C', 'C', 'S', 'S'], par: 61 },   // L7 右圆左星
  { shape: ['S', 'S', 'T', 'T'], par: 61 },   // L8 右星左方
  { shape: ['T', 'T', 'T', 'T'], par: 24 },   // 全方（y=10 直线实测）
  { shape: ['S', 'S', 'S', 'S'], par: 30 },   // 全星（实测）
  { shape: [null, null, 'C', 'C'], par: 31 }, // 左半圆（实测）
  { shape: ['C', null, null, 'C'], par: 31 }, // 上半圆（实测）
  { shape: [null, 'T', 'T', null], par: 25 }, // 下半方（实测）
  { shape: [null, null, 'T', 'T'], par: 27 }, // 左半方
  { shape: ['T', null, null, 'T'], par: 27 }, // 上半方
  { shape: ['S', null, null, 'S'], par: 32 }, // 上半星
  { shape: [null, 'S', 'S', null], par: 31 }, // 下半星
  { shape: ['T', 'T', 'C', 'C'], par: 61 },   // 右方左圆（实测）
  { shape: ['C', 'S', 'S', 'C'], par: 61 },   // 上圆下星（实测）
  { shape: ['T', 'S', 'S', 'T'], par: 61 },   // 上方下星
];

// 随机换目标（避免与当前重复）；刷新目标预览与标题
function nextFreeTarget() {
  let t;
  do { t = FREE_TARGETS[Math.floor(Math.random() * FREE_TARGETS.length)]; }
  while (G.target && shapeEq(t.shape, G.target));
  G.freePar = t.par;
  G.target = t.shape.slice();
  if (typeof UI !== 'undefined' && UI.els && UI.els.lvlName) UI.refreshLevel();
}

// 装载自由模式：固定资源摆位 + 枢纽 + 无限预算 + 随机目标
function loadFree() {
  G.v2 = null;
  G.v3 = null;
  G.mode = 'free';
  setGridSize(FREE.w, FREE.h, FREE.tile);
  G.grid = [];
  for (let y = 0; y < GRID_H; y++) G.grid.push(new Array(GRID_W).fill(null));
  for (const r of FREE.resources) G.grid[r.y][r.x] = { type: 'resource', x: r.x, y: r.y, shapeType: r.type };
  G.grid[FREE.hub.y][FREE.hub.x] = mkCell('hub', FREE.hub.x, FREE.hub.y, 0);
  G.budget = {};
  for (const k of MACHINE_TYPES) G.budget[k] = Infinity;
  G.used = {};
  for (const k of MACHINE_TYPES) G.used[k] = 0;
  G.tickCount = 0; G.delivered = 0; G.won = false; G.paused = false;
  G.particles.length = 0; G.hubPulse = 0;
  G.tool = 'belt'; G.toolDir = 1; G.hover = { x: -1, y: -1 };
  G.paste = null; G.selMode = false; G.sel = null;
  G.stats.log.length = 0;
  Undo.clear();
  G.target = null; // 让 nextFreeTarget 的查重通过
  nextFreeTarget();
  UI.refreshLevel(); UI.refreshBudget(); UI.refreshToolbar(); UI.syncPause();
}

// 断言自测：目标池形状合法（仅含 C/R/S/null 且非全空）
console.assert(FREE_TARGETS.length === 20, '目标池应为 20 个目标');
console.assert(FREE_TARGETS.every(t => t.shape.length === 4 && t.shape.some(Boolean) && t.shape.every(q => q === null || q === 'C' || q === 'T' || q === 'S')), '目标形状须为合法四象限');
console.assert(FREE.w * FREE.tile === 768, '自由模式画布宽度应保持 768');

// ===== 挑战模式（D12）：六关四类约束；预算复用 V1 budget 机制（宪法8） =====
// 字段：need=交付目标数（C4 无，靠 tickLimit 到时结算）；realTimer=显示真实用时；
//       realLimit=真实秒数硬上限（超时 0 星）；tickLimit=游戏 tick 上限；betterIsLower=最佳成绩比较方向
// stars(G) 返回 0-3：0 = 完成但未入星 / 未达标
const CHALLENGES = [
  {
    id: 'C1', name: '开门红', need: 6,
    target: ['C', 'C', 'C', 'C'],
    hint: '真实计时，表从进关那一刻就走：把 6 个圆从左下送到右上枢纽。传送带只有 24 条，浪费就重来！星级：★★★≤22s · ★★≤32s · 45s 未完成 0 星。',
    resources: [{ x: 3, y: 11, type: 'C' }], hub: { x: 18, y: 4 },
    budget: { belt: 24, extractor: 1, cutter: 0, rotator: 0, merger: 0, trash: 0 },
    realTimer: true, realLimit: 45, betterIsLower: true,
    scoreVal: g => g.chal.elapsed,
    scoreText: g => g.chal.elapsed.toFixed(1) + ' 秒',
    stars: g => g.delivered < 6 ? 0 : (g.chal.elapsed <= 22 ? 3 : g.chal.elapsed <= 32 ? 2 : 1),
  },
  {
    id: 'C2', name: '极简', need: 1,
    target: [null, 'C', 'C', null],
    hint: '用尽可能少的设备做出下半圆。星级：★★★≤7 台 · ★★≤9 台 · ★≤11 台。想想：出料口下面能放什么？机器和机器之间一定要传送带吗？',
    resources: [{ x: 3, y: 8, type: 'C' }], hub: { x: 9, y: 8 },
    budget: { belt: Infinity, extractor: Infinity, cutter: Infinity, rotator: Infinity, merger: Infinity, trash: Infinity },
    betterIsLower: true,
    scoreVal: () => usedTotal(),
    scoreText: g => usedTotal() + ' 台设备',
    stars: () => { const n = usedTotal(); return n <= 7 ? 3 : n <= 9 ? 2 : n <= 11 ? 1 : 0; },
  },
  {
    id: 'C3', name: '紧缩', need: 1,
    target: ['C', 'C', 'T', 'T'],
    hint: '右圆左梯形，但传送带只有 9 条！把每一格都走成最短的线。',
    resources: [{ x: 3, y: 6, type: 'C' }, { x: 3, y: 10, type: 'T' }], hub: { x: 8, y: 8 },
    budget: { belt: 9, extractor: 2, cutter: 2, rotator: 0, merger: 1, trash: 2 },
    betterIsLower: true,
    scoreVal: g => g.used.belt,
    scoreText: g => '传送带 ' + g.used.belt + ' 条',
    stars: g => g.used.belt <= 8 ? 3 : 2, // 预算硬约束 9，参考解 8 条
  },
  {
    id: 'C4', name: '并行', need: 0, passNeed: 120, // 到时结算；至少交付 120 个才达标
    target: ['C', 'C', null, null],
    hint: '布线完成后点击「启动供料」，随后在 60 秒游戏时间内持续交付右半圆。设备不限量；星级线：★≥120 · ★★≥220 · ★★★≥300。',
    resources: [{ x: 3, y: 5, type: 'C' }, { x: 3, y: 11, type: 'C' }], hub: { x: 19, y: 8 },
    budget: { belt: Infinity, extractor: Infinity, cutter: Infinity, rotator: Infinity, merger: Infinity, trash: Infinity },
    tickLimit: 400, betterIsLower: false, // 400 tick × 150ms = 60s 游戏时间
    scoreVal: g => g.delivered,
    scoreText: g => '交付 ' + g.delivered + ' 个',
    stars: g => g.delivered >= 300 ? 3 : g.delivered >= 220 ? 2 : g.delivered >= 120 ? 1 : 0,
  },
  {
    id: 'C5', name: '旋转大师', need: 50,
    target: ['S', null, null, 'S'], // 上半星：outA/outB 都直出不了，必须旋转一次
    hint: '50 秒真实时间交付 50 个上半星！旋转机只有 1 台、传送带只有 8 条——哪个出料口才是原料？星级：★★★≤20s · ★★≤32s · 未达标 0 星。',
    resources: [{ x: 3, y: 8, type: 'S' }], hub: { x: 13, y: 9 },
    budget: { belt: 8, extractor: 1, cutter: 1, rotator: 1, merger: 0, trash: 1 },
    realTimer: true, realLimit: 50, betterIsLower: true,
    scoreVal: g => g.chal.elapsed,
    scoreText: g => g.chal.elapsed.toFixed(1) + ' 秒 · 交付 ' + g.delivered + ' 个',
    stars: g => g.delivered < 50 ? 0 : (g.chal.elapsed <= 20 ? 3 : g.chal.elapsed <= 32 ? 2 : 1),
  },
  {
    id: 'C6', name: '终章', need: 8,
    target: ['C', 'C', 'S', 'S'],
    hint: '双约束终章：90 秒内持续交付 8 个右圆左星（产线卡死即败），设备星级线 25/28/30 台。垃圾桶只有 1 个——两路废料得汇进同一张口。',
    resources: [{ x: 3, y: 5, type: 'C' }, { x: 3, y: 11, type: 'S' }], hub: { x: 11, y: 8 },
    budget: { belt: Infinity, extractor: 2, cutter: 2, rotator: 0, merger: 1, trash: 1 },
    realTimer: true, realLimit: 90, betterIsLower: true,
    scoreVal: () => usedTotal(),
    scoreText: g => usedTotal() + ' 台 · ' + g.chal.elapsed.toFixed(1) + ' 秒',
    stars: g => {
      const n = usedTotal();
      if (g.chal.elapsed > 90 || g.delivered < 8 || n > 30) return 0;
      return n <= 25 ? 3 : n <= 28 ? 2 : 1;
    },
  },
];

// 装载挑战关（网格同教程 24×16）
function loadChallenge(i) {
  i = Math.max(0, Math.min(CHALLENGES.length - 1, i));
  if (CHALLENGES[i].ruleset === 'petal-v3') { V3Runtime.load(i); return; }
  if (CHALLENGES[i].ruleset === 'trapezoid-v2') { V2Runtime.load(i); return; }
  G.v2 = null;
  G.v3 = null;
  const C = CHALLENGES[i];
  G.mode = 'challenge';
  G.chalIndex = i;
  G.save.lastChal = i; persist();
  G.chalDef = C; // 当前挑战定义（每日挑战复用同一结算管线）
  setGridSize(24, 16, 32);
  G.grid = [];
  for (let y = 0; y < GRID_H; y++) G.grid.push(new Array(GRID_W).fill(null));
  for (const r of C.resources) G.grid[r.y][r.x] = { type: 'resource', x: r.x, y: r.y, shapeType: r.type };
  G.grid[C.hub.y][C.hub.x] = mkCell('hub', C.hub.x, C.hub.y, 0);
  G.target = C.target.slice();
  G.budget = {};
  for (const k in C.budget) G.budget[k] = C.budget[k];
  G.used = {};
  for (const k of MACHINE_TYPES) G.used[k] = 0;
  G.tickCount = 0; G.delivered = 0; G.won = false; G.paused = false;
  G.particles.length = 0; G.hubPulse = 0;
  G.tool = 'belt'; G.toolDir = 1; G.hover = { x: -1, y: -1 };
  G.paste = null; G.selMode = false; G.sel = null;
  G.stats.log.length = 0;
  G.chal = { elapsed: 0, done: false, started: C.id !== 'C4' }; // C4 布线期不供料、不倒计时
  Undo.clear();
  UI.refreshLevel(); UI.refreshBudget(); UI.refreshToolbar(); UI.syncPause();
}

function startC4Supply() {
  if (G.mode !== 'challenge' || !G.chalDef || G.chalDef.id !== 'C4' || !G.chal || G.chal.done || G.chal.started) return false;
  G.chal.started = true;
  G.paused = false;
  UI.syncPause();
  return true;
}

// 挑战结算：计星、存最佳、弹窗（每日挑战走 dailyWin 分支）
function challengeWin() {
  if (!G.chal || G.chal.done) return;
  const C = G.chalDef;
  G.chal.done = true;
  G.won = true; // 停模拟（同教程过关）
  const stars = C.stars(G);
  const isDaily = !!C.isDaily;
  const scores = G.v3 ? G.save.challengeV3 : G.v2 ? G.save.challengeV2 : G.save.challenges;
  const rec = (isDaily ? G.save.daily[C.dateStr] : scores[C.id]) || { stars: 0, best: null };
  const val = C.scoreVal(G);
  const isBest = rec.best === null || (C.betterIsLower ? val < rec.best : val > rec.best);
  const next = { stars: Math.max(rec.stars, stars), best: isBest ? val : rec.best };
  if (isDaily) G.save.daily[C.dateStr] = next; else scores[C.id] = next;
  persist();
  AudioFX.win();
  UI.refreshLevels();
  checkAchievements();
  setTimeout(() => UI.showChalWin(stars, C.scoreText(G), isBest), 700);
}

// 每 tick 检查时间类约束（由 core frame() 在 Sim.tick 后调用）
function challengeTick() {
  if (!G.chal || G.chal.done || !G.chalDef) return;
  const C = G.chalDef;
  if (C.id === 'C4' && !G.chal.started) return;
  if (C.tickLimit && G.tickCount >= C.tickLimit) challengeWin(); // C4 到时按交付数结算
  else if (C.realLimit && G.chal.elapsed > C.realLimit) challengeWin(); // 超时按当前数据结算
}

console.assert(CHALLENGES.length === 6, '挑战应为 6 关');
console.assert(CHALLENGES.every(c => c.id && c.target.length === 4 && c.hub && c.resources.length), '挑战数据须完整');

// ===== 每日挑战（D13 超额位）：当日日期 → mulberry32 确定性随机 → 同题 =====
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// 本地日期的 YYYY-MM-DD 与对应随机流
function dailyRand() {
  const d = new Date();
  const str = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return { str, rand: mulberry32(h) };
}
// 生成当日挑战定义（复用挑战结算管线，存档进 save.daily）
function dailyDef() {
  const { str, rand } = dailyRand();
  const t = FREE_TARGETS[Math.floor(rand() * FREE_TARGETS.length)];
  const k = [0.8, 1.0, 1.2][Math.floor(rand() * 3)];
  const devLimit = Math.round(t.par * k);
  return {
    id: 'daily', isDaily: true, dateStr: str, name: '每日挑战 ' + str, need: 1,
    target: t.shape.slice(),
    hint: '今日题目：' + t.par + ' 台参考线 × ' + k + ' = 至多 ' + devLimit + ' 台设备，180 秒内完成。全服同题，拼最佳！',
    resources: FREE.resources.map(r => ({ x: r.x, y: r.y, type: r.type })), // 复用自由模式摆位
    hub: { x: FREE.hub.x, y: FREE.hub.y },
    budget: { belt: Infinity, extractor: Infinity, cutter: Infinity, rotator: Infinity, merger: Infinity, trash: Infinity },
    realTimer: true, realLimit: 180, betterIsLower: true, devLimit,
    scoreVal: g => g.chal.elapsed,
    scoreText: g => g.chal.elapsed.toFixed(1) + ' 秒 · ' + usedTotal() + ' 台',
    stars: g => (g.chal.elapsed > 180 || usedTotal() > devLimit) ? 0 : (usedTotal() <= Math.round(t.par * 0.8) ? 3 : usedTotal() <= t.par ? 2 : 1),
  };
}
function loadDaily() {
  G.v2 = null;
  G.v3 = null;
  const D = dailyDef();
  G.mode = 'daily';
  G.chalDef = D;
  setGridSize(FREE.w, FREE.h, FREE.tile); // 每日挑战用 32×20 大图
  G.grid = [];
  for (let y = 0; y < GRID_H; y++) G.grid.push(new Array(GRID_W).fill(null));
  for (const r of D.resources) G.grid[r.y][r.x] = { type: 'resource', x: r.x, y: r.y, shapeType: r.type };
  G.grid[D.hub.y][D.hub.x] = mkCell('hub', D.hub.x, D.hub.y, 0);
  G.target = D.target.slice();
  G.budget = {};
  for (const k in D.budget) G.budget[k] = D.budget[k];
  G.used = {};
  for (const k of MACHINE_TYPES) G.used[k] = 0;
  G.tickCount = 0; G.delivered = 0; G.won = false; G.paused = false;
  G.particles.length = 0; G.hubPulse = 0;
  G.tool = 'belt'; G.toolDir = 1; G.hover = { x: -1, y: -1 };
  G.paste = null; G.selMode = false; G.sel = null;
  G.stats.log.length = 0;
  G.chal = { elapsed: 0, done: false };
  Undo.clear();
  UI.refreshLevel(); UI.refreshBudget(); UI.refreshToolbar(); UI.syncPause();
}

// ===== 成就系统（D13 超额位）：计数器 + toast + 主菜单一览 =====
const ACHIEVEMENTS = [
  { id: 'first-win', name: '首胜', desc: '通过教程第 1 关', test: s => (s.stars[0] || 0) >= 1 },
  { id: 'graduate', name: '毕业', desc: '教程 8 关全部通过', test: s => LEVELS.every((_, i) => (s.stars[i] || 0) >= 1) },
  { id: 'all-stars', name: '全星', desc: '教程 8 关全部三星', test: s => LEVELS.every((_, i) => (s.stars[i] || 0) >= 3) },
  { id: 'blueprint-3', name: '蓝图师', desc: '保存 3 个自建蓝图', test: s => Object.keys(s.blueprints).length >= 3 },
  { id: 'chal-3star', name: '挑战者', desc: '任一挑战达成 3 星', test: s =>
    [s.challenges, s.challengeV3 || {}].some(scores => Object.keys(scores).some(k => (scores[k].stars || 0) >= 3)) },
  { id: 'chal-all', name: '全挑战', desc: '6 个挑战全部完成', test: s => CHALLENGES.every(c =>
    (((c.ruleset === 'petal-v3' ? s.challengeV3 || {} : s.challenges)[c.id] || {}).stars || 0) >= 1) },
  { id: 'daily-1', name: '常客', desc: '完成一次每日挑战', test: s => Object.keys(s.daily).length >= 1 },
  { id: 'speedrun', name: '速通者', desc: 'C1 达成 3 星', test: s =>
    (((s.challengeV3 || {}).C1 || s.challenges.C1 || {}).stars || 0) >= 3 },
];
function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (!G.save.achievements[a.id] && a.test(G.save)) {
      G.save.achievements[a.id] = true;
      persist();
      UI.toast('成就解锁：「' + a.name + '」——' + a.desc, 4);
      if (typeof UI !== 'undefined' && UI.renderAchievements) UI.renderAchievements();
    }
  }
}
console.assert(ACHIEVEMENTS.length === 8, '成就应为 8 个');
console.assert(dailyDef().target.length === 4, '每日挑战目标须合法');
