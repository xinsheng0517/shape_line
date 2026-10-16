'use strict';
/* sim.js — 固定 tick 模拟：形状变换、物品移动（先算后动的双缓冲）、机器加工、枢纽判定
 * 只被 core.js 的 tick 调用，不响应输入、不做渲染。
 */

// ===== 形状变换（象限约定：0=右上 1=右下 2=左下 3=左上，顺时针） =====
// 切割（垂直）：返回 [右半, 左半]
function cutV(s) {
  if (Array.isArray(s)) return [[s[0], s[1], null, null], [null, null, s[2], s[3]]];
  return ['R','L'].map(side=>classicShape(s.units.filter(unit=>unit.quadrant.endsWith(side))));
}
// 顺时针旋转 90°：原 0 号位（右上）落到 1 号位（右下）
function rotCW(s) {
  if (Array.isArray(s)) return [s[3], s[0], s[1], s[2]];
  const next={TL:'TR',TR:'BR',BR:'BL',BL:'TL'};
  return classicShape(s.units.map(unit=>({...unit,quadrant:next[unit.quadrant],slot:next[unit.quadrant]})));
}
// 合并（并集）：底 + 补，空象限被补位件填充
const ClassicSynthesisEngine = typeof PetalV3 !== 'undefined' ? PetalV3.engine : SynthesisEngine.create(SynthesisConfig);
const CLASSIC_SLOTS = ['TR','BR','BL','TL'];
let classicSerial=0;
function classicItem(shape) {
  if (!Array.isArray(shape)) return shape;
  const prefix='classic-'+(++classicSerial);
  return {orientation:0,units:shape.flatMap((kind,index)=>kind==null?[]:[{
    id:prefix+':'+index,sourceId:prefix+':'+index,shapeKind:kind==='R'?'T':kind,
    quadrant:CLASSIC_SLOTS[index],slot:CLASSIC_SLOTS[index],layer:0,cutStage:0
  }])};
}
function classicShape(units) {
  if (!units.length) return [null,null,null,null];
  if (units.every(unit=>unit.layer===0))
    return CLASSIC_SLOTS.map(slot=>units.find(unit=>unit.quadrant===slot)?.shapeKind||null);
  const layers=Array.from({length:Math.max(...units.map(unit=>unit.layer))+1},()=>({}));
  for(const unit of units) layers[unit.layer][unit.quadrant]=unit.shapeKind;
  return Object.freeze({kind:'synthesis',orientation:0,stage:'composite',
    units:Object.freeze(units.map(unit=>Object.freeze({...unit,resource:unit.shapeKind}))),
    layers:Object.freeze(layers.map(Object.freeze)),key:ClassicSynthesisEngine.signature({units})});
}
function mergeShapes(b, f) {
  const inputs=[classicItem(b),classicItem(f)].filter(item=>item.units.length);
  if (!inputs.length) return [null,null,null,null];
  if (inputs.length===1) return classicShape(inputs[0].units);
  const result=ClassicSynthesisEngine.combine(inputs);
  return result.ok?classicShape(result.units):null;
}
function shapeEq(a, b) {
  if (!a || !b) return false;
  if (Array.isArray(a)&&Array.isArray(b)) return a.length===4&&b.length===4&&a.every((value,index)=>value===b[index]);
  return ClassicSynthesisEngine.matches(classicItem(a),classicItem(b));
}

// 断言自测：加载即跑，控制台全绿才算通过
console.assert(JSON.stringify(cutV(['C', 'C', 'C', 'C'])[0]) === JSON.stringify(['C', 'C', null, null]), 'cutV 应取右半');
console.assert(JSON.stringify(cutV(['C', 'C', 'C', 'C'])[1]) === JSON.stringify([null, null, 'C', 'C']), 'cutV 应取左半');
console.assert(JSON.stringify(rotCW(['C', 'C', null, null])) === JSON.stringify([null, 'C', 'C', null]), 'rotCW 右半圆→下半圆');
console.assert(JSON.stringify(rotCW(rotCW(['S', 'S', null, null]))) === JSON.stringify([null, null, 'S', 'S']), 'rotCW×2 右半星→左半星');
console.assert(JSON.stringify(mergeShapes(['C', 'C', null, null], [null, null, 'T', 'T'])) === JSON.stringify(['C', 'C', 'T', 'T']), 'merge 右半圆+左半方→右圆左方');

const Sim = {
  tick() {
    if (G.v3) { V3Runtime.tick(); return; }
    if (G.v2) { V2Runtime.tick(); return; }
    if (G.mode === 'challenge' && G.chalDef && G.chalDef.id === 'C4' && G.chal && !G.chal.started) return;
    G.tickCount++;
    if (G.tickCount % MOVE_EVERY === 0) this.movement();
    this.machines();
  },

  // ---- 移动阶段：统一收集搬运者 → 递归解算（先算）→ 同步提交（后动） ----
  movement() {
    const movers = [];
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const c = G.grid[y][x];
      if (!c) continue;
      if ((c.type === 'belt' || c.type === 'extractor') && c.item) movers.push({ x, y, slot: 'item' });
      else if (c.type === 'cutter') {
        if (c.outA) movers.push({ x, y, slot: 'outA' });
        if (c.outB) movers.push({ x, y, slot: 'outB' });
      } else if ((c.type === 'rotator' || c.type === 'merger') && c.outA) movers.push({ x, y, slot: 'outA' });
    }
    const state = new Map(), reserved = new Set();
    for (const m of movers) this.resolve(m.x, m.y, m.slot, state, reserved);
    for (const m of movers) {
      if (state.get(m.x + ',' + m.y + ',' + m.slot) !== 2) continue;
      const src = G.grid[m.y][m.x], it = src[m.slot];
      if (!it) continue;
      src[m.slot] = null;
      const tp = this.targetOf(m.x, m.y, m.slot), t = cellAt(tp.x, tp.y);
      const acc = t ? this.accepts(t, m.x, m.y, it.shape) : false;
      if (acc === 'consume') {
        if (t.type === 'hub') this.deliver(it, t);
        else burst(tp.x, tp.y, '#6a7286', 5); // 垃圾桶吞掉
      } else if (acc) {
        it.fx = m.x; it.fy = m.y; it.moveTick = G.tickCount;
        t[acc] = it;
      } else {
        src[m.slot] = it; // 防御：解算与提交之间状态不应变化
      }
    }
  },

  // 搬运者的目标格：outB（切割机左半）→ 右侧面；其余 → 正面
  targetOf(x, y, slot) {
    const c = G.grid[y][x];
    const d = (slot === 'outB') ? DIRV[(c.dir + 1) % 4] : DIRV[c.dir];
    return { x: x + d[0], y: y + d[1] };
  },

  // 目标格 t 是否接受来自 (sx,sy) 的物品；返回槽位名 / 'consume' / false
  accepts(t, sx, sy, shape) {
    const d = DIRV[t.dir];
    switch (t.type) {
      case 'belt': // 不接受来自自己正面的倒灌
        return (sx === t.x + d[0] && sy === t.y + d[1]) ? false : 'item';
      case 'cutter':
      case 'rotator': // 只从背面进料
        return (sx === t.x - d[0] && sy === t.y - d[1]) ? 'inA' : false;
      case 'merger': { // 背面=底，右侧=补
        const r = DIRV[(t.dir + 1) % 4];
        if (sx === t.x - d[0] && sy === t.y - d[1]) return 'inA';
        if (sx === t.x + r[0] && sy === t.y + r[1]) return 'inB';
        return false;
      }
      case 'trash':
        return 'consume';
      case 'hub': // 枢纽只接收目标形状，其余拒之门外
        return shapeEq(shape, G.target) ? 'consume' : false;
      default:
        return false;
    }
  },

  // 递归解算：目标槽位为空则占用；被物品占着则看对方能否让出；成环即堵转
  resolve(x, y, slot, state, reserved) {
    const key = x + ',' + y + ',' + slot, st = state.get(key);
    if (st === 2) return true;
    if (st === 1 || st === 3) return false; // 环（互等）或已判定不可动
    state.set(key, 1);
    const c = G.grid[y][x], it = c[slot];
    let ok = false;
    if (it) {
      const tp = this.targetOf(x, y, slot), t = cellAt(tp.x, tp.y);
      const acc = t ? this.accepts(t, x, y, it.shape) : false;
      if (acc === 'consume') {
        ok = true;
      } else if (acc) {
        const skey = tp.x + ',' + tp.y + ',' + acc;
        if (!reserved.has(skey)) {
          if (!t[acc]) { reserved.add(skey); ok = true; }
          else if (acc === 'item' && this.resolve(tp.x, tp.y, 'item', state, reserved)) { reserved.add(skey); ok = true; }
        }
      }
    }
    state.set(key, ok ? 2 : 3);
    return ok;
  },

  // ---- 机器阶段：产出与加工 ----
  machines() {
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const c = G.grid[y][x];
      if (!c) continue;
      switch (c.type) {
        case 'extractor': // 紧邻资源节点，每 2 tick 出一个该节点的基础形状
          if (!c.item) {
            if (c.cd > 0) c.cd--;
            if (c.cd <= 0) {
              const rt = this.adjResource(c);
              if (rt) {
                c.item = { shape: [rt, rt, rt, rt], fx: c.x, fy: c.y, moveTick: G.tickCount };
                c.cd = MOVE_EVERY;
              }
            }
          }
          break;
        case 'cutter': // 正面输出右半，右侧面输出左半；两侧排空才能继续切
          if (c.proc) {
            if (--c.proc.t <= 0) {
              const h = cutV(c.proc.shape);
              c.outA = { shape: h[0], fx: c.x, fy: c.y, moveTick: G.tickCount };
              c.outB = { shape: h[1], fx: c.x, fy: c.y, moveTick: G.tickCount };
              c.proc = null;
            }
          } else if (c.inA && !c.outA && !c.outB) {
            c.proc = { shape: c.inA.shape, t: PROC_TICKS };
            c.inA = null;
          }
          break;
        case 'rotator':
          if (c.proc) {
            if (--c.proc.t <= 0) {
              c.outA = { shape: rotCW(c.proc.shape), fx: c.x, fy: c.y, moveTick: G.tickCount };
              c.proc = null;
            }
          } else if (c.inA && !c.outA) {
            c.proc = { shape: c.inA.shape, t: PROC_TICKS };
            c.inA = null;
          }
          break;
        case 'merger': // 底 + 补齐备才开工
          if (c.proc) {
            if (--c.proc.t <= 0) {
              c.outA = { shape: c.proc.shape, fx: c.x, fy: c.y, moveTick: G.tickCount };
              c.proc = null;
            }
          } else if (c.inA && c.inB && !c.outA) {
            const result=mergeShapes(c.inA.shape,c.inB.shape);
            if (!result) { c.status='输入冲突，物料已保留'; break; }
            c.proc = { shape: result, t: PROC_TICKS };
            c.inA = null; c.inB = null;
          }
          break;
      }
    }
  },

  adjResource(c) {
    for (const d of DIRV) {
      const n = cellAt(c.x + d[0], c.y + d[1]);
      if (n && n.type === 'resource') return n.shapeType;
    }
    return null;
  },

  deliver(it, hub) {
    G.delivered++;
    G.stats.log.push(performance.now()); // 统计 HUD：30 秒滚动窗口
    G.hubPulse = 1;
    const kinds=Array.isArray(it.shape)?it.shape.filter(Boolean):it.shape.units.map(unit=>unit.shapeKind);
    const cols = kinds.map(s => SHAPE_COLOR[s]);
    for (let i = 0; i < 20; i++) burst(hub.x, hub.y, cols.length ? cols[i % cols.length] : '#f2a93b', 1);
    AudioFX.deliver();
    winLevel();
  },
};
