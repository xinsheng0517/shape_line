# 通用合成引擎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task.

**Goal:** 实现用户已批准的自由几何合成、动态注册、多输入、层级、路径推导、索引性能及游戏接入。

**Architecture:** 独立纯引擎处理结构运算、规则和索引；PetalV3 门面管理物理身份及旧 ID 适配；V3Runtime 负责真实机器调度；界面按物料实际层级呈现。主源码在当前 shape-line Git checkout 中修改，保留用户已有 docs/diagnostics，不另建工作树、不提交或推送。

**Tech Stack:** 原生 JavaScript / Canvas / Node assert+vm / 已安装 Playwright 和 Chrome。

## Global Constraints

- 遵循已批准设计 `docs/superpowers/specs/2026-10-14-general-synthesis-design.md`。
- 不允许目标过滤合成、固定材质组合白名单、隐式销毁或截断高层。
- 核心支持任意注册材料与声明式规则；新增运算使用注册扩展，不改内核。
- 不得缓存物理生产输出身份；结构键必须无歧义，注册变更必须失效缓存。
- 物料不可变、拒绝伪造/预览/重复物理单元；输出必须守恒。
- 普通匹配不调用路径搜索；搜索超限明确返回 budget-exceeded。
- 保留旧目标/合法配方/蓝图/成绩；旧固定表、自动回收与非法同材断言有意替换为新要求测试。
- 各代理文件所有权独立；不得修改其他人的实现文件或执行提交。

## Task 1：纯引擎与配置

- [x] 先创建 test-synthesis-engine.js，运行并记录因缺引擎而失败。
- [x] 创建 js/synthesis-engine.js 与 js/synthesis-config.js，按下方公共接口实现。
- [x] 覆盖任意多输入、平面互补、重叠最低层叠放、动态规则/材料、不可变输入、来源一致、重复 ID、缓存失效与路径推导。
- [x] 创建 test-synthesis-performance.js：精确规则索引与队列规模分开测试，提供可重复性能计数和计时，不以单次耗时作脆弱门槛。

## Task 2：PetalV3 兼容门面

- [x] 在 test-petal-v3.js 中先写同材、81组合、多字符材料、多输入、旋转/再切割的新测试并看到失败。
- [x] 重构 js/petal-v3.js，保留旧方法名；移除固定配方表作为合法性来源。底层委托纯引擎。
- [x] 旧 ID 只用于预览/显示和目标转换，预览不拥有真实物料身份。
- [x] 公共门面：engine、mergeMany(items,options)、describe(item)、matches(item,target)、registerMaterial(id,descriptor)、registerRule(def)、derive(target,options)、validItem(item)。
- [x] raw/cut/rotate/isFinished 与单位守恒测试通过；支持原坯横切和多层产物再次切割。

## Task 3：真实运行时接入

- [x] 先增加 test-synthesis-runtime.js：原始两半、同材、跨内部/外部池、3/4输入、非法身份、输出堵塞和目标无关材料。
- [x] 修改 js/challenge-v3.js，移除目标瓣 discard 与 recipeId.slice；通过 PetalV3.engine 索引统一候选池，按引用提交消费。
- [x] 保持两个物理入口；动态规则的多输入由缓存积累凑齐；显式绑定规则时等齐输入，自动模式中未凑齐的其他规则不阻断通用组合。
- [x] 处理不同形状/多层的入口、出口、暂停、重置、拆除和在途统计。
- [x] 更新相关 VM 加载列表；经典模拟保持其适配边界并回归。

## Task 4：UI、分层显示、蓝图和配置

- [x] 为模式状态回滚、动态材料绘制、分层显示及配置导入/导出先补失败测试。
- [x] 修改 js/input.js、js/render.js、js/blueprint.js、index.html、build.js，不能遗漏脚本顺序。
- [x] 显示平面拼接/层叠含义、具体拒因、真实层数及查看层结构；动态材料使用配置颜色/轮廓。
- [x] 为机器选择注册规则提供界面入口，让3输入规则可在游戏中触发；JSON规则配置可验证地导入/导出。
- [x] 保留旧模式别名，修复 occupied 先改默认值的问题；蓝图和撤销重做保留选定模式/规则。

## Task 5：集成、审查、发行

- [x] 定向测试全部通过后执行根目录19个原测试与新测试，逐个检查退出码；旧行为断言替换有明确理由。
- [x] 审查 pure engine 与 runtime 的身份、规则扩展、队列复杂度、层叠顺序、路径超限、缓存失效。
- [x] 使用真实浏览器分别打开源码与单文件，布置C1产线验证同材/不同材/多层与动态规则，无控制台错误。
- [x] 更新 README/PROJECT/V3说明、扩展API文档、测试/性能报告。
- [x] node build.js；同步中文单文件、嵌套源副本/发行及现有zip；SHA256一致后交付路径。

## 公共接口合同（所有任务采用）

全局 `SynthesisEngine` 为 `{create(config)}`；Node 导出同一对象。`SynthesisConfig` 为纯默认配置对象，同样支持 Node require。脚本顺序：synthesis-engine → synthesis-config → petal-v3。

引擎物料输入是 `{units:[{id,sourceId,shapeKind,quadrant,slot?,layer?,cutStage?,...}], orientation?:0|90|180|270,stage?:string}`。引擎接受结构数据，不持有游戏 WeakSet；门面负责信任检查。结果 unit 中 quadrant/slot 为布局实际位置，layer 为非负整数。默认布局 TL/BL/TR/BR；材料标识为完整字符串。

引擎方法：

```text
registerMaterial(id, descriptor) -> descriptor
getMaterial(id) -> descriptor|null
registerRule(definition) -> ruleId
unregisterRule(id) -> boolean
registerOperator(id, handler) -> void
combine(items, {mode='auto',ruleId?}={}) -> {ok,units,layers,key,ruleId,reason?}
signature(itemOrUnits) -> string
matches(item,target) -> boolean
select(items,{mode='auto',ruleId?,target?}={}) -> {ok,indices,result,pending?,reason?}
derive(target,{sources,maxStates?,maxDepth?}={}) -> {status,steps,visited,...}
stats() -> {candidateChecks,cacheHits,cacheMisses,...}
```

规则定义最小形式：`{id,inputs:[{material:string,count?:positiveInteger,slot?:string}],operation:'join'|'stack'|registeredOperator,priority?:number,ordered?:boolean,conditions?:object}`。material 匹配输入物品的所有单元材质，'*' 为通配。多个同类输入以 count 表示；注册表默认无固定组合，通用 auto 运算自动拼接/层叠。自定义 handler `(items,options,engine) -> unitsArray`，核心验证不丢不增物理单位。条件与扩展语义在 API 文档中明确。

`select` 优先已凑齐的注册配方；显式 ruleId 输入不足时返回 pending 以待凑齐，未绑定时不因其他配方输入不足阻断通用合成。items 是按明确物理顺序排列的当前候选数组，返回 indices 不直接修改数组；队列调度缓存由 runtime 管理。引擎须按签名计数索引候选，避免对所有规则全扫。

门面对象产物继续保留 kind/ruleset='petal-v3'、stage、units、unitIds、orientation、recipeId、side、quadrant、region、itemId，并新增 layers/key。canonical物料合成结果 orientation=0（输入先转换世界坐标）；普通cut/rotate可维持兼容局部坐标约定。旧单层同侧上下半保留 mixed-half/H_... 标签；旧四槽满层保留 finished/F_... 标签；其他结构使用 composite 和无歧义动态key。标签不限制合成。
