# 通用合成运行时独立最终审查

日期：2026-10-14。范围：当前未提交升级的 `SYNTHESIS.md`、已批准设计、git diff，以及 `js/challenge-v3.js`、`js/petal-v3.js`、`js/sim.js`、`js/core.js`、`js/input.js`、`js/blueprint.js`。为核对配置和选择器合同，读取 `js/synthesis-engine.js` 相关实现；未审查 derive。仅新增本报告，未修改生产代码或测试。

## 已复现并关闭的问题

### [P2，已修复] 配置导入直接展开极大 count，短 JSON 即可同步冻结界面

位置：`js/synthesis-engine.js:58–61`，调用入口 `js/input.js:425–428`、`js/core.js` 的 `restoreSynthesisConfig`。

`count` 只检查为正的安全整数，然后逐次向 `expanded` 写入对象。以下合法 JSON 不到 150 字节，但会尝试创建十亿个需求对象。UI 应用配置及启动恢复均同步调用编译，因此主线程不能及时返回校验错误或等待状态。

```json
{"materials":[],"rules":[{"id":"huge-count","inputs":[{"material":"T","count":1000000000}],"operation":"join"}]}
```

修复前实证：隔离 Node 子进程调用 `Engine.create(Config).importConfig(上述对象)`，在调用前后分别输出 before/after；父进程设置 `spawnSync` 的 `timeout:1500`。结果 `ETIMEDOUT`，约 1586 ms，只有 before，无 after。该探针由超时终止，不向项目或浏览器存档写入配置。

已将精确反例交给实现代理。修复加入显式 `maxCompileInputs` 配置编译预算，默认 1,000,000；在展开前扣除需求数，单条规则累计需求、import 整批规则和 create 初始规则批次均受预算约束，超额明确抛出 `configuration-budget-exceeded`。可信调用者可配置更大的预算；未引入材料类型或合成层数上限。

修复后独立复测：

- 原巨大 count 子进程在约 129 ms 正常退出 0，返回预期预算错误。活动配置、revision 均不变，导入同时声明的新材料未注册。
- 使用真实 `UI.importSynthesisConfig` 的 VM 启动器应用相同 JSON，错误返回后引擎配置、revision、`G.save` 及 localStorage 字节内容全部保持原样。
- 以含该 JSON 的既有存档重新启动，恢复及时返回预算错误；原始配置仍保留并可导出，既有 stars、challengeV3 成绩和 localStorage 内容不变，没有半导入材料。
- 设置预算 256，分别验证单规则两组 count:200、import 两条 count:200 规则及 create 初始两条规则都明确拒绝；import 与 register 失败时配置、revision 保持不变。将可信预算提高至 400 后，两条规则正常注册。

该问题已关闭。

## 已独立验证的行为

- **显式规则失配不吞料。** 实际 V3 混合机绑定 `T×3 / join`，缓存为 `T@TL + C@BL`，推进 50 tick 后两输入仍在原队列，无 proc/outA，物理 ID 多重集完全相同；不存在默认二输入回退消费。
- **缺失规则不吞料。** 同样缓存绑定不存在的规则，推进 20 tick 后输入和 ID 多重集不变。
- **停用及替换使运行时缓存失效。** 在上述已经缓存失配结果的机器上，将同 ID 规则替换为已停用的 `T+C / join`，下一 tick 返回 rule-disabled 并保留输入；随后替换为启用版本，下一 tick 即开始加工，原队列清空且 ID 多重集守恒。
- **动态变材保持可信身份和物理来源。** 原始同源 T 原坯纵切后，一半通过真实机器上的单输入 transform 规则变成 glass。输出仍被 `PetalV3.validItem` 接受，每个单元为 `shapeKind:glass, originKind:T`，ID 不变；可与同源但尚未变材的另一半继续合成为四单元产物。对象展开伪造和重复输入均被拒绝。
- **多层旋转、切割和重组守恒。** 完整 T 与完整 C 自动合成两层结构，旋转后横切，两份输出 ID 并集与原产物完全相同；重新合成后的结构与旋转前述产物匹配。
- **消费提交与背压。** 代码审查确认 select 选择后由门面再次校验、合成；结果成功且每个来源引用存在后才移除真实容器中的输入。两入口和旧 autoHalves 使用携带容器引用的统一候选视图。加工中及输出未清空时不会启动下一批合成。
- **存档和蓝图。** 原子导入失败路径在写 G.save 和 persist 前抛错；失效扩展恢复保留原配置并可导出。蓝图 clone/rotate/mirror/export/import/paste 保留 ruleId，粘贴无绑定规则的蓝图显式传空 ID，避免继承当前工具绑定。Undo 保留规则字段。旧 half/final 映射 join，未恢复阶段或目标白名单。
- **物料统计和拆除。** 两队列、旧内部半块、加工中 shape/shapeB 及两输出均进入物理 ID 统计；拆除保留废弃记录。resetMaterial 清理队列、内部半块和匹配缓存，并重建供料批次。

## 本次执行结果

以下命令全部退出 0：

```text
node test-synthesis-runtime.js       ALL_SYNTHESIS_RUNTIME_PASS
node test-synthesis-persistence.js   ALL_SYNTHESIS_PERSISTENCE_PASS
node test-synthesis-classic.js       ALL_SYNTHESIS_CLASSIC_PASS
node test-blueprint-file.js          ALL_BLUEPRINT_FILE_TESTS_PASS
node test-demolition.js              ALL_DEMOLITION_TESTS_PASS
node test-petal-v3.js                ALL_PETAL_V3_PASS
```

另运行了上文六组独立 VM 反例/断言，全部通过。修复稳定后重新执行 runtime、persistence、classic、petal 四根测试，全部退出 0，并执行上述配置 API/UI/存档恢复与累计预算探针。未重复运行父代理已经执行的全部 25 根测试；未进行浏览器、发行包或 derive 审查。

最终结论：本次审查发现的 1 项 P2 已修复并独立复测关闭；审查范围内剩余可复现 P1 为 0，P2 为 0。上述结论限于已列明的代码和验证边界，不代表全部未来扩展规则的数学证明。
