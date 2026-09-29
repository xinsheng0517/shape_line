'use strict';
/* render.js — Canvas 渲染（D15 全屏 / D16 动态 TILE / D17 工业风美术）
 * 结构：全屏地板（渐变+扫描线+金属网格，离屏缓存） → 机器静态底座（离屏缓存）
 *       → 动态覆盖层（钻头/激光/能量环等，渲染帧推进） → 物品 → 粒子 → 全息预览。
 * 坐标约定：draw() 先把画布变换到「网格本地坐标系」（原点 ox,oy + dpr 缩放），
 * 之后一切绘制只用格子数 × TILE；像素入口统一为 tilePx()/gridToPx()（5.4）。
 * 只读游戏状态；粒子/回弹/脉冲/光环属表现层状态，全部以 performance.now() 推进。
 */

const Render = {
  cv: null, ctx: null, pctx: null, dpr: 1, _fxLast: 0,
  cssW: 0, cssH: 0,      // 画布 CSS 尺寸：以实际可见视口为准
  ox: 0, oy: 0,          // 网格原点（画布本地 CSS px）
  u: 1,                  // 美术细节缩放因子 = TILE/32（全部造型按 32px 基准设计）
  _floor: null,          // 静态地板离屏缓存（含背景与网格线，resize 时重建）
  _bases: {},            // 机器静态底座缓存 key=type:dir[:shapeType:x:y] → 离屏 canvas
  _anims: new Map(),     // 放置压缩回弹：'x,y' → t0
  _prevOcc: new Map(),   // 上一帧机器占用快照 'x,y' → 是否加工中（检测放置/拆除/加工完成）
  _lastTick: 0,          // 检关卡切换（tickCount 回卷时清空表现层快照）
  _rings: [],            // 交付冲击波环 { x, y, t0 }
  _hubPulsePrev: 0,
  lowFx: false,          // 性能降级开关：关扫描线/皮带纹理滚动/环境粒子（风险6 对策）
  _fpsAcc: 0, _fpsN: 0, _fpsChecked: false,

  init() {
    this.cv = document.getElementById('game');
    this.resize();
    const pv = document.getElementById('target-canvas');
    pv.width = 48 * this.dpr; pv.height = 48 * this.dpr;
    this.pctx = pv.getContext('2d');
    this.pctx.scale(this.dpr, this.dpr);
  },

  // ===== 像素统一入口（5.4）：渲染层所有像素计算经此，禁止直接乘 TILE =====
  tilePx() { return TILE; },
  gridToPx(gx, gy) { return { x: this.ox + gx * TILE, y: this.oy + gy * TILE }; },

  // 全屏自适应（D15）+ 视口驱动 TILE（D16）：画布占满视口，网格在 UI 安全区内居中
  resize() {
    if (!this.cv) return;
    const viewport = window.visualViewport;
    const vw = viewport && viewport.width || window.innerWidth || 1280;
    const vh = viewport && viewport.height || window.innerHeight || 720;
    this.cssW = Math.max(1, Math.floor(vw));
    this.cssH = Math.max(1, Math.floor(vh));
    this.dpr = window.devicePixelRatio || 1;
    this.cv.style.width = this.cssW + 'px';
    this.cv.style.height = this.cssH + 'px';
    this.cv.width = Math.max(1, Math.round(this.cssW * this.dpr));
    this.cv.height = Math.max(1, Math.round(this.cssH * this.dpr));
    this.ctx = this.cv.getContext('2d');
    // 顶栏、托盘高度实时测量；窄屏布局变化时仍给整张网格留出空间。
    const topEl = document.getElementById('topbar'), trayEl = document.getElementById('tray');
    const topH = (topEl && topEl.offsetHeight) || 48;
    const botH = (trayEl && trayEl.offsetHeight) || 56;
    const M = 12; // 安全边距（宪法10：UI 不遮挡核心区域）
    const ins = { l: M, r: M, t: topH + 8, b: botH + 8 };
    const availW = Math.max(1, this.cssW - ins.l - ins.r);
    const availH = Math.max(1, this.cssH - ins.t - ins.b);
    TILE = computeTile(availW, availH); // 写回全局活值（模式切换时 setGridSize 也会触发本函数）
    this.u = TILE / 32;
    this.ox = ins.l + Math.max(0, (availW - GRID_W * TILE) / 2);
    this.oy = ins.t + Math.max(0, (availH - GRID_H * TILE) / 2);
    this._bases = {};
    this._buildFloor();
  },

  // ===== 静态地板：径向暗角背景 + 扫描线 + 金属地板缝网格 + 交点铆钉（整屏离屏缓存） =====
  _buildFloor() {
    const w = this.cssW, h = this.cssH, u = this.u;
    const f = document.createElement('canvas');
    f.width = Math.max(1, Math.round(w * this.dpr));
    f.height = Math.max(1, Math.round(h * this.dpr));
    const c = f.getContext('2d');
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // 背景：中心微亮、四周压暗的径向渐变
    let g = c.createRadialGradient(w / 2, h * 0.42, Math.min(w, h) * 0.08, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, '#1a2133'); g.addColorStop(0.55, '#121625'); g.addColorStop(1, '#090b12');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    // 扫描线微纹理（低透明度，不抢主体；降级时跳过）
    if (!this.lowFx) {
      c.fillStyle = 'rgba(255,255,255,.014)';
      for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1);
    }
    // 网格地板面板：比网格大一圈的金属台面
    const gx = this.ox, gy = this.oy, gw = GRID_W * TILE, gh = GRID_H * TILE, pad = 7 * u;
    g = c.createLinearGradient(gx, gy - pad, gx, gy + gh + pad);
    g.addColorStop(0, '#1b2133'); g.addColorStop(1, '#131724');
    c.fillStyle = g;
    this.rrect(c, gx - pad, gy - pad, gw + pad * 2, gh + pad * 2, 10 * u); c.fill();
    c.strokeStyle = '#2c3550'; c.lineWidth = 1.5;
    this.rrect(c, gx - pad, gy - pad, gw + pad * 2, gh + pad * 2, 10 * u); c.stroke();
    // 地板缝：深色凹槽 + 下侧 1px 微高光，营造金属板拼缝
    c.lineWidth = 1;
    for (let x = 1; x < GRID_W; x++) {
      const px = gx + x * TILE;
      c.strokeStyle = 'rgba(8,10,16,.7)';
      c.beginPath(); c.moveTo(px - 0.5, gy); c.lineTo(px - 0.5, gy + gh); c.stroke();
      c.strokeStyle = 'rgba(140,160,210,.05)';
      c.beginPath(); c.moveTo(px + 0.5, gy); c.lineTo(px + 0.5, gy + gh); c.stroke();
    }
    for (let y = 1; y < GRID_H; y++) {
      const py = gy + y * TILE;
      c.strokeStyle = 'rgba(8,10,16,.7)';
      c.beginPath(); c.moveTo(gx, py - 0.5); c.lineTo(gx + gw, py - 0.5); c.stroke();
      c.strokeStyle = 'rgba(140,160,210,.05)';
      c.beginPath(); c.moveTo(gx, py + 0.5); c.lineTo(gx + gw, py + 0.5); c.stroke();
    }
    // 交点铆钉
    if (!this.lowFx) {
      c.fillStyle = 'rgba(150,170,220,.09)';
      for (let x = 0; x <= GRID_W; x++) for (let y = 0; y <= GRID_H; y++) {
        c.beginPath(); c.arc(gx + x * TILE, gy + y * TILE, Math.max(0.8, 1.1 * u), 0, 7); c.fill();
      }
    }
    this._floor = f;
  },

  drawPreview(shape) {
    const c = this.pctx;
    c.clearRect(0, 0, 48, 48);
    this.shapeIcon(c, shape, 24, 24, 19);
  },

  draw(alpha) {
    const ctx = this.ctx, now = performance.now();
    let fdt = (now - this._fxLast) / 1000;
    this._fxLast = now;
    if (!(fdt > 0) || fdt > 0.1) fdt = 0.016;
    this._fpsTrack(fdt);
    if (G.tickCount < this._lastTick) { // 切关/重开：清空表现层快照，避免旧格爆碎片
      this._prevOcc.clear(); this._anims.clear(); this._rings.length = 0;
    }
    this._lastTick = G.tickCount;

    // 全屏地板（静态缓存整屏贴回）
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this._floor) ctx.drawImage(this._floor, 0, 0, this.cssW, this.cssH);

    // 进入网格本地坐标系（原点 = 网格左上角）
    ctx.setTransform(this.dpr, 0, 0, this.dpr, this.ox * this.dpr, this.oy * this.dpr);

    this._diffGrid(now); // 放置回弹 / 拆除碎片 / 加工闪光的事件检测（表现层）

    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const c = G.grid[y][x];
      if (c && c.type === 'resource') this.resource(ctx, c, now);
    }
    this.guideLayer(ctx, now); // 教学引导幽灵（仅教程模式，垫在实机器下层）
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const c = G.grid[y][x];
      if (!c || c.type === 'resource') continue;
      this.machine(ctx, c, alpha, now);
    }
    this.items(ctx, alpha);
    this.fx(ctx, fdt);
    this.rings(ctx, now);
    this.selRect(ctx);
    if (G.paste) this.bpGhost(ctx); else this.ghost(ctx, now);
    if (G.v2 || G.v3) this.v2Hover(ctx);

    if (G.paused && !G.won) { // 全屏暂停遮罩
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = 'rgba(10,12,20,.55)';
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.fillStyle = '#dbe2f1';
      ctx.font = '600 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('已暂停 · 按空格继续', this.cssW / 2, this.cssH / 2);
    }
  },

  // 简单帧率自检：前 180 帧均值超 22ms 则自动降级（关扫描线/纹理滚动/环境粒子）
  _fpsTrack(fdt) {
    if (this._fpsChecked) return;
    this._fpsAcc += fdt; this._fpsN++;
    if (this._fpsN >= 180) {
      this._fpsChecked = true;
      if (this._fpsAcc / this._fpsN > 0.022) { this.lowFx = true; this._buildFloor(); }
    }
  },

  // 占用快照差分：新机器 → 回弹+尘土；消失 → 碎片飞溅；加工结束 → 小闪光（全部表现层，不回写状态）
  _diffGrid(now) {
    const cur = new Map();
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const c = G.grid[y][x];
      if (!c || c.type === 'resource') continue;
      cur.set(x + ',' + y, !!c.proc);
    }
    for (const [k, proc] of cur) {
      const coma = k.indexOf(','), x = +k.slice(0, coma), y = +k.slice(coma + 1);
      if (!this._prevOcc.has(k)) {
        this._anims.set(k, now);
        if (!this.lowFx && ctx1()) {
          const isBelt = G.grid[y][x].type === 'belt';
          burst(x, y, '#8a93a8', isBelt ? 2 : 6); // 尘土
        }
      } else if (this._prevOcc.get(k) && !proc && !this.lowFx) {
        burst(x, y, '#d8f7dc', 3); // 加工完成闪光
      }
    }
    for (const k of this._prevOcc.keys()) {
      if (!cur.has(k)) {
        const coma = k.indexOf(','), x = +k.slice(0, coma), y = +k.slice(coma + 1);
        burst(x, y, '#6a7286', this.lowFx ? 4 : 10); // 拆除碎片
        this._anims.delete(k);
      }
    }
    this._prevOcc = cur;
    function ctx1() { return true; } // 占位：粒子生成与全局 Alpha 无关（幽灵不触发，因其不在网格中）
  },

  // 教学引导：把本关参考解画成半透明幽灵，玩家放对位置后幽灵被实机覆盖
  guideLayer(ctx, now) {
    if (G.v2) {
      if (!G.v2.showGuide || !G.v2.def || !G.v2.def.guide) return;
      ctx.save(); ctx.globalAlpha = 0.2;
      for (const g of G.v2.def.guide) {
        if (G.grid[g.y] && G.grid[g.y][g.x]) continue;
        this.machine(ctx, { type: g.type, x: g.x, y: g.y, dir: g.dir, machineMode: g.machineMode }, 0, now);
      }
      ctx.restore();
      return;
    }
    if (G.mode !== 'tutorial') return;
    const g = LEVELS[G.levelIndex] && LEVELS[G.levelIndex].guide;
    if (!g) return;
    ctx.save();
    ctx.globalAlpha = 0.22;
    for (const [type, x, y, dir] of g) {
      if (G.grid[y] && G.grid[y][x]) continue; // 已放置（任意东西）则不显示
      this.machine(ctx, { type, x, y, dir }, 0, now);
    }
    ctx.restore();
  },

  // ===== 机器静态底座：离屏缓存（TILE 变化即随 resize 重建） =====
  _base(c) {
    const key = c.type === 'resource'
      ? 'res:' + (c.shapeType && c.shapeType.kind === 'trapezoid-v2' ?
        (c.shapeType.units || []).map(v => v.resource).join('') : c.shapeType) + ':' + c.x + ',' + c.y // 矿石散布按坐标定死，不闪烁
      : c.type + ':' + (c.dir || 0);
    let b = this._bases[key];
    if (!b) { b = this._paintBase(c); this._bases[key] = b; }
    return b;
  },

  // 在 0..TILE 本地坐标内绘制静态部分；动态部分由 machine()/resource() 的覆盖层画
  _paintBase(c) {
    const T = TILE, u = this.u, T2 = T / 2;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(T * this.dpr));
    cv.height = Math.max(1, Math.round(T * this.dpr));
    const g = cv.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const plate = (c0, c1, edge) => { // 通用金属底盘：纵向渐变圆角板 + 内缘高光
      const lg = g.createLinearGradient(0, 2 * u, 0, T - 2 * u);
      lg.addColorStop(0, c0); lg.addColorStop(1, c1);
      g.fillStyle = lg;
      this.rrect(g, 1.5 * u, 1.5 * u, T - 3 * u, T - 3 * u, 5 * u); g.fill();
      g.strokeStyle = edge || 'rgba(8,10,16,.85)'; g.lineWidth = Math.max(1, u);
      this.rrect(g, 2 * u, 2 * u, T - 4 * u, T - 4 * u, 4.5 * u); g.stroke();
    };
    const rivets = (inset, color) => { // 四角铆钉
      g.fillStyle = color;
      for (const [rx, ry] of [[inset, inset], [T - inset, inset], [inset, T - inset], [T - inset, T - inset]]) {
        g.beginPath(); g.arc(rx, ry, 1.3 * u, 0, 7); g.fill();
      }
    };
    switch (c.type) {
      case 'belt': {
        plate('#212840', '#151a29');
        g.save(); this._rot(g, c.dir, T); // 统一画「流向朝右」原型
        // 皮带带面：垂直流向的渐变压出两侧暗边
        const bg = g.createLinearGradient(0, T2 - T * 0.27, 0, T2 + T * 0.27);
        bg.addColorStop(0, '#0d1120'); bg.addColorStop(0.5, '#1d2438'); bg.addColorStop(1, '#0d1120');
        g.fillStyle = bg;
        g.fillRect(2 * u, T2 - T * 0.27, T - 4 * u, T * 0.54);
        // 金属侧轨（包边）
        const rail = g.createLinearGradient(0, 0, 0, 4 * u);
        rail.addColorStop(0, '#4a5578'); rail.addColorStop(1, '#262e45');
        g.fillStyle = rail;
        g.fillRect(2 * u, T2 - T * 0.27 - 3.4 * u, T - 4 * u, 3.4 * u);
        g.fillRect(2 * u, T2 + T * 0.27, T - 4 * u, 3.4 * u);
        // 侧轨铆钉
        g.fillStyle = '#5d688a';
        for (const fx of [0.22, 0.5, 0.78]) {
          g.beginPath(); g.arc(T * fx, T2 - T * 0.27 - 1.7 * u, 1.1 * u, 0, 7); g.fill();
          g.beginPath(); g.arc(T * fx, T2 + T * 0.27 + 1.7 * u, 1.1 * u, 0, 7); g.fill();
        }
        g.restore();
        break;
      }
      case 'extractor': { // 采矿钻机：多层基座
        plate('#2d2544', '#1e1930');
        g.fillStyle = '#171224'; // 中层环座
        g.beginPath(); g.arc(T2, T2, T * 0.32, 0, 7); g.fill();
        g.strokeStyle = '#463a66'; g.lineWidth = 1.6 * u;
        g.beginPath(); g.arc(T2, T2, T * 0.32, 0, 7); g.stroke();
        g.fillStyle = '#241d3a'; // 上层钻台
        g.beginPath(); g.arc(T2, T2, T * 0.22, 0, 7); g.fill();
        g.strokeStyle = '#584a7d'; g.lineWidth = u;
        g.beginPath(); g.arc(T2, T2, T * 0.22, 0, 7); g.stroke();
        rivets(5 * u, '#4c4170');
        break;
      }
      case 'cutter': { // 激光切割机：金属外壳 + 安全警示条纹
        plate('#352230', '#231722');
        g.save(); this._rot(g, c.dir, T);
        // 上下沿警示条纹（黄黑斜纹）
        for (const sy of [3.4 * u, T - 3.4 * u - 3.2 * u]) {
          g.save();
          g.beginPath(); g.rect(3 * u, sy, T - 6 * u, 3.2 * u); g.clip();
          g.fillStyle = '#d9a92e'; g.fillRect(3 * u, sy, T - 6 * u, 3.2 * u);
          g.fillStyle = '#191920';
          for (let sx = -4 * u; sx < T; sx += 7 * u) {
            g.beginPath();
            g.moveTo(sx, sy + 3.2 * u); g.lineTo(sx + 3.2 * u, sy);
            g.lineTo(sx + 6.4 * u, sy); g.lineTo(sx + 3.2 * u, sy + 3.2 * u);
            g.closePath(); g.fill();
          }
          g.restore();
        }
        // 激光刀缝（竖向，垂直于流向）
        g.fillStyle = '#0b070c';
        g.fillRect(T2 - 2 * u, T * 0.2, 4 * u, T * 0.6);
        g.restore();
        rivets(5 * u, '#5e3a48');
        break;
      }
      case 'rotator': { // 机械转盘：齿轮底座
        plate('#1f332b', '#15231d');
        g.fillStyle = '#27443a'; // 齿轮：八齿外圈
        for (let i = 0; i < 8; i++) {
          g.save();
          g.translate(T2, T2); g.rotate(i * Math.PI / 4);
          g.fillRect(-2.4 * u, -T * 0.36, 4.8 * u, 4.4 * u);
          g.restore();
        }
        g.beginPath(); g.arc(T2, T2, T * 0.34, 0, 7); g.fill();
        g.strokeStyle = '#101b15'; g.lineWidth = u;
        g.beginPath(); g.arc(T2, T2, T * 0.34, 0, 7); g.stroke();
        g.fillStyle = '#1a2c24'; // 内平台
        g.beginPath(); g.arc(T2, T2, T * 0.24, 0, 7); g.fill();
        g.strokeStyle = '#39614f'; g.lineWidth = u;
        g.beginPath(); g.arc(T2, T2, T * 0.24, 0, 7); g.stroke();
        break;
      }
      case 'merger': { // 冲压融合机：外壳 + 双进料槽（背面/右侧）
        plate('#302c18', '#211e10');
        g.save(); this._rot(g, c.dir, T);
        g.fillStyle = '#0f0d06'; // 背面进料槽（本地左）与右侧进料槽（本地…旋转后朝上？约定：右侧=本地 -y）
        g.fillRect(1.5 * u, T2 - 5 * u, 5 * u, 10 * u);        // 背面口
        g.fillRect(T2 - 5 * u, 1.5 * u, 10 * u, 5 * u);        // 右侧口（本地 -y = 流向右侧）
        g.restore();
        const cg = g.createRadialGradient(T2, T2, 1, T2, T2, T * 0.24); // 融合腔
        cg.addColorStop(0, '#4a421e'); cg.addColorStop(1, '#26220f');
        g.fillStyle = cg;
        g.beginPath(); g.arc(T2, T2, T * 0.24, 0, 7); g.fill();
        g.strokeStyle = '#8a7428'; g.lineWidth = 1.4 * u;
        g.beginPath(); g.arc(T2, T2, T * 0.24, 0, 7); g.stroke();
        rivets(5 * u, '#6a5c26');
        break;
      }
      case 'trash': { // 工业粉碎机：粉碎齿 + 深口
        plate('#30232a', '#1f161c');
        const mg = g.createRadialGradient(T2, T2, 1, T2, T2, T * 0.3); // 粉碎深口
        mg.addColorStop(0, '#070409'); mg.addColorStop(1, '#1c1016');
        g.fillStyle = mg;
        g.beginPath(); g.arc(T2, T2, T * 0.3, 0, 7); g.fill();
        g.strokeStyle = '#53282f'; g.lineWidth = 1.6 * u;
        g.beginPath(); g.arc(T2, T2, T * 0.3, 0, 7); g.stroke();
        g.fillStyle = '#6b3640'; // 上下两排粉碎齿，相对咬合
        for (let i = 0; i < 5; i++) {
          const tx = T * (0.18 + i * 0.16);
          g.beginPath(); g.moveTo(tx - 3 * u, T2 - T * 0.28); g.lineTo(tx + 3 * u, T2 - T * 0.28); g.lineTo(tx, T2 - T * 0.13); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(tx - 3 * u, T2 + T * 0.28); g.lineTo(tx + 3 * u, T2 + T * 0.28); g.lineTo(tx, T2 + T * 0.13); g.closePath(); g.fill();
        }
        break;
      }
      case 'hub': { // 中央控制室：多层基座
        plate('#3d3113', '#28200d', 'rgba(242,169,59,.5)');
        g.strokeStyle = '#8a6a1f'; g.lineWidth = 1.8 * u;
        g.beginPath(); g.arc(T2, T2, T * 0.37, 0, 7); g.stroke();
        const hg = g.createRadialGradient(T2, T2, 1, T2, T2, T * 0.3);
        hg.addColorStop(0, '#4a3a16'); hg.addColorStop(1, '#2c240e');
        g.fillStyle = hg;
        g.beginPath(); g.arc(T2, T2, T * 0.3, 0, 7); g.fill();
        g.strokeStyle = '#f2a93b'; g.lineWidth = u;
        g.beginPath(); g.arc(T2, T2, T * 0.3, 0, 7); g.stroke();
        rivets(4.6 * u, '#8a6a1f');
        break;
      }
      case 'resource': { // 矿脉矿床：立体岩床 + 散落矿石（按坐标确定性散布）
        const v2res = c.shapeType && c.shapeType.kind === 'trapezoid-v2';
        const col = v2res ? '#82b9de' : SHAPE_COLOR[c.shapeType];
        g.fillStyle = '#12161f'; // 岩床底
        g.beginPath(); g.arc(T2, T2, T * 0.46, 0, 7); g.fill();
        g.fillStyle = '#1a2130'; // 岩块隆起
        const seed = c.x * 31 + c.y * 17;
        for (let i = 0; i < 3; i++) {
          const a = (seed + i * 2.4) % 6.28, rr = T * (0.16 + ((seed + i * 7) % 10) / 60);
          g.beginPath(); g.arc(T2 + Math.cos(a) * T * 0.16, T2 + Math.sin(a) * T * 0.16, rr, 0, 7); g.fill();
        }
        g.strokeStyle = col + '44'; g.lineWidth = 1.4 * u;
        g.beginPath(); g.arc(T2, T2, T * 0.42, 0, 7); g.stroke();
        for (let i = 0; i < 4; i++) { // 散落小矿石
          const a = (seed + i * 1.9) % 6.28, rr = T * (0.3 + ((seed + i * 5) % 8) / 40);
          this.shapeIcon(g, v2res ? c.shapeType : [c.shapeType, c.shapeType, c.shapeType, c.shapeType],
            T2 + Math.cos(a) * rr, T2 + Math.sin(a) * rr, 2.6 * u);
        }
        this.shapeIcon(g, v2res ? c.shapeType : [c.shapeType, c.shapeType, c.shapeType, c.shapeType], T2, T2, 8 * u); // 主矿
        break;
      }
    }
    return cv;
  },

  resource(ctx, c, now) {
    const T = TILE, u = this.u, x = c.x * T, y = c.y * T, cx = x + T / 2, cy = y + T / 2;
    ctx.drawImage(this._base(c), x, y, T, T);
    const col = c.shapeType && c.shapeType.kind === 'trapezoid-v2' ? '#82b9de' : SHAPE_COLOR[c.shapeType];
    // 脉动光晕
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.3 + 0.18 * Math.sin(now / 420 + c.x);
    ctx.lineWidth = 2 * u;
    ctx.beginPath(); ctx.arc(cx, cy, T * 0.44 + Math.sin(now / 400) * 2 * u, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
    // 矿脉微光闪点（无状态，按相位算）
    if (!this.lowFx) {
      for (let i = 0; i < 2; i++) {
        const ph = (now / 900 + i * 0.5 + c.x * 0.13 + c.y * 0.07) % 1;
        const a = (c.x * 31 + c.y * 17 + i * 2.4) % 6.28;
        ctx.globalAlpha = Math.max(0, 0.5 - Math.abs(ph - 0.5)) * 1.2;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * T * 0.3, cy + Math.sin(a) * T * 0.3, 1.4 * u, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  },

  machine(ctx, c, alpha, now) {
    const T = TILE, u = this.u;
    const x = c.x * T, y = c.y * T, cx = x + T / 2, cy = y + T / 2, d = DIRV[c.dir];
    // 放置压缩回弹：1.2 → 0.95 → 1，约 190ms（「咚」的重量感）
    let sc = 1;
    const t0 = this._anims.get(c.x + ',' + c.y);
    if (t0 !== undefined) {
      const k = (now - t0) / 190;
      if (k >= 1) this._anims.delete(c.x + ',' + c.y);
      else sc = 1 + 0.2 * (1 - k) * (1 - k) * Math.cos(k * Math.PI * 2);
    }
    ctx.save();
    if (sc !== 1) { ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy); }
    ctx.drawImage(this._base(c), x, y, T, T);
    const solid = ctx.globalAlpha >= 1; // 教学幽灵不产粒子
    switch (c.type) {
      case 'belt': {
        // 保持布线阶段也有流向提示；供料与模拟暂停不影响这层纯视觉动画。
        this.beltFlow(ctx, c.dir, x, y, (now / 300) % 1);
        break;
      }
      case 'extractor': { // 旋转钻头 + 资源色光晕 + 碎屑
        const rt = Sim.adjResource(c);
        const rtColor = rt && rt.kind === 'trapezoid-v2' ? '#82b9de' : SHAPE_COLOR[rt];
        if (rt) { // 资源色呼吸光晕
          ctx.strokeStyle = rtColor;
          ctx.globalAlpha = (0.3 + 0.2 * Math.sin(now / 460)) * (solid ? 1 : 1);
          ctx.lineWidth = 2 * u;
          ctx.beginPath(); ctx.arc(cx, cy, T * 0.36, 0, 7); ctx.stroke();
          ctx.globalAlpha = solid ? ctx.globalAlpha : ctx.globalAlpha; // 透明度继承（幽灵层统一 0.22）
          ctx.globalAlpha = 1;
        }
        ctx.save(); // 钻头：三叶螺旋桨 + 中心轴
        ctx.translate(cx, cy);
        ctx.rotate(now / 300 % (Math.PI * 2));
        ctx.fillStyle = rt ? rtColor : '#8a93a8';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(0, -2.6 * u); ctx.lineTo(T * 0.2, -1 * u); ctx.lineTo(T * 0.2, 1 * u); ctx.lineTo(0, 2.6 * u);
          ctx.closePath(); ctx.fill();
          ctx.rotate(Math.PI * 2 / 3);
        }
        ctx.fillStyle = '#14101f';
        ctx.beginPath(); ctx.arc(0, 0, 2.4 * u, 0, 7); ctx.fill();
        ctx.restore();
        if (solid && !this.lowFx && Math.random() < 0.02) burst(c.x, c.y, rt ? rtColor : '#8a93a8', 1); // 碎屑
        this.port(ctx, c.x, c.y, c.dir, 'out'); // 出口：正面
        break;
      }
      case 'cutter': { // 激光束 + 切割火花
        if (G.v3) for (const dir of [c.dir, (c.dir + 1) % 4]) {
          const side = DIRV[dir];
          ctx.fillStyle = '#141c2b'; ctx.strokeStyle = '#8baac9'; ctx.lineWidth = 1.2 * u;
          ctx.beginPath(); ctx.arc(cx + side[0] * 9 * u, cy + side[1] * 9 * u, 6.5 * u, 0, 7);
          ctx.fill(); ctx.stroke();
        }
        ctx.save(); this._rot(ctx, c.dir, T);
        const pulse = 0.65 + 0.35 * Math.sin(now / 170);
        ctx.strokeStyle = 'rgba(255,90,74,' + (0.22 * pulse).toFixed(3) + ')'; // 外晕
        ctx.lineWidth = 5 * u;
        ctx.beginPath(); ctx.moveTo(cx, cy - 11 * u); ctx.lineTo(cx, cy + 11 * u); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,90,74,' + (0.85 * pulse).toFixed(3) + ')'; // 束体
        ctx.lineWidth = 2.2 * u;
        ctx.beginPath(); ctx.moveTo(cx, cy - 11 * u); ctx.lineTo(cx, cy + 11 * u); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,224,216,' + pulse.toFixed(3) + ')'; // 亮芯
        ctx.lineWidth = u;
        ctx.beginPath(); ctx.moveTo(cx, cy - 11 * u); ctx.lineTo(cx, cy + 11 * u); ctx.stroke();
        ctx.restore();
        if (solid && c.proc && !this.lowFx && Math.random() < 0.25) burst(c.x, c.y, '#ffc46a', 1); // 切割火花
        this.port(ctx, c.x, c.y, (c.dir + 2) % 4, 'in');  // 入口：背面
        if ((G.v2 && c.machineMode === 'fine') || G.v3) this.port(ctx, c.x, c.y, (c.dir + 3) % 4, 'in'); // 回送第二入口
        this.port(ctx, c.x, c.y, c.dir, 'out');           // 出口1：正面（右半）
        this.port(ctx, c.x, c.y, (c.dir + 1) % 4, 'out'); // 出口2：右侧（左半）
        break;
      }
      case 'rotator': { // 旋转平台 + 机械臂 + 绿色能量环
        const a0 = now / 400 % (Math.PI * 2);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a0); // 旋转平台纹理
        ctx.strokeStyle = '#2f5243';
        ctx.lineWidth = 1.6 * u;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(T * 0.2, 0); ctx.stroke();
          ctx.rotate(Math.PI * 2 / 3);
        }
        ctx.restore();
        const ae = a0 + Math.PI * 1.4; // 机械臂（旋转方向指示，沿用 V1 读法）
        ctx.strokeStyle = '#7bd88f';
        ctx.lineWidth = 2.4 * u;
        ctx.beginPath(); ctx.arc(cx, cy, 8.5 * u, a0, ae); ctx.stroke();
        this.arrowAngle(ctx, cx + Math.cos(ae) * 8.5 * u, cy + Math.sin(ae) * 8.5 * u, ae + Math.PI / 2, '#7bd88f');
        ctx.strokeStyle = 'rgba(123,216,143,' + (0.22 + 0.16 * Math.sin(now / 500)).toFixed(3) + ')'; // 能量环
        ctx.lineWidth = 1.6 * u;
        ctx.beginPath(); ctx.arc(cx, cy, T * 0.3, 0, 7); ctx.stroke();
        this.port(ctx, c.x, c.y, (c.dir + 2) % 4, 'in');  // 入口：背面
        this.port(ctx, c.x, c.y, c.dir, 'out');           // 出口：正面
        break;
      }
      case 'merger': { // 融合腔脉冲 + 加工时金色焊接火花
        ctx.save(); this._rot(ctx, c.dir, T);
        const r = DIRV[(c.dir + 1) % 4];
        ctx.strokeStyle = 'rgba(232,210,122,.4)'; // 双进料导向线（本地：背面=左，右侧=上）
        ctx.lineWidth = 1.6 * u;
        ctx.beginPath();
        ctx.moveTo(cx - 11 * u, cy); ctx.lineTo(cx - 3.5 * u, cy);
        ctx.moveTo(cx, cy - 11 * u); ctx.lineTo(cx, cy - 3.5 * u);
        ctx.stroke();
        ctx.restore();
        const pr = T * (0.1 + (c.proc ? 0.03 : 0) + 0.015 * Math.sin(now / 240));
        ctx.fillStyle = c.proc ? '#ffe89a' : '#e8d27a'; // 融合核心
        ctx.globalAlpha *= 0.9;
        ctx.beginPath(); ctx.arc(cx, cy, pr, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(232,210,122,' + (0.3 + 0.25 * Math.sin(now / 240)).toFixed(3) + ')'; // 能量脉冲环
        ctx.lineWidth = 1.4 * u;
        ctx.beginPath(); ctx.arc(cx, cy, T * 0.17 + Math.sin(now / 240) * 1.6 * u, 0, 7); ctx.stroke();
        if (solid && c.proc && !this.lowFx && Math.random() < 0.22) burst(c.x, c.y, '#ffd97a', 1); // 焊接火花
        this.port(ctx, c.x, c.y, (c.dir + 2) % 4, 'in');  // 入口1：背面（底）
        this.port(ctx, c.x, c.y, (c.dir + 1) % 4, 'in');  // 入口2：右侧（补）
        this.port(ctx, c.x, c.y, c.dir, 'out');           // 出口：正面
        break;
      }
      case 'trash': { // 闪烁警示灯 + 吸入粒子（无状态相位动画）
        const blink = Math.sin(now / 150) > 0;
        ctx.fillStyle = blink ? '#ff5a4a' : '#5a2426';
        ctx.beginPath(); ctx.arc(c.x * T + 5.4 * u, c.y * T + 5.4 * u, 2 * u, 0, 7); ctx.fill();
        if (blink) {
          ctx.strokeStyle = 'rgba(255,90,74,.4)';
          ctx.lineWidth = u;
          ctx.beginPath(); ctx.arc(c.x * T + 5.4 * u, c.y * T + 5.4 * u, 3.4 * u, 0, 7); ctx.stroke();
        }
        if (!this.lowFx) for (let i = 0; i < 3; i++) { // 碎屑被吸入粉碎口
          const ph = (now / 650 + i / 3) % 1;
          const a = ph * 3.1 + i * 2.1;
          const rr = (1 - ph) * T * 0.26;
          ctx.globalAlpha = 0.15 + ph * 0.45;
          ctx.fillStyle = '#c56a6a';
          ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.3 * u, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'hub': { // 能量场 + 数据流 + 全息目标屏（保留交付脉冲回弹）
        const pulse = 1 + G.hubPulse * 0.12;
        G.hubPulse *= 0.94;
        ctx.save();
        ctx.translate(cx, cy); ctx.scale(pulse, pulse); ctx.translate(-cx, -cy);
        ctx.strokeStyle = 'rgba(242,169,59,.55)'; // 旋转能量场（虚线环）
        ctx.lineWidth = 1.8 * u;
        ctx.setLineDash([4 * u, 5 * u]);
        ctx.lineDashOffset = -now / 28;
        ctx.beginPath(); ctx.arc(cx, cy, T * 0.41, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
        if (!this.lowFx) for (let i = 0; i < 2; i++) { // 数据流光点升向屏幕
          const ph = (now / 520 + i * 0.5) % 1;
          ctx.globalAlpha = 0.2 + ph * 0.6;
          ctx.fillStyle = '#ffd166';
          ctx.beginPath(); ctx.arc(cx + (i ? -4 * u : 4 * u), cy - ph * 13 * u, 1.3 * u, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
        // 全息目标屏：悬浮于枢纽上方
        const hy = y - 14 * u + Math.sin(now / 500) * 2 * u;
        ctx.fillStyle = 'rgba(15,18,28,.88)';
        this.rrect(ctx, cx - 14 * u, hy - 14 * u, 28 * u, 28 * u, 6 * u); ctx.fill();
        ctx.strokeStyle = '#f2a93b';
        ctx.lineWidth = 1.4 * u;
        this.rrect(ctx, cx - 14 * u, hy - 14 * u, 28 * u, 28 * u, 6 * u); ctx.stroke();
        this.shapeIcon(ctx, G.target, cx, hy, 9 * u);
        ctx.restore();
        break;
      }
    }
    if ((G.v2 || G.v3) && (c.type === 'cutter' || c.type === 'merger')) this.machineBadge(ctx, c);
    ctx.restore();
  },

  machineBadge(ctx, c) {
    const names = { rough: 'K1', fine: 'K2', half: 'M½', final: 'M✓', auto: 'A', vertical: 'V', horizontal: 'H' };
    const label = names[c.machineMode];
    if (!label) return;
    const u = this.u, x = c.x * TILE, y = c.y * TILE;
    ctx.save();
    ctx.font = '700 ' + Math.max(7, 8 * u) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(10,14,23,.86)';
    this.rrect(ctx, x + 2 * u, y + 2 * u, 14 * u, 9 * u, 2 * u); ctx.fill();
    ctx.fillStyle = c.locked ? '#ffd166' : '#dce8f6';
    ctx.fillText(label, x + 9 * u, y + 6.5 * u);
    ctx.restore();
  },

  items(ctx, alpha) {
    const T = TILE, u = this.u;
    const SLOTS = ['item', 'inA', 'inB', 'outA', 'outB'];
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const c = G.grid[y][x];
      if (!c || c.type === 'resource') continue;
      const d = DIRV[c.dir], r = DIRV[(c.dir + 1) % 4];
      const cutterTray = !!(G.v3 && c.type === 'cutter');
      const outputInset = cutterTray ? 9 * u : 5 * u;
      const offs = {
        item: [0, 0],
        inA: [-d[0] * 4 * u, -d[1] * 4 * u],
        inB: [r[0] * 4 * u, r[1] * 4 * u],
        outA: [d[0] * outputInset, d[1] * outputInset],
        outB: [r[0] * outputInset, r[1] * outputInset],
      };
      for (const s of SLOTS) {
        const it = c[s];
        if (!it) continue;
        const a = Math.min(1, (G.tickCount - it.moveTick + alpha) / MOVE_EVERY);
        const gx = it.fx + (c.x - it.fx) * a, gy = it.fy + (c.y - it.fy) * a;
        const size = cutterTray && (s === 'outA' || s === 'outB') ? 6 * u : 10 * u;
        this.shapeIcon(ctx, it.shape, gx * T + T / 2 + offs[s][0], gy * T + T / 2 + offs[s][1], size);
      }
      if (c.proc) { // 加工进度条 + 进度头亮点
        this.shapeIcon(ctx, c.proc.shape, x * T + T / 2, y * T + T / 2, 7 * u);
        if ((G.v2 || G.v3) && c.proc.shapeB) this.shapeIcon(ctx, c.proc.shapeB, x * T + T / 2 + 7 * u, y * T + T / 2, 5 * u);
        const p = 1 - c.proc.t / PROC_TICKS;
        ctx.fillStyle = '#57e389';
        ctx.fillRect(x * T + 5 * u, y * T + T - 6 * u, (T - 10 * u) * p, 2 * u);
        ctx.fillStyle = '#c8ffd8';
        ctx.beginPath(); ctx.arc(x * T + 5 * u + (T - 10 * u) * p, y * T + T - 5 * u, 1.6 * u, 0, 7); ctx.fill();
      }
      if ((G.v2 || G.v3) && (c.type === 'cutter' || c.type === 'merger')) this.queueMarks(ctx, c);
    }
  },

  queueMarks(ctx, c) {
    const qa = c.queueA || [], qb = c.queueB || [];
    if (!qa.length && !qb.length && !c.status) return;
    const u = this.u, x = c.x * TILE, y = c.y * TILE;
    ctx.save();
    ctx.font = '700 ' + Math.max(7, 8 * u) + 'px sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const badge = (n, bx, by, col) => {
      ctx.fillStyle = 'rgba(8,13,23,.88)';
      this.rrect(ctx, bx - 5 * u, by - 4.5 * u, 10 * u, 9 * u, 2 * u); ctx.fill();
      ctx.fillStyle = col; ctx.fillText(String(n), bx, by + 0.4 * u);
    };
    if (qa.length) badge(qa.length, x + 6 * u, y + TILE - 7 * u, '#73e7ad');
    if (qb.length) badge(qb.length, x + TILE - 6 * u, y + TILE - 7 * u, '#b1e5ff');
    if (c.status && /满|堵|缺|等待|blocked|full|wait|missing/i.test(String(c.status))) {
      ctx.fillStyle = '#ffb75e';
      ctx.beginPath(); ctx.arc(x + TILE - 5 * u, y + 5 * u, 2.7 * u, 0, 7); ctx.fill();
    }
    ctx.restore();
  },

  v2Hover(ctx) {
    const h = G.hover;
    if (!h || h.x < 0 || h.y < 0 || !G.grid[h.y]) return;
    const c = G.grid[h.y][h.x];
    if (!c || (c.type !== 'cutter' && c.type !== 'merger' && c.type !== 'belt')) return;
    const qa = c.queueA || [], qb = c.queueB || [];
    const first = qa[0] || qb[0] || c.proc || c.outA || c.outB || c.item;
    if (!qa.length && !qb.length && !c.status && !c.proc && !c.outA && !c.outB) return;
    const w = 176, hh = 82, pad = 5;
    let x = (h.x + 1) * TILE + 6;
    if (x + w > GRID_W * TILE) x = h.x * TILE - w - 6;
    const y = Math.max(pad, Math.min(GRID_H * TILE - hh - pad, h.y * TILE - hh / 2));
    ctx.save();
    ctx.fillStyle = 'rgba(13,18,30,.96)';
    this.rrect(ctx, x, y, w, hh, 7); ctx.fill();
    ctx.strokeStyle = '#58718b'; ctx.lineWidth = 1.2;
    this.rrect(ctx, x, y, w, hh, 7); ctx.stroke();
    if (first && first.shape) this.shapeIcon(ctx, first.shape, x + 37, y + 40, 27);
    ctx.fillStyle = '#e5efff'; ctx.font = '700 11px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText((c.machineMode || c.type).toUpperCase() + ' · ' + (c.locked ? '已锁定' : '可调整'), x + 72, y + 17);
    ctx.font = '10px sans-serif'; ctx.fillStyle = '#a9d4b7';
    const v3Cutter = !!(G.v3 && c.type === 'cutter');
    if (v3Cutter) {
      const stage = it => !it ? '空' : it.shape.stage === 'vertical-half' ? '半块' :
        it.shape.stage === 'quarter' ? '四分之一' : it.shape.stage;
      ctx.fillText('前出口:' + stage(c.outA) + '  侧出口:' + stage(c.outB), x + 72, y + 35);
    } else ctx.fillText('入口 A: ' + qa.length + '   入口 B: ' + qb.length, x + 72, y + 35);
    const status = String(c.status || (c.proc ? '加工中' : '等待材料'));
    ctx.fillStyle = /满|堵|缺|未连接|blocked|full|missing/i.test(status) ? '#ffbd77' : '#b9cce3';
    const parts = v3Cutter ? status.split('；') : [status];
    ctx.fillText(parts[0].length > 24 ? parts[0].slice(0, 23) + '…' : parts[0], x + 72, y + 53);
    if (parts.length > 1) {
      ctx.fillText(parts[1].length > 24 ? parts[1].slice(0, 23) + '…' : parts[1], x + 72, y + 69);
    } else if (first && first.shape && (first.shape.kind === 'trapezoid-v2' || first.shape.kind === 'petal-v3')) {
      const s = first.shape, mats = (s.units || []).map(v => v.resource).join('');
      ctx.fillStyle = '#9eb3c9';
      ctx.fillText((s.recipeId || mats) + ' · ' + s.stage, x + 72, y + 69);
    }
    ctx.restore();
  },

  fx(ctx, dt) {
    const ps = G.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= dt * 1.6;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
  },

  // 交付冲击波环：hubPulse 上升沿触发，金色扩张环
  rings(ctx, now) {
    if (G.hubPulse > 0.9 && this._hubPulsePrev <= 0.9) {
      for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
        const c = G.grid[y][x];
        if (c && c.type === 'hub') {
          this._rings.push({ x, y, t0: now });
          if (!this.lowFx) burst(x, y, '#ffd166', 14); // 金色爆发
        }
      }
    }
    this._hubPulsePrev = G.hubPulse;
    for (let i = this._rings.length - 1; i >= 0; i--) {
      const rg = this._rings[i], k = (now - rg.t0) / 520;
      if (k >= 1) { this._rings.splice(i, 1); continue; }
      const cx = rg.x * TILE + TILE / 2, cy = rg.y * TILE + TILE / 2;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = (3.5 * (1 - k) + 0.8) * this.u;
      ctx.beginPath(); ctx.arc(cx, cy, (0.35 + k * 1.8) * TILE, 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  // 框选高亮矩形
  selRect(ctx) {
    if (!G.selMode) return;
    ctx.fillStyle = 'rgba(88,166,255,.06)';
    ctx.fillRect(0, 0, GRID_W * TILE, GRID_H * TILE);
    if (!G.sel) return;
    const s = G.sel;
    const x = Math.min(s.x0, s.x1) * TILE, y = Math.min(s.y0, s.y1) * TILE;
    const w = (Math.abs(s.x1 - s.x0) + 1) * TILE, h = (Math.abs(s.y1 - s.y0) + 1) * TILE;
    ctx.fillStyle = 'rgba(88,166,255,.14)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#58a6ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.setLineDash([]);
  },

  // 蓝图粘贴幽灵：蓝色线框 + 底纹（蓝图风），冲突格单独标红框
  bpGhost(ctx) {
    const bp = G.paste, h = G.hover, u = this.u;
    if (!bp || h.x < 0 || h.y < 0) return;
    const bad = Blueprints.check(bp, h.x, h.y);
    for (const c of bp.cells) {
      const x = (h.x + c.dx) * TILE, y = (h.y + c.dy) * TILE;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = bad ? 'rgba(110,61,61,.5)' : 'rgba(61,110,178,.42)';
      this.rrect(ctx, x + 2 * u, y + 2 * u, TILE - 4 * u, TILE - 4 * u, 5 * u); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = bad ? '#e08a8a' : '#6aa8ff'; // 蓝图线框
      ctx.lineWidth = 1.3 * u;
      this.rrect(ctx, x + 2 * u, y + 2 * u, TILE - 4 * u, TILE - 4 * u, 5 * u); ctx.stroke();
      ctx.strokeStyle = bad ? 'rgba(224,138,138,.3)' : 'rgba(106,168,255,.3)'; // 对角底纹
      ctx.lineWidth = u;
      ctx.beginPath();
      ctx.moveTo(x + 3 * u, y + TILE - 3 * u); ctx.lineTo(x + TILE - 3 * u, y + 3 * u);
      ctx.stroke();
      if (c.type === 'belt') this.beltFlow(ctx, c.dir, x, y, (performance.now() / 300) % 1);
      else {
        const d = DIRV[c.dir];
        this.arrowAt(ctx, x + TILE / 2 + d[0] * 2 * u, y + TILE / 2 + d[1] * 2 * u, c.dir, bad ? '#e08a8a' : '#9fc8ff');
      }
    }
    if (bad) { // 标出第一个冲突格
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2 * u;
      this.rrect(ctx, bad.x * TILE + 1, bad.y * TILE + 1, TILE - 2, TILE - 2, 4 * u); ctx.stroke();
    }
    ctx.fillStyle = bad ? '#ff6b6b' : '#9fc8ff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(bp.name + ' ' + bp.w + '×' + bp.h + (bad ? ' · ' + bad.reason : ''), h.x * TILE, h.y * TILE - 4);
  },

  // 放置预览：全息投影风（扫描线 + 边缘光 + 角标）
  ghost(ctx, now) {
    const h = G.hover, u = this.u;
    if (G.won || h.x < 0 || h.y < 0 || h.x >= GRID_W || h.y >= GRID_H) return;
    const x = h.x * TILE, y = h.y * TILE;
    const cell = G.grid[h.y][h.x];
    if (G.tool === 'bulldoze' || !G.tool) {
      if (cell && MACHINE_TYPES.indexOf(cell.type) >= 0) {
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 2 * u;
        this.rrect(ctx, x + 1, y + 1, TILE - 2, TILE - 2, 4 * u); ctx.stroke();
      }
      return;
    }
    const ok = !cell && G.budget[G.tool] > 0;
    const col = ok ? '88,200,255' : '255,110,110';
    ctx.fillStyle = 'rgba(' + col + ',.1)';
    this.rrect(ctx, x + 2 * u, y + 2 * u, TILE - 4 * u, TILE - 4 * u, 5 * u); ctx.fill();
    ctx.save(); // 扫描线（全息质感）
    this.rrect(ctx, x + 2 * u, y + 2 * u, TILE - 4 * u, TILE - 4 * u, 5 * u); ctx.clip();
    ctx.fillStyle = 'rgba(' + col + ',.16)';
    const sweep = (now / 900) % 1 * TILE; // 一道亮扫描带缓慢下移
    for (let ly = 0; ly < TILE; ly += 4 * u) ctx.fillRect(x, y + ly, TILE, 1);
    ctx.fillStyle = 'rgba(' + col + ',.28)';
    ctx.fillRect(x, y + sweep, TILE, 2.4 * u);
    ctx.restore();
    ctx.strokeStyle = 'rgba(' + col + ',.85)'; // 边缘光
    ctx.lineWidth = 1.4 * u;
    this.rrect(ctx, x + 2 * u, y + 2 * u, TILE - 4 * u, TILE - 4 * u, 5 * u); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + col + ',1)'; // 四角标
    ctx.lineWidth = 2.2 * u;
    const L = 5.5 * u, o = 1.2 * u;
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const px = x + (sx ? TILE - o : o), py = y + (sy ? TILE - o : o);
      ctx.beginPath();
      ctx.moveTo(px - (sx ? L : -L) * -1, py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py - (sy ? L : -L) * -1);
      ctx.stroke();
    }
    if (G.tool === 'belt') this.beltFlow(ctx, G.toolDir, x, y, (now / 300) % 1);
    else {
      const cx = x + TILE / 2, cy = y + TILE / 2, d = DIRV[G.toolDir];
      this.arrowAt(ctx, cx + d[0] * 2 * u, cy + d[1] * 2 * u, G.toolDir, ok ? '#dbe2f1' : '#e08a8a');
    }
  },

  // ===== 形状图标：按象限绘制（0=右上 1=右下 2=左下 3=左上） =====
  shapeIcon(ctx, shape, cx, cy, r) {
    if (shape && shape.kind === 'petal-v3') {
      this.petalIcon(ctx, shape, cx, cy, r);
      return;
    }
    if (shape && shape.kind === 'trapezoid-v2') {
      this.trapezoidIcon(ctx, shape, cx, cy, r);
      return;
    }
    const DIAG = [[1, -1], [1, 1], [-1, 1], [-1, -1]];   // 象限对角方向
    const AXA = [[1, 0], [0, 1], [-1, 0], [0, -1]];       // 象限边轴 A
    const AXB = [[0, -1], [1, 0], [0, 1], [-1, 0]];       // 象限边轴 B
    for (let i = 0; i < 4; i++) {
      const t = shape[i];
      if (!t) continue;
      ctx.fillStyle = SHAPE_COLOR[t];
      ctx.strokeStyle = 'rgba(10,12,18,.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (t === 'C') {           // 四分之一圆瓣
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, (i - 1) * Math.PI / 2, i * Math.PI / 2);
        ctx.closePath();
      } else if (t === 'T' || t === 'R') { // 旧 R 存档在迁移前也按梯形绘制
        const outlines = [
          [[0.8, 0], [0.6, -1], [0, -1]],
          [[0.8, 0], [1, 1], [0, 1]],
          [[0, 1], [-1, 1], [-0.8, 0]],
          [[-0.8, 0], [-0.6, -1], [0, -1]],
        ];
        ctx.moveTo(cx, cy);
        for (const [px, py] of outlines[i]) ctx.lineTo(cx + px * r, cy + py * r);
        ctx.closePath();
      } else {                   // 'S'：四分之一星瓣（凹点收进 0.34r）
        const a = AXA[i], b = AXB[i], dg = DIAG[i];
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + a[0] * r, cy + a[1] * r);
        ctx.lineTo(cx + dg[0] * r * 0.34, cy + dg[1] * r * 0.34);
        ctx.lineTo(cx + b[0] * r, cy + b[1] * r);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }
  },

  // 四瓣各沿原料轮廓裁切；1/4 是槽位名称，不要求梯形四瓣等面积。
  petalIcon(ctx, shape, cx, cy, r) {
    const petals = {
      TL: [[0, 0], [-0.8, 0], [-0.6, -1], [0, -1]],
      TR: [[0, 0], [0, -1], [0.6, -1], [0.8, 0]],
      BL: [[0, 0], [0, 1], [-1, 1], [-0.8, 0]],
      BR: [[0, 0], [0.8, 0], [1, 1], [0, 1]],
    };
    const star = {
      TL: [[0, 0], [-1, 0], [-0.34, -0.34], [0, -1]],
      TR: [[0, 0], [0, -1], [0.34, -0.34], [1, 0]],
      BL: [[0, 0], [0, 1], [-0.34, 0.34], [-1, 0]],
      BR: [[0, 0], [1, 0], [0.34, 0.34], [0, 1]],
    };
    const arc = { TL: [Math.PI, Math.PI * 1.5], TR: [Math.PI * 1.5, Math.PI * 2],
      BL: [Math.PI * 0.5, Math.PI], BR: [0, Math.PI * 0.5] };
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((shape.orientation || 0) * Math.PI / 180);
    for (const unit of shape.units || []) {
      const slot = unit.slot || unit.quadrant;
      const type = unit.resource || unit.shapeKind || shape.shapeKind;
      if (!petals[slot]) continue;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      if (type === 'C') ctx.arc(0, 0, r, arc[slot][0], arc[slot][1]);
      else for (const [px, py] of (type === 'S' ? star : petals)[slot].slice(1))
        ctx.lineTo(px * r, py * r);
      ctx.closePath();
      ctx.fillStyle = SHAPE_COLOR[type] || '#8ab7dc';
      ctx.fill();
      ctx.strokeStyle = 'rgba(8,13,22,.65)';
      ctx.lineWidth = Math.max(0.8, r * 0.06);
      ctx.stroke();
      if (!this.lowFx && r >= 8) {
        ctx.save(); ctx.clip();
        ctx.strokeStyle = 'rgba(5,12,24,.52)';
        ctx.fillStyle = 'rgba(5,12,24,.55)';
        ctx.lineWidth = Math.max(0.8, r * 0.08);
        const sx = slot.endsWith('L') ? -1 : 1, sy = slot.startsWith('T') ? -1 : 1;
        if (type === 'T') {
          for (let k = -1; k <= 1; k++) {
            ctx.beginPath(); ctx.moveTo(sx * r * (0.15 + k * 0.25), sy * r * 0.2);
            ctx.lineTo(sx * r * (0.48 + k * 0.25), sy * r * 0.72); ctx.stroke();
          }
        } else if (type === 'C') {
          for (const [px, py] of [[0.3, 0.3], [0.6, 0.4], [0.4, 0.65]]) {
            ctx.beginPath(); ctx.arc(sx * r * px, sy * r * py, Math.max(0.6, r * 0.045), 0, 7); ctx.fill();
          }
        } else {
          for (const k of [0.25, 0.5, 0.75]) {
            ctx.beginPath(); ctx.moveTo(sx * r * k, sy * r * 0.12);
            ctx.lineTo(sx * r * k * 0.4, sy * r * 0.75); ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
    ctx.restore();
  },

  // 全坯面积为 0.8：F(t)=0.6t+0.2t²。以面积分数求横切高度，
  // 原切片保留全坯外缘；压合后的半坯以 sqrt(1/2) 缩放而保持面积。
  trapezoidIcon(ctx, shape, cx, cy, r) {
    const colors = { A: '#4DA3FF', B: '#F2AA4C', C: '#B58AE8', D: '#55C7AB' };
    const units = shape.units || [];
    const pressed = shape.stage === 'mixed-half' || shape.stage === 'finished';
    const scale = pressed && shape.stage === 'mixed-half' ? Math.SQRT1_2 : 1;
    const span = !pressed && Array.isArray(shape.span) ? shape.span : [0, 1];
    const f0 = Math.max(0, Math.min(1, +span[0] || 0));
    const f1 = Math.max(f0, Math.min(1, +span[1] || 0));
    const lo = pressed ? 0 : f0, hi = pressed ? 1 : f1;
    if (!units.length || hi <= lo) return;
    const tAt = f => (-0.6 + Math.sqrt(0.36 + 0.64 * f)) / 0.4;
    const edge = t => 0.6 + 0.4 * t;
    const pathBand = (a, b) => {
      const ta = tAt(a), tb = tAt(b), wa = edge(ta) * r, wb = edge(tb) * r;
      ctx.beginPath();
      ctx.moveTo(-wa, -r + 2 * r * ta); ctx.lineTo(wa, -r + 2 * r * ta);
      ctx.lineTo(wb, -r + 2 * r * tb); ctx.lineTo(-wb, -r + 2 * r * tb);
      ctx.closePath();
    };
    let bands = units.map(v => v.resource || v.type || 'A');
    if (pressed && shape.recipeId) {
      const recipe = shape.recipeId.replace(/^[HF]_/, '').split('');
      if (shape.stage === 'finished' && recipe.length === 2) bands = [recipe[0], recipe[1], recipe[0], recipe[1]];
      else if (recipe.length === units.length) bands = recipe;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((((+shape.orientation || 0) % 360) + 360) % 360 * Math.PI / 180);
    ctx.scale(scale, scale);
    const df = (hi - lo) / bands.length;
    for (let i = 0; i < bands.length; i++) {
      const a = lo + i * df, b = a + df, material = bands[i];
      pathBand(a, b);
      ctx.fillStyle = colors[material] || '#aab6c8'; ctx.fill();
      if (!this.lowFx && r >= 7) {
        ctx.save(); pathBand(a, b); ctx.clip();
        ctx.strokeStyle = 'rgba(9,16,28,.48)'; ctx.fillStyle = 'rgba(9,16,28,.5)';
        ctx.lineWidth = Math.max(0.6, r * 0.055);
        const tm = tAt((a + b) / 2), yy = -r + 2 * r * tm;
        if (material === 'A') { // 斜线
          for (let xx = -r; xx <= r; xx += r * 0.45) {
            ctx.beginPath(); ctx.moveTo(xx - r * 0.15, yy + r * 0.18); ctx.lineTo(xx + r * 0.15, yy - r * 0.18); ctx.stroke();
          }
        } else if (material === 'B') { // 点阵
          for (let xx = -r * 0.55; xx <= r * 0.55; xx += r * 0.42) {
            ctx.beginPath(); ctx.arc(xx, yy, Math.max(0.55, r * 0.055), 0, 7); ctx.fill();
          }
        } else if (material === 'C') { // 横线
          for (let dy = -r * 0.1; dy <= r * 0.1; dy += r * 0.2) {
            ctx.beginPath(); ctx.moveTo(-r * 0.7, yy + dy); ctx.lineTo(r * 0.7, yy + dy); ctx.stroke();
          }
        } else if (material === 'D') { // 网格
          ctx.beginPath(); ctx.moveTo(-r * 0.55, yy); ctx.lineTo(r * 0.55, yy);
          ctx.moveTo(-r * 0.24, yy - r * 0.17); ctx.lineTo(-r * 0.24, yy + r * 0.17);
          ctx.moveTo(r * 0.24, yy - r * 0.17); ctx.lineTo(r * 0.24, yy + r * 0.17); ctx.stroke();
        }
        ctx.restore();
      }
      if (i) {
        const t = tAt(a), w = edge(t) * r;
        ctx.strokeStyle = 'rgba(10,13,22,.6)'; ctx.lineWidth = Math.max(0.65, r * 0.065);
        ctx.beginPath(); ctx.moveTo(-w, -r + 2 * r * t); ctx.lineTo(w, -r + 2 * r * t); ctx.stroke();
      }
    }
    pathBand(lo, hi);
    ctx.strokeStyle = shape.stage === 'raw' ? '#8b96a7' : pressed ? '#f7e7aa' : '#d7e5ed';
    ctx.lineWidth = Math.max(0.8, r * (pressed ? 0.09 : 0.075)); ctx.stroke();
    if (pressed) { // 与原坯可辨的压合印记
      ctx.strokeStyle = '#fff1bf'; ctx.lineWidth = Math.max(0.7, r * 0.07);
      const marks = shape.stage === 'finished' ? [-0.16, 0.16] : [0];
      for (const mx of marks) {
        ctx.beginPath(); ctx.moveTo(mx * r - r * 0.085, -r * 0.21);
        ctx.lineTo(mx * r - r * 0.085, r * 0.21); ctx.lineTo(mx * r + r * 0.085, r * 0.21); ctx.stroke();
      }
    }
    if (r >= 16) {
      ctx.fillStyle = '#101725'; ctx.font = '700 ' + Math.max(8, r * 0.45) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < bands.length; i++) {
        const yy = -r + 2 * r * tAt(lo + (i + 0.5) * df);
        ctx.fillText(bands[i], 0, yy);
      }
    }
    ctx.restore();
  },

  // ===== 基础图元 =====
  rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },
  // 把 ctx 旋转到「本地 +x = 机器朝向」（图元原型朝右，dir 0上1右2下3左）
  _rot(ctx, dir, T) {
    ctx.translate(T / 2, T / 2);
    ctx.rotate((dir - 1) * Math.PI / 2);
    ctx.translate(-T / 2, -T / 2);
  },
  // 只靠沿实际流向滚动的斜纹表达方向；每格先平移到本地坐标，再旋转。
  beltFlow(ctx, dir, x, y, phase) {
    const T = TILE, u = this.u, middle = T / 2;
    ctx.save();
    ctx.translate(x, y);
    this._rot(ctx, dir, T);
    ctx.beginPath();
    ctx.rect(2 * u, middle - T * 0.25, T - 4 * u, T * 0.5);
    ctx.clip();
    const step = 8 * u, offset = ((phase % 1) + 1) % 1 * step;
    ctx.strokeStyle = this.lowFx ? 'rgba(155,212,255,.72)' : 'rgba(160,218,255,.84)';
    ctx.lineWidth = Math.max(1, 1.8 * u);
    for (let sx = -step + offset; sx < T + step; sx += step) {
      ctx.beginPath();
      ctx.moveTo(sx, middle - T * 0.19);
      ctx.lineTo(sx + 3 * u, middle + T * 0.19);
      ctx.stroke();
    }
    ctx.restore();
  },
  arrowAt(ctx, px, py, dir, color) {
    this.arrowAngle(ctx, px, py, (dir - 1) * Math.PI / 2, color);
  },
  arrowAngle(ctx, px, py, angle, color) {
    const u = this.u;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(4 * u, 0); ctx.lineTo(-3 * u, -3.5 * u); ctx.lineTo(-3 * u, 3.5 * u); ctx.closePath(); ctx.fill();
    ctx.restore();
  },
  dirMark(ctx, cx, cy, dir) {
    const d = DIRV[dir];
    this.arrowAt(ctx, cx + d[0] * 12 * this.u, cy + d[1] * 12 * this.u, dir, '#5b6685');
  },
  // 出入口标记：格子 dir 侧边缘的显眼三角形。出口=黄三角尖朝外，入口=绿三角尖朝内
  port(ctx, x, y, dir, kind) {
    const u = this.u;
    const d = DIRV[dir];
    const px = x * TILE + TILE / 2 + d[0] * (TILE / 2 - 1);
    const py = y * TILE + TILE / 2 + d[1] * (TILE / 2 - 1);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate((dir - 1) * Math.PI / 2); // 局部 +x 方向 = 朝格外侧（与 arrowAt 同约定）
    ctx.fillStyle = kind === 'out' ? '#ffd166' : '#57e389';
    ctx.strokeStyle = 'rgba(10,12,18,.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (kind === 'out') { ctx.moveTo(6 * u, 0); ctx.lineTo(-4 * u, -5 * u); ctx.lineTo(-4 * u, 5 * u); }
    else { ctx.moveTo(-6 * u, 0); ctx.lineTo(4 * u, -5 * u); ctx.lineTo(4 * u, 5 * u); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  },
};
