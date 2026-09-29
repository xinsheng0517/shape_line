'use strict';
/* levels.js — 关卡数据：目标形状、资源节点、枢纽位置、机器预算、星级标准
 * 形状象限约定（顺时针）：0=右上 1=右下 2=左下 3=左上
 * 形状件：'C'=圆 'T'=梯形 'S'=星；null=空
 * budget：本关可用机器数量，Infinity = 不限，0 = 本关不可用
 * par：[3★ 设备总数上限, 2★ 设备总数上限]（含传送带）；blueprintThreeStar 关卡以蓝图使用取代 3★ 设备数条件
 */
const LEVELS = [
  {
    name: '铺设',
    target: ['C', 'C', 'C', 'C'],
    hint: '把采集器（按 2）贴着圆形资源放下、开口朝右，再选传送带（按 1）一路铺到金色的枢纽。',
    resources: [{ x: 3, y: 8, type: 'C' }],
    hub: { x: 19, y: 8 },
    budget: { belt: Infinity, extractor: 2, cutter: 0, rotator: 0, merger: 0, trash: 0 },
    par: [16, 22],
  },
  {
    name: '一刀两断',
    target: ['C', 'C', null, null],
    hint: '切割机把圆切成两半：正面出右半，右侧出左半。右半送枢纽，左半请进垃圾桶——枢纽只收目标形状。',
    resources: [{ x: 3, y: 8, type: 'C' }],
    hub: { x: 19, y: 8 },
    budget: { belt: Infinity, extractor: 2, cutter: 1, rotator: 0, merger: 0, trash: 1 },
    par: [18, 24],
  },
  {
    name: '转个方向',
    target: [null, 'C', 'C', null],
    hint: '右半圆顺时针转 90° 就是下半圆：先切一刀取右半，再让旋转机转一下。',
    resources: [{ x: 3, y: 8, type: 'C' }],
    hub: { x: 19, y: 8 },
    budget: { belt: Infinity, extractor: 2, cutter: 1, rotator: 1, merger: 0, trash: 1 },
    par: [19, 26],
  },
  {
    name: '合二为一',
    target: ['C', 'C', 'T', 'T'],
    hint: '合并机从背面进「底」、右侧进「补」，空象限被补位填充：圆切出右半做底，梯形切出左半做补。',
    resources: [{ x: 3, y: 5, type: 'C' }, { x: 3, y: 11, type: 'T' }],
    hub: { x: 19, y: 8 },
    budget: { belt: Infinity, extractor: 3, cutter: 2, rotator: 0, merger: 1, trash: 2 },
    par: [38, 48],
  },
  {
    name: '星星之火',
    target: ['S', 'S', null, null],
    hint: '新资源：星形。老办法——切一刀，取右半，废料进垃圾桶。蓝图栏已解锁：按 B 框选复制，或点下方「切割双路」一键铺线！',
    resources: [{ x: 3, y: 8, type: 'S' }],
    hub: { x: 19, y: 8 },
    budget: { belt: Infinity, extractor: 2, cutter: 1, rotator: 0, merger: 0, trash: 1 },
    par: [18, 24],
    bp: true, // L5 起开放蓝图栏
  },
  {
    name: '转两次',
    target: [null, null, 'S', 'S'],
    hint: '右半星转一次是下半星，转两次才是左半星：把两台旋转机串联起来。三星需从蓝图库选取蓝图，并在本关成功粘贴一次。',
    resources: [{ x: 3, y: 8, type: 'S' }],
    hub: { x: 19, y: 8 },
    budget: { belt: Infinity, extractor: 2, cutter: 1, rotator: 2, merger: 0, trash: 1 },
    par: [20, 27],
    bp: true,
    blueprintThreeStar: true,
  },
  {
    name: '双拼',
    target: ['C', 'C', 'S', 'S'],
    hint: '圆和星各切一刀，右半圆做底、左半星做补，在合并机里汇合。',
    resources: [{ x: 3, y: 5, type: 'C' }, { x: 3, y: 11, type: 'S' }],
    hub: { x: 19, y: 8 },
    budget: { belt: Infinity, extractor: 3, cutter: 2, rotator: 0, merger: 1, trash: 2 },
    par: [38, 48],
    bp: true,
  },
  {
    name: '精打细算',
    target: ['S', 'S', 'T', 'T'],
    hint: '传送带只有 20 条！把机器摆在资源与枢纽之间，走最短的路线。',
    resources: [{ x: 8, y: 3, type: 'S' }, { x: 8, y: 12, type: 'T' }],
    hub: { x: 16, y: 8 },
    budget: { belt: 20, extractor: 3, cutter: 2, rotator: 0, merger: 1, trash: 2 },
    par: [22, 30],
    bp: true,
  },
];

// ===== 教学引导：每关参考解设备位 [type,x,y,dir]，渲染层画半透明幽灵供玩家参照 =====
// 数据与 test-headless.js 的八关参考解严格同源
;(function () {
  const D = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  function beltsInto(g, x1, y1, x2, y2, dir) {
    const d = D[dir]; let x = x1, y = y1;
    while (true) { g.push(['belt', x, y, dir]); if (x === x2 && y === y2) break; x += d[0]; y += d[1]; }
  }
  const G0 = [['extractor', 4, 8, 1]]; beltsInto(G0, 5, 8, 18, 8, 1);
  LEVELS[0].guide = G0;
  const G1 = [['extractor', 4, 8, 1], ['cutter', 5, 8, 1], ['trash', 5, 9, 0]]; beltsInto(G1, 6, 8, 18, 8, 1);
  LEVELS[1].guide = G1;
  const G2 = [['extractor', 4, 8, 1], ['cutter', 5, 8, 1], ['trash', 5, 9, 0], ['belt', 6, 8, 1], ['rotator', 7, 8, 1]]; beltsInto(G2, 8, 8, 18, 8, 1);
  LEVELS[2].guide = G2;
  const G3 = [['extractor', 4, 5, 1], ['cutter', 5, 5, 1], ['trash', 5, 6, 0]];
  beltsInto(G3, 6, 5, 15, 5, 1); G3.push(['belt', 16, 5, 2]); beltsInto(G3, 16, 6, 16, 7, 2); G3.push(['belt', 16, 8, 1]);
  G3.push(['extractor', 4, 11, 1], ['cutter', 5, 11, 1], ['trash', 6, 11, 0]);
  beltsInto(G3, 5, 12, 16, 12, 1); G3.push(['belt', 17, 12, 0]); beltsInto(G3, 17, 11, 17, 9, 0);
  G3.push(['merger', 17, 8, 1], ['belt', 18, 8, 1]);
  LEVELS[3].guide = G3;
  LEVELS[4].guide = G1; // L5 与 L2 同布局（资源换星形）
  const G5 = [['extractor', 4, 8, 1], ['cutter', 5, 8, 1], ['trash', 5, 9, 0], ['belt', 6, 8, 1], ['rotator', 7, 8, 1], ['belt', 8, 8, 1], ['rotator', 9, 8, 1]]; beltsInto(G5, 10, 8, 18, 8, 1);
  LEVELS[5].guide = G5;
  LEVELS[6].guide = G3.map(c => c.slice()); // L7 与 L4 同布局（补线资源换星形）
  const G7 = [['extractor', 9, 3, 1], ['cutter', 10, 3, 1], ['trash', 10, 4, 0]];
  beltsInto(G7, 11, 3, 12, 3, 1); G7.push(['belt', 13, 3, 2]); beltsInto(G7, 13, 4, 13, 6, 2); G7.push(['belt', 13, 7, 1]);
  G7.push(['extractor', 9, 12, 1], ['cutter', 10, 12, 1], ['trash', 11, 12, 0]);
  G7.push(['belt', 10, 13, 1], ['belt', 11, 13, 1], ['belt', 12, 13, 0]);
  beltsInto(G7, 12, 12, 12, 9, 0); G7.push(['belt', 12, 8, 1], ['belt', 13, 8, 1], ['belt', 14, 8, 0]);
  G7.push(['merger', 14, 7, 1], ['belt', 15, 7, 2], ['belt', 15, 8, 1]);
  LEVELS[7].guide = G7;
  // 自测：引导格不得越界、不得压住资源或枢纽
  for (const L of LEVELS) {
    console.assert(L.guide && L.guide.length > 0, '每关应有引导');
    const blocked = new Set(L.resources.map(r => r.x + ',' + r.y).concat([L.hub.x + ',' + L.hub.y]));
    for (const [t, x, y] of L.guide) {
      console.assert(x >= 0 && x < 24 && y >= 0 && y < 16, '引导格越界 ' + t + '@' + x + ',' + y);
      console.assert(!blocked.has(x + ',' + y), '引导格压住资源/枢纽 ' + t + '@' + x + ',' + y);
    }
  }
})();
