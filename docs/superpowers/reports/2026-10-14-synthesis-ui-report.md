# 通用合成 UI 接入报告

日期：2026-10-14。范围：Task 4，UI、图标、蓝图、源码与单文件脚本接线。

## 实现

- 空机器模式、规则更改成功后才更新默认值；占用时恢复选择框并保留机器与默认设置。更改写入同组 Undo 动作，机器的 mode/ruleId 可撤销重做。
- 混合机支持自由拼接、仅平面拼接、顺序层叠；说明互补同层、重叠向最低可用层移动、A 下 B 上及多输入缓存凑齐。旧 auto/half/final 仍可读取和导入。
- 从 `PetalV3.engine.listRules()` 显示规则选择，写入 `machine.ruleId`，新放置采用 `G.v3.toolRuleId`。蓝图 clone/rotate/mirror、JSON 文件和粘贴均保留 ruleId；未注册的规则 ID 可携带，配置导入后生效。
- JSON 文本编辑器调用 `exportConfig()` / `importConfig()`，错误显示原始校验说明；失败不刷新或改变当前配置。支持文本复制导出和编辑导入，不执行配置代码。
- 图标根据注册材料的 color/outline 绘制，支持默认梯形/圆/星，以及 square、triangle、规范化 points 多边形；未知轮廓采用菱形。经典适配器的 `kind:'synthesis'` 同样使用此绘制路径。
- 按 units 的实际 layer 分组绘制全部层，轻微错位并标记真实层数。逐层面板显示每层独立图标、旋转后世界槽位、完整材料 ID 与注册名称，包括空层，不截断高层。
- `index.html` 和 `build.js` 均按照 synthesis-engine → synthesis-config → petal-v3 加载。

## TDD 与验证

先运行新增 UI 测试，确认五项预期失败：占用回滚、ruleId 蓝图变换、join/stack 模式、配置 API、层级检查。绘制测试先确认动态材料颜色断言失败。旋转层级补测先确认槽位断言失败，再修复为实际世界槽位。

最终定向执行（均退出码 0）：

- `node test-synthesis-ui.js`：11 项检查，覆盖占用回滚、蓝图变换与文件往返、旧/新模式、原子 JSON 导入、真实层号与旋转、注册规则到放置、占用规则回滚、可编辑配置、逐层名称、Undo/Redo 和脚本顺序。
- `node test-v3-ui.js`：已有 V3 界面行为与切割模式 Undo/Redo。
- `node test-render-v3.js`：已有绘制行为；动态材料 color/outline；经典 synthesis 两个真实层、错位与层数标记。
- `node test-blueprint-file.js`：已有蓝图文件兼容与安全校验。

未在此子任务中生成发行文件或做浏览器整线验证；由 Task 5 统一执行。没有提交或推送。
