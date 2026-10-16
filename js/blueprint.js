'use strict';
/* blueprint.js — 蓝图系统：数据模型、几何变换、整体预检、内置蓝图
 * bp = { id, name, w, h, cells: [{ dx, dy, type, dir }] }
 * dx/dy 相对蓝图左上角；type 复用机器类型；dir 0-3（0上1右2下3左）
 * 本文件只定义数据与纯函数；放置走 Input.tryPlace 统一入口。
 */

const Blueprints = {
  cell(c, dx, dy, dir, includeMode = true) {
    const out = { dx, dy, type: c.type, dir };
    if (includeMode && c.machineMode !== undefined) out.machineMode = c.machineMode;
    if (includeMode && c.ruleId !== undefined) out.ruleId = c.ruleId;
    return out;
  },

  withRuleset(bp, result) {
    if (bp.ruleset !== undefined) result.ruleset = bp.ruleset;
    return result;
  },

  // 从框选区域生成蓝图（只含机器格；空选返回 null）
  fromRegion(x0, y0, x1, y1, name) {
    const ax = Math.min(x0, x1), ay = Math.min(y0, y1);
    const bx = Math.max(x0, x1), by = Math.max(y0, y1);
    const cells = [];
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const c = G.grid[y][x];
      if (c && MACHINE_TYPES.indexOf(c.type) >= 0) {
        cells.push(this.cell(c, x - ax, y - ay, c.dir, !!(G.v2 || G.v3)));
      }
    }
    if (!cells.length) return null;
    const bp = { id: 'bp' + Date.now(), name: name || '未命名蓝图', w: bx - ax + 1, h: by - ay + 1, cells };
    if (G.v3) bp.ruleset = 'petal-v3';
    else if (G.v2) bp.ruleset = 'trapezoid-v2';
    return bp;
  },

  clone(bp) {
    return this.withRuleset(bp, { id: bp.id, name: bp.name, w: bp.w, h: bp.h, cells: bp.cells.map(c => this.cell(c, c.dx, c.dy, c.dir)) });
  },

  // 顺时针整体旋转 90°：(dx,dy)→(h-1-dy,dx)，dir=(dir+1)%4，w/h 互换；返回新蓝图
  rotate(bp) {
    return this.withRuleset(bp, {
      id: bp.id, name: bp.name, w: bp.h, h: bp.w,
      cells: bp.cells.map(c => this.cell(c, bp.h - 1 - c.dy, c.dx, (c.dir + 1) % 4)),
    });
  },

  // 左右镜像（超额位）：dx→w-1-dx，朝向左右互换（1↔3，0/2 不变）
  mirror(bp) {
    const DIR_MIR = [0, 3, 2, 1];
    return this.withRuleset(bp, {
      id: bp.id, name: bp.name, w: bp.w, h: bp.h,
      cells: bp.cells.map(c => this.cell(c, bp.w - 1 - c.dx, c.dy, DIR_MIR[c.dir])),
    });
  },

  // Portable data only: the HTML game shell and runtime machine queues never enter a file.
  FILE_FORMAT: 'shape-line-blueprint',
  FILE_VERSION: 3,
  MAX_FILE_BYTES: 128 * 1024,
  MAX_CELLS: 512,
  MAX_DIMENSION: 128,
  _importSerial: 0,

  byteLength(value) {
    let bytes = 0;
    for (const char of value) {
      const n = char.codePointAt(0);
      bytes += n <= 0x7f ? 1 : n <= 0x7ff ? 2 : n <= 0xffff ? 3 : 4;
    }
    return bytes;
  },

  sanitizeName(value) {
    if (typeof value !== 'string') throw new Error('蓝图名称无效');
    const name = value.replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').trim().slice(0, 40);
    return name || '未命名蓝图';
  },

  validateCells(cells, w, h, ruleset) {
    if (!Array.isArray(cells) || cells.length < 1 || cells.length > this.MAX_CELLS) throw new Error('蓝图单元数量无效');
    const seen = new Set();
    return cells.map(c => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('蓝图单元无效');
      if (Object.keys(c).some(k => !['dx', 'dy', 'type', 'dir', 'machineMode', 'ruleId'].includes(k))) throw new Error('蓝图单元含不允许的字段');
      if (!Number.isInteger(c.dx) || !Number.isInteger(c.dy) || c.dx < 0 || c.dy < 0 || c.dx >= w || c.dy >= h) throw new Error('蓝图坐标无效');
      const key = c.dx + ',' + c.dy;
      if (seen.has(key)) throw new Error('蓝图包含重复坐标');
      seen.add(key);
      if (!['belt', 'extractor', 'cutter', 'rotator', 'merger', 'trash'].includes(c.type)) throw new Error('蓝图机器类型无效');
      if (!Number.isInteger(c.dir) || c.dir < 0 || c.dir > 3) throw new Error('蓝图方向无效');
      const modes = ruleset === 'petal-v3'
        ? (c.type === 'cutter' ? ['auto', 'vertical', 'horizontal'] : c.type === 'merger' ? ['auto', 'join', 'stack', 'half', 'final'] : null)
        : ruleset === 'trapezoid-v2'
          ? (c.type === 'cutter' ? ['rough', 'fine'] : c.type === 'merger' ? ['half', 'final'] : null)
          : null;
      if (c.machineMode !== undefined && (!modes || !modes.includes(c.machineMode))) throw new Error('蓝图机器模式无效');
      if (c.ruleId !== undefined && (ruleset !== 'petal-v3' || c.type !== 'merger' || typeof c.ruleId !== 'string' || !c.ruleId.trim() || c.ruleId.length > 200)) throw new Error('蓝图规则 ID 无效');
      const result = { dx: c.dx, dy: c.dy, type: c.type, dir: c.dir };
      if (c.machineMode !== undefined) result.machineMode = c.machineMode;
      if (c.ruleId !== undefined) result.ruleId = c.ruleId;
      return result;
    });
  },

  validateBlueprint(bp, ruleset) {
    if (!bp || typeof bp !== 'object' || Array.isArray(bp)) throw new Error('蓝图内容无效');
    if (!['classic-v1', 'trapezoid-v2', 'petal-v3'].includes(ruleset)) throw new Error('蓝图规则集无效');
    const w = bp.w, h = bp.h;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > this.MAX_DIMENSION || h > this.MAX_DIMENSION) throw new Error('蓝图尺寸无效');
    return { name: this.sanitizeName(bp.name), ruleset, w, h, cells: this.validateCells(bp.cells, w, h, ruleset) };
  },

  validateFile(file) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('蓝图文件内容无效');
    if (file.format !== this.FILE_FORMAT) throw new Error('蓝图文件格式无效');
    if (file.version !== this.FILE_VERSION) throw new Error('蓝图文件版本不支持');
    if (!file.size || typeof file.size !== 'object' || Array.isArray(file.size)) throw new Error('蓝图尺寸无效');
    if (Object.keys(file).some(k => !['format', 'version', 'ruleset', 'name', 'size', 'cells'].includes(k))) throw new Error('蓝图文件含不允许的字段');
    if (Object.keys(file.size).some(k => !['w', 'h'].includes(k))) throw new Error('蓝图尺寸字段无效');
    return this.validateBlueprint({ name: file.name, w: file.size.w, h: file.size.h, cells: file.cells }, file.ruleset);
  },

  exportFile(bp) {
    const normalized = this.validateBlueprint(bp, bp.ruleset || 'classic-v1');
    const file = {
      format: this.FILE_FORMAT, version: this.FILE_VERSION,
      ruleset: normalized.ruleset, name: normalized.name,
      size: { w: normalized.w, h: normalized.h }, cells: normalized.cells,
    };
    const text = JSON.stringify(file, null, 2);
    if (this.byteLength(text) > this.MAX_FILE_BYTES) throw new Error('蓝图文件大小超限');
    return text;
  },

  importFile(text) {
    if (typeof text !== 'string' || this.byteLength(text) > this.MAX_FILE_BYTES) throw new Error('蓝图文件大小超限');
    let input;
    try { input = JSON.parse(text); } catch (e) { throw new Error('蓝图文件不是有效 JSON'); }
    if (input && Object.prototype.hasOwnProperty.call(input, 'format') && input.format !== this.FILE_FORMAT) throw new Error('蓝图文件格式无效');
    const file = input && input.format === this.FILE_FORMAT;
    const original = JSON.parse(JSON.stringify(input));
    const bp = file ? this.validateFile(input) : this.validateBlueprint(input, input && input.ruleset || 'classic-v1');
    bp.id = 'bp-import-' + Date.now() + '-' + (++this._importSerial);
    if (bp.ruleset === 'trapezoid-v2') {
      const preview = this.clone(bp);
      preview.ruleset = 'petal-v3';
      preview.cells = preview.cells.map(c => {
        if (c.type === 'cutter') c.machineMode = c.machineMode === 'rough' ? 'vertical' : 'horizontal';
        else if (c.type === 'merger') c.machineMode = 'auto';
        return c;
      });
      return { blueprint: bp, original, migrated: true, preview, safeToPaste: false,
        warning: '旧梯形蓝图仅生成迁移预览；需通过当前关卡源点、端口、预算和占格预检后再粘贴' };
    }
    return { blueprint: bp, original, migrated: !file, safeToPaste: true };
  },

  // 整体预检：全部通过返回 null，否则返回第一个冲突 { x, y, reason }
  check(bp, px, py) {
    const active = G.v3 ? 'petal-v3' : G.v2 ? 'trapezoid-v2' : 'classic-v1';
    if ((bp.ruleset || 'classic-v1') !== active) return { x: px, y: py, reason: '蓝图规则集不匹配' };
    if (G.v2) for (const c of bp.cells) {
      const valid = c.type === 'cutter' ? ['rough', 'fine'] : c.type === 'merger' ? ['half', 'final'] : null;
      if (valid && !valid.includes(c.machineMode)) return { x: px + c.dx, y: py + c.dy, reason: (c.type === 'cutter' ? '切割机' : '合并机') + '模式无效' };
    }
    if (G.v3) for (const c of bp.cells) {
      const valid = c.type === 'cutter' ? ['auto', 'vertical', 'horizontal'] : c.type === 'merger' ? ['auto', 'join', 'stack', 'half', 'final'] : null;
      if (valid && c.machineMode !== undefined && !valid.includes(c.machineMode)) return { x: px + c.dx, y: py + c.dy, reason: (c.type === 'cutter' ? '切割机' : '混合机') + '模式无效' };
    }
    const need = {};
    for (const c of bp.cells) {
      const x = px + c.dx, y = py + c.dy;
      if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return { x, y, reason: '超出边界' };
      if (G.grid[y][x]) return { x, y, reason: '格子被占用' };
      need[c.type] = (need[c.type] || 0) + 1;
    }
    for (const t in need) {
      if (!(G.budget[t] === Infinity || G.budget[t] >= need[t])) {
        const c = bp.cells.find(c => c.type === t);
        const tn = TOOLS.find(u => u.id === t);
        return { x: px + c.dx, y: py + c.dy, reason: '「' + tn.name + '」预算不足（需 ' + need[t] + '）' };
      }
    }
    return null;
  },
};

// ===== 内置蓝图（教程各关的标准模块） =====
const BUILTIN_BPS = [
  { id: 'bl-line', name: '直送线×8', w: 8, h: 1,
    cells: [0, 1, 2, 3, 4, 5, 6, 7].map(dx => ({ dx, dy: 0, type: 'belt', dir: 1 })) },
  { id: 'bl-cut', name: '切割双路', w: 3, h: 2,
    cells: [
      { dx: 0, dy: 0, type: 'extractor', dir: 1 },
      { dx: 1, dy: 0, type: 'cutter', dir: 1 },
      { dx: 2, dy: 0, type: 'belt', dir: 1 },
      { dx: 1, dy: 1, type: 'trash', dir: 0 },
    ] },
  { id: 'bl-rot', name: '180°折返', w: 2, h: 1,
    cells: [
      { dx: 0, dy: 0, type: 'rotator', dir: 1 },
      { dx: 1, dy: 0, type: 'rotator', dir: 1 },
    ] },
  { id: 'bl-merge', name: '双线汇流', w: 3, h: 2,
    cells: [
      { dx: 0, dy: 0, type: 'belt', dir: 1 },
      { dx: 1, dy: 0, type: 'merger', dir: 1 },
      { dx: 2, dy: 0, type: 'belt', dir: 1 },
      { dx: 1, dy: 1, type: 'belt', dir: 0 },
    ] },
];

// ===== 断言自测：加载即跑 =====
(function () {
  const line = { id: 't', name: 't', w: 2, h: 1, cells: [{ dx: 0, dy: 0, type: 'belt', dir: 1 }, { dx: 1, dy: 0, type: 'belt', dir: 1 }] };
  const r = Blueprints.rotate(line);
  console.assert(r.w === 1 && r.h === 2, '蓝图旋转后 w/h 互换');
  console.assert(r.cells[0].dx === 0 && r.cells[0].dy === 0 && r.cells[0].dir === 2, '旋转：原点不变、朝右→朝下');
  console.assert(r.cells[1].dx === 0 && r.cells[1].dy === 1 && r.cells[1].dir === 2, '旋转：(1,0)→(0,1)');
  const r4 = Blueprints.rotate(Blueprints.rotate(Blueprints.rotate(Blueprints.rotate(line))));
  console.assert(JSON.stringify(r4.cells) === JSON.stringify(line.cells) && r4.w === 2 && r4.h === 1, '旋转四次回到原样');
  const m = Blueprints.mirror(line);
  console.assert(m.cells[0].dx === 1 && m.cells[1].dx === 0 && m.cells[0].dir === 3, '镜像：左右互换、朝向翻转');
  console.assert(BUILTIN_BPS.every(b => b.cells.every(c => c.dx >= 0 && c.dx < b.w && c.dy >= 0 && c.dy < b.h)), '内置蓝图坐标须在范围内');
})();
