'use strict';
/* input.js — 鼠标/键盘交互 + DOM 界面（关卡页签、工具栏、提示、弹窗）
 * 输入层只写 G，不直接推进模拟。
 */

function ge(id) { return document.getElementById(id); }

// 关卡栏只在内容溢出时启用鼠标拖动；触屏保留浏览器的原生惯性滚动。
const TabScroller = {
  el: null, viewport: null, drag: null, suppressClick: false, clickTimer: null,
  init(el, viewport) {
    if (this.el === el) return;
    this.el = el;
    this.viewport = viewport;
    el.addEventListener('scroll', () => this.sync(), { passive: true });
    el.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !this.overflowing()) return;
      this.drag = { id: e.pointerId, x: e.clientX, scroll: el.scrollLeft, active: false };
    });
    el.addEventListener('pointermove', e => {
      const drag = this.drag;
      if (!drag || drag.id !== e.pointerId) return;
      const distance = e.clientX - drag.x;
      if (!drag.active && Math.abs(distance) < 5) return;
      if (!drag.active) {
        drag.active = true;
        el.classList.add('dragging');
        if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      }
      el.scrollLeft = drag.scroll - distance;
      e.preventDefault();
      this.sync();
    });
    const finish = e => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      if (this.drag.active) {
        this.suppressClick = true;
        clearTimeout(this.clickTimer);
        this.clickTimer = setTimeout(() => { this.suppressClick = false; }, 0);
      }
      this.drag = null;
      el.classList.remove('dragging');
      if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('click', e => {
      if (!this.suppressClick) return;
      this.suppressClick = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
    window.addEventListener('resize', () => this.sync());
    if (window.ResizeObserver) {
      const observer = new window.ResizeObserver(() => this.sync());
      observer.observe(viewport);
      observer.observe(el);
    }
    this.sync();
  },
  overflowing() { return !!(this.el && this.el.clientWidth > 0 && this.el.scrollWidth > this.el.clientWidth + 1); },
  sync() {
    if (!this.el || !this.viewport) return;
    const overflow = this.overflowing();
    if (!overflow) {
      this.el.scrollLeft = 0;
      this.drag = null;
      this.el.classList.remove('dragging');
    }
    this.viewport.classList.toggle('scrollable', overflow);
    this.viewport.classList.toggle('can-left', overflow && this.el.scrollLeft > 1);
    this.viewport.classList.toggle('can-right', overflow && this.el.scrollLeft < this.el.scrollWidth - this.el.clientWidth - 1);
  },
  revealActive() {
    if (!this.overflowing()) return;
    const active = this.el.querySelector('.tab.cur');
    if (!active || !active.getBoundingClientRect || !this.el.getBoundingClientRect) return;
    const visible = this.el.getBoundingClientRect(), tab = active.getBoundingClientRect();
    if (tab.left < visible.left) this.el.scrollLeft += tab.left - visible.left;
    else if (tab.right > visible.right) this.el.scrollLeft += tab.right - visible.right;
    this.sync();
  },
  refresh(previousScroll) {
    if (!this.el) return;
    this.el.scrollLeft = previousScroll;
    this.revealActive();
    this.sync();
  },
};

// 浏览器启动时无法在没有用户手势的情况下强制旋转设备；竖屏先提示，操作后尝试全屏锁定。
const Landscape = {
  initialized: false,
  detectMobile() {
    if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')) return true;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return !!(coarse && navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) <= 1024);
  },
  portrait() {
    return window.matchMedia ? window.matchMedia('(orientation: portrait)').matches : window.innerHeight > window.innerWidth;
  },
  update() {
    const blocked = this.detectMobile() && this.portrait();
    G.orientationBlocked = blocked;
    const gate = ge('landscape-gate');
    if (gate) gate.hidden = !blocked;
  },
  init() {
    if (this.initialized) return;
    this.initialized = true;
    ge('landscape-action').addEventListener('click', () => this.request());
    window.addEventListener('resize', () => this.update());
    window.addEventListener('orientationchange', () => this.update());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.update());
    if (screen.orientation && screen.orientation.addEventListener)
      screen.orientation.addEventListener('change', () => this.update());
    document.addEventListener('fullscreenchange', () => this.update());
    document.addEventListener('visibilitychange', () => this.update());
    this.update();
  },
  async request() {
    if (!this.detectMobile()) return false;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
    } catch (e) { /* 全屏可能不支持；仍可手动旋转 */ }
    try {
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch (e) { /* iOS 等浏览器可能拒绝锁定；方向提示继续生效 */ }
    this.update();
    return !G.orientationBlocked;
  },
};

const UI = {
  els: {},
  bpOpen: false,
  init() {
    this.els = {
      tabs: ge('tabs'), lvlName: ge('lvl-name'), toolbar: ge('toolbar'),
      toast: ge('toast'), hint: ge('hint'), modal: ge('modal'),
      winStars: ge('win-stars'), winInfo: ge('win-info'), btnNext: ge('btn-next'),
      bpbar: ge('bpbar'), menu: ge('menu'), statRate: ge('stat-rate'),
      sidebar: ge('sidebar'),
    };
    TabScroller.init(this.els.tabs, ge('tabs-viewport'));
    // 工具栏
    TOOLS.forEach(t => {
      const b = document.createElement('div');
      b.className = 'tool';
      b.id = 'tool-' + t.id;
      b.innerHTML = '<span class="k">' + t.key + '</span><span class="g">' + t.glyph +
        '</span><span class="n">' + t.name + '</span><span class="b"></span>';
      b.addEventListener('click', () => {
        if (b.classList.contains('off')) {
          UI.toast('「' + t.name + '」本关不可用或预算已用完');
          AudioFX.deny();
          return;
        }
        G.tool = (G.tool === t.id) ? null : t.id; // 再点一次取消选择（空工具点击 = 拆除）
        G.paste = null; G.selMode = false; G.sel = null; // 选工具即退出粘贴/框选态
        UI.refreshToolbar();
      });
      this.els.toolbar.appendChild(b);
    });
    // 侧边栏动作键：旋转、框选、撤销、重做、存蓝图（键盘对应 R/B/Ctrl+Z/Ctrl+Y/S）
    const noopEv = { preventDefault() {} };
    [
      ['⟳', '旋转（R）', () => Input.key(Object.assign({ key: 'r' }, noopEv))],
      ['⬚', '框选复制（B）', () => Input.key(Object.assign({ key: 'b' }, noopEv))],
      ['↶', '撤销（Ctrl+Z）', () => Input.key(Object.assign({ key: 'z', ctrlKey: true }, noopEv))],
      ['↷', '重做（Ctrl+Y）', () => Input.key(Object.assign({ key: 'y', ctrlKey: true }, noopEv))],
      ['✚', '保存蓝图为库（S）', () => UI.saveBlueprint()],
      ['▤', '蓝图库／导入导出', () => { UI.bpOpen = !UI.bpOpen; UI.refreshBps(); }],
    ].forEach(([glyph, tip, fn]) => {
      const b = document.createElement('div');
      b.className = 'tool act';
      b.innerHTML = '<span class="g">' + glyph + '</span><span class="n">' + tip + '</span>';
      b.title = tip;
      b.addEventListener('click', fn);
      this.els.sidebar.appendChild(b);
    });
    // 顶栏按钮
    ge('btn-pause').addEventListener('click', () => {
      if (!G.won) { G.paused = !G.paused; UI.syncPause(); }
    });
    ge('btn-restart').addEventListener('click', () => {
      if (G.mode === 'free') loadFree();
      else if (G.mode === 'challenge') loadChallenge(G.chalIndex);
      else if (G.mode === 'daily') loadDaily();
      else loadLevel(G.levelIndex);
    });
    ge('btn-sound').addEventListener('click', () => {
      G.save.sound = !G.save.sound; persist(); UI.syncSound();
    });
    ge('btn-hint').addEventListener('click', () => UI.toast(G.chalDef && (G.mode==='challenge'||G.mode==='daily') ? G.chalDef.hint : LEVELS[G.levelIndex].hint, 8));
    ge('bp-import-file').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        if (file.size > Blueprints.MAX_FILE_BYTES) throw new Error('蓝图文件大小超限');
        this.importBlueprintText(await file.text());
      } catch (err) { this.toast(err.message || '蓝图导入失败', 5); }
      e.target.value = '';
    });
    ge('c4-start').addEventListener('click', () => {
      if (startC4Supply()) this.refreshChalProgress();
    });
    ge('btn-next-target').addEventListener('click', () => { // 自由模式：换目标
      nextFreeTarget();
      UI.toast('已换新目标');
    });
    // 主菜单与模式入口
    ge('btn-menu').addEventListener('click', () => UI.showMenu());
    ge('mode-tutorial').addEventListener('click', () => { Landscape.request(); setMode('tutorial'); });
    ge('mode-free').addEventListener('click', () => { Landscape.request(); setMode('free'); });
    ge('mode-challenge').addEventListener('click', () => { Landscape.request(); setMode('challenge'); });
    ge('mode-daily').addEventListener('click', () => { Landscape.request(); setMode('daily'); });
    // D15：底部托盘收起/展开（收起只留拉手，释放画布底部安全区）
    ge('tray-toggle').addEventListener('click', () => {
      ge('tray').classList.toggle('min');
      Render.resize();
    });
    // 速度控制：按钮循环 1x→2x→4x
    ge('btn-speed').addEventListener('click', () => {
      setSpeed(SPEEDS[(SPEEDS.indexOf(G.speed) + 1) % SPEEDS.length]);
    });
    // 统计 HUD：30 秒滚动窗口 → 件/分，附在途与累计；挑战模式附实时进度
    setInterval(() => {
      const now = performance.now(), log = G.stats.log;
      while (log.length && now - log[0] > 30000) log.shift();
      this.els.statRate.textContent = (log.length * 2) + ' 件/分 · 在途 ' + inTransit() + ' · 累计 ' + G.delivered;
      if ((G.mode === 'challenge' || G.mode === 'daily') && G.chal) this.refreshChalProgress();
    }, 500);
    // 过关弹窗
    ge('btn-next').addEventListener('click', () => {
      UI.hideModal();
      if (G.mode === 'challenge') loadChallenge(G.chalIndex + 1); else loadLevel(G.levelIndex + 1);
    });
    ge('btn-replay').addEventListener('click', () => {
      UI.hideModal();
      if (G.mode === 'challenge') loadChallenge(G.chalIndex); else loadLevel(G.levelIndex);
    });
    ge('btn-close').addEventListener('click', () => UI.hideModal());
    this.syncSound();
  },

  // 顶栏通关条件（常驻）：按模式生成「要做什么 + 约束」短文本，玩家不用点提示即见
  refreshTargetCond() {
    const el = ge('target-cond');
    if (!el) return;
    if(G.v3) { el.textContent=G.chalDef.recipeId.replace('F_','')+' '+G.delivered+'/'+G.chalDef.need; return; }
    if(G.v2) { el.textContent=G.v2.orders.map(o=>o.recipeId.replace('F_','')+' '+o.delivered+'/'+o.need).join(' · '); return; }
    const chal = G.mode === 'challenge', daily = G.mode === 'daily', free = G.mode === 'free';
    if (free) { el.textContent = '送到枢纽换题'; return; }
    if (chal || daily) {
      const C = G.chalDef;
      const parts = [];
      if (C.need) parts.push('交付×' + C.need);
      if (C.passNeed) parts.push('交付≥' + C.passNeed);
      if (C.tickLimit) parts.push('限' + Math.round(C.tickLimit * TICK_MS / 1000) + 's游戏时');
      if (C.realLimit) parts.push('限' + C.realLimit + 's');
      if (C.devLimit) parts.push('≤' + C.devLimit + '台');
      if (C.id === 'C2' || C.id === 'C6') parts.push('拼设备数'); // 设备评级关点出核心
      el.textContent = parts.join(' · ') || '交付目标';
      return;
    }
    // 教程：交付 1 个目标形状过关，par 设备数评级
    const L = LEVELS[G.levelIndex];
    el.textContent = L ? (L.blueprintThreeStar ? '交付1个 · 3★使用蓝图1次' : '交付1个 · 3★≤' + L.par[0] + '台') : '';
  },

  refreshLevel() {
    this.refreshV2();
    this.refreshC4Controls();
    const free = G.mode === 'free', chal = G.mode === 'challenge', daily = G.mode === 'daily';
    ge('tabs-viewport').style.display = free ? 'none' : ''; // 自由模式无关卡页签
    const topbar = ge('topbar'), tabsChanged = this._tabsVisible !== !free;
    this._tabsVisible = !free;
    topbar.classList.toggle('has-tabs', !free);
    if (tabsChanged && Render.cv) Render.resize(); // 两行顶栏与单行顶栏切换后重算画布安全区
    ge('btn-hint').style.display = free || !!G.v3 ? 'none' : '';
    ge('btn-next-target').style.display = free ? '' : 'none';
    if (chal || daily) {
      const C = G.chalDef, rec = daily ? G.save.daily[C.dateStr] :
        (G.v3 ? G.save.challengeV3 || {} : G.v2 ? G.save.challengeV2 : G.save.challenges)[C.id];
      this.els.lvlName.textContent = (daily ? MODES.daily : MODES.challenge) + ' · ' + (daily ? C.dateStr : C.id + ' ' + C.name) + (rec && rec.stars ? ' · ' + '★'.repeat(rec.stars) : '');
      Render.drawPreview(G.target);
      this.refreshTargetCond();
      this.refreshLevels();
      this.refreshBps();
      this.refreshChalProgress();
      return;
    }
    if (free) {
      this.els.lvlName.textContent = MODES.free + ' · 随机目标（参考 ' + (G.freePar || '?') + ' 台）';
      this.els.hint.textContent = '提示：全机器解锁、不限预算。把目标形状送进枢纽即自动换新目标，也可点「换一个」。B 框选 / S 存蓝图照常可用。';
      Render.drawPreview(G.target);
      this.refreshTargetCond();
      this.refreshBps();
      return;
    }
    const L = LEVELS[G.levelIndex], st = G.save.stars[G.levelIndex] || 0;
    this.els.lvlName.textContent = MODES[G.mode] + ' · 第' + (G.levelIndex + 1) + '关 · ' + L.name + (st ? ' · ' + '★'.repeat(st) : '');
    this.els.hint.textContent = '提示：' + L.hint;
    Render.drawPreview(G.target);
    this.refreshTargetCond();
    this.refreshLevels();
    this.refreshBps();
  },

  // 蓝图栏：内置 4 个 + 存档里的自建蓝图；教程 L5 起开放
  v3StockText() {
    const v = G.v3;
    const count = lists => (lists || []).reduce((sum, items) => sum + items.length, 0);
    return '持续供料 ∞ · 当前缓存 ' + count(v.stockByNode) +
      ' · 已发 ' + (v.emitted || 0) + ' · 废料 ' + (v.discardedItems || []).length;
  },

  refreshBps() {
    const bar = this.els.bpbar;
    if (!bar) return;
    const active = G.v3 ? 'petal-v3' : G.v2 ? 'trapezoid-v2' : 'classic-v1';
    bar.style.display = this.bpOpen ? 'flex' : 'none';
    bar.innerHTML = '';
    if (!this.bpOpen) return;
    const label = document.createElement('strong');
    label.className = 'bplabel';
    label.textContent = '蓝图库 · ' + ({'petal-v3':'四瓣规则','trapezoid-v2':'旧梯形规则','classic-v1':'经典规则'})[active];
    bar.appendChild(label);
    if (G.mode === 'challenge' || G.mode === 'tutorial') {
      const levels = document.createElement('div'); levels.className = 'drawer-actions';
      const source = G.mode === 'challenge' ? CHALLENGES : LEVELS;
      source.forEach((entry, index) => {
        const button = document.createElement('button'); button.className = 'hbtn';
        button.textContent = G.mode === 'challenge' ? entry.id : String(index + 1);
        button.title = entry.name;
        button.addEventListener('click', () => G.mode === 'challenge' ? loadChallenge(index) : loadLevel(index));
        levels.appendChild(button);
      });
      bar.appendChild(levels);
    }
    const actions = document.createElement('div'); actions.className = 'drawer-actions';
    for (const [name,id] of [['速度','btn-speed'],['重开','btn-restart'],['音效','btn-sound']]) {
      const button = document.createElement('button'); button.className = 'hbtn'; button.textContent = name;
      button.addEventListener('click', () => { ge(id).click(); this.refreshBps(); });
      actions.appendChild(button);
    }
    if (!G.v3 && G.mode !== 'free') {
      const hint = document.createElement('button'); hint.className='hbtn'; hint.textContent='提示';
      hint.addEventListener('click', () => ge('btn-hint').click()); actions.appendChild(hint);
    }
    bar.appendChild(actions);
    const importButton = document.createElement('button');
    importButton.className = 'hbtn'; importButton.textContent = '导入 .slbp.json';
    importButton.addEventListener('click', () => ge('bp-import-file').click());
    bar.appendChild(importButton);
    if (G.v3) {
      const status = document.createElement('span');
      status.id = 'v3-stock-status'; status.className = 'bplabel';
      status.textContent = this.v3StockText();
      bar.appendChild(status);
      const label = document.createElement('label'); label.className = 'bplabel';
      label.textContent = '切割机模式 · 每次入机只切一级 ';
      const select = document.createElement('select');
      select.title = '原坯可直接纵切或横切，各层按局部槽位切割；自动档先判断纵切，再判断横切；再次切割需重新入机';
      for (const [value,name] of [['auto','自动判断'],['vertical','纵切'],['horizontal','横切']]) {
        const option = document.createElement('option'); option.value=value; option.textContent=name;
        select.appendChild(option);
      }
      select.value = G.v3.toolModes.cutter;
      select.addEventListener('change', () => {
        this.setSynthesisMode('cutter', select);
      });
      label.appendChild(select); bar.appendChild(label);
      const mergeLabel = document.createElement('label'); mergeLabel.className = 'bplabel';
      mergeLabel.textContent = '混合机模式 ';
      const mergeSelect = document.createElement('select');
      mergeSelect.title = '自由拼接优先互补位置；同入口重复片等待另一侧，不抢先叠层。两入口重叠可自动层叠；单入口主动叠层请选层叠模式。旧 half/final 兼容平面拼接。';
      for (const [value, name] of [['auto','自由拼接＋重叠层叠'],['join','平面拼接（重叠拒绝）'],['stack','按顺序层叠'],['half','旧 half · 平面拼接'],['final','旧 final · 平面拼接']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = name;
        mergeSelect.appendChild(option);
      }
      mergeSelect.value = G.v3.toolModes.merger;
      mergeSelect.addEventListener('change', () => {
        this.setSynthesisMode('merger', mergeSelect);
      });
      mergeLabel.appendChild(mergeSelect); bar.appendChild(mergeLabel);
      this.synthesisControls(bar);
      const reset = document.createElement('button'); reset.className='hbtn'; reset.textContent='重置供料，保留布线';
      reset.addEventListener('click', () => { V3Runtime.resetMaterial(); this.refreshChalProgress(); this.refreshBps(); });
      bar.appendChild(reset);
    }
    if (active === 'classic-v1') BUILTIN_BPS.forEach(bp => bar.appendChild(this._bpItem(bp, true)));
    Object.values(G.save.blueprints).forEach(bp => bar.appendChild(this._bpItem(bp, false)));
  },

  setSynthesisMode(type, select) {
    const pos = G.v3.selected, cell = pos && cellAt(pos.x, pos.y);
    if (cell && cell.type === type && V3Runtime.occupied(cell)) {
      select.value = cell.machineMode || 'auto';
      this.toast('机器有物品时不能切换模式');
      return false;
    }
    if (cell && cell.type === type) {
      Undo.begin(); Undo.rec('remove', cell.x, cell.y, cell.type, cell.dir);
      cell.machineMode = select.value;
      Undo.rec('place', cell.x, cell.y, cell.type, cell.dir); Undo.end();
    }
    G.v3.toolModes[type] = select.value;
    return true;
  },

  exportSynthesisConfig() {
    return JSON.stringify(PetalV3.engine.exportConfig(), null, 2);
  },

  exportSavedSynthesisConfig() {
    const snapshot = Object.prototype.hasOwnProperty.call(G.save, 'synthesisConfig')
      ? G.save.synthesisConfig : PetalV3.engine.exportConfig();
    return JSON.stringify(snapshot, null, 2);
  },

  importSynthesisConfig(text) {
    let config;
    try { config = JSON.parse(text); } catch (error) { throw new Error('配置不是有效 JSON'); }
    const snapshot = PetalV3.engine.importConfig(config);
    G.save.synthesisConfig = snapshot;
    G.synthesisConfigError = null;
    persist();
    return this.exportSynthesisConfig();
  },

  synthesisLayers(shape) {
    const units = shape && shape.units || [];
    const count = units.reduce((total,unit) => Math.max(total,(unit.layer || 0) + 1),
      Math.max(1, shape && shape.layers && shape.layers.length || 0));
    const layers = Array.from({length:count}, () => ({}));
    const slots = ['TL','TR','BR','BL'], turns = ((shape && shape.orientation || 0) / 90) % 4;
    units.forEach(unit => {
      const slot = unit.slot || unit.quadrant, index = slots.indexOf(slot);
      layers[unit.layer || 0][index < 0 ? slot : slots[(index + turns + 4) % 4]] = unit.shapeKind || unit.resource;
    });
    return layers;
  },

  synthesisControls(bar) {
    const label = document.createElement('label'); label.className = 'bplabel'; label.textContent = '指定规则 ';
    const select = document.createElement('select'); select.id = 'synthesis-rule';
    const rules = PetalV3.engine.listRules();
    const pos = G.v3.selected, selected = pos && cellAt(pos.x, pos.y);
    const selectedId = selected && selected.type === 'merger' ? selected.ruleId || '' : G.v3.toolRuleId || '';
    const choices = [{id:'',name:'自动匹配（含多输入）'}, ...rules];
    if (selectedId && !rules.some(rule => rule.id === selectedId)) choices.push({id:selectedId,name:selectedId + '（未注册）'});
    for (const rule of choices) {
      const option = document.createElement('option'); option.value = rule.id;
      option.textContent = (rule.name || rule.id) + (rule.enabled === false ? '（已停用）' : '');
      option.disabled = rule.enabled === false;
      select.appendChild(option);
    }
    select.value = selectedId;
    select.addEventListener('change', () => {
      const position = G.v3.selected, cell = position && cellAt(position.x, position.y);
      if (cell && cell.type === 'merger') {
        if (V3Runtime.occupied(cell)) { select.value = cell.ruleId || ''; this.toast('机器有物品时不能切换规则'); return; }
        Undo.begin(); Undo.rec('remove', cell.x, cell.y, cell.type, cell.dir);
        if (select.value) cell.ruleId = select.value; else delete cell.ruleId;
        Undo.rec('place', cell.x, cell.y, cell.type, cell.dir); Undo.end();
      }
      G.v3.toolRuleId = select.value;
    });
    label.appendChild(select); bar.appendChild(label);
    const meaning = document.createElement('p'); meaning.className = 'synthesis-note';
    meaning.textContent = '自由拼接优先互补位置；同入口重复片保留等待，两入口重叠自动叠层，不限制层数。单入口叠层可选层叠模式。绑定规则后按规则加工。'; bar.appendChild(meaning);
    if (selected && selected.status) {
      const status = document.createElement('p'); status.className = 'synthesis-note'; status.textContent = '机器状态：' + selected.status; bar.appendChild(status);
    }
    const inspect = document.createElement('button'); inspect.className = 'hbtn'; inspect.textContent = '查看每层结构';
    inspect.addEventListener('click', () => {
      const position = G.v3.selected, cell = position && cellAt(position.x, position.y);
      const item = cell && (cell.outA || cell.outB || cell.item || cell.proc || (cell.queueA || [])[0] || (cell.queueB || [])[0]);
      this.showSynthesisLayers(item && item.shape || G.target, bar);
    }); bar.appendChild(inspect);
    const editor = document.createElement('details'); editor.className = 'synthesis-config';
    const heading = document.createElement('summary'); heading.textContent = '编辑 / 导入 / 导出材料与规则 JSON'; editor.appendChild(heading);
    const text = document.createElement('textarea'); text.id = 'synthesis-config-text'; text.spellcheck = false;
    text.setAttribute && text.setAttribute('aria-label', '材料与规则 JSON 配置'); text.value = this.exportSynthesisConfig(); editor.appendChild(text);
    const status = document.createElement('p'); status.className = 'synthesis-note';
    status.textContent = G.synthesisConfigError || '编辑后点击应用并自动保存；校验失败保留当前全部配置。导出可复制文本保存。';
    const apply = document.createElement('button'); apply.className = 'hbtn'; apply.textContent = '校验并应用 JSON';
    apply.addEventListener('click', () => {
      try { text.value = this.importSynthesisConfig(text.value); this.refreshBps(); this.toast('材料与规则配置已应用'); }
      catch (error) { status.textContent = '配置未应用：' + error.message; }
    }); editor.appendChild(apply);
    const reload = document.createElement('button'); reload.className = 'hbtn'; reload.textContent = '导出当前配置到文本';
    reload.addEventListener('click', () => { text.value = this.exportSynthesisConfig(); status.textContent = '已导出，可复制或继续编辑。'; });
    editor.appendChild(reload);
    if (G.synthesisConfigError) {
      const recover = document.createElement('button'); recover.className = 'hbtn'; recover.textContent = '导出未恢复的存档配置';
      recover.addEventListener('click', () => {
        text.value = this.exportSavedSynthesisConfig();
        status.textContent = '已导出未恢复的原存档配置；可复制保存或修正后重新应用。';
      });
      editor.appendChild(recover);
    }
    editor.appendChild(status); bar.appendChild(editor);
  },

  showSynthesisLayers(shape, bar) {
    if (!shape || !shape.units) { this.toast('选择有物料的机器以查看每层结构'); return; }
    const panel = document.createElement('details'); panel.className = 'synthesis-layers'; panel.open = true;
    const layers = this.synthesisLayers(shape), heading = document.createElement('summary');
    heading.textContent = '共 ' + layers.length + ' 层 · 从底到顶'; panel.appendChild(heading);
    layers.forEach((layer, index) => {
      const row = document.createElement('div'); row.className = 'synthesis-layer';
      const canvas = document.createElement('canvas'); canvas.width = 72; canvas.height = 72;
      Render.shapeIcon(canvas.getContext('2d'), {kind:'synthesis',orientation:shape.orientation || 0,
        units:shape.units.filter(unit => (unit.layer || 0) === index).map(unit => ({...unit,layer:0}))}, 36,36,26);
      row.appendChild(canvas);
      const text = document.createElement('span'); text.textContent = '第 ' + (index + 1) + ' 层：' + ['TL','TR','BL','BR'].map(slot => {
        const id = layer[slot], material = id && PetalV3.engine.getMaterial(id);
        return slot + '=' + (id ? (material && material.name || id) + ' [' + id + ']' : '空');
      }).join(' · '); row.appendChild(text); panel.appendChild(row);
    });
    bar.appendChild(panel);
  },

  _bpItem(bp, builtin) {
    const el = document.createElement('span');
    el.className = 'bp';
    const title = document.createElement('span');
    title.textContent = bp.name + ((bp.ruleset || 'classic-v1') === (G.v3 ? 'petal-v3' : G.v2 ? 'trapezoid-v2' : 'classic-v1') ? '' : ' · 旧规则');
    const size = document.createElement('span'); size.className = 'sz'; size.textContent = bp.w + '×' + bp.h;
    el.appendChild(title); el.appendChild(size);
    el.title = '点击粘贴：R 旋转，左键放置，Esc 取消';
    el.addEventListener('click', () => {
      if (bp.migrationPending) { this.toast('旧版蓝图需重新核对资源与端口，暂不能直接粘贴', 5); return; }
      const activeRuleset = G.v3 ? 'petal-v3' : G.v2 ? 'trapezoid-v2' : 'classic-v1';
      if ((bp.ruleset || 'classic-v1') !== activeRuleset) { this.toast('此蓝图属于其他规则，可先导出保存', 5); return; }
      G.paste = Blueprints.clone(bp);
      G.selMode = false; G.sel = null; G.tool = null;
      this.refreshToolbar();
      this.toast('粘贴「' + bp.name + '」：左键放置 · R 旋转 · Esc 取消');
    });
    if (!builtin) {
      const exportButton = document.createElement('span');
      exportButton.className = 'op'; exportButton.textContent = '⬇'; exportButton.title = '导出 .slbp.json';
      exportButton.addEventListener('click', e => { e.stopPropagation(); this.downloadBlueprint(bp); });
      el.appendChild(exportButton);
      const rn = document.createElement('span');
      rn.className = 'op'; rn.textContent = '✎'; rn.title = '改名';
      rn.addEventListener('click', e => {
        e.stopPropagation();
        const n = prompt('蓝图改名：', bp.name);
        if (n) { bp.name = n.slice(0, 12); persist(); this.refreshBps(); }
      });
      const del = document.createElement('span');
      del.className = 'op'; del.textContent = '×'; del.title = '删除';
      del.addEventListener('click', e => {
        e.stopPropagation();
        delete G.save.blueprints[bp.id];
        persist(); this.refreshBps();
        this.toast('已删除蓝图「' + bp.name + '」');
      });
      el.appendChild(rn); el.appendChild(del);
    }
    return el;
  },

  // S 键：把剪贴板蓝图存入蓝图库
  saveBlueprint() {
    if (!G.clip) { this.toast('剪贴板为空：先按 B 框选复制'); return; }
    const n = prompt('蓝图命名：', G.clip.name);
    if (n === null) return;
    G.clip.name = (n || G.clip.name).slice(0, 12);
    G.clip.id = 'bp' + Date.now();
    G.save.blueprints[G.clip.id] = Blueprints.clone(G.clip);
    persist();
    this.refreshBps();
    checkAchievements(); // 蓝图师成就
    this.toast('蓝图「' + G.clip.name + '」已保存');
  },

  importBlueprintText(text) {
    try {
      const imported = Blueprints.importFile(text);
      const add = (source, pending = false) => {
        const bp = Blueprints.clone(source);
        let id = bp.id || 'bp-import-' + Date.now();
        while (G.save.blueprints[id]) id += '-copy';
        bp.id = id;
        if (pending) bp.migrationPending = true;
        G.save.blueprints[id] = bp;
        return bp;
      };
      const saved = add(imported.blueprint);
      if (imported.preview) {
        imported.preview.id = saved.id + '-preview';
        imported.preview.name = saved.name + '（迁移预览）';
        add(imported.preview, true);
      }
      persist(); this.refreshBps(); checkAchievements();
      this.toast(imported.warning || '蓝图「' + saved.name + '」已导入', imported.warning ? 5 : 2);
      return saved;
    } catch (err) {
      this.toast(err.message || '蓝图导入失败', 5);
      return false;
    }
  },

  downloadBlueprint(bp) {
    try {
      const content = Blueprints.exportFile(bp);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = Blueprints.sanitizeName(bp.name).replace(/[\\/:*?"<>|]/g, '_') + '.slbp.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (err) { this.toast(err.message || '蓝图导出失败', 5); return false; }
  },

  refreshLevels() {
    const el = this.els.tabs;
    const previousScroll = el.scrollLeft || 0;
    el.innerHTML = '';
    if (G.mode === 'challenge' || G.mode === 'daily') { // 挑战选择页签（复用教程标签样式，全开放无锁）
      CHALLENGES.forEach((C, i) => {
        const b = document.createElement('button');
        const rec = (C.ruleset==='petal-v3'?G.save.challengeV3 || {}:
          C.ruleset==='trapezoid-v2'?G.save.challengeV2:G.save.challenges)[C.id];
        b.className = 'tab' + (G.mode === 'challenge' && i === G.chalIndex ? ' cur' : '');
        b.title = C.ruleset === 'petal-v3' ? C.id + ' · ' + C.name : C.hint;
        b.innerHTML = C.id + '<span class="st">' + (rec && rec.stars ? '★'.repeat(rec.stars) : '') + '</span>';
        b.addEventListener('click', () => loadChallenge(i));
        el.appendChild(b);
      });
      TabScroller.refresh(previousScroll);
      return;
    }
    LEVELS.forEach((L, i) => {
      const b = document.createElement('button');
      const locked = i >= G.save.unlocked;
      b.className = 'tab' + (i === G.levelIndex ? ' cur' : '') + (locked ? ' lock' : '');
      const st = G.save.stars[i] || 0;
      b.innerHTML = (i + 1) + '<span class="st">' + (st ? '★'.repeat(st) : '') + '</span>';
      if (!locked) b.addEventListener('click', () => loadLevel(i));
      el.appendChild(b);
    });
    TabScroller.refresh(previousScroll);
  },

  refreshToolbar() {
    TOOLS.forEach(t => {
      ge('tool-' + t.id).classList.toggle('sel', G.tool === t.id);
    });
  },

  refreshBudget() {
    TOOLS.forEach(t => {
      const b = ge('tool-' + t.id), badge = b.querySelector('.b');
      if (t.id === 'bulldoze') { badge.textContent = ''; return; }
      const n = G.budget[t.id];
      badge.textContent = (n === Infinity) ? '∞' : n;
      b.classList.toggle('off', !(n > 0));
    });
  },

  syncPause() { ge('btn-pause').textContent = G.paused ? '继续' : '暂停'; },
  syncSound() { ge('btn-sound').textContent = G.save.sound ? '♪ 音效' : '♪ 静音'; },
  syncSpeed() { ge('btn-speed').textContent = G.speed + 'x'; },

  showMenu() { // 打开主菜单即暂停，选模式后恢复
    if (!G.won) { G.paused = true; this.syncPause(); }
    this.renderAchievements();
    this.els.menu.style.display = 'flex';
  },
  hideMenu() {
    this.els.menu.style.display = 'none';
  },

  // 主菜单成就一览
  renderAchievements() {
    const el = ge('ach-list');
    if (!el) return;
    el.innerHTML = '';
    ACHIEVEMENTS.forEach(a => {
      const got = !!G.save.achievements[a.id];
      const s = document.createElement('span');
      s.className = 'ach' + (got ? ' got' : '');
      s.title = a.desc;
      s.textContent = (got ? '★ ' : '☆ ') + a.name;
      el.appendChild(s);
    });
  },

  toast(msg, sec) {
    const el = this.els.toast;
    el.textContent = msg;
    el.style.opacity = 1;
    clearTimeout(this._tt);
    this._tt = setTimeout(() => { el.style.opacity = 0; }, (sec || 2) * 1000);
  },

  showWin(stars, total) {
    if (!G.won) return; // 等待期间可能已重开关卡
    this.els.modal.querySelector('h2').textContent = '过关！';
    this.els.winStars.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    const L = LEVELS[G.levelIndex];
    let info = '共用 ' + total + ' 台设备（' + (L.blueprintThreeStar
      ? '3★ 需成功粘贴蓝图1次；未用蓝图时2★≤' + L.par[1] + '台'
      : '3★ 不超过 ' + L.par[0] + ' 台') + '）';
    if (G.levelIndex === LEVELS.length - 1) info += ' · 教程毕业！去自由模式练手 / 去挑战模式验证'; // 3.2 通关 L8 引导
    this.els.winInfo.textContent = info;
    this.els.btnNext.style.display = (G.levelIndex + 1 < LEVELS.length) ? '' : 'none';
    this.els.modal.style.display = 'flex';
  },

  // 挑战实时进度（顶部 hint 行常驻，500ms 刷新）
  c4Remaining() {
    const C = G.chalDef;
    return C && C.id === 'C4' ? Math.max(0, Math.ceil((C.tickLimit - G.tickCount) * TICK_MS / 1000)) : 0;
  },

  refreshC4Controls() {
    const active = G.mode === 'challenge' && G.chalDef && G.chalDef.id === 'C4';
    ge('topbar').classList.toggle('c4-mode', !!active);
    const timer = ge('c4-timer'), start = ge('c4-start');
    timer.style.display = active ? '' : 'none';
    const waiting = !!(active && G.chal && !G.chal.started && !G.chal.done);
    start.style.display = waiting ? '' : 'none';
    start.classList.toggle('supply-attention', waiting);
    start.textContent = '▶ 启动供料';
    if (active) timer.textContent = '剩余 ' + this.c4Remaining() + 's';
  },

  refreshChalProgress() {
    if(G.v3) {
      this.els.hint.textContent=''; this.refreshTargetCond(); this.refreshC4Controls();
      const stock = ge('v3-stock-status');
      if (stock) stock.textContent = this.v3StockText();
      return;
    }
    if(G.v2) { this.refreshV2(); this.els.hint.textContent=G.chalDef.hint; return; }
    const C = G.chalDef;
    this.refreshC4Controls();
    let s = '已交付 ' + G.delivered + (C.need ? '/' + C.need : '');
    if (C.tickLimit) s += ' · 剩余 ' + this.c4Remaining() + 's';
    if (C.realTimer) s += ' · 用时 ' + G.chal.elapsed.toFixed(1) + 's' + (C.realLimit ? ' / ' + C.realLimit + 's' : '');
    if (C.devLimit) s += ' · 设备 ' + usedTotal() + '/' + C.devLimit;
    this.els.hint.textContent = C.hint + '　【' + s + '】';
  },

  // 挑战结算弹窗：星级 + 成绩 + 最佳记录
  showChalWin(stars, scoreText, isBest) {
    const C = G.chalDef;
    this.els.modal.querySelector('h2').textContent = stars > 0 ? '过关！' : '未达标';
    this.els.winStars.textContent = stars > 0 ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '未达标';
    this.els.winInfo.textContent = (C.isDaily ? C.name : C.id + ' ' + C.name) + ' · ' + scoreText + (isBest ? ' · 新纪录！' : '');
    this.els.btnNext.style.display = (stars > 0 && !C.isDaily && G.chalIndex + 1 < CHALLENGES.length) ? '' : 'none';
    this.els.modal.style.display = 'flex';
  },

  hideModal() { this.els.modal.style.display = 'none'; },

  refreshV2() {
    const bar=ge('v2-controls'); if(!bar) return;
    const show=!!G.v2, prev=bar.style.display;
    ge('tray').classList.toggle('v2-mode',show);
    bar.style.display=show?'flex':'none';
    if(show) {
      const v=G.v2;
      ge('v2-cutter').value=v.toolModes.cutter; ge('v2-merger').value=v.toolModes.merger;
      ge('v2-stock').textContent='库存 '+v.initial.length+' · 待补 '+v.reserve.length+' · 已发 '+v.emitted;
      const orders=ge('v2-orders'); orders.textContent='';
      for(const o of v.orders) {
        const label=document.createElement('span'); label.className='v2-order';
        const canvas=document.createElement('canvas'); canvas.width=44;canvas.height=40;
        if(canvas.getContext) Render.shapeIcon(canvas.getContext('2d'),Trapezoid.preview(o.recipeId),22,20,16);
        label.appendChild(canvas);
        const text=document.createElement('span');text.textContent=o.recipeId.replace('F_','')+' '+o.delivered+'/'+o.need;
        label.appendChild(text);orders.appendChild(label);
      }
      this.refreshTargetCond();
    }
    if(prev!==bar.style.display) Render.resize();
  },
};

const Input = {
  drag: null, // 拖拽会话 { button, last:{x,y}, placed:[], warned }

  init() {
    UI.init();
    Landscape.init();
    const cv = Render.cv;
    cv.addEventListener('mousemove', e => this._move(e));
    cv.addEventListener('mouseleave', () => { G.hover = { x: -1, y: -1 }; });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('mousedown', e => this._down(e));
    window.addEventListener('mouseup', () => this._up());
    window.addEventListener('keydown', e => this.key(e));
    // 方向/可见视口变化后下一帧重排；旋转事件再补一次以适配尺寸稍晚更新的浏览器。
    let resizePending = false;
    const resize = () => {
      if (resizePending) return;
      resizePending = true;
      requestAnimationFrame(() => { resizePending = false; Render.resize(); });
    };
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => { resize(); setTimeout(resize, 120); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
    document.addEventListener('fullscreenchange', resize);
    // 触屏桥接：单指 = 鼠标左键（放置/拖拽连铺/粘贴/框选），全程禁页面滚动缩放
    cv.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this._down({ clientX: t.clientX, clientY: t.clientY, button: 0 });
    }, { passive: false });
    cv.addEventListener('touchmove', e => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this._move({ clientX: t.clientX, clientY: t.clientY });
    }, { passive: false });
    cv.addEventListener('touchend', e => { e.preventDefault(); this._up(); }, { passive: false });
    cv.addEventListener('touchcancel', () => this._up());
  },

  _move(e) {
    const p = this.pos(e);
    G.hover = p;
    if (G.selMode && G.sel) { // 框选中：更新矩形
      const q = {
        x: Math.max(0, Math.min(GRID_W - 1, p.x)),
        y: Math.max(0, Math.min(GRID_H - 1, p.y)),
      };
      G.sel.x1 = q.x; G.sel.y1 = q.y;
      return;
    }
    if (!this.drag) return;
    const q = {
      x: Math.max(0, Math.min(GRID_W - 1, p.x)),
      y: Math.max(0, Math.min(GRID_H - 1, p.y)),
    };
    if (this.drag.button === 2 || G.tool === 'bulldoze') {
      this.walkTo(q, (f, t) => this.removeAt(t.x, t.y)); // 拖动连拆
    } else if (G.tool === 'belt') {
      this.dragBelt(q); // 拖动连铺
    }
  },

  _down(e) {
    AudioFX.ensure();
    const p = this.pos(e);
    G.hover = { x: p.x, y: p.y };
    if(G.v3&&e.button===0&&!G.paste&&!G.selMode&&G.tool&&G.tool!=='bulldoze') {
      const c=cellAt(p.x,p.y);
      if(c&&MACHINE_TYPES.includes(c.type)&&c.type!=='belt') {
        G.v3.selected={x:p.x,y:p.y};
        if(c.machineMode && (c.type==='cutter'||c.type==='merger')) G.v3.toolModes[c.type]=c.machineMode;
        if(c.type==='merger') G.v3.toolRuleId=c.ruleId||'';
        UI.toast(c.status||'机器已选中；可在蓝图库侧栏调整空机器模式');
        UI.refreshBps();
        return;
      }
      G.v3.selected=null;
    }
    if(G.v2&&e.button===0&&!G.paste&&!G.selMode&&G.tool&&G.tool!=='bulldoze') {
      const c=cellAt(p.x,p.y);
      if(c&&MACHINE_TYPES.includes(c.type)&&c.type!=='belt') {
        G.v2.selected={x:p.x,y:p.y};
        if(c.machineMode) { G.v2.toolModes[c.type]=c.machineMode; UI.refreshV2(); }
        UI.toast((c.locked?'固定教学机器 · ':'')+(c.status||'可通过下方选择框修改空机器模式'));
        return;
      }
      G.v2.selected=null;
    }
    if (e.button === 0 && G.paste) { this.pasteAt(p.x, p.y); return; } // 粘贴态优先
    if (e.button === 0 && G.selMode) { // 框选起点
      if (p.x >= 0 && p.y >= 0 && p.x < GRID_W && p.y < GRID_H) G.sel = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      return;
    }
    if (e.button === 2) {
      Undo.begin(); // 拖动连拆 = 一个动作组
      this.removeAt(p.x, p.y);
      this.drag = { button: 2, last: p };
      return;
    }
    if (e.button === 0) {
      if (G.tool === 'belt') {
        Undo.begin(); // 拖动连铺 = 一个动作组
        this.drag = { button: 0, last: p, placed: [], warned: false };
        if (this.tryPlace(p.x, p.y, 'belt', G.toolDir)) {
          const c = cellAt(p.x, p.y);
          c._drag = true;
          this.drag.placed.push(c);
        }
      } else {
        if (G.tool === 'bulldoze') { Undo.begin(); this.drag = { button: 0, last: p }; } // 拖拆成组
        this.click(p.x, p.y);
      }
    }
  },

  _up() {
    if (G.selMode && G.sel) this.copyRegion(); // 框选松开即复制
    if (!this.drag) return;
    if (this.drag.placed) this.drag.placed.forEach(c => { delete c._drag; });
    this.drag = null;
    Undo.end();
  },

  // D16 统一入口：画布本地像素 → 网格坐标（ox/oy 偏移 + 动态 TILE），禁止直接除固定边长
  pxToGrid(lx, ly) {
    return {
      x: Math.floor((lx - Render.ox) / TILE),
      y: Math.floor((ly - Render.oy) / TILE),
    };
  },

  pos(e) {
    const r = Render.cv.getBoundingClientRect();
    const lx = (e.clientX - r.left) / r.width * Render.cssW;
    const ly = (e.clientY - r.top) / r.height * Render.cssH;
    return this.pxToGrid(lx, ly);
  },

  click(x, y) {
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return;
    if (!G.tool || G.tool === 'bulldoze') { this.removeAt(x, y); return; }
    if (G.won) return;
    if (G.paused) { UI.toast('已暂停，按空格继续'); return; }
    const cell = G.grid[y][x];
    if (cell) { AudioFX.deny(); return; } // 资源/枢纽/已有机器上不可放置
    this.tryPlace(x, y, G.tool, G.toolDir);
  },

  // 统一放置入口：校验边界/占用/预算，成功则建格、扣预算、计数
  tryPlace(x, y, type, dir, quiet, machineMode, ruleId) {
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return false;
    if (G.won || G.paused) return false;
    if (G.grid[y][x]) return false;
    if (!(G.budget[type] > 0)) {
      if (!quiet) {
        const t = TOOLS.find(t => t.id === type);
        UI.toast('「' + t.name + '」预算已用完');
        AudioFX.deny();
      }
      return false;
    }
    G.grid[y][x] = mkCell(type, x, y, dir);
    if(G.v2&&(type==='cutter'||type==='merger')) G.grid[y][x].machineMode=machineMode||G.v2.toolModes[type];
    if(G.v3&&(type==='cutter'||type==='merger')) G.grid[y][x].machineMode=machineMode||G.v3.toolModes[type]||'auto';
    if(G.v3&&type==='merger'&&(ruleId===undefined?G.v3.toolRuleId:ruleId)) G.grid[y][x].ruleId=ruleId===undefined?G.v3.toolRuleId:ruleId;
    if (G.budget[type] !== Infinity) G.budget[type]--;
    G.used[type]++;
    Undo.rec('place', x, y, type, dir); // 宪法7：统一入口写撤销栈
    AudioFX.place();
    UI.refreshBudget();
    return true;
  },

  // 从 last 逐格走向 p（先横后纵取差值较大轴），每步回调 (from, to)
  walkTo(p, fn) {
    let cur = this.drag.last, guard = 0;
    while ((cur.x !== p.x || cur.y !== p.y) && guard++ < 64) {
      const dx = p.x - cur.x, dy = p.y - cur.y;
      const step = { x: cur.x, y: cur.y };
      if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) step.x += Math.sign(dx);
      else if (dy !== 0) step.y += Math.sign(dy);
      fn(cur, step);
      cur = step;
    }
    this.drag.last = cur;
  },

  dirFromTo(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0;
  },

  // 拖拽铺传送带：上一条本次拖出的带随拖动转向（自动拐弯），新格朝运动方向
  dragBelt(p) {
    this.walkTo(p, (from, to) => {
      const d = this.dirFromTo(from, to);
      const prev = cellAt(from.x, from.y);
      if (prev && prev.type === 'belt' && prev._drag) prev.dir = d;
      if (this.tryPlace(to.x, to.y, 'belt', d, true)) {
        const c = cellAt(to.x, to.y);
        c._drag = true;
        this.drag.placed.push(c);
      } else if (!(G.budget.belt > 0) && !this.drag.warned) {
        this.drag.warned = true;
        UI.toast('「传送带」预算已用完');
      }
    });
  },

  removeAt(x, y) {
    if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return;
    const cell = G.grid[y][x];
    if (!cell || MACHINE_TYPES.indexOf(cell.type) < 0) return; // 资源与枢纽不可拆
    const selected = G.v3 ? G.v3.selected : G.v2 ? G.v2.selected : null;
    const inspectorWasShowingCell = selected && selected.x === x && selected.y === y;
    Undo.rec('remove', x, y, cell.type, cell.dir);
    demolishCell(x, y);
    AudioFX.remove();
    UI.refreshBudget();
    if (inspectorWasShowingCell && typeof UI.refreshBps === 'function') UI.refreshBps();
    else if (G.v3 && UI.bpOpen) {
      const stock = ge('v3-stock-status');
      if (stock) stock.textContent = UI.v3StockText();
    }
  },

  // 框选复制：不改动网格，结果进剪贴板
  copyRegion() {
    const s = G.sel;
    G.sel = null;
    const bp = Blueprints.fromRegion(s.x0, s.y0, s.x1, s.y1);
    if (!bp) { UI.toast('框内没有可复制的机器'); AudioFX.deny(); return; }
    G.clip = bp;
    UI.toast('已复制 ' + bp.cells.length + ' 台设备（Ctrl+V 粘贴）');
    AudioFX.place();
  },

  // 蓝图粘贴：整体预检，要么全成要么全不
  pasteAt(px, py) {
    if (G.won || G.paused) return;
    const bp = G.paste;
    const bad = Blueprints.check(bp, px, py);
    if (bad) {
      UI.toast('无法粘贴：(' + bad.x + ',' + bad.y + ') ' + bad.reason);
      AudioFX.deny();
      return;
    }
    Undo.begin(); // 一次粘贴 = 一个撤销动作组
    let placed = false;
    for (const c of bp.cells) if (this.tryPlace(px + c.dx, py + c.dy, c.type, c.dir, true, c.machineMode, c.ruleId || '')) placed = true;
    Undo.end();
    if (placed && G.mode === 'tutorial') G.blueprintUsed = true;
    UI.toast('已粘贴「' + bp.name + '」（' + bp.cells.length + ' 台）');
  },

  key(e) {
    if (UI.els.menu && UI.els.menu.style.display === 'flex') { // 主菜单打开时只响应 Esc 返回
      if (e.key === 'Escape') setMode(G.mode);
      return;
    }
    if (e.key === ',' || e.key === '.') { // 速度：, 降档 . 升档
      const i = Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(G.speed) + (e.key === '.' ? 1 : -1)));
      if (SPEEDS[i] !== G.speed) { setSpeed(SPEEDS[i]); UI.toast('速度 ×' + SPEEDS[i]); }
      return;
    }
    if (e.key === ' ') {
      if (!G.won) { G.paused = !G.paused; UI.syncPause(); }
      e.preventDefault();
      return;
    }
    if ((e.key === 'v' || e.key === 'V') && (e.ctrlKey || e.metaKey)) { // Ctrl+V 进入粘贴态
      if (G.clip) {
        G.paste = Blueprints.clone(G.clip);
        G.selMode = false; G.sel = null; G.tool = null; UI.refreshToolbar();
        UI.toast('粘贴「' + G.paste.name + '」：左键放置 · R 旋转 · Esc 取消');
      } else UI.toast('剪贴板为空：先按 B 框选复制');
      e.preventDefault();
      return;
    }
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { // Ctrl+Z 撤销
      UI.toast(Undo.undo() ? '已撤销' : '没有可撤销的操作');
      e.preventDefault();
      return;
    }
    if ((e.key === 'y' || e.key === 'Y') && (e.ctrlKey || e.metaKey)) { // Ctrl+Y 重做
      UI.toast(Undo.redoOp() ? '已重做' : '没有可重做的操作');
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') { // 取消顺序：粘贴 → 框选 → 工具
      if (G.paste) { G.paste = null; UI.toast('已取消粘贴'); return; }
      if (G.selMode) { G.selMode = false; G.sel = null; return; }
      G.tool = null; UI.refreshToolbar(); return;
    }
    if (e.key === 'b' || e.key === 'B') { // 框选态
      if (G.won || G.paused) return;
      G.selMode = true; G.sel = null; G.paste = null; G.tool = null;
      UI.refreshToolbar();
      UI.toast('框选模式：拖出矩形复制机器，S 保存为蓝图，Esc 退出');
      return;
    }
    if (e.key === 'm' || e.key === 'M') { // 粘贴态：整体镜像（超额位）
      if (G.paste) { G.paste = Blueprints.mirror(G.paste); UI.toast('已镜像翻转'); }
      return;
    }
    if (e.key === 's' || e.key === 'S') { UI.saveBlueprint(); return; }
    if (e.key === 'r' || e.key === 'R') {
      if (G.paste) { G.paste = Blueprints.rotate(G.paste); return; } // 粘贴态：整体旋转
      const h = G.hover;
      const cell = (h.x >= 0 && h.y >= 0 && h.x < GRID_W && h.y < GRID_H) ? G.grid[h.y][h.x] : null;
      if (!G.tool && cell && MACHINE_TYPES.indexOf(cell.type) >= 0) {
        if(G.v2&&(G.paused||G.won||cell.locked||V2Runtime.occupied(cell))) {
          UI.toast(cell.locked?'固定教学机器不可旋转':'先重置材料，再旋转机器');
          return;
        }
        if(G.v3&&(G.paused||G.won||V3Runtime.occupied(cell))) {
          UI.toast('先重置供料，再旋转机器');
          return;
        }
        cell.dir = (cell.dir + 1) % 4; // 空工具时 R 旋转光标下的已有机器
      } else {
        G.toolDir = (G.toolDir + 1) % 4;
      }
      return;
    }
    const t = TOOLS.find(t => t.key === e.key);
    if (t) {
      if (t.id !== 'bulldoze' && !(G.budget[t.id] > 0)) {
        UI.toast('「' + t.name + '」本关不可用或预算已用完');
        AudioFX.deny();
        return;
      }
      G.tool = t.id;
      G.paste = null; G.selMode = false; G.sel = null; // 数字键选工具同样退出粘贴/框选态
      UI.refreshToolbar();
    }
  },
};
