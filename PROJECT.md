# 形状流水线 Shape Line · 项目说明书（面向 AI 协作者）

> 2026-10-14：当前发行已使用通用结构合成引擎。权威接口和玩法见 [SYNTHESIS.md](SYNTHESIS.md)，实现为 `js/synthesis-engine.js`、`js/synthesis-config.js`、PetalV3 门面与 V3Runtime。本文旧“固定配方、先纵后横、目标自动回收”描述均为历史记录，不得据此重新限制新合成系统。经典数组模拟已有通用引擎适配，多层产物是真实数据。

> 读完这份文档，你应该能不读全部源码就正确改动这个项目。**第 14 章「铁律」和第 15 章「改动指南」是最高频入口。**

> 2026-09-23 再次增补：挑战 C1/C2/C5/C6 现改用 `petal-v3`，其最新规则、配置与验收见 [V3-IMPLEMENTATION.md](V3-IMPLEMENTATION.md)；第 17 章的 `trapezoid-v2` 只保留作迁移与回归记录。旧四象限规则仍用于教程、自由、每日及 C3/C4。前 17 章中涉及旧脚本顺序及四关旧目标的描述，以新说明为准。

> 当前实现的权威说明见 [V3-IMPLEMENTATION.md](V3-IMPLEMENTATION.md)；本文件第 17 章以前保留历史设计记录。

- 定位：纯前端「工厂建造」小游戏（类 shapez.io 的简化版）。采集形状原料 → 传送带/切割机/旋转机/合并机组成产线 → 把目标形状送进枢纽。
- 技术栈：原生 HTML + CSS + Canvas 2D + 原生 JS（ES5/ES6 语法，无模块、无框架、无 npm 依赖、无构建步骤即可运行）。
- 规模：源码约 2500 行 / 7 个 JS 文件；单文件发行版约 124 KB。
- 运行环境：任何现代浏览器（PC / 手机），进度存 `localStorage`，无账号、无后端。

---

## 1. 30 秒速览

| 问题 | 答案 |
|---|---|
| 入口 | [index.html](index.html)（按顺序引入 7 个 JS），发行版为 `dist/shape-line.html`（单文件内联全部代码） |
| 全局状态 | 唯一的 `const G`（core.js 定义），所有层围绕它读写 |
| 主循环 | `requestAnimationFrame(frame)`（core.js）→ 固定步长 `Sim.tick()`（150ms/速度）→ `Render.draw(alpha)` 插值渲染 |
| 数据流 | `input.js` 只写 `G` → `sim.js` 只被 `tick` 调用、只改 `G` → `render.js` 只读 `G` |
| 机器种类 | belt / extractor / cutter / rotator / merger / trash（外加不可放置的 resource、hub） |
| 形状模型 | 4 个象限的数组 `[右上, 右下, 左下, 左上]`，值为 `'C'`圆 / `'R'`方 / `'S'`星 / `null` 空 |
| 模式 | tutorial(8 关) · free(32×20 随机目标) · challenge(6 关) · daily(日期种子同题) |
| 测试 | `node test-headless.js`（无头回归，当前全绿，退出码 0/1） |
| 打包 | `node build.js` → `dist/shape-line.html` |

---

## 2. 目录与文件清单

```
<项目根目录>\
├─ shapez-feasibility-plan.md      V2 开发计划（设计宪法 / 里程碑 D8–D21，含历史背景）
├─ challenge-rebalance-plan.md     挑战关难度校准计划（数据层校准依据，已体现在当前数值中）
└─ shape-line\
   ├─ index.html          248 行  页面骨架：CSS（毛玻璃 HUD / 托盘 / 弹窗 / 竖屏伪横屏）、DOM、脚本引用
   ├─ build.js             19 行  打包器：把 7 个 js 内联进 index.html → dist/shape-line.html
   ├─ test-headless.js    464 行  无头冒烟回归测试（Node 直接跑，桩掉 DOM/Render）
   ├─ README.md                   玩家向说明（玩法/操作/部署）
   ├─ PROJECT.md                  本文件（AI 向技术说明）
   ├─ js\
   │  ├─ levels.js        126 行  教程 8 关数据 + 每关「参考解幽灵」数据
   │  ├─ blueprint.js      95 行  蓝图数据模型、旋转/镜像/整体预检 + 4 个内置蓝图
   │  ├─ challenges.js    286 行  自由模式配置与目标池、挑战 6 关、每日挑战、成就
   │  ├─ core.js          300 行  常量、全局状态 G、撤销栈 Undo、存档、音效、主循环、关卡/模式装载
   │  ├─ sim.js           182 行  固定 tick 模拟：形状变换、物品移动、机器加工、枢纽判定
   │  ├─ render.js        854 行  Canvas 渲染：全屏地板、机器底座缓存、动态层、物品、粒子、幽灵
   │  └─ input.js         614 行  鼠标/触屏/键盘交互 + 全部 DOM 界面（UI 对象）与放置/删除入口
   └─ dist\
      ├─ shape-line.html  单文件发行版（build.js 产物，双击即玩）
      ├─ README.md        拷贝自上级 README
      └─ 几何工厂.zip      发行压缩包（内含 shape-line.html + README.md）
```

脚本加载顺序（[index.html](index.html) 与 [build.js](build.js) 的 `FILES` 必须一致）：

```
levels.js → blueprint.js → challenges.js → core.js → sim.js → render.js → input.js
```

依赖方向是单向的：后面的文件可以引用前面的全局变量，反之不行。全部通过全局变量通信（`LEVELS` `Blueprints` `G` `Sim` `Render` `UI` `Input` `Undo` `AudioFX`），**没有** import/export。

---

## 3. 命令速查

```powershell
# 直接玩（无需构建）
start shape-line\index.html

# 回归测试（当前应输出 ALL_*_PASS，退出码 0）
cd shape-line; node test-headless.js

# 改完源码后重新打包单文件发行版
cd shape-line; node build.js

# 局域网用手机试玩
cd shape-line; python -m http.server 8000
```

---

## 4. 架构总览

### 4.1 分层与职责

| 层 | 文件 | 可以做什么 | 不可以做什么 |
|---|---|---|---|
| 数据层 | `levels.js` `challenges.js` `blueprint.js` | 定义常量数据与纯函数 | 不碰 DOM、不改 `G`（`nextFreeTarget` 等装载函数除外） |
| 状态/主控 | `core.js` | 定义 `G`、装载关卡、推进主循环、存档、音效 | 不做具体模拟逻辑、不渲染 |
| 模拟层 | `sim.js` | 读写 `G.grid`、变换形状、结算交付 | 不读输入、不渲染、不碰 DOM |
| 表现层 | `render.js` | 只读 `G` 绘制；自持粒子/回弹/光环等表现状态 | 不修改 `G.grid` / `G.tool` 等游戏状态 |
| 交互层 | `input.js` | 读写 `G`（工具、粘贴态、框选）、操作 DOM、调用 `Render.resize()` | 不直接推进模拟（只经 `Sim.tick` 由 core 驱动） |

### 4.2 一帧的生命周期

```
requestAnimationFrame(frame)                     // core.js
 ├ dt = min(now-last, 250ms)
 ├ 若未暂停且未过关：
 │   ├ while(累加器 ≥ TICK_MS/speed) Sim.tick()   // 最多 8 次防卡死，固定步长
 │   ├ G._alpha = 累加器余量 / 步长               // 渲染插值系数
 │   └ 挑战中：G.chal.elapsed += dt/1000; challengeTick()   // 真实计时 + 超时/到时结算
 └ Render.draw(G._alpha)                          // 渲染一帧（含粒子推进）
```

`Sim.tick()` 内部：`tickCount++` → 每 2 tick 执行一次 `movement()` → 每 tick 执行一次 `machines()`。

注意：挑战的**真实计时**走 `dt`（帧时间），**模拟进度**走 tick —— 所以 `speed` 倍速会加速产线但不会加速限时，这是有意设计。

---

## 5. 领域模型（最重要的一章）

### 5.1 形状 Shape

形状是**长度 4 的数组**，四个元素依次代表顺时针的四个象限：

| 下标 | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| 位置 | 右上 | 右下 | 左下 | 左上 |
| 角度弧 | 0°~90° | 90°~180° | 180°~270° | 270°~360° |

- 值：`'C'` 圆 / `'R'` 方 / `'S'` 星 / `null` 空（`SHAPE_COLOR`、`SHAPE_NAME` 在 core.js）。
- 变换（全部在 sim.js，纯函数，文件末尾有 `console.assert` 自测）：
  - `cutV(s)` → `[右半, 左半]`：右半 = `[s0, s1, null, null]`，左半 = `[null, null, s2, s3]`。
  - `rotCW(s)` → `[s3, s0, s1, s2]`：顺时针 90°（0 号位落到 1 号位）。
  - `mergeShapes(base, filler)`：逐象限并集，`base` 为空的象限取 `filler`。
  - `shapeEq(a, b)`：四象限全等。
- **可制造性前提**：任何目标形状必须能由「全形 → 切半 → 旋转 → 合并」得到，且参考解能通过 `test-headless.js`。

> 易错点：切割机的 **outB 出料口给的是「左半」**，outA 给的是「右半」。想让左半上线，必须从切割机**右侧面**接出。

### 5.2 机器与端口

方向常量 `DIRV = [[0,-1],[1,0],[0,1],[-1,0]]` 即 `0=上 1=右 2=下 3=左`；`dir` 表示机器的**正面/输出朝向**，`R` 键 `(dir+1)%4` 顺时针。派生方向：

- 正面（输出口）= `dir`
- 右侧面 = `(dir+1)%4`
- 背面 = `(dir+2)%4`

| 机器 | 进料口 | 出料口 | 行为要点 |
|---|---|---|---|
| `resource` | — | — | 不可放置/不可拆除的资源矿点，只有 `shapeType` 字段 |
| `extractor` 采集器 | — | `item`（正面） | 必须**紧邻**某个 `resource` 才产出该资源的全形；`cd = MOVE_EVERY`（2 tick 一件）；槽位被占则停产 |
| `belt` 传送带 | `item`（任意侧） | `item`（正面） | 每 2 tick 移动一格；**拒收来自自己正面的倒灌**（`accepts` 特判） |
| `cutter` 切割机 | `inA` = 背面 | `outA` = 正面（右半）、`outB` = 右侧面（左半） | 必须 `inA` 有料 **且 outA/outB 都为空**才开工；`PROC_TICKS = 2` |
| `rotator` 旋转机 | `inA` = 背面 | `outA` = 正面 | 顺时针 90°；`inA` 有料且 `outA` 空即开工 |
| `merger` 合并机 | `inA` = 背面（**底**）、`inB` = 右侧面（**补**） | `outA` = 正面 | 两路齐备且 `outA` 空才开工，结果 = `mergeShapes(底, 补)` |
| `trash` 垃圾桶 | 任意 | 消耗 | `accepts` 返回 `'consume'`，吞掉并出灰色粒子 |
| `hub` 枢纽 | 任意 | 消耗 | **只接收 `shapeEq(shape, G.target)` 的物品**，其余一律拒收 → 堵线；收下即 `deliver()` |

### 5.3 格子的槽位（Cell）

`mkCell(type, x, y, dir)` 创建的格子结构（字段全部常驻，避免动态加字段）：

```js
{ type, x, y, dir,
  item,                 // 传送带 / 采集器的在载物品
  inA, inB,             // 加工类机器的进料槽
  proc,                 // 加工中：{ shape, t }，t 递减到 0 完成
  outA, outB,           // 出料槽（cutter 用 outA/outB，其余只用 outA）
  cd }                  // 采集器冷却
```

物品结构（`mkItem` / 各处内联创建）：`{ shape, fx, fy, moveTick }`。
- `fx, fy` = **上一格坐标**（渲染插值起点），`moveTick` = 本次移动发生的 tick（渲染用它算插值进度 `min(1,(tickCount-moveTick+alpha)/MOVE_EVERY)`）。
- 渲染层按槽位给物品加固定像素偏移（`offs`：inA 向背面 4u、outA 向正面 5u、outB 向右侧 5u …）。

### 5.4 移动算法（sim.js `movement()`）—— 先算后动

这是全项目最烧脑的部分，**同时性**是它的关键：

1. **收集搬运者**：遍历全网格，把「槽位里有物品且该物品有出料路径」的槽位记进 `movers`（belt/extractor 的 `item`、cutter 的 `outA`+`outB`、rotator/merger 的 `outA`）。
2. **递归解算 `resolve(x,y,slot,state,reserved)`**：判断该物品能否移动。
   - `state`：`undefined`=未访问、`1`=访问中、`2`=可动、`3`=不可动。遇到 `1` 表示**成环**（互相等待）→ 判定不可动，这就是「堵转」的来源。
   - `reserved`：已被其他物品预定的目标槽，防止两个物品抢同一格。
   - 目标槽被占用且类型是 `item` 时，递归尝试让对方先让位（链式移动，所以整条传送带能一次 tick 整体前进）。
3. **同步提交**：只有 `state === 2` 的搬运者真正移动；提交时再校验一次 `accepts`，不通过则回滚（防御性代码）。
   - `'consume'` → 目标是 hub 就 `deliver()`，是 trash 就出粒子吞掉。
   - 否则写入目标格对应槽位，并把 `fx/fy/moveTick` 设为**源格坐标**。

### 5.5 格网与坐标（动态尺寸，全部是「活值」）

```js
let TILE = 32; let GRID_W = 24, GRID_H = 16;   // core.js：不是常量，会被三处改写
```

- **网格尺寸**由模式决定（`setGridSize(w,h,tile)`）：教程/挑战 `24×16`，自由/每日 `32×20`。
- **TILE** 在浏览器里由 `Render.resize()` 用 `computeTile(availW, availH)` 按视口重算，夹在 `[MIN_TILE=12, MAX_TILE=56]`。窗口多大，格子就多大。
- 网格原点 `Render.ox / Render.oy` 由视口减去 UI 安全区后居中得出。
- **像素换算是唯一入口**，禁止硬乘硬除 TILE：
  - 渲染 → 网格：`Render.tilePx()`、`Render.gridToPx(gx,gy)`
  - 屏幕 → 网格：`Input.pxToGrid(lx,ly)`（内部用 `Render.ox/oy` 与 `TILE`），`Input.pos(event)` 再负责 DPR / 旋转屏变换。
- `Render.u = TILE/32` 是**美术细节缩放因子**（所有造型按 32px 基准设计，再用 `u` 缩放）。

---

## 6. 全局状态 `G`（core.js）

| 字段 | 含义 |
|---|---|
| `mode` | `'tutorial' \| 'free' \| 'challenge' \| 'daily'` |
| `levelIndex` / `chalIndex` | 教程关索引 / 挑战关索引 |
| `grid` | `grid[y][x]` = cell 或 `null`（`resource`、`hub` 也是 cell，只是不可拆） |
| `target` | 当前目标形状（四元数组） |
| `budget` | 各机器**剩余**预算（`Infinity` = 不限，`0` = 本关不可用） |
| `used` | 各机器**已放置**数量 |
| `tickCount` | 模拟 tick 计数（渲染用它做插值与「切关检测」，回卷即清空表现层快照） |
| `delivered` | 已交付数量 |
| `won` / `paused` | 过关（停模拟、出弹窗）/ 暂停 |
| `speed` | `∈ SPEEDS = [1,2,4]`，主步长 = `TICK_MS/speed` |
| `stats.log` | 交付时间戳数组，30 秒滚动窗口 → HUD「件/分」 |
| `tool` / `toolDir` | 当前工具（`null` = 空手，点击即拆除）/ 放置朝向 |
| `hover` | 鼠标所在格 `{x,y}`（-1 表示网格外） |
| `particles` / `hubPulse` | 表现层：粒子、枢纽交付脉冲（渲染层消费） |
| `clip` / `paste` | 剪贴板蓝图 / 正在放置的蓝图（`paste` 随 `R` 旋转、`M` 镜像） |
| `selMode` / `sel` | 框选态开关 / 框选矩形 |
| `chal` | 挑战运行时 `{ elapsed, done }`（非挑战模式为 `null`） |
| `chalDef` | 当前挑战定义（挑战 = `CHALLENGES[i]`，每日 = `dailyDef()`） |
| `save` | 存档对象（见第 7 章） |
| `_alpha` | 主循环写入的渲染插值系数（唯一带下划线前缀的字段） |
| `freePar` | 自由模式当前目标的参考设备数（仅展示） |

辅助函数：`cellAt(x,y)`（越界返回 `null`）、`usedTotal()`、`inTransit()`（在途物品数）、`burst(gx,gy,color,n)`（生成粒子）、`mkCell()`、`mkItem()`。

---

## 7. 存档结构

- `localStorage` key = `'shape-line-save-v1'`（常量 `SAVE_KEY`）。
- `loadSave()` 用默认对象 `DEF` 做 `Object.assign(DEF, s)` 合并，**新增字段必须同时补进 `DEF`** 才能对老存档生效；`persist()` 全量写回，全部包在 `try/catch` 里（`file://`、隐私模式可能不可用）。

```js
{
  unlocked: 1,        // 教程已解锁关数（下一关 = unlocked+1）
  stars: {},          // { 关索引: 1..3 }
  sound: true,
  last: 0,            // 上次教程关索引
  blueprints: {},     // { id: bp } 自建蓝图
  challenges: {},     // { 'C1': { stars, best } }
  achievements: {},   // { id: true }
  daily: {},          // { 'YYYY-MM-DD': { stars, best } }
  lastChal: 0,        // 上次挑战关索引（注意：DEF 里没有此字段，读取处用 || 0 兜底）
}
```

---

## 8. 模式与装载

`setMode(mode)`（core.js）是**唯一**的模式入口：清理跨模式残留（撤销栈、粘贴/框选态、粒子、统计、挑战态）→ 调用对应 loader → 关主菜单。`loadLevel(i)` 内部会把 `G.mode` 复位为 `'tutorial'`。

| 模式 | 装载函数 | 网格 | 目标 | 预算 | 过关条件 |
|---|---|---|---|---|---|
| 教程 | `loadLevel(i)`（core.js） | 24×16 | 固定 | 每关不同 | 交付 1 个，按 `usedTotal()` 评 1–3 星 |
| 自由 | `loadFree()`（challenges.js） | 32×20 | 20 个目标池随机 | 全 `Infinity` | 交付即庆祝并自动换新目标，产线继续跑 |
| 挑战 | `loadChallenge(i)` | 24×16 | 固定 | 每关不同 | 见 `chalDef.stars(G)`，交付/到时/超时都走 `challengeWin()` |
| 每日 | `loadDaily()` | 32×20 | 日期种子随机 | 全 `Infinity` | 180 秒内完成且设备数 ≤ `devLimit` |

挑战结算链路：`Sim.deliver()` → `winLevel()` → `challengeWin()`（若 `delivered ≥ need`）或 `challengeTick()`（每帧检查 `tickLimit` / `realLimit`）→ `challengeWin()` 计星、写最佳记录、`AudioFX.win()`、`checkAchievements()`、`UI.showChalWin()`。

> 挑战/每日复用**同一套结算管线**，区别只在定义对象的字段（`isDaily`、`dateStr`、`betterIsLower` = 最佳成绩比较方向）。

---

## 9. 数据层清单（改数据必看）

| 数据 | 文件 | 结构 | 现有断言 |
|---|---|---|---|
| `LEVELS` | levels.js | `{ name, target, hint, resources[{x,y,type}], hub{x,y}, budget{}, par[3★,2★], bp?, guide? }` | 每关必须有 `guide`；guide 不得越界/压资源枢纽 |
| `guide` | levels.js | IIFE 内生成，`[type,x,y,dir]` 数组，教程模式画成半透明幽灵 | 与 `test-headless.js` 的参考解严格同源 |
| `FREE` / `FREE_TARGETS` | challenges.js | 自由模式网格配置 / 20 个 `{shape, par}` | 长度 = 20；形状合法（仅 C/R/S/null 且非全空）；`FREE.w*FREE.tile === 768` |
| `CHALLENGES` | challenges.js | `{ id, name, need, target, hint, resources, hub, budget, realTimer?, realLimit?, tickLimit?, devLimit?, betterIsLower, scoreVal(G), scoreText(G), stars(G) }` | 长度 = 6；id/target/hub/resources 齐备 |
| `dailyDef()` | challenges.js | 日期串哈希 → `mulberry32` → 目标 + 预算系数 `k ∈ {0.8,1,1.2}`；确定性（同日同题） | `dailyDef().target.length === 4` |
| `ACHIEVEMENTS` | challenges.js | `{ id, name, desc, test(save) }` | 长度 = 8 |
| `BUILTIN_BPS` | blueprint.js | 4 个内置蓝图（直送线×8 / 切割双路 / 180°折返 / 双线汇流） | 坐标须落在 `w×h` 内 |

**教程关的 `par` = `[3★ 设备总数上限, 2★ 上限]`**（含传送带）；挑战的星级线写在各自的 `stars(G)` 里。

---

## 10. 蓝图系统（blueprint.js）

```js
bp = { id, name, w, h, cells: [{ dx, dy, type, dir }] }   // dx/dy 相对蓝图左上角
```

- `fromRegion(x0,y0,x1,y1)`：框选区域 → 蓝图（只收集机器格，空选返回 `null`）。
- `rotate(bp)`：`(dx,dy) → (h-1-dy, dx)`，`dir+1`，`w/h` 互换（右乘旋转，四次回原样）。
- `mirror(bp)`：`dx → w-1-dx`，`dir` 查表 `[0,3,2,1]`（左右互换，0/2 不变）。
- `check(bp, px, py)`：**整体预检**，任一格越界/被占/预算不足就返回第一个冲突 `{x,y,reason}`，否则 `null`。粘贴是「要么全成、要么全不」。
- 放置最终仍走 `Input.tryPlace()`，因此撤销栈、预算、计数自动一致。

交互链路：`B` 进入框选 → 松开即 `copyRegion()` 写 `G.clip` → `Ctrl+V`（或点蓝图栏）进入 `G.paste` 粘贴态 → 左键 `pasteAt()` 落图；`R` 旋转整体、`M` 镜像、`Esc` 取消；`S` 存入 `G.save.blueprints`。

---

## 11. 渲染层（render.js）

```js
const Render = { init(), resize(), draw(alpha), drawPreview(shape), ... }
```

`draw()` 的绘制顺序（改美术时务必遵守）：

```
全屏地板（离屏缓存：径向渐变 + 扫描线 + 金属地板缝 + 交点铆钉）
 → resource 资源矿点 → guideLayer 教学幽灵（仅教程）→ machine 机器
 → items 在载物品 / 加工进度条 → fx 粒子 → rings 交付冲击波
 → selRect 框选高亮 → ghost 放置预览 / bpGhost 蓝图幽灵
 → 暂停遮罩
```

性能设计（TILE 一变就全部重建，仅在 `resize()` 里发生）：

- `_floor`：整屏地板离屏 canvas，每帧一次 `drawImage` 贴回。
- `_bases`：机器**静态底座**离屏缓存，key = `type:dir`（resource 用 `res:shapeType:x,y`，让矿石散布按坐标定死、不闪烁）；动态部分（钻头旋转、激光切割、能量环、皮带纹理滚动）由 `machine()` 逐帧画。
- `_diffGrid()`：与上一帧的占用快照做差分，检测「新放置 → 回弹+尘土」「被拆 → 碎片」「加工完成 → 闪光」，**纯表现层，不回写游戏状态**。
- 自动降级：前 180 帧平均帧间隔 > 22ms 时 `lowFx = true`，关掉扫描线 / 铆钉 / 皮带纹理滚动 / 环境粒子并重建地板。
- 切关检测：`G.tickCount` 比上帧小（回卷）就清空 `_prevOcc/_anims/_rings`，避免旧格爆碎片。

`shapeIcon(ctx, shape, cx, cy, r)` 是形状的**唯一绘制入口**（按象限画四分之一圆瓣 / 方块 / 凹点星瓣），HUD 目标预览、机器上的物品、幽灵都用它。

---

## 12. 输入与 UI（input.js）

文件里有两个对象：`UI`（全部 DOM 界面）与 `Input`（鼠标/触屏/键盘 + 放置删除）。

### 12.1 放置与拆除的唯一入口

- `Input.tryPlace(x, y, type, dir, quiet)`：校验边界 / 已占用 / `G.won` / `G.paused` / 预算 → 建格 → 扣预算 → `G.used++` → **`Undo.rec('place', ...)`** → 音效 → 刷新工具栏徽标。
- `Input.removeAt(x, y)`：资源与枢纽不可拆；先 `Undo.rec('remove', ...)` 再清格并退还预算。
- **一切网格变更都必须经这两个函数**（撤销栈、预算、计数才不会错位）。

### 12.2 撤销/重做（core.js `Undo`）

- 动作组：一次拖拽连铺 / 一次拖拽连拆 / 一次蓝图粘贴 = 一组；单击 = 单动作组。`begin()` / `rec()` / `end()` 配对。
- 栈上限 200 组（超出 `shift()`），`trim()` 同时清空 `redo`。
- `undo()` 组内**反向**回退，`redoOp()` 组内正向重放；`_place/_remove` 会同步预算与 `used`。

### 12.3 拖拽与触屏

- 拖拽铺带：`walkTo()` 按「先横后纵、取差值较大轴」逐格走；`dragBelt()` 让**上一条本次拖出的带随方向拐弯**（`cell._drag` 标记本轮拖拽产生的格子，松开时清除）。
- 触屏桥接：`touchstart/move/end` 全部 `preventDefault`，单指 = 鼠标左键（`button: 0`），全程禁页面滚动缩放。
- 竖屏伪横屏：`index.html` 用媒体查询把 `#game` 旋转 90°，`Input.pos()` 用**同一条 media query** 做坐标轴变换（`lx = 视觉Y`、`ly = 包围盒宽 - 视觉X`）。
- 窗口变化 → `resize` 100ms 防抖 + `orientationchange` 300ms 后调 `Render.resize()`。

### 12.4 键盘

| 键 | 行为 |
|---|---|
| `1`–`7` | 选工具（1 带 2 采集器 3 切割机 4 旋转机 5 合并机 6 垃圾桶 7 拆除）；会退出粘贴/框选态 |
| `R` | 有 `paste` → 整体旋转；空手且光标下有机器 → 旋转该机器；否则旋转放置朝向 `toolDir` |
| `M` | 粘贴态整体镜像 |
| `B` | 进入框选态（幂等） |
| `S` | 把剪贴板蓝图存入蓝图库 |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `Ctrl+V` | 剪贴板 → 粘贴态 |
| `Esc` | 逐层退出：粘贴 → 框选 → 工具；主菜单打开时 Esc = 返回当前局 |
| `,` / `.` | 速度降/升档 |
| `空格` | 暂停/继续（`preventDefault`） |

UI 对象另含：关卡/挑战页签、工具栏与预算徽标、蓝图栏、主菜单（模式入口 + 成就一览）、过关弹窗、toast、`setInterval(500ms)` 的速率 HUD。

---

## 13. 测试与验收

`test-headless.js` 的做法：桩掉 `window / document / UI / Render`，把 6 个 js 源码字符串与测试脚本拼接后 `eval()` 执行（**不加载 render.js 的绘制逻辑**），最后按 `globalThis.__fail` 决定退出码。

覆盖范围：教程 8 关参考解、错误形状被枢纽拒收（反向测试）、自由模式、模式互切复位、目标池新增目标、挑战 C1–C6、蓝图预算联动、每日挑战确定性与结算存档、成就解锁、镜像流向、交互态互斥（粘贴/框选/工具的退出顺序）。

另有两类**加载即运行**的自测：`console.assert` 分散在 `sim.js`（形状变换）、`levels.js`（guide 合法性）、`blueprint.js`（旋转/镜像/坐标）、`challenges.js`（数据规模与合法性）。

改动的验收标准：`node test-headless.js` 全 PASS 且退出码 0；改渲染或 UI 后另需浏览器实测（无头测试不覆盖 `render.js`）。

---

## 14. 铁律（改代码前必读）

1. **单向数据流**：`input` 只写 `G` → `core.frame` 驱动 `Sim.tick` → `Render` 只读 `G`。Sim 不读输入，Render 不改游戏状态（粒子、回弹、光环等表现层状态除外）。
2. **网格变更唯一入口**：`Input.tryPlace()` / `Input.removeAt()`，否则撤销栈、预算、`used` 会失配。
3. **像素换算唯一入口**：`Render.tilePx()` / `Render.gridToPx()` / `Input.pxToGrid()`；禁止 `* TILE` / `/ TILE` 硬算。造型尺寸一律乘 `Render.u`。
4. **UI 不遮挡网格**：`Render.resize()` 通过 `offsetHeight` 读顶栏/托盘/蓝图栏实际高度算安全区；UI 显隐变化后要调 `Render.resize()`。
5. **旋转屏判定三处必须一致**：`index.html` 的 media query、`Render.rotated()`、`Input.pos()`。
6. **数据必须有参考解**：新增关卡/目标/挑战，必须补 `test-headless.js` 用例并跑通。
7. **零依赖、零外部资源**：不引入库、不引外链图片/音频（音效是 `AudioFX` 用 Web Audio 振荡器合成，图标是 emoji 或 SVG data URI）。
8. **单文件交付**：改完 `js/` 后必须 `node build.js` 重新生成 `dist/shape-line.html`，且 `index.html` 与 `build.js` 的脚本列表保持一致。
9. **形状象限语义不可变**：`0=右上 1=右下 2=左下 3=左上`，`cutV` 返回 `[右半,左半]`，改这两条会同时破坏所有关卡数据、guide、蓝图与测试。

---

## 15. 常见改动指南

**加一个教程关（levels.js）**
1. 在 `LEVELS` 末尾追加关卡对象（8 关 → N 关会影响 `G.save.unlocked` 上限与 `UI.showWin` 的「毕业」提示，`winLevel()` 用的是 `LEVELS.length`，无需手改）。
2. 在文件末尾的 guide IIFE 里为该关生成参考解幽灵（可用 `beltsInto()` 辅助）。
3. 在 `test-headless.js` 补该关参考解（`levels.js` 的断言要求每关必有 guide）。

**加一个自由模式目标（challenges.js）**
1. `FREE_TARGETS` 追加 `{ shape, par }`；断言写死了长度 20，记得同步改。
2. `test-headless.js` 的「新目标」用例补一个参考解。

**加一种机器**
1. `core.js`：`TOOLS` 加 UI 条目（含 `key` 快捷键）→ `MACHINE_TYPES` 加类型名。
2. `sim.js`：`accepts()` 加进料规则，`machines()`（或 `movement()` 的收集段）加行为。
3. `levels.js` / `challenges.js`：所有 `budget` 对象加该字段（缺字段会被当作 `undefined`，`G.budget[t] > 0` 为假 → 不可用）。
4. `render.js`：`_paintBase()`（静态底座）+ `machine()`（动态层）。
5. 工具栏按钮由 `TOOLS` 自动生成，`index.html` 无需改动。

**加一个成就**：`ACHIEVEMENTS` 追加 `{ id, name, desc, test(save) }`（断言长度 8 需同步改）。

**调整美术**：静态部分改 `_paintBase()`，动态部分改 `machine()`；都按 32px 基准设计并乘 `u`。

**调整难度/数值**：只改 `levels.js` 的 `par/budget` 与 `challenges.js` 的 `stars/need/realLimit/tickLimit/devLimit`，并跑 `test-headless.js` 校验参考解仍在星级线内（`challenge-rebalance-plan.md` 就是这种改动的范例）。

---

## 16. 已知坑与注意事项

1. **`TILE` / `GRID_W` / `GRID_H` 是 `let` 活值**，不是常量。切模式时 `setGridSize()` 改写并在浏览器里触发 `Render.resize()`，`TILE` 随后可能被视口重新计算覆盖 —— 所以**不要把 TILE 缓存进闭包或模块级常量**。
2. **发行压缩包须与单文件同步**。本次已更新 `dist/几何工厂.zip`；以后运行 `node build.js` 后也要重打压缩包，并比对其内部 `shape-line.html` 与 `README.md` 的长度。
3. `Render.resize()` 会重建 `_floor` 与 `_bases` 两个离屏缓存，别在每帧里调用它。
4. 无头测试 `eval` 的是源码字符串，**不覆盖 render.js**；改动画出效果的部分必须浏览器实测。
5. `localStorage` 在 `file://` 或隐私模式可能抛异常：`loadSave()` / `persist()` 已 `try/catch`，存档失败不影响游玩。
6. `G.save.lastChal` 未写进 `loadSave()` 的 `DEF`，首次读取靠 `|| 0` 兜底。
7. 存档结构变更时**必须同步更新 `DEF`**（`Object.assign` 只补 DEF 里已有的键，缺失字段不会出现默认值）。
8. 挑战模式「真实计时」与「游戏 tick」是两套时钟：`speed` 倍速只加速产线，不加速限时。
9. 枢纽只收**精确等于** `G.target` 的形状，错误形状会拒收并**堵线**；这是刻意的教学手段（见 `test-headless.js` 的「L2 错误形状拒收」用例），不要「顺手修掉」。
10. 拆除不可作用于 `resource` 与 `hub`（`removeAt` 里用 `MACHINE_TYPES.indexOf` 白名单判断）。

---

## 17. 梯形挑战规则（2026-09-23）

- 新规则只用于 C1/C2/C5/C6，配置在 `js/challenge-v2.js`。旧规则值在 `LEGACY_CHALLENGES` 中保留供兼容参考。
- `js/trapezoid.js` 负责不可变材料载荷。四个原子组成原坯：粗切成两个半块，精切成四个单元；异种单元生成混合半块，两个符合配方的混合半块生成新成品。来源、切割阶段和成品配方都由纯函数验证。
- `js/sim.js` 根据 `G.v2` 将 tick 转交给 `V2Runtime.tick()`；老规则的四象限 `cutV`、`rotCW`、`mergeShapes` 不变。新规则按两个加工出料口、每口最多 4 件的缓存和下游背压运行。
- 供料分 `initial` 和 `reserve` 两个有限队列，只有玩家启动后发货。原坯、加工中材料、在途材料与已交付材料的原子 ID 总量恒定。重置材料会恢复库存及订单，同时保留布线。
- `index.html`、`build.js` 的脚本顺序须一致：`levels.js → blueprint.js → trapezoid.js → challenges.js → challenge-v2.js → core.js → sim.js → render.js → input.js`。
- 新挑战成绩存 `G.save.challengeV2`；同关旧成绩保留在 `G.save.challenges`，二者不比较。蓝图保存 `ruleset` 与机器模式，跨规则拒绝粘贴。
- 新增验证：`node test-trapezoid.js`、`node test-v2-runtime.js`、`node test-blueprint-v2.js`。`node test-headless.js` 继续验证旧规则并保留 C1/C2/C5/C6 的旧参考解作为历史回归。改视觉还要浏览器检查 `visual-spec.html` 的普通与灰度状态。
- 四关当前的三星带数阈值按参考解带数计算，仍待真实玩家试玩调校。玩家设计和参数推导见 `../docs/superpowers/specs/2026-09-23-challenge-trapezoid-design.md`。
