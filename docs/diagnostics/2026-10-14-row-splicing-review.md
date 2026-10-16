# 行拼接调度修复独立复核

日期：2026-10-14。范围：只读复核 `js/challenge-v3.js` 的自动择对修复和 `test-row-splicing.js`；生产代码、测试代码及发行文件均未修改。仅使用文件读取与本地 Node/VM，未访问浏览器或本地 file 页面。

## 结论

此前发现的一项 P2 扩展兼容回归现已修复并独立关闭：通用几何择对使用 `genericMode:'join'`，注册算子继续接收真实 `mode:'auto'`。合法同入口算子正常产出，注册算子失败后的通用兜底及跨入口回退也未泄漏 join 模式。本次复核范围内剩余 P1/P2 为 0。

普通 T/C/S 的 TL+TR、BL+BR 在重复片提前抵达、两种入口顺序、64/32 件积压等场景正常输出单层两单元产物。显式叠层、绑定规则、完整自动注册规则、内部物料池以及原有四条参考产线的既有回归通过。

该结论针对已执行的具体回归和精确反例，不承诺所有未来任意扩展配置无遗漏。

## 原因与修复检查

旧自动路径将整个 A 队列排在 B 队列前面，并立即采用第一个合法自动二输入。因此 `[TL,TL,TR]` 会先叠两个 TL；反馈供料可不断提高层数并饿死右侧队列。

新逻辑先对完整候选池以 `genericMode:'join'` 选择互补位置，保留原始算子 mode；无通用互补时，自动重叠回退限定不同容器，单容器重复片保留等待。显式 mode/rule 继续走原有规则路径。完整注册规则仍先于通用几何选择执行，属于保留的扩展优先级。

选择缓存键包含机器物料 revision、引擎 revision、模式、绑定规则和候选数量；另核对候选对象引用顺序。实际提交重新读取当前候选容器及引用，消费后清缓存。未发现本次修复导致错删物料、重复消费或等待缓存永久遮蔽新输入。

## 已关闭 P2：通用择对策略改变注册算子的模式参数

最小复现：注册 `requires-auto` 算子，在 `options.mode!=='auto'` 时抛出 `operator-requires-auto`，否则原样返回全部单元；注册 T+C 二输入规则，将合法 `T@TL` 和 `C@TR` 放入同一 queueA，机器为 auto。

只读 VM 实测：

```text
engine.select([T@TL,C@TR],{mode:'auto'}) -> ok:true
engine.select([T@TL,C@TR],{mode:'join'}) -> no-compatible-inputs
V3Runtime.synthesize -> proc不存在，queueA=2
状态：等待互补位置的材料，重复片已保留
```

本例本来既互补又满足注册配方，不能永久等待。跨入口时自动回退恰好使用 auto，可能掩盖此问题；显式绑定规则也绕过新分支。

修复将通用几何择对提示与算子模式分开：`genericMode:'join'` 仅控制无注册配方时的几何运算和通用候选选择，始终保留原 `mode:'auto'` 给注册算子。通用分支中的二次 combine 匹配也不再把 join 传入注册算子。

独立关闭证据（全部为只读 Node/VM）：

```text
requires-auto 同入口规则 -> proc=true，单层产物，queueA=0
所有算子调用 mode -> [auto, auto]
故意失败注册算子，同入口通用兜底调用 mode -> [auto, auto]
故意失败注册算子，跨入口回退调用 mode -> [auto, auto, auto]
失败路径输入全部保留，未生成非法产物
invalid genericMode -> 明确拒绝
```

关闭时再次执行 `test-row-splicing.js`、`test-synthesis-runtime.js`、`test-v3-runtime.js`、`test-synthesis-engine.js` 以及 synthesis-engine/challenge-v3/test-row-splicing 的语法检查，全部退出 0。当前行拼接测试还包含真实采矿、切割、后接下分支、出口背压和接上输出后连续产出的六种材料/行组合；扩展兼容回归、40 输入规则及既有参考产线均通过。本代理只更新此审查报告，未修改生产代码或测试代码。

## 已执行验证

下列命令全部退出 0：

```text
node test-row-splicing.js
node test-synthesis-runtime.js
node test-v3-runtime.js
node test-synthesis-engine.js
node --check js/challenge-v3.js
node --check test-row-splicing.js
```

`test-row-splicing.js` 验证：

- T/C/S × 上下两行 × A/B 先到：两个重复片提前抵达时不加工，互补片随后到达后拼接，一件重复片保留。
- 每种材质、上下两行的 A=64 件/B=32 件积压：输出一件正确单层行，剩余 63/31 件，物理 ID 总集不变。
- 同入口互补片可直接拼接；显式 stack 同入口可叠层；默认 auto 跨入口重叠仍可叠层。

额外只读 Node/VM 精确反例均通过：

| 场景 | 实测结果 |
|---|---|
| 内部池两个 TL，外部入口一件 TR | 拼成一层 TL+TR，内部剩一件 TL，来源 ID 守恒 |
| 内部池 TL，入口 C@TL 重叠 | 跨容器回退自动叠成两层，ID 守恒 |
| 等待缓存后，候选数量/revision 不变但对象引用改变为互补片 | 缓存失效，立即拼接；未使用旧 pending |
| 等待期间动态注册 T×2 stack 规则 | 引擎 revision 使缓存失效，注册规则执行，允许同入口两层输出 |
| 两件 TL 加一件 TR，并存在高优先级完整注册 stack 规则 | 注册规则优先，TR 保留；没有意外降低扩展优先级 |
| 自动注册三输入规则，先两件重复片，随后第三件抵达 | 早到重复片等待，完整规则一次消费三个输入 |
| 已有七层 TL、另一个 TL、互补 TR | 优先选择七层物料+TR，TR 被消费，新 TL 保留，不继续增高 TL 塔 |

V3 运行时 C1/C2/C5/C6 参考产线分别在 tick 78/108/80/124 完成。

## 语义观察

无绑定规则时的 join 结果用于择对，最终仍按机器 auto 模式执行，保留已有整体下降重力语义。因此有层间空洞的复杂物料，其候选 join 结构与实际 auto 结构可能不同。例如 `[TL@0,BL@1,BL@2]` 加 `BL@0` 的几何 join 可填入底部，但实际 auto 将新 BL 放到第 3 层，避免穿过上层。当前运行时只使用候选的 indices/ruleId，实际产物由真实 merge 重新生成；这不是六种单层行拼接的阻断问题，也没有物料丢失。若未来直接展示候选预览，应明确同步实际运算模式。

完整特殊注册规则可以有意覆盖通用拼接；默认无此类覆盖规则的行拼接保证已验证。没有访问用户当前页面，因此报告不推断截图的具体布线或连接状态。
