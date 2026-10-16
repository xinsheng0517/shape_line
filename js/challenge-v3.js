'use strict';
/* Four-petal challenge runtime. Loaded after challenges.js, before core.js. */
const V3_QUEUE_CAPACITY = 64;
const V3_SUPPLY_MOVES = 3; // 多资源共用传送线时保留汇流空档，避免单一路径持续占满入口
const V3Runtime = {
  active() { return !!G.v3; },
  stock(def) {
    return def.resources.map((resource, node) =>
      Array.from({ length: def.initial[node] || 0 }, (_, i) =>
        PetalV3.raw(resource.type, `${def.id}:source${node}:raw${i}`)));
  },
  supply(def) {
    const stockByNode = this.stock(def);
    return {
      stockByNode,
      nextRawByNode: stockByNode.map(items => items.length),
    };
  },
  load(index) {
    const def = CHALLENGES[index];
    if (!def || def.ruleset !== 'petal-v3') throw new Error('Not a four-petal challenge');
    G.v2 = null;
    G.mode = 'challenge'; G.chalIndex = index; G.chalDef = def;
    G.save.lastChal = index;
    setGridSize(24, 16, 32);
    G.grid = Array.from({ length: 16 }, () => Array(24).fill(null));
    for (let i = 0; i < def.resources.length; i++) {
      const r = def.resources[i];
      G.grid[r.y][r.x] = { type: 'resource', x: r.x, y: r.y,
        shapeType: r.type, sourceNode: i };
    }
    G.grid[def.hub.y][def.hub.x] = mkCell('hub', def.hub.x, def.hub.y, 0);
    G.target = PetalV3.preview(def.recipeId);
    G.budget = { ...def.budget };
    G.used = {}; MACHINE_TYPES.forEach(type => { G.used[type] = 0; });
    G.tickCount = 0; G.delivered = 0; G.won = false; G.paused = false;
    G.chal = { elapsed: 0, done: false, started: false };
    G.particles.length = 0; G.hubPulse = 0; G.stats.log.length = 0;
    G.tool = 'belt'; G.toolDir = 1; G.hover = { x: -1, y: -1 };
    G.paste = null; G.selMode = false; G.sel = null; G.clip = null;
    G.v3 = { def, running: true, toolModes: { cutter: 'auto', merger: 'auto' },
      ...this.supply(def), deliveredItems: [], discardedItems: [],
      discardReasons: [], emitted: 0 };
    Undo.clear(); persist();
    UI.refreshLevel(); UI.refreshBudget(); UI.refreshToolbar(); UI.syncPause();
    if (typeof UI.refreshV3 === 'function') UI.refreshV3();
  },
  resetMaterial() {
    if (!G.v3) return;
    for (const row of G.grid) for (const c of row) if (c) {
      for (const key of ['item', 'inA', 'inB', 'outA', 'outB', 'proc']) c[key] = null;
      c.queueA = []; c.queueB = []; c.cd = 1; c.status = ''; c.nextPort = 0;
      c.autoHalves = [];
      c.synthesisRevision = 0; c.synthesisCache = null;
    }
    Object.assign(G.v3, this.supply(G.v3.def));
    G.v3.deliveredItems = []; G.v3.discardedItems = []; G.v3.discardReasons = [];
    G.v3.emitted = 0; G.v3.running = true;
    G.delivered = 0; G.tickCount = 0; G.won = false; G.paused = false;
    G.chal.elapsed = 0; G.chal.done = false; G.chal.started = false;
    G.stats.log.length = 0; G.hubPulse = 0;
    UI.syncPause();
    if (typeof UI.refreshV3 === 'function') UI.refreshV3();
  },
  occupied(c) {
    return !!(c.item || c.inA || c.inB || c.outA || c.outB || c.proc ||
      (c.queueA && c.queueA.length) || (c.queueB && c.queueB.length) ||
      (c.autoHalves && c.autoHalves.length));
  },
  item(shape, c) { return { shape, fx: c.x, fy: c.y, moveTick: G.tickCount }; },
  materialIds() {
    if (!G.v3) return [];
    const shapes = G.v3.stockByNode.flat().concat(
      G.v3.deliveredItems, G.v3.discardedItems);
    for (const row of G.grid) for (const c of row) if (c) {
      for (const key of ['item', 'inA', 'inB', 'outA', 'outB'])
        if (c[key]) shapes.push(c[key].shape);
      for (const key of ['queueA', 'queueB'])
        for (const it of c[key] || []) shapes.push(it.shape);
      for (const shape of c.autoHalves || []) shapes.push(shape);
      if (c.proc) {
        shapes.push(c.proc.shape);
        if (c.proc.shapeB) shapes.push(c.proc.shapeB);
      }
    }
    return shapes.flatMap(shape => shape.units.map(unit => unit.id));
  },
  accepts(c, sx, sy, it) {
    if (!it || !PetalV3.validItem(it.shape)) return null;
    const d = DIRV[c.dir], back = sx === c.x - d[0] && sy === c.y - d[1];
    const r = DIRV[(c.dir + 1) % 4], l = DIRV[(c.dir + 3) % 4];
    if (c.type === 'hub') return PetalV3.isFinished(it.shape, [G.v3.def.recipeId]) &&
      G.delivered < G.v3.def.need ? 'consume' : null;
    if (c.type === 'trash') return 'discard';
    if (c.type === 'belt') return !(sx === c.x + d[0] && sy === c.y + d[1]) &&
      !c.item ? 'item' : null;
    let port = null;
    if (back) port = 'queueA';
    if (c.type === 'cutter' && sx === c.x + l[0] && sy === c.y + l[1]) port = 'queueB';
    if (c.type === 'merger' && sx === c.x + r[0] && sy === c.y + r[1]) port = 'queueB';
    if (c.type === 'rotator' && !back) return null;
    if (!port || !['cutter', 'merger', 'rotator'].includes(c.type)) return null;
    if (c.type === 'cutter' && !PetalV3.cut(it.shape, c.machineMode || 'auto')) return null;
    return (c[port] || []).length < V3_QUEUE_CAPACITY ? port : null;
  },
  blockReason(dest, it) {
    if (!dest) return '下游未连接';
    if (dest.type === 'hub') {
      return '物料结构与关卡目标不符';
    }
    if (dest.type === 'belt' && dest.item) return '下游传送带已满';
    if (dest.type === 'cutter' && !PetalV3.cut(it.shape, dest.machineMode || 'auto'))
      return '该切割方向无法把当前结构分成两份';
    return '下游入口未对齐或缓存已满';
  },
  outletStatus(c) {
    const waiting = [];
    for (const [slot, label, dir] of [
      ['outA', '前出口', c.dir], ['outB', '侧出口', (c.dir + 1) % 4]
    ]) {
      const it = c[slot];
      if (!it) continue;
      const d = DIRV[dir], dest = cellAt(c.x + d[0], c.y + d[1]);
      const reason = dest && this.accepts(dest, c.x, c.y, it)
        ? '等待运输' : this.blockReason(dest, it);
      waiting.push(label + (reason === '下游未连接' ? '未连接，产物待取' : '：' + reason));
    }
    return (c.type === 'merger' && waiting.length ? '合成完成；' : '') + waiting.join('；');
  },
  tick() {
    if (!G.v3 || !G.v3.running || G.paused || G.won) return;
    G.tickCount++;
    if (G.tickCount % MOVE_EVERY === 0) this.movement();
    if (!G.won) this.machines();
  },
  movement() {
    const sources = [];
    for (const row of G.grid) for (const c of row) if (c) {
      const slots = c.type === 'belt' || c.type === 'extractor' ? ['item'] :
        ['outA', 'outB'];
      for (const slot of slots) if (c[slot]) sources.push({ c, slot, it: c[slot] });
    }
    for (const { c, slot, it } of sources) {
      if (G.won || c[slot] !== it) continue;
      const d = DIRV[slot === 'outB' ? (c.dir + 1) % 4 : c.dir];
      const dest = cellAt(c.x + d[0], c.y + d[1]);
      const port = dest && this.accepts(dest, c.x, c.y, it);
      if (!port) { c.status = this.blockReason(dest, it); continue; }
      c[slot] = null; c.status = '';
      if (port === 'consume') {
        G.v3.deliveredItems.push(it.shape); G.delivered++;
        G.stats.log.push(performance.now()); G.hubPulse = 1;
        AudioFX.deliver(); burst(dest.x, dest.y, '#ffd166', 12);
        if (G.delivered >= G.v3.def.need) challengeWin();
      } else if (port === 'discard') {
        G.v3.discardedItems.push(it.shape);
        const reason = '玩家垃圾桶';
        G.v3.discardReasons.push({ itemId: it.shape.itemId, reason });
        dest.status = reason + '已回收';
        burst(dest.x, dest.y, '#6a7286', 5);
      } else {
        it.fx = c.x; it.fy = c.y; it.moveTick = G.tickCount;
        if (port === 'item') dest.item = it;
        else {
          if (!dest[port]) dest[port] = [];
          dest[port].push(it);
          dest.synthesisRevision = (dest.synthesisRevision || 0) + 1;
        }
      }
    }
  },
  machines() {
    for (const row of G.grid) for (const c of row) if (c) {
      if (c.type === 'extractor') {
        if (c.item) continue;
        if (c.cd > 0) c.cd--;
        if (c.cd > 0) continue;
        const node = DIRV.map(d => cellAt(c.x + d[0], c.y + d[1]))
          .find(n => n && n.type === 'resource' && Number.isInteger(n.sourceNode));
        if (!node) { c.status = '未连接资源节点'; continue; }
        const source = node.sourceNode;
        const stock = G.v3.stockByNode[source];
        const shape = stock.length ? stock.shift() : PetalV3.raw(
          G.v3.def.resources[source].type,
          `${G.v3.def.id}:source${source}:raw${G.v3.nextRawByNode[source]++}`);
        c.item = this.item(shape, c); c.cd = MOVE_EVERY * V3_SUPPLY_MOVES;
        c.status = ''; G.v3.emitted++;
        continue;
      }
      if (!['cutter', 'rotator', 'merger'].includes(c.type)) continue;
      c.queueA = c.queueA || []; c.queueB = c.queueB || [];
      c.autoHalves = c.autoHalves || [];
      if (c.proc) {
        if (c.proc.t > 0) c.proc.t--;
        if (c.proc.t <= 0) {
          if (c.proc.autoStage === 'half') {
            c.autoHalves.push(c.proc.shape);
            c.proc = null; c.status = '内部半块待合并';
          } else if (!c.outA && !c.outB) {
            c.outA = this.item(c.proc.shape, c);
            if (c.proc.shapeB) c.outB = this.item(c.proc.shapeB, c);
            c.proc = null; c.status = '';
          } else c.status = '输出堵塞';
        }
        continue;
      }
      if (c.outA || c.outB) { c.status = this.outletStatus(c); continue; }
      if (c.type === 'merger') {
        this.synthesize(c);
        continue;
      }
      const choices = c.nextPort === 1 ? ['queueB', 'queueA'] : ['queueA', 'queueB'];
      const port = choices.find(name => c[name].length);
      if (!port) { c.status = '等待材料'; continue; }
      const input = c[port][0].shape;
      const result = c.type === 'rotator' ? [PetalV3.rotate(input)] :
        PetalV3.cut(input, c.machineMode || 'auto');
      if (!result || !result[0]) { c.status = '材料阶段或切割方向不符'; continue; }
      c[port].shift(); c.nextPort = port === 'queueA' ? 1 : 0;
      c.proc = { shape: result[0], shapeB: result[1] || null, t: PROC_TICKS };
      c.status = '加工中';
    }
  },
  synthesisMode(c) {
    if (c.machineMode === 'stack') return 'stack';
    if (['join', 'half', 'final'].includes(c.machineMode)) return 'join';
    return 'auto';
  },
  synthesize(c) {
    // Old internal halves and both physical inlet buffers share one view.
    // Port A precedes B for ordered stacking; each inlet preserves arrival order.
    const entries = [
      ...c.autoHalves.map(shape => ({ shape, container: c.autoHalves, value: shape })),
      ...c.queueA.map(item => ({ shape: item.shape, container: c.queueA, value: item })),
      ...c.queueB.map(item => ({ shape: item.shape, container: c.queueB, value: item })),
    ];
    if (!entries.length) { c.status = '等待材料'; return; }
    const engine = PetalV3.engine;
    const mode = this.synthesisMode(c);
    const key = [c.synthesisRevision || 0, engine.revision || engine.version || 0,
      mode, c.ruleId || '', entries.length].join('|');
    let selected;
    if (c.synthesisCache && c.synthesisCache.key === key &&
        c.synthesisCache.values.every((value, i) => value === entries[i].value)) {
      selected = c.synthesisCache.selected;
    } else {
      const items = entries.map(entry => entry.shape);
      if (mode === 'auto' && !c.ruleId) {
        // Building a line while it runs can fill one inlet before the other.
        // Join complementary positions first, even behind duplicate early items.
        selected = engine.select(items, {mode:'auto',genericMode:'join'});
        if (!selected.ok && selected.reason === 'no-compatible-inputs') {
          const other = entries.findIndex(entry => entry.container !== entries[0].container);
          if (other >= 0) {
            // Overlap still stacks automatically across distinct inlet buffers.
            // Explicit stack mode / registered rules also support one-inlet stacks.
            const indices = [0, other];
            const fallback = engine.select(indices.map(index => items[index]), {mode:'auto'});
            selected = {...fallback, indices:fallback.indices.map(index => indices[index])};
          } else selected = {...selected, pending:true, reason:'waiting-for-complementary-inputs'};
        }
      } else selected = engine.select(items, {mode, ruleId:c.ruleId || undefined});
      c.synthesisCache = {key, values:entries.map(entry => entry.value), selected};
    }
    if (!selected.ok) {
      c.status = selected.reason === 'waiting-for-complementary-inputs' ? '等待互补位置的材料，重复片已保留' :
        selected.pending ? '等待规则所需的其余输入' :
        selected.reason === 'budget-exceeded' ? '匹配工作预算已用完，输入已保留' :
        '等待可合成材料：' + (selected.reason || '至少需要两件物料');
      return;
    }
    const chosen = selected.indices.map(index => entries[index]);
    if (!chosen.length || chosen.some(entry => !PetalV3.validItem(entry.shape))) {
      c.status = '物料身份无效'; return;
    }
    const result = PetalV3.mergeMany(chosen.map(entry => entry.shape),
      {mode, ruleId:selected.result.ruleId || c.ruleId || undefined});
    if (!result) { c.status = '物料冲突，输入已保留'; return; }
    for (const entry of chosen) {
      const index = entry.container.indexOf(entry.value);
      if (index < 0) { c.status = '输入发生变化，等待下一次匹配'; return; }
    }
    for (const entry of chosen) entry.container.splice(entry.container.indexOf(entry.value), 1);
    c.synthesisRevision = (c.synthesisRevision || 0) + 1;
    c.synthesisCache = null;
    c.proc = {shape:result, t:PROC_TICKS};
    c.status = '合成中 · ' + chosen.length + ' 输入';
  },
};

for (const [index, name, recipeId, need, positions, hub, initial, limited] of [
  [0, '双材初识', 'F_TC_TC', 3, [[2, 3], [2, 8], [2, 13]], [21, 8], [1, 1, 1], false],
  [1, '三材调度', 'F_TC_TS', 6, [[2, 3], [2, 12], [20, 2]], [20, 13], [2, 2, 2], false],
  [4, '双材精炼', 'F_CS_CS', 4, [[2, 3], [2, 8], [2, 13]], [21, 8], [1, 1, 1], true],
  [5, '三材终章', 'F_TC_SC', 8, [[2, 2], [2, 13], [20, 2]], [20, 13], [2, 2, 2], true],
]) {
  const budget = Object.fromEntries(
    ['belt', 'extractor', 'cutter', 'rotator', 'merger', 'trash']
      .map(type => [type, Infinity]));
  if (limited) { budget.extractor = 3; budget.belt = 80; }
  CHALLENGES[index] = {
    id: `C${index + 1}`, name, revision: 3, ruleset: 'petal-v3',
    recipeId, need, target: PetalV3.preview(recipeId), initial,
    resources: positions.map(([x, y], i) => ({ x, y, type: PetalV3.SHAPES[i] })),
    hub: { x: hub[0], y: hub[1] }, budget, betterIsLower: true,
    scoreVal: g => g.used.belt,
    scoreText: g => `${g.delivered} 个新成品 · ${g.used.belt} 条传送带`,
    stars: g => {
      if (g.delivered < g.chalDef.need) return 0;
      const belts = g.used.belt;
      if (!limited) return belts <= 55 ? 3 : belts <= 70 ? 2 : 1;
      return belts <= 62 ? 3 : belts <= 72 ? 2 : 1;
    },
  };
}
