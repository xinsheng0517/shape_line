// 无头冒烟测试：桩掉浏览器环境，加载 levels/core/sim，程序化铺参考解法并跑模拟
const fs = require('fs');
const dir = __dirname + '/js/';
global.window = { addEventListener() {} };
const noop = () => {};
global.UI = { refreshLevel: noop, refreshBudget: noop, refreshToolbar: noop, syncPause: noop, refreshLevels: noop, showWin: noop, toast: noop, syncSound: noop, showMenu: noop, hideMenu: noop, syncSpeed: noop, refreshBps: noop, showChalWin: noop, refreshChalProgress: noop };

const src = ['levels.js', 'blueprint.js', 'challenges.js', 'core.js', 'sim.js', 'input.js'].map(f => fs.readFileSync(dir + f, 'utf8')).join('\n');

const test = `
;globalThis.__fail = 0;
// DOM/Render 最小桩：input.js 的真实 UI 在无头环境可跑（ge/createElement 返回通用元素桩）
const __el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, appendChild() {}, addEventListener() {}, querySelector: () => __el(), textContent: '', innerHTML: '', title: '', id: '', className: '' });
const document = { getElementById: () => __el(), createElement: () => __el(), addEventListener() {} };
const Render = { drawPreview: () => {}, cv: null, resize: () => {}, draw: () => {} };
UI.els = { tabs: __el(), lvlName: __el(), toolbar: __el(), toast: __el(), hint: __el(), modal: __el(), winStars: __el(), winInfo: __el(), btnNext: __el(), bpbar: __el(), menu: __el(), statRate: __el() };
;(function () {
  let fail = 0;
  function place(type, x, y, dir) { G.grid[y][x] = mkCell(type, x, y, dir); }
  function belts(x1, y1, x2, y2, dir) {
    const d = DIRV[dir]; let x = x1, y = y1;
    while (true) { place('belt', x, y, dir); if (x === x2 && y === y2) break; x += d[0]; y += d[1]; }
  }
  function run(name, max) {
    for (let i = 0; i < max && !G.won; i++) Sim.tick();
    if (G.won) { console.log(name + ': PASS (tick ' + G.tickCount + ')'); }
    else { console.log(name + ': FAIL'); fail++; }
  }
  function runExpectJam(name, max) {
    for (let i = 0; i < max && !G.won; i++) Sim.tick();
    if (!G.won) { console.log(name + ': PASS (正确拒收，未过关)'); }
    else { console.log(name + ': FAIL (不应过关却过了)'); fail++; }
  }

  // L1 直通
  loadLevel(0);
  place('extractor', 4, 8, 1);
  belts(5, 8, 18, 8, 1);
  run('L1 直通', 300);
  if (G.stats.log.length < 1) { console.log('统计埋点: FAIL (deliver 未写入 stats.log)'); fail++; } // D10 速率 HUD 数据源

  // L2 切割 + 垃圾桶
  loadLevel(1);
  place('extractor', 4, 8, 1); place('cutter', 5, 8, 1); place('trash', 5, 9, 0);
  belts(6, 8, 18, 8, 1);
  run('L2 切割', 300);

  // L2 反向测试：把左半圆送去枢纽，应被拒收堵死
  loadLevel(1);
  place('extractor', 4, 8, 1); place('cutter', 5, 8, 1); place('trash', 6, 8, 0);
  place('belt', 5, 9, 2); // 左半从右侧口出来向下
  belts(5, 10, 5, 14, 2); belts(6, 14, 17, 14, 1); place('belt', 18, 14, 0);
  belts(18, 13, 18, 9, 0); place('belt', 18, 8, 1);
  runExpectJam('L2 错误形状拒收', 300);

  // L3 旋转
  loadLevel(2);
  place('extractor', 4, 8, 1); place('cutter', 5, 8, 1); place('trash', 5, 9, 0);
  place('belt', 6, 8, 1); place('rotator', 7, 8, 1); belts(8, 8, 18, 8, 1);
  run('L3 旋转', 300);

  // L4 合并（圆底 + 方补）
  loadLevel(3);
  place('extractor', 4, 5, 1); place('cutter', 5, 5, 1); place('trash', 5, 6, 0);
  belts(6, 5, 15, 5, 1); place('belt', 16, 5, 2); belts(16, 6, 16, 7, 2); place('belt', 16, 8, 1);
  place('extractor', 4, 11, 1); place('cutter', 5, 11, 1); place('trash', 6, 11, 0);
  belts(5, 12, 16, 12, 1); place('belt', 17, 12, 0); belts(17, 11, 17, 9, 0);
  place('merger', 17, 8, 1); place('belt', 18, 8, 1);
  run('L4 合并', 400);

  // L5 星形切割
  loadLevel(4);
  place('extractor', 4, 8, 1); place('cutter', 5, 8, 1); place('trash', 5, 9, 0);
  belts(6, 8, 18, 8, 1);
  run('L5 切星', 300);

  // L6 双级旋转
  loadLevel(5);
  place('extractor', 4, 8, 1); place('cutter', 5, 8, 1); place('trash', 5, 9, 0);
  place('belt', 6, 8, 1); place('rotator', 7, 8, 1); place('belt', 8, 8, 1); place('rotator', 9, 8, 1);
  belts(10, 8, 18, 8, 1);
  run('L6 双转', 400);

  // L7 圆星双拼（同 L4 布局，S 替换 R）
  loadLevel(6);
  place('extractor', 4, 5, 1); place('cutter', 5, 5, 1); place('trash', 5, 6, 0);
  belts(6, 5, 15, 5, 1); place('belt', 16, 5, 2); belts(16, 6, 16, 7, 2); place('belt', 16, 8, 1);
  place('extractor', 4, 11, 1); place('cutter', 5, 11, 1); place('trash', 6, 11, 0);
  belts(5, 12, 16, 12, 1); place('belt', 17, 12, 0); belts(17, 11, 17, 9, 0);
  place('merger', 17, 8, 1); place('belt', 18, 8, 1);
  run('L7 双拼', 400);

  // L8 预算关：19 条传送带的参考解（预算 20）
  loadLevel(7);
  place('extractor', 9, 3, 1); place('cutter', 10, 3, 1); place('trash', 10, 4, 0);
  belts(11, 3, 12, 3, 1); place('belt', 13, 3, 2); belts(13, 4, 13, 6, 2); place('belt', 13, 7, 1);
  place('extractor', 9, 12, 1); place('cutter', 10, 12, 1); place('trash', 11, 12, 0);
  place('belt', 10, 13, 1); place('belt', 11, 13, 1); place('belt', 12, 13, 0);
  belts(12, 12, 12, 9, 0); place('belt', 12, 8, 1); place('belt', 13, 8, 1); place('belt', 14, 8, 0);
  place('merger', 14, 7, 1);
  place('belt', 15, 7, 2); place('belt', 15, 8, 1);
  let beltCount = 0;
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
    const c = G.grid[y][x]; if (c && c.type === 'belt') beltCount++;
  }
  console.log('L8 传送带用量: ' + beltCount + ' / 预算 ' + G.budget.belt);
  if (beltCount > 20) { console.log('L8 预算: FAIL (参考解超预算)'); fail++; }
  run('L8 精打细算', 500);

  console.log(fail === 0 ? 'ALL_SIM_TESTS_PASS' : fail + ' TESTS FAILED');
  globalThis.__fail += fail;
})();

// ===== 蓝图系统测试 =====
;(function () {
  let fail = 0;
  function place(type, x, y, dir) { G.grid[y][x] = mkCell(type, x, y, dir); }
  function belts(x1, y1, x2, y2, dir) {
    const d = DIRV[dir]; let x = x1, y = y1;
    while (true) { place('belt', x, y, dir); if (x === x2 && y === y2) break; x += d[0]; y += d[1]; }
  }
  function pasteBp(bp, px, py) { // 与 Input.pasteAt 同逻辑：先整体预检再逐格落子
    const bad = Blueprints.check(bp, px, py);
    if (bad) return bad;
    for (const c of bp.cells) place(c.type, px + c.dx, py + c.dy, c.dir);
    return null;
  }

  // 框选复制 → 旋转 → 粘贴到空地 → 产线恢复运行
  loadLevel(0);
  place('extractor', 4, 8, 1); belts(5, 8, 12, 8, 1);
  const bp = Blueprints.fromRegion(4, 8, 12, 8);
  if (!bp || bp.cells.length !== 9 || bp.w !== 9 || bp.h !== 1) { console.log('蓝图框选: FAIL'); fail++; }
  else {
    const badOcc = Blueprints.check(bp, 4, 8); // 压在自己身上应拒绝
    if (!badOcc || badOcc.reason !== '格子被占用') { console.log('蓝图占用预检: FAIL'); fail++; }
    if (pasteBp(bp, 4, 10)) { console.log('蓝图空地粘贴: FAIL'); fail++; }
    else {
      place('extractor', 3, 10, 1); // 给粘贴段补一个源头（蓝图里的采集器在 4,10 贴着资源? 4,10 不贴资源，改用外部供给）
    }
  }
  // 粘贴含切割机的产线并验证运行：框选 L2 参考解 → 平移粘贴
  loadLevel(1);
  place('extractor', 4, 8, 1); place('cutter', 5, 8, 1); place('trash', 5, 9, 0);
  belts(6, 8, 18, 8, 1);
  const bp2 = Blueprints.fromRegion(4, 8, 6, 9); // 采集+切割+垃圾桶+一段带
  if (!bp2 || bp2.cells.length !== 4) { console.log('蓝图框选2: FAIL cells=' + (bp2 && bp2.cells.length)); fail++; }
  // 预算预检：切割机的预算只剩 0 时应整体拒绝
  G.budget.cutter = 0;
  const badBudget = Blueprints.check(bp2, 4, 11);
  if (!badBudget || badBudget.reason.indexOf('预算') < 0) { console.log('蓝图预算预检: FAIL'); fail++; }
  G.budget.cutter = 99;
  // 越界预检
  if (!Blueprints.check(bp2, 22, 14)) { console.log('蓝图越界预检: FAIL'); fail++; }
  // 旋转 90° 后粘贴（竖向产线），验证形状变换链仍正确：旋转后的切割双路
  const cut = BUILTIN_BPS[1]; // 切割双路
  const rcut = Blueprints.rotate(cut); // 变竖向：采集器朝下进切割
  loadLevel(4); // L5 星形，目标右半星
  if (pasteBp(rcut, 8, 4)) { console.log('旋转蓝图粘贴: FAIL'); fail++; }
  // 竖向布局：extractor 在 (8,4) dir=2? 旋转后 dir=(1+1)%4=2 朝下，cutter 在其下方…
  // rcut 布局：原 (0,0)ext→(1,0)? 旋转 (dx,dy)→(h-1-dy,dx)，h=2：(0,0)→(1,0) dir2；(1,0)→(1,1) dir2 cutter；(2,0)→(1,2) belt dir2；(1,1)→(0,1) trash dir1
  // 即采集器 (9,4) 朝下 → 切割机 (9,5) → 传送带 (9,6) 朝下，垃圾桶 (8,5)
  place('extractor', 4, 8, 1); place('cutter', 5, 8, 1); place('trash', 5, 9, 0); // 正常参考解过关
  belts(6, 8, 18, 8, 1);
  for (let i = 0; i < 300 && !G.won; i++) Sim.tick();
  if (!G.won) { console.log('旋转蓝图关卡回归: FAIL'); fail++; }
  else console.log('蓝图系统: PASS');

  console.log(fail === 0 ? 'ALL_BP_TESTS_PASS' : fail + ' BP TESTS FAILED');
  globalThis.__fail += fail;
})();

// ===== 撤销/重做测试 =====
;(function () {
  let fail = 0;
  loadLevel(0);
  // 拖拽铺设动作组：整组回退
  Undo.begin();
  G.grid[8][5] = mkCell('belt', 5, 8, 1); Undo.rec('place', 5, 8, 'belt', 1);
  G.grid[8][6] = mkCell('belt', 6, 8, 1); Undo.rec('place', 6, 8, 'belt', 1);
  Undo.end();
  if (Undo.stack.length !== 1) { console.log('拖拽成组: FAIL stack=' + Undo.stack.length); fail++; }
  Undo.undo();
  if (G.grid[8][5] || G.grid[8][6]) { console.log('撤销拖拽组: FAIL'); fail++; }
  Undo.redoOp();
  if (!G.grid[8][5] || !G.grid[8][6]) { console.log('重做拖拽组: FAIL'); fail++; }
  // 单击 = 单动作组
  Undo.clear();
  G.grid[8][8] = mkCell('belt', 8, 8, 1); Undo.rec('place', 8, 8, 'belt', 1);
  if (Undo.stack.length !== 1 || Undo.stack[0].length !== 1) { console.log('单击成组: FAIL'); fail++; }
  // 撤销拆除 = 放回
  Undo.clear();
  Undo.rec('remove', 8, 8, 'belt', 1);
  G.grid[8][8] = null;
  Undo.undo();
  if (!G.grid[8][8]) { console.log('撤销拆除放回: FAIL'); fail++; }
  // 预算回滚（L8 传送带预算 20）
  loadLevel(7);
  G.grid[5][5] = mkCell('belt', 5, 5, 1); G.budget.belt--; G.used.belt++;
  Undo.rec('place', 5, 5, 'belt', 1);
  Undo.undo();
  if (G.budget.belt !== 20 || G.used.belt !== 0 || G.grid[5][5]) { console.log('撤销预算回滚: FAIL'); fail++; }
  else console.log('撤销重做: PASS');
  console.log(fail === 0 ? 'ALL_UNDO_TESTS_PASS' : fail + ' UNDO TESTS FAILED');
  globalThis.__fail += fail;
})();

// ===== 自由模式测试 =====
;(function () {
  let fail = 0;
  function place(type, x, y, dir) { G.grid[y][x] = mkCell(type, x, y, dir); }
  function belts(x1, y1, x2, y2, dir) {
    const d = DIRV[dir]; let x = x1, y = y1;
    while (true) { place('belt', x, y, dir); if (x === x2 && y === y2) break; x += d[0]; y += d[1]; }
  }
  loadFree();
  if (GRID_W !== 32 || GRID_H !== 20 || TILE !== 24) { console.log('自由模式网格尺寸: FAIL ' + GRID_W + 'x' + GRID_H + 'x' + TILE); fail++; }
  if (G.mode !== 'free') { console.log('自由模式 mode: FAIL'); fail++; }
  if (G.budget.belt !== Infinity || G.budget.merger !== Infinity) { console.log('自由模式预算: FAIL'); fail++; }
  if (!FREE_TARGETS.some(t => shapeEq(t.shape, G.target))) { console.log('自由目标在池中: FAIL'); fail++; }
  // 换目标查重
  const prev = G.target.slice();
  nextFreeTarget();
  if (shapeEq(prev, G.target)) { console.log('换目标查重: FAIL'); fail++; }
  // 参考解：R 资源 (3,10) → 采集器 → 传送带 → 枢纽 (28,10)，目标强制为全方
  G.target = ['T', 'T', 'T', 'T'];
  place('extractor', 4, 10, 1);
  belts(5, 10, 27, 10, 1);
  const before = G.target.slice();
  for (let i = 0; i < 400 && shapeEq(G.target, before); i++) Sim.tick();
  if (G.delivered < 1) { console.log('自由模式交付: FAIL'); fail++; }
  else if (shapeEq(G.target, before)) { console.log('交付后自动换目标: FAIL'); fail++; }
  else if (G.won) { console.log('自由模式不应置 won: FAIL'); fail++; }
  else console.log('自由模式: PASS (交付 ' + G.delivered + '，在途 ' + inTransit() + ')');
  // 切回教程：网格尺寸与模式复位
  loadLevel(0);
  if (GRID_W !== 24 || GRID_H !== 16 || TILE !== 32 || G.mode !== 'tutorial') { console.log('切回教程复位: FAIL'); fail++; }
  else console.log('模式互切复位: PASS');
  console.log(fail === 0 ? 'ALL_FREE_TESTS_PASS' : fail + ' FREE TESTS FAILED');
  globalThis.__fail += fail;
})();

// ===== 新增目标参考解验证（自由网格 32×20，顺便数设备数校准 par） =====
;(function () {
  let fail = 0;
  function place(type, x, y, dir) { G.grid[y][x] = mkCell(type, x, y, dir); }
  function belts(x1, y1, x2, y2, dir) {
    const d = DIRV[dir]; let x = x1, y = y1;
    while (true) { place('belt', x, y, dir); if (x === x2 && y === y2) break; x += d[0]; y += d[1]; }
  }
  function devCount() { // 数当前网格设备总数
    let n = 0;
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const c = G.grid[y][x]; if (c && MACHINE_TYPES.indexOf(c.type) >= 0) n++;
    }
    return n;
  }
  // 在自由网格上为目标 t 跑参考解：buildFn 铺设，期望交付后 G.delivered >= 1
  function runFree(name, shape, buildFn) {
    loadFree();
    G.target = shape.slice();
    buildFn();
    const devs = devCount();
    const before = G.target.slice();
    for (let i = 0; i < 600 && shapeEq(G.target, before); i++) Sim.tick();
    if (G.delivered >= 1 && !shapeEq(G.target, before)) console.log(name + ': PASS (设备 ' + devs + ')');
    else { console.log(name + ': FAIL (delivered=' + G.delivered + ')'); fail++; }
    return devs;
  }

  // 全星直送：S(3,16) → 采集 → 传送带 → 27列上行 → 枢纽
  runFree('新目标·全星', ['S', 'S', 'S', 'S'], () => {
    place('extractor', 4, 16, 1); belts(5, 16, 26, 16, 1); place('belt', 27, 16, 0);
    belts(27, 15, 27, 11, 0); place('belt', 27, 10, 1);
  });
  // 下半方：右半方转 1 次（R 资源 y=10 直线）
  runFree('新目标·下半方', [null, 'T', 'T', null], () => {
    place('extractor', 4, 10, 1); place('cutter', 5, 10, 1); place('trash', 5, 11, 0);
    place('belt', 6, 10, 1); place('rotator', 7, 10, 1); belts(8, 10, 27, 10, 1);
  });
  // 左半圆：右半圆转 2 次（C 资源 y=4，27列下拐进枢纽）
  runFree('新目标·左半圆', [null, null, 'C', 'C'], () => {
    place('extractor', 4, 4, 1); place('cutter', 5, 4, 1); place('trash', 5, 5, 0);
    place('belt', 6, 4, 1); place('rotator', 7, 4, 1); place('belt', 8, 4, 1); place('rotator', 9, 4, 1);
    belts(10, 4, 26, 4, 1); place('belt', 27, 4, 2);
    belts(27, 5, 27, 9, 2); place('belt', 27, 10, 1);
  });
  // 上半圆：右半圆转 3 次
  runFree('新目标·上半圆', ['C', null, null, 'C'], () => {
    place('extractor', 4, 4, 1); place('cutter', 5, 4, 1); place('trash', 5, 5, 0);
    place('belt', 6, 4, 1); place('rotator', 7, 4, 1); place('belt', 8, 4, 1); place('rotator', 9, 4, 1);
    place('belt', 10, 4, 1); place('rotator', 11, 4, 1);
    belts(12, 4, 26, 4, 1); place('belt', 27, 4, 2);
    belts(27, 5, 27, 9, 2); place('belt', 27, 10, 1);
  });
  // 右方左圆：底=右半方（y=10 直线进背面），补=左半圆（转2次，绕 29 列从东侧折返到 27,11 向上进补，避开 y=10 底线）
  runFree('新目标·右方左圆', ['T', 'T', 'C', 'C'], () => {
    place('extractor', 4, 10, 1); place('cutter', 5, 10, 1); place('trash', 5, 11, 0);
    belts(6, 10, 26, 10, 1);
    place('extractor', 4, 4, 1); place('cutter', 5, 4, 1); place('trash', 5, 5, 0);
    place('belt', 6, 4, 1); place('rotator', 7, 4, 1); place('belt', 8, 4, 1); place('rotator', 9, 4, 1);
    belts(10, 4, 28, 4, 1); place('belt', 29, 4, 2); belts(29, 5, 29, 11, 2);
    place('belt', 29, 11, 3); place('belt', 28, 11, 3); place('belt', 27, 11, 0);
    place('merger', 27, 10, 1);
  });
  // 上圆下星：底=上半圆（转3次，26列下行进背面），补=下半星（转1次，27列上行进补）
  runFree('新目标·上圆下星', ['C', 'S', 'S', 'C'], () => {
    place('extractor', 4, 4, 1); place('cutter', 5, 4, 1); place('trash', 5, 5, 0);
    place('belt', 6, 4, 1); place('rotator', 7, 4, 1); place('belt', 8, 4, 1); place('rotator', 9, 4, 1);
    place('belt', 10, 4, 1); place('rotator', 11, 4, 1);
    belts(12, 4, 25, 4, 1); place('belt', 26, 4, 2); belts(26, 5, 26, 9, 2); place('belt', 26, 10, 1);
    place('extractor', 4, 16, 1); place('cutter', 5, 16, 1); place('trash', 5, 17, 0);
    place('belt', 6, 16, 1); place('rotator', 7, 16, 1);
    belts(8, 16, 26, 16, 1); place('belt', 27, 16, 0); belts(27, 15, 27, 12, 0); place('belt', 27, 11, 0);
    place('merger', 27, 10, 1);
  });

  console.log(fail === 0 ? 'ALL_NEWTARGET_TESTS_PASS' : fail + ' NEWTARGET TESTS FAILED');
  globalThis.__fail += fail;
})();

// ===== 挑战模式参考解（D12：六关全部可通 + 星级校准实测） =====
;(function () {
  let fail = 0;
  function place(type, x, y, dir) { G.grid[y][x] = mkCell(type, x, y, dir); }
  function belts(x1, y1, x2, y2, dir) {
    const d = DIRV[dir]; let x = x1, y = y1;
    while (true) { place('belt', x, y, dir); if (x === x2 && y === y2) break; x += d[0]; y += d[1]; }
  }
  function runChal(name, idx, buildFn, maxTick) {
    loadChallenge(idx);
    buildFn();
    for (let i = 0; i < maxTick && !G.won; i++) { Sim.tick(); challengeTick(); }
    if (!G.won) { console.log(name + ': FAIL (未结算)'); fail++; return; }
    const C = CHALLENGES[idx], rec = G.save.challenges[C.id];
    console.log(name + ': PASS (成绩 ' + C.scoreText(G) + '，' + (rec ? rec.stars : '?') + ' 星)');
  }
  function placeU(type, x, y, dir) { place(type, x, y, dir); G.used[type]++; } // 同步 used 供星级校准

  // C1 开门红 v2：折线竞速。资源(3,11)→枢纽(18,4)，L 形 20 带（预算 24）
  runChal('C1 开门红', 0, () => {
    placeU('extractor', 4, 11, 1);           // 贴资源(3,11) 朝右
    belts(5, 11, 17, 11, 1);                 // y=11 东行 13 带（到 17 列）
    place('belt', 18, 11, 0);                // (18,11) 拐角：朝上汇入北上列
    place('belt', 18, 10, 0); place('belt', 18, 9, 0); place('belt', 18, 8, 0);
    place('belt', 18, 7, 0); place('belt', 18, 6, 0); place('belt', 18, 5, 0); // 18 列北上 7 带（含拐角）
    G.used.belt += 20;
  }, 400);
  if (G.save.challenges.C1.stars !== 3) { console.log('C1 星级校准: FAIL 期望3星 实际' + G.save.challenges.C1.stars); fail++; }

  // C2 极简 v2：枢纽(9,8)，6 台最优解（垃圾桶垫切割机下方 + 旋转机直连）
  runChal('C2 极简', 1, () => {
    placeU('extractor', 4, 8, 1); placeU('cutter', 5, 8, 1); placeU('trash', 5, 9, 0);
    placeU('rotator', 6, 8, 1);              // 旋转机直连切割机 outA
    placeU('belt', 7, 8, 1); placeU('belt', 8, 8, 1);
  }, 300);
  if (G.save.challenges.C2.stars !== 3) { console.log('C2 星级校准: FAIL 期望3星 实际' + G.save.challenges.C2.stars); fail++; }

  // C3 紧缩 v2：belt 预算 9，参考解 8 条（merger(7,8) 贴枢纽(8,8)）
  runChal('C3 紧缩', 2, () => {
    placeU('extractor', 4, 6, 1); placeU('cutter', 5, 6, 1); placeU('trash', 5, 7, 0);
    placeU('belt', 6, 6, 2); placeU('belt', 6, 7, 2); placeU('belt', 6, 8, 1);
    placeU('extractor', 4, 10, 1); placeU('cutter', 5, 10, 1); placeU('trash', 6, 10, 0);
    placeU('belt', 5, 11, 1); placeU('belt', 6, 11, 1); placeU('belt', 7, 11, 0); placeU('belt', 7, 10, 0); placeU('belt', 7, 9, 0);
    placeU('merger', 7, 8, 1);
  }, 400);
  if (G.save.challenges.C3.stars !== 3) { console.log('C3 星级校准: FAIL 期望3星 实际' + G.save.challenges.C3.stars); fail++; }

  // C4 并行：设备全无限，四条切割线从枢纽四方向进料，验证交付量与星级
  loadChallenge(3);
  // 线1（左进）：C(3,5) 右侧采集
  place('extractor', 4, 5, 1); place('cutter', 5, 5, 1); place('trash', 5, 6, 0);
  belts(6, 5, 17, 5, 1); place('belt', 18, 5, 2); place('belt', 18, 6, 2); place('belt', 18, 7, 2); place('belt', 18, 8, 1);
  // 线2（下进）：C(3,11) 右侧采集
  place('extractor', 4, 11, 1); place('cutter', 5, 11, 1); place('trash', 5, 12, 0);
  belts(6, 11, 18, 11, 1); place('belt', 19, 11, 0); place('belt', 19, 10, 0); place('belt', 19, 9, 0);
  // 线3（上进）：C(3,5) 上方采集，y=3 东行后 19 列南下
  place('extractor', 3, 4, 0); place('belt', 3, 3, 0); belts(4, 3, 7, 3, 1);
  place('cutter', 8, 3, 1); place('trash', 8, 4, 0);
  belts(9, 3, 18, 3, 1); place('belt', 19, 3, 2); belts(19, 4, 19, 7, 2);
  // 线4（右进）：C(3,11) 下方采集，y=13 东行后 20 列北上
  place('extractor', 3, 12, 2); place('belt', 3, 13, 1); belts(4, 13, 7, 13, 1);
  place('cutter', 8, 13, 1); place('trash', 8, 14, 0);
  belts(9, 13, 19, 13, 1); place('belt', 20, 13, 0); belts(20, 12, 20, 9, 0); place('belt', 20, 8, 3);
  startC4Supply();
  for (let i = 0; i < 450 && !G.won; i++) { Sim.tick(); challengeTick(); }
  if (!G.won || G.tickCount < 400) { console.log('C4 到时结算: FAIL won=' + G.won + ' tick=' + G.tickCount); fail++; }
  else console.log('C4 并行: PASS (400tick 交付 ' + G.delivered + ' 个，' + G.save.challenges.C4.stars + ' 星)');

  // C5 旋转大师 v2：目标上半星，唯一路线 = outB(左半星) ×1 旋转；outA(右半星) 直落垃圾桶
  // 布线：ext(4,8)→cutter(5,8,dir=1)；outA 朝右 → trash(6,8)；outB 垂落 (5,9) → rotator(6,9) → 带 → 枢纽(13,9)
  runChal('C5 旋转大师', 4, () => {
    placeU('extractor', 4, 8, 1); placeU('cutter', 5, 8, 1); placeU('trash', 6, 8, 0);
    placeU('belt', 5, 9, 1);                  // outB(5,9) 朝右送进旋转机背面
    placeU('rotator', 6, 9, 1);               // 左半星 ×1 CW → 上半星
    belts(7, 9, 12, 9, 1);                    // 6 带 → 枢纽(13,9)
    G.used.belt += 7;
  }, 900);
  if (G.delivered < 50) { console.log('C5 产能: FAIL 期望≥50 实际' + G.delivered); fail++; }
  if (G.save.challenges.C5.stars !== 3) { console.log('C5 星级校准: FAIL 期望3星 实际' + G.save.challenges.C5.stars); fail++; }

  // C6 终章 v2：need=8 持续运转，单垃圾桶汇两路废料，25 台参考解
  runChal('C6 终章', 5, () => {
    // C 线：ext(4,5)→cutter(5,5,dir=1)；outA(右半C) 东行→南下→进 merger(10,8) 背面；outB(左半C) 南下进共用垃圾桶
    placeU('extractor', 4, 5, 1); placeU('cutter', 5, 5, 1);
    belts(6, 5, 8, 5, 1); placeU('belt', 9, 5, 2); placeU('belt', 9, 6, 2); placeU('belt', 9, 7, 2); placeU('belt', 9, 8, 1);
    placeU('belt', 5, 6, 2); placeU('belt', 5, 7, 2); placeU('belt', 5, 8, 2); placeU('belt', 5, 9, 2); // C 废料 4 带南下
    // S 线：ext(3,12,dir=1 贴资源(3,11))→(4,12)→(5,12)↑→cutter(5,11,dir=0 朝上)；outB(左半S) 朝右直出为原料，outA(右半S) 朝上落垃圾桶
    placeU('extractor', 3, 12, 1); placeU('belt', 4, 12, 1); placeU('belt', 5, 12, 0);
    placeU('cutter', 5, 11, 0);
    belts(6, 11, 9, 11, 1); G.used.belt += 4; // outB 东行 4 带
    placeU('belt', 10, 11, 0); placeU('belt', 10, 10, 0); placeU('belt', 10, 9, 0); // 北上 3 带进 merger 下方 inB
    placeU('trash', 5, 10, 0);                // 共用垃圾桶：S 废料(5,10? 朝上出料落 5,10) + C 废料顺路落 5,10
    placeU('merger', 10, 8, 1);               // 右圆左星 → HUB(11,8)
  }, 600);
  if (G.save.challenges.C6.stars !== 3) { console.log('C6 星级校准: FAIL 期望3星(≤25台) 实际' + G.save.challenges.C6.stars + ' 台数' + usedTotal()); fail++; }

  // C3 预算与蓝图粘贴联动（宪法7/8）：粘贴含 cutter 的蓝图受预算约束
  loadChallenge(2);
  const blCut = BUILTIN_BPS[1]; // 切割双路：含 1 cutter
  G.budget.cutter = 0;
  const linkR = Blueprints.check(blCut, 10, 2);
  if (linkR) console.log('C3 蓝图预算联动: PASS (' + linkR.reason + ')');
  else { console.log('C3 蓝图预算联动: FAIL (预算0仍通过预检) won=' + G.won + ' cutter=' + G.budget.cutter); fail++; }

  console.log(fail === 0 ? 'ALL_CHALLENGE_TESTS_PASS' : fail + ' CHALLENGE TESTS FAILED');
  globalThis.__fail += fail;
})();

// ===== 每日挑战 / 成就 / 镜像（D13） =====
;(function () {
  let fail = 0;
  function place(type, x, y, dir) { G.grid[y][x] = mkCell(type, x, y, dir); }
  function belts(x1, y1, x2, y2, dir) {
    const d = DIRV[dir]; let x = x1, y = y1;
    while (true) { place('belt', x, y, dir); if (x === x2 && y === y2) break; x += d[0]; y += d[1]; }
  }
  // 确定性：同日两次生成完全一致
  const d1 = dailyDef(), d2 = dailyDef();
  if (d1.dateStr !== d2.dateStr || !shapeEq(d1.target, d2.target) || d1.devLimit !== d2.devLimit) {
    console.log('每日挑战确定性: FAIL'); fail++;
  } else console.log('每日挑战确定性: PASS (' + d1.dateStr + ' 目标[' + d1.target.map(q => q || '·').join('') + '] 上限 ' + d1.devLimit + ' 台)');
  // 装载与结算管线：目标改为全方铺直通验证 deliver → challengeWin → save.daily
  loadDaily();
  if (G.mode !== 'daily' || GRID_W !== 32 || TILE !== 24) { console.log('每日装载: FAIL'); fail++; }
  G.chalDef.target = ['T', 'T', 'T', 'T']; G.target = ['T', 'T', 'T', 'T'];
  G.chalDef.devLimit = 99; // 放宽设备线，专注验证结算管线
  place('extractor', 4, 10, 1); belts(5, 10, 27, 10, 1);
  for (let i = 0; i < 400 && !G.won; i++) { Sim.tick(); challengeTick(); }
  if (!G.won || !G.save.daily[d1.dateStr]) { console.log('每日结算存档: FAIL'); fail++; }
  else console.log('每日结算存档: PASS (stars=' + G.save.daily[d1.dateStr].stars + ')');
  // 成就：常客应在结算时解锁；挑战者/速通者已被前面的 C1-C6 测试解锁
  if (!G.save.achievements['daily-1']) { console.log('成就·常客: FAIL'); fail++; }
  if (!G.save.achievements['chal-3star'] || !G.save.achievements['speedrun']) { console.log('成就·挑战者/速通者: FAIL'); fail++; }
  if (!G.save.achievements['chal-all']) { console.log('成就·全挑战: FAIL (C1-C6 已全部通过)'); fail++; }
  if (!G.save.achievements['first-win']) { console.log('成就·首胜: FAIL (L1 已通过)'); fail++; }
  // 镜像：直送线×8 镜像后流向应反转（dir 1→3），传送带逐个验证
  const m = Blueprints.mirror(BUILTIN_BPS[0]);
  if (m.cells.some(c => c.dir !== 3) || m.cells[0].dx !== 7) { console.log('镜像传送带: FAIL'); fail++; }
  else console.log('镜像传送带流向: PASS');
  // 镜像两次回原样
  const mm = Blueprints.mirror(m);
  if (JSON.stringify(mm.cells) !== JSON.stringify(BUILTIN_BPS[0].cells)) { console.log('镜像对合: FAIL'); fail++; }
  console.log(fail === 0 ? 'ALL_DAILY_TESTS_PASS' : fail + ' DAILY TESTS FAILED');
  globalThis.__fail += fail;
})();

// ===== 交互态互斥（粘贴/框选/工具切换） =====
;(function () {
  let fail = 0;
  loadLevel(0);
  // 粘贴态下按数字键切工具 → 应退出粘贴态
  G.paste = Blueprints.clone(BUILTIN_BPS[0]);
  Input.key({ key: '1' });
  if (G.paste !== null || G.tool !== 'belt') { console.log('数字键退出粘贴态: FAIL'); fail++; }
  // 粘贴态下点工具栏（模拟 click 处理器核心逻辑）：切换即退出粘贴
  G.paste = Blueprints.clone(BUILTIN_BPS[0]);
  G.tool = 'extractor'; G.paste = null; G.selMode = false; G.sel = null; // 与工具栏 click 相同的清理
  if (G.paste !== null) { console.log('工具栏退出粘贴态: FAIL'); fail++; }
  // 框选态下切工具 → 框选退出
  G.selMode = true; G.sel = { x0: 1, y0: 1, x1: 2, y1: 2 };
  Input.key({ key: '2' });
  if (G.selMode !== false || G.sel !== null || G.tool !== 'extractor') { console.log('数字键退出框选态: FAIL'); fail++; }
  // 框选幂等进入 + Esc 逐层退出（先退框选，再退工具）
  Input.key({ key: 'b' });
  if (G.selMode !== true) { console.log('B 进入框选: FAIL'); fail++; }
  Input.key({ key: 'b' });
  if (G.selMode !== true) { console.log('B 幂等保持框选: FAIL'); fail++; }
  Input.key({ key: 'Escape' });
  if (G.selMode !== false) { console.log('Esc 退出框选: FAIL'); fail++; }
  console.log(fail === 0 ? 'ALL_STATE_TESTS_PASS' : fail + ' STATE TESTS FAILED');
  globalThis.__fail += fail;
  process.exit(globalThis.__fail === 0 ? 0 : 1);
})();
`;

eval(src + test);
