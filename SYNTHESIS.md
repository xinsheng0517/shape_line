# 通用合成系统

本版用结构运算替代固定材料配方表。形状由从底到顶的层组成，每层记录 TL、BL、TR、BR 的材料。材料标识是完整字符串，可以注册铜、玻璃或任何其他类型，不需要改合成引擎代码。

## 玩家操作

在挑战关打开工具栏的“蓝图库／导入导出”抽屉，选中空混合机后设置模式：

- **自由拼接＋重叠层叠**：机器优先从全部缓存寻找互补位置，合成在同一层。同入口重复片会保留等待互补片，防止边搭边供料时抢先叠层；找不到平面组合时，两入口的重叠物料仍可自动叠放。单入口主动叠层可用层叠模式或绑定规则。叠层把后输入整体放在最低可落下的位置，已有上层会阻挡下落，输入内部层间关系不改变。
- **平面拼接**：仅在原有位置无重叠时拼接，重叠时保留输入等待其他材料。
- **按顺序层叠**：把后输入放到当前结构之上。A 缓存先于 B，同一入口内按到达顺序；配置规则可进一步声明有序输入。
- 旧蓝图中的 **half/final** 保留，并兼容为平面拼接，不再限制“只能异材上下瓣”或“只能特定半块”。

默认不设固定层数上限，也不会截掉高层。机器缓存仍有容量，出口堵塞会反向停止生产；这是运输背压，不是配方限制。选中机器后点击“查看每层结构”，可逐层查看槽位、材料名称与图形。

完整原坯现在可以直接纵切或横切；切割机每次入机仍只执行一次分割。左右半块可横切，上下半块可纵切，多层产物也可继续分割与旋转。切割只按所选方向分开已有槽位，不复制物料。

关卡目标仅决定枢纽是否接收成品，机器不再按目标配方阻止合成或自动销毁非目标材料。旧目标、成绩和蓝图布局保留；原先依赖自动回收的线路需要接垃圾桶或重新规划废料出口。

## 动态配置

抽屉中展开“编辑 / 导入 / 导出材料与规则 JSON”，编辑文本并点击“校验并应用 JSON”。应用成功后保存至浏览器本地存档，刷新仍可恢复。配置采用原子合并：校验失败不应用任何材料或规则；未列出的现有材料/规则继续保留。导出按钮生成可复制保存的完整文本。

例如注册新材料和三输入配方：

```json
{
  "materials": [
    {"id":"copper","name":"铜","color":"#dc8752","outline":"diamond"}
  ],
  "rules": [
    {"id":"copper-three","name":"三份铜拼接","inputs":[{"material":"copper","count":3}],"operation":"join"}
  ]
}
```

混合机的“指定规则”下拉框可以绑定该规则。绑定三输入规则时，机器等待缓存凑齐三件再加工；未绑定时优先使用已凑齐的注册规则，未凑齐的配方不会阻止通用合成。两个物理入口可在多个运输批次中供应三件或更多输入。

输入 `material` 指输入物品全部单元的材料，`*` 为通配；混合材质物品可用通配输入。`count` 为物品件数，不是内部四瓣数量。`slot` 可要求该输入的所有单元位于指定槽。`ordered:true` 表示按候选池中的物理输入顺序匹配。

规则支持 `priority`，数值高的先匹配；相同优先级先匹配输入数多的规则，再按 ID 排序。`enabled:false` 可在配置中保留但停用规则，重新设为 true 后恢复。绑定不存在或停用的规则时，机器保留材料并等待配置修正。

支持的条件：

| 条件 | 含义 |
|---|---|
| minLayers / maxLayers | 输入结构的最高层所形成的深度范围，不是全局层数上限 |
| sameSource | 所有输入单元是否来自同一物理原坯 |
| disjoint | 所有输入位置是否无重叠 |

`join`、`auto`、`stack` 是通用结构运算；`transform` 可通过 `output.material` 指定已注册的产物材料，保留原始物料身份与来源。例如把铜输入转换为已注册的玻璃材料，不需要新增材料组合分支。复杂几何或业务逻辑用下面的算子扩展接口实现。

## 开发接口

`SynthesisEngine.create(config)` 创建独立引擎。默认配置在 `js/synthesis-config.js`，不含材料组合白名单。

```js
const engine = PetalV3.engine;
engine.registerMaterial('glass', {name:'玻璃',color:'#9adbe8',outline:'circle'});
engine.registerRule({
  id:'copper-to-glass', inputs:[{material:'copper'}],
  operation:'transform', output:{material:'glass'}
});
```

高级扩展注册算子函数即可，不修改内核：

```js
engine.registerOperator('raise-one-layer', items =>
  items.flatMap(item => item.units.map(unit => ({...unit, layer:unit.layer+1})))
);
engine.registerRule({
  id:'lift-three', inputs:[{material:'*',count:3}], operation:'raise-one-layer'
});
```

算子接收深度冻结的独立输入副本，应为确定性、无副作用的结构运算。返回的每个物理单元必须保留 id、sourceId 和 originKind，不能复制、漏掉或伪造单元。shapeKind 可以变为其他已注册材料；originKind 始终保存原始来源材质。输出槽位和层必须合法，拒绝时机器不消费输入。JSON 不执行代码；注册函数必须来自可信扩展模块。需要跨刷新恢复此类规则时，扩展模块须在恢复配置前注册相同算子；缺失时会提示并保留未恢复配置供导出。

主要接口：

```text
registerMaterial(id, descriptor) / getMaterial(id)
registerRule(definition) / unregisterRule(id)
registerOperator(id, handler)
exportConfig() / importConfig(snapshot) / listRules()
combine(items, {mode, ruleId})
select(items, {mode, ruleId, maxCandidates})
signature(itemOrUnits) / matches(item, target)
derive(target, {sources, maxStates, maxDepth})
version / revision / stats()
```

生产物料使用 PetalV3.raw/cut/rotate/mergeMany 创建。门面持有物理信任集合，不能用普通 JSON、对象展开或目标预览伪造生产物料。`mergeMany` 支持注册的单输入规则及任意多输入配方；无对应规则的单件物料不会自行加工。

机器自动择对使用 `genericMode:'join'` 提示优先通用平面组合；该提示仅决定无注册规则时的几何路径，注册算子仍接收原始 `options.mode:'auto'`。队列先后顺序不会强迫机器消费更早到达的重叠重复片。

旧 H_TC、F_TC_TS 等 ID 只转换成结构目标和显示标签，不决定是否允许合成。新材料目标直接用结构，例如：

```js
const target = {layers:[{TL:'copper',BL:'glass',TR:'T',BR:'S'}]};
PetalV3.matches(product, target);
```

经典教程、自由、每日及 C3/C4 的已有四象限数组仍由适配器支持。无重叠合成继续返回原数组；重叠结果改为真实多层结构，可继续旋转、切割和渲染。

## 路径推导与性能边界

`derive` 根据可补给源结构、切割、旋转和当前注册规则动态推导路径。`sources` 是可重复补给的来源描述，不代表机器中有限库存的清单。实际库存匹配由 select 和运行时负责。切割步骤记录真实二路分割方向及剩余物料，不能跳过工序或忽略废料。

返回状态为 found、unreachable 或 budget-exceeded。工作预算和深度预算限制规划资源；超限不是“配方不存在”，也不会让机器丢弃输入。正常加工不调用路径搜索。

`select` 和 `combine` 可传 `maxCandidates` 调整匹配工作预算（默认 10,000）；该预算也传递到内部规则校验。创建引擎时可用 `SynthesisEngine.create({...SynthesisConfig,maxCompileInputs:1000000})` 配置规则展开预算，默认也是 1,000,000。注册单条规则与整批导入都在展开 `count` 前检查预算；超大配置立即返回 `configuration-budget-exceeded`，保留现有注册表和存档。可信扩展可提高创建参数，普通 40/128 输入在默认配置内。此预算控制配置编译资源，不限制材料组合或合成层数。

精确配方采用材料多重集索引及候选缓存，签名包含完整材料字符串、位置、层和朝向；注册修改递增版本并使缓存失效。缓存只存结构运算计划，实际输出始终来自本次输入的物理单元。

精确规则基准覆盖 10、1000、10000、100000 条规则，并测试共享常用材料但其他材料不可用的规则，避免伪优化。任意通配条件或扩展函数不可能都转换成常数时间查找，其候选搜索受预算约束并明确报告超限；新增规则的注册与索引构建也存在正常开销。详见本次测试报告及可运行 `test-synthesis-performance.js`。

## 验证与发行

执行 `node test-synthesis-engine.js`、`node test-petal-v3.js`、`node test-synthesis-runtime.js`、`node test-synthesis-classic.js`、`node test-synthesis-ui.js`、`node test-synthesis-persistence.js` 和 `node test-synthesis-performance.js`。全部旧回归也需运行；最终单文件由 `node build.js` 构建，新增两个脚本会内联进 HTML。

行拼接专项执行 `node test-row-splicing.js`，或 `node test-row-splicing.js dist/shape-line.html` 在 Node VM 中加载发行文件内联代码，检查三材质上下半、延迟进料、积压、未接出口、真实截图产线及已注册算子模式兼容。

`scripts/verify-synthesis-browser.js` 使用已安装的 Playwright 与 Chrome，检查真实工具栏放置、配置导入和刷新、三输入规则、分层查看及四关实际产线；不属于发行游戏的运行依赖。

借鉴来源：shapez.io 的 [ShapeDefinition](https://github.com/tobspr-games/shapez.io/blob/master/src/js/game/shape_definition.js) 与 [ShapeDefinitionManager](https://github.com/tobspr-games/shapez.io/blob/master/src/js/game/shape_definition_manager.js)。本项目独立实现结构和接口，采用空间组合与操作缓存思想，不复制其固定四层截断策略。
