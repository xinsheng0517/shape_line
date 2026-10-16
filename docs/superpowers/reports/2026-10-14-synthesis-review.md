# 通用合成重构综合代码审查

日期：2026-10-14。审查范围：已批准设计、实现计划、engine/petal/ui 报告，以及 `synthesis-engine/config`、`petal-v3`、`challenge-v3`、`core`、`sim`、`input`、`render`、`blueprint`。只读生产代码；使用 Node 最小探针验证下列问题，没有重跑已有全套测试。行号以本报告写入时源码为准。

## 需要修正的问题

### [P1] 规划器在预算检查之前进行指数枚举

位置：`js/synthesis-engine.js:307–308`（`derive` 的 `visit`）。

递归先枚举每个输入的候选结构笛卡尔积，到叶节点才检查 `chosen.includes(node)`，之后才调用 `budget()`。当前节点根本不可能匹配某条规则时，整棵指数枚举树不计入任何工作预算。普通声明式多输入规则即可触发，调用所在浏览器线程会阻塞；`maxStates` 不再是报告承诺的工作上界。

已运行隔离子进程探针：注册 `{id:'many-C',inputs:[{material:'C',count:30}],operation:'auto'}`，sources 是单元结构 `[T@TL,C@TL,C@BL]`，目标 `{layers:[{},{TR:'T'}]}`，选项 `{maxStates:20,maxDepth:2}`。父进程使用 `spawnSync(...,{timeout:2000})`，结果为 `ETIMEDOUT`、约 2024ms、无返回输出。将 count 改成24，约1965ms才返回 `budget-exceeded, visited:20`，说明不是状态预算正常耗尽造成的即时退出。

建议先跳过不含当前节点候选的规则/组合，并对递归分支展开和候选尝试计费；工作预算耗尽后立即停止，不以生成新结构或到达特定叶节点为计费前提。

### [P2] 扩展算子的第一组候选失败后，选择器漏掉合法的后续组合

位置：`js/synthesis-engine.js:220–221`，以及 `pick` 仅返回一组候选的合同。

`select` 对每条规则只调用一次 `pick`，然后只执行该组的算子。算子结果检查失败时，显式规则直接返回错误；自动规则继续尝试下一条规则/通用路径。没有搜索同一规则的其他可执行组合。可注册算子允许自行定义空间变换，第一组结果重叠并不能证明这条规则没有合法输入。

已运行探针：注册 `copy(items => items.flatMap(i=>i.units))`，注册 `{id:'copy-pair',inputs:[{material:'T',count:2}],operation:'copy'}`，池为三个独立物理单元 `[T@TL,T@TL,T@BL]`。

```text
select(pool,{ruleId:'copy-pair'}) -> {ok:false,reason:'slot-conflict'}
combine([pool[0],pool[2]],{ruleId:'copy-pair'}) -> {ok:true,ruleId:'copy-pair'}
```

这是已存在的合法配对，且没有消费或身份冲突。真实机器使用显式 ruleId 时会缓存失败结果，在输入不变时持续卡住。建议允许选择器在算子验证失败后尝试后续候选，或为算子声明可索引的可行性约束，并保留完整的回退匹配。

### [P2] 路径步骤使用四路切割，实际切割机只能二路切割

位置：`js/synthesis-engine.js:256`、`:282`；对照 `js/petal-v3.js:82–98`。

规划器的 `cuts` 将输入直接按四个槽拆成最多四个输出，并把这记为一次 `cut`。实际 `PetalV3.cut` 一次只能纵切或横切成两份，原坯获得 quarter 至少需要两次切割。因此返回的 steps 不能直接按现有机器操作执行，也低估 `maxDepth`。步骤没有记录纵/横方向或两半中间产物。

已运行探针：

```js
engine.derive({layers:[{TL:'T'}]}, {
  sources:['T'], maxStates:100, maxDepth:1
});
```

实际返回 `found`，steps 只有一步 `{operation:'cut'}`，该步输入4单元，outputs 的单元数为 `[1,1,1,1]`。实际机器一次切割只能 `[2,2]`。

建议规划边直接使用与门面一致的纵切、横切语义，记录 mode、全部二路输出以及必要的第二次切割；按实际边数计算深度。

### [P2] 规划虚拟身份破坏同源条件，且步骤输入输出身份不一致

位置：`js/synthesis-engine.js:257`、`:269–270`、`:297`、`:311–312`。

`virtual` 为每个单元分别生成新的 sourceId，将原来同源的四个瓣改成四个不同来源。`sameSource:true` 规则于是无法匹配本来合法的供应结构。初始 unary 路径的步骤 inputs 记录 `node.item`，但实际 combine 使用再次 virtual 的另一个对象；输出 ID 与步骤输入 ID 对不上。后续闭包合并同样重建 inputs，却直接复用前置 steps，缺少可连接的物理生产关系。

已运行同源探针：原坯四槽T，所有单元 sourceId 都为 `'x'`；注册 unary `raise-full` 算子，仅接受4单元并将 layer 加1；规则条件 `{sameSource:true}`。直接 `combine([raw],{ruleId:'raise-full'})` 成功，结果为空底层上方完整T原坯。相同 sources、相同目标，`derive(...,{maxStates:100,maxDepth:1})` 却返回 `budget-exceeded, visited:7`，尽管存在合法一步路径。

反向探针同样已运行：将条件改为 `{sameSource:false}`，实际 `combine([raw],{ruleId:'raise-full'})` 返回 `rule-input-mismatch`，规划器却在 `maxDepth:1` 返回一步 `found`。这说明它还可能将不可按所示一步执行的工艺报告成成功，并非仅搜索效率问题。

已运行步骤身份探针：注册将单个T从TL移动到TR的 unary `move`，derive 返回一步 found；该步骤输入ID为 `plan-1-0`，输出ID为 `plan-2-0`。实际算子保留输入ID，改变来自规划器记录的对象不一致。

建议每个供应实例按原 sourceId 分组做一致重映射，保留同源关系；每个步骤记录真正传给 combine 的 inputs。重复引用前置工艺时，应实例化整条前置路径及其关联身份，或显式使用结构工艺节点与边引用，不声称当前不连通的身份对象是实际执行步骤。

## 已核对但未另报缺陷的边界

- 多字符材料和特殊键使用 Map 与 JSON canonical key；普通几何运算缓存保存 offsets，每次 combine 使用本次输入单位身份。
- 条件匹配已有回溯，覆盖同源、占位、层数约束；无条件精确/通配匹配使用二分图分配。以上第2项限定于后续算子执行失败，不否定已有条件回溯。
- 配置导入先建立临时材料/规则注册表，验证成功才提交；现有文档明确它是原子合并，未将“没有删除旧规则”误报为原子性缺陷。
- 队列、加工态、输出与旧内部半块均纳入物料统计/拆除；输出阻塞会保留加工产物。规则和模式通过蓝图/Undo 字段保留。
- classic 适配维持单层数组形式，重叠输出使用真实多层结构，旋转与切割保留层信息。未发现本次阅读范围内新的明确经典路径回归。

另：审查最初复现 auto first-fit 将后输入插入已有上层下方孔洞（TL 0/2层 + TL0错误落1层）。父代理已独立发现，并在本报告写入前修改为同槽最高/最低高度计算；此项作为已处理问题记录，不列入上述待修清单。修复后的测试由父代理负责。

结论：当前有1项 P1 与3项 P2需要处理后再批准。既有全套测试通过不能覆盖上述反例。

## 修复后独立复核（第一轮）

已阅读 `2026-10-14-synthesis-engine-fixes.md` 并重新运行原反例，另执行 `node test-synthesis-engine.js`（退出0）。本节结论取代上文首次审查时的状态：原 P1 已关闭，原候选重试及二路切割 P2 已关闭，身份问题仍有两个重要分支；另发现内层预算传播 P2。

### 已关闭的具体证据

- 原 `C count:30` 反例：隔离子进程约111ms返回 `{status:'budget-exceeded',visited:20}`，未触及2秒超时。递归分支现在计入工作预算；未发现原先未计费指数枚举路径仍可复现。
- copy算子、T×2、`[T@TL,T@TL,T@BL]`：有序/无序与自动/显式共4种选择均成功并包含第三件物料。
- T原坯到TL单瓣：`maxDepth:1` 不再返回 found；`maxDepth:2` 返回纵切 `[2,2]`、随后横切 `[1,1]` 两步。第二步消费第一步输出的相同ID，切割余料有明确输出。
- 同源4单元 unary raise-full：`sameSource:true` 一步found，输入/输出ID一致；`sameSource:false` 不再虚报一步found。
- 两个独立前驱都经过自定义变材/位移，再由二输入规则提升：得到 `move-T → move-C → raise-pair`，最终输入保留两个前驱输出的相同ID/sourceId/originKind。
- 声明式transform保留物理originKind；通过importConfig反复 enabled=false/true 切换，combine/select/derive状态均相应变化。此次检查未发现禁用规则残留在匹配索引。

### [P2，原身份问题仍未关闭] 同次切割兄弟被重新实例化成不同来源

位置：`js/synthesis-engine.js:287`、`:373`（本轮检查时行号）。

`chosen.map(instantiate)` 为每个候选独立重映射完整前驱。这样能连接各自的前驱，但两个原本来自同次切割的兄弟被当成两份独立原坯，sourceId关系丢失。`sameSource:true` 的多输入规则因而不能执行，即使真实切割余料已完整凑齐。

可复现代码（从仓库目录执行 `node -e`，或在Node中运行）：

```js
const E = require('./js/synthesis-engine').create(require('./js/synthesis-config'));
const raw = {units:['TL','BL','TR','BR'].map(slot => ({
  id:'x:'+slot, sourceId:'x', shapeKind:'T', slot, layer:0
}))};
E.registerOperator('raise', items => items.flatMap(item =>
  item.units.map(unit => ({...unit, layer:unit.layer+1}))));
E.registerRule({id:'raise-pair', inputs:[{material:'T',count:2}],
  operation:'raise', conditions:{sameSource:true}});
console.log(E.combine([
  {units:raw.units.slice(0,2)}, {units:raw.units.slice(2)}
], {ruleId:'raise-pair'}).ok);
console.log(E.derive({layers:[{},{TL:'T',BL:'T',TR:'T',BR:'T'}]}, {
  sources:[raw], maxStates:10000, maxDepth:2
}));
```

实际为 `true`，随后 `budget-exceeded, visited:3176`。正确路径只需纵切一次、消费两个同源输出、提升一次，应在depth2找到。修复必须共同实例化同一个前驱图并复用其互斥输出，不能通过复制完整原坯两次制造伪同源物料。

### [P2，原身份问题仍未关闭] 结构去重丢弃来源关系不同的供应

位置：`js/synthesis-engine.js:274`、`:298`（本轮检查时行号）。

`seen` 仅按当前材料/槽/层结构去重，无法区分来源分区。来源关系会影响sameSource规则，因此两个结构相同的供应并非对所有规则等价。

```js
const E = require('./js/synthesis-engine').create(require('./js/synthesis-config'));
const raw = {units:['TL','BL','TR','BR'].map(slot => ({
  id:'x:'+slot, sourceId:'x', shapeKind:'T', slot, layer:0
}))};
const mosaic = {units:raw.units.map(unit => ({...unit, sourceId:unit.slot}))};
E.registerOperator('raise-full', items => items[0].units.length===4
  ? items[0].units.map(unit => ({...unit,layer:unit.layer+1})) : []);
E.registerRule({id:'raise-full', inputs:[{material:'T'}],
  operation:'raise-full', conditions:{sameSource:true}});
const target = {layers:[{},{TL:'T',BL:'T',TR:'T',BR:'T'}]};
console.log(E.derive(target,{sources:[raw],maxStates:200,maxDepth:1}).status);
console.log(E.derive(target,{sources:[mosaic,raw],maxStates:200,maxDepth:1}));
```

实际为 solo `found`，加入前置异源结构后反而 `budget-exceeded, visited:34`。建议规划状态键包含规范化来源分区及影响后续规则的originKind；不应直接包含随机sourceId而破坏等价去重。

### [P2，新增] 内层匹配固定预算阻止调用者提高预算完成合法多输入规则

位置：`js/synthesis-engine.js:170–173`，对照`:225`（本轮检查时行号）。

外层select使用调用者maxCandidates，内部combine的matchingRule却再次调用默认10,000预算的pick。即使外层允许1,000,000次工作，40个相同材料输入的二分图匹配仍在内层失败；真实两个64件入口足以容纳该规则，但规则永远无法通过提高预算执行。

```js
const E = require('./js/synthesis-engine').create(require('./js/synthesis-config'));
E.registerRule({id:'many',inputs:[{material:'T',count:40}],operation:'auto'});
const pool = Array.from({length:40},(_,id)=>({
  units:[{id,sourceId:id,shapeKind:'T',slot:'TL',layer:0}]
}));
console.log(E.select(pool,{ruleId:'many',maxCandidates:1000000}));
console.log(E.combine(pool,{ruleId:'many',maxCandidates:1000000}));
```

两者都返回 `budget-exceeded`。同探针count20通过、count40/50/100失败。建议在全部匹配层传播统一预算，或让已验证的选择结果不再以更小的隐式预算重复匹配。

本轮剩余：没有已复现P1；上述三个具体P2反例仍需要修正。生产代码未由审查代理修改。

## 补充修复后的独立复核（第二轮）

本轮重新执行第一轮三个精确反例，并执行 `node test-synthesis-engine.js`（退出0）。先前精确反例已通过，但来源去重仍有下述新的可运行P2，当前尚不能全部关闭。

### 已通过的精确反例与图检查

- raw4纵切兄弟 + sameSource二输入提升：返回found、visited169，路径只有一个纵切步骤和一个提升步骤；结果4个唯一ID、1个sourceId。
- 来源顺序为异源raw4、同源raw4的unary提升：返回found、visited5。
- 同桶count40/count128在默认预算成功；原count40显式提高预算成功；`T×20 + wildcard×20` 的40输入在1,000,000预算成功。
- 对共享兄弟路径逐步维护可消费物料表，检查所有输入单位唯一、前驱输出与下一步输入一致、已消费身份不再作为新根引入、输出不重复占用仍在途的单位；切割真实二路分区，非切割步骤重新调用combine得到相同结构。检查通过。
- 原raw同一对象重复提供两次，试图制造同源8单元的反例未返回found（visited3500，budget-exceeded）；直接combine仍返回duplicate-unit-id。合法共享兄弟能通过，重复物理单位未在此探针中被误复用。

### [P2，来源去重仍未关闭] 物品内部来源分区不能代表跨节点同源关系

当前 `stateIdentity` 保留物品内部来源分区，却仍把不同根来源的同形状单片视为等价。若TL片段x先出现，TL片段y会被丢弃，无法再和BL片段y形成合法同源组合。这个问题可由插入无关同形状供应触发，供应排列改变可达性。

```js
const E = require('./js/synthesis-engine').create(require('./js/synthesis-config'));
const part = (id,sourceId,slot) => ({units:[{
  id,sourceId,shapeKind:'T',slot,layer:0
}]});
E.registerOperator('raise', items => items.flatMap(item =>
  item.units.map(unit => ({...unit,layer:unit.layer+1}))));
E.registerRule({id:'raise-pair',inputs:[{material:'T',count:2}],
  operation:'raise',conditions:{sameSource:true}});
const a=part('x:TL','x','TL');
const b=part('y:TL','y','TL');
const c=part('y:BL','y','BL');
const target={layers:[{},{TL:'T',BL:'T'}]};
console.log(E.combine([b,c],{ruleId:'raise-pair'}).ok);
for(const sources of [[b,c],[a,b,c],[b,a,c],[b,c,a],[a,c,b],[c,a,b],[c,b,a]]) {
  const r=E.derive(target,{sources,maxStates:10000,maxDepth:1});
  console.log(sources.map(s=>s.units[0].id),r.status,r.visited);
}
```

本轮实际结果：

```text
direct combine(yTL,yBL): true
[b,c]   found 15
[a,b,c] budget-exceeded 84
[b,a,c] found 15
[b,c,a] found 15
[a,c,b] budget-exceeded 84
[c,a,b] budget-exceeded 82
[c,b,a] found 13
```

建议状态等价同时保留跨节点来源谱系关系；不应依赖随机生成的物理ID，也不能只比较每件物料内部来源组数。修复代理已收到此代码及全部排列结果。

本轮结论：没有已复现P1；仍有上述1项P2，属于原来源拓扑问题的跨节点分支。其他上一轮精确反例可以关闭。仅修改审查报告，未改生产代码。

## 最终独立复核：剩余来源P2关闭

稳定source/unit lineage及原前驱图优先合并修复后，重新执行最后三源反例的全部6种排列、同源三片的连续变换/合并链及物料消费账本检查。`node test-synthesis-engine.js` 再次退出0。

原三源反例的选项保持 `maxStates:10000,maxDepth:1`，结果如下；每条found路径均经过独立逐步回放，并确认两个输入单位唯一、同一个sourceId，异源同形状片段没有冒充同源片段。

| 供应顺序 | 状态 | visited |
|---|---|---:|
| a,b,c | found | 93 |
| a,c,b | found | 93 |
| b,a,c | found | 19 |
| b,c,a | found | 18 |
| c,a,b | found | 17 |
| c,b,a | found | 16 |

其中a为异源TL，b/c为同源TL/BL。只提供 `[a,c]` 的异源反例没有返回found；插入与重排无关同形状源不再丢失b/c的合法可达性。

连续链复核使用TL/BL/TR三个同源T片段。前两片经 `sameSource:true` 规则提升并变为Z，随后与第三片经另一个 `sameSource:true` 规则合并并全部变为Z。Z目标使该链必须完成，避免普通通用合成产生另一条满足纯结构目标的合法路径。所有6种排列在 `maxDepth:2,maxStates:100000` 返回found，步骤均为 `raise-two → finish-three`，输出有3个唯一单位ID、1个sourceId；第一步的2个输出单位以相同ID/sourceId进入第二步。逐步执行每个规则并比较完整输出身份与位置，全部通过。

这条更强的Z链在两种TR先列的顺序中使用visited10925，其他顺序为96或357；预算10,000时这两种顺序正确返回budget-exceeded，提高预算后找到路径。这是有界搜索顺序的资源差异，未表现为丢失状态或虚报unreachable。

再次检查共享原坯纵切兄弟：路径为一次cut、一次raise，只有1个根供应、4个唯一物理单位；切割的两个输出均被合法消费。再次检查重复raw对象试图制造同源8单元：直接combine返回duplicate-unit-id，derive没有返回found，并在5000工作预算停止。

物料回放账本同时检查：每个新根匹配声明供应结构；已经引入且消费的单位不能再次当作新根；每步输入ID无重复；输出ID多重集与输入守恒；切割为真实二路分区；规则重新执行得到相同输出身份/材料/层/槽；在途输出之间不重叠占用同一物理ID；最终结果确实仍在账本中。

**最终结论：本次审查报告中的问题均已关闭，当前没有剩余的已复现P1/P2。** 结论限定于已审查代码与上述回归证据，不宣称有限测试证明所有未来任意扩展。审查代理仅追加本报告，没有修改生产代码。
