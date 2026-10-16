# 通用合成引擎验证报告

日期：2026-10-14；Node.js v22.20.0；工作目录 `shape-line`。

## 实现边界

- `js/synthesis-engine.js` 提供独立实例、纯结构合成、真实层数据、旋转归一化、规则/材料/算子注册、选择计划和动态路径推导；`js/synthesis-config.js` 仅声明 T/C/S 外观及布局，不声明材料组合表。
- `combine` 先将 orientation 转换成实际 slot/quadrant。auto 将后输入作为整体放入最低不冲突层偏移；join 拒绝重叠；stack 将后输入放到当前最高层上方。输入内部层间距保留，无固定层数上限。
- 层结构为底到顶 `Array<{TL?:material,BL?:material,TR?:material,BR?:material}>`，空中间层保留。signature 比较槽位、层号和完整材料 ID，不包含生产身份；`matches` 接受 units 或 layers 目标。
- 输入物理单元 ID 必须唯一，同一 sourceId 不得改变材料。自定义算子必须返回相同的 ID/sourceId/shapeKind 多重集，且输出不得在同层同槽重叠。算子接收深复制、深冻结输入，输出也冻结；调用者嵌套元数据不会被意外冻结。
- 缓存仅保存几何摆放 offsets，按版本/操作/规则/结构签名索引；不缓存生产输出。每次输出重新从当前批次身份构造。材料、规则、算子注册/替换、规则删除和成功导入均递增 `version`/`revision` 并清缓存。

## 扩展 API

公共合同全部实现：`registerMaterial/getMaterial/registerRule/unregisterRule/registerOperator/combine/signature/matches/select/derive/stats`。

额外配置 API：

- `exportConfig()` → 纯 JSON `{materials:[{id,...descriptor}],rules:[definition]}`。
- `importConfig(config)` → 原子合并配置。先验证全部材料及规则，再一次提交；未知运算/非法输入/非 JSON 数据抛错，失败不改变注册表、版本或缓存。保留现有 T/C/S 与已注册算子，不从 JSON 执行函数。
- `listRules()` → 可独立修改的规则定义 JSON 副本。
- `version`、`revision` getter 与 `stats().version` → 相同的注册表版本。

规则 inputs 中 `count` 表示物品数量；每个物品所有单元必须具有该 material，`*` 接受混合材料；slot 要求该物品全部单元位于该实际槽。ordered 要求按物理队列顺序匹配，非 ordered 仍保留最终选中物品的到达顺序用于层叠。

支持的 conditions 为 `minLayers`、`maxLayers`（选中输入当前最高层号 + 1）、`sameSource`（选中全部单元是否属于同一来源）和 `disjoint`（选中输入的实际层/槽占位是否互不重叠）。未知条件拒绝注册，避免悄悄忽略约束。其他逻辑使用注册算子扩展。

`select` 返回 indices 与 result，永不修改候选数组。完整注册规则优先；存在真实部分匹配时返回 pending 以积累多输入；没有适用规则则选择通用组合。条件/平面冲突匹配会寻找后面的合法输入，不能因第一组失败漏掉有效候选。调用端必须使用 `result.ruleId` 重新建立可信生产输出。

## 推导语义

`derive(target,{sources,maxStates,maxDepth})` 的 sources 是可持续补给的结构描述；材料字符串代表对应四槽原坯。它是工艺规划，不是有限库存调度器。所有规划身份均为独立虚拟身份，不会进入游戏信任集合。

优先实际执行结构分解、按槽切割、旋转和合成；需要扩展操作时，对动态发现的结构执行注册的单输入或多输入规则，并进行有界结构闭包搜索。步骤记录实际输入、输出与 ruleId，切割同时记录全部 outputs 余料；多层相同槽位不会被切割操作剥离。没有固定材料工序脚本。

结果区分 found/unreachable/budget-exceeded。缺失必要材料可证明 unreachable；有限预算未找到路径返回 budget-exceeded。`visited` 同时计入结构加入和扩展工作，预算是工作上界，避免枚举但未新增节点时无限运行。普通合成/选择不调用 derive。

## 红绿证据

首先创建 `test-synthesis-engine.js` 并执行，退出 1，明确断言 `pure synthesis engine must exist` 失败。随后实现引擎和默认配置。

后续新增测试先出现以下失败，再实施修复并复跑：

1. 初始来源预算耗尽误报 unreachable → budget-exceeded。
2. 缺少 version getter → getter 与 stats 版本一致。
3. 自定义算子冻结调用者嵌套元数据 → 深复制隔离。
4. 共享 T 的无关规则从 posting 全扫（10 规则检查 10）→ 材料多重集 trie 与部分需求索引。
5. sameSource 候选误选 `[0,1]` → 选择 `[0,2]`；加入首件冲突后选择 `[1,2]` 的回归。
6. 跨 VM realm 的 JSON 规则被拒 → 接受跨 realm 的普通 JSON 对象。
7. 搜索切割未记录余料 → 切割 steps.outputs 物料数量守恒。
8. 多层相同槽位被推导成可剥离 → 按槽保留全部层一起切割。

最终针对性命令均退出 0：

- `node test-synthesis-engine.js`
- `node test-synthesis-performance.js`
- `node test-petal-v3.js`（代理接入后的门面集成回归）
- `node test-synthesis-ui.js`（代理接入后的配置/UI集成回归）

覆盖 41 层连续合成、无歧义多字符材料与特殊键、身份守恒、缓存新批次身份、配置失败原子性、规则替换/删除、算子替换、约束候选、三输入等待、动态单/三输入规划、循环与预算耗尽。

## 可重复性能

执行 `node test-synthesis-performance.js`；计时仅报告，不设置容易抖动的毫秒门槛。固定两个物品/两个单元测试 R；Q 测试每个物品一个单元。

| 无关精确规则 R | 注册 ms | 命中检查 | 未命中检查 | 命中 median/p95 ms | 未命中 median/p95 ms |
|---:|---:|---:|---:|---:|---:|
| 10 | 0.56 | 2 | 0 | 0.0290 / 0.1838 | 0.0146 / 0.0674 |
| 1,000 | 7.35 | 2 | 0 | 0.0240 / 0.0780 | 0.0142 / 0.0173 |
| 10,000 | 66.45 | 2 | 0 | 0.0212 / 0.0289 | 0.0153 / 0.0184 |
| 100,000 | 550.01 | 2 | 0 | 0.0212 / 0.0280 | 0.0152 / 0.0436 |

命中检查 2 = select 一次规则匹配 + combine 一次精确匹配。额外严格场景将全部无关规则设为 T + 各自缺少的 noise 材料：

| 共享材料规则 R | 部分等待检查 | 真正 T/C 命中检查 | 命中 median/p95 ms |
|---:|---:|---:|---:|
| 10 | 1 | 2 | 0.0218 / 0.0814 |
| 1,000 | 1 | 2 | 0.0219 / 0.0293 |
| 10,000 | 1 | 2 | 0.0219 / 0.0313 |
| 100,000 | 1 | 2 | 0.0222 / 0.0315 |

| 队列 Q | 精确候选检查 | median/p95 ms |
|---:|---:|---:|
| 10 | 0 | 0.0298 / 0.0490 |
| 100 | 0 | 0.1717 / 2.0523 |
| 1,000 | 0 | 1.2916 / 2.3538 |
| 10,000 | 0 | 9.2508 / 11.9409 |

通配规则是显式回退桶，单独测试：10 条检查 10 次、median 0.0647 ms；1,000 条检查 1,000 次、median 3.9885 ms。它们不享受精确规则的常量候选数保证。

精确完整规则通过材料多重集 trie 访问池中存在的材料分支；部分需求索引按材料与槽位取一个证明可等待的规则，不扫共享材料的全部 posting。队列物品索引按需建立，普通 auto 通用选择线性处理队列。join 将相同占位形状折叠为一个代表再查找兼容对；不同占位形状非常多时仍可能平方增长。带复杂组合条件的规则需要约束搜索，不能承诺任意第三方规则都恒定耗时。

本报告仅负责纯引擎与上述定向集成结果；完整既有测试、实际浏览器、运行时守恒与发行包同步由主任务报告。
