# Changelog

所有改动按 [Semantic Versioning](https://semver.org/lang/zh-CN/) 记录。

## [1.1.0] — 2026-11-05

行为变更：把两处"默认替用户做"改成"默认交给用户"，并写成技能最前面的硬门禁。

### Changed

- **门禁 1 · 谁进考场**：进考试默认由用户完成（技能只把说明页准备好），滑块验证码默认转人工。
  只有用户在指令里明确说了"你自己进考试"这类授权，才允许技能自己 `bsk_interact drag` 拉滑块，且最多 4 次，不过仍转人工。
  原来是无条件直接转人工，现在是"默认转人工 + 明确授权才可自试"。
- **门禁 2 · 谁点交卷**：复核通过后**停手**，报告"已做完、等你交卷"，保持会话不退出。绝不自动点「交卷」和确认弹窗。
  只有用户明确说了"答完帮我交卷 / 做完直接提交"才执行阶段 5。
  原来阶段 4 → 阶段 5 是一条无门禁的直线，现在中间插了强制停止点。
- `SKILL.md` 新增「两个硬门禁」章节，位置在核心结论之后、阶段 0 之前，声明其优先级高于后续所有阶段。
- `scripts/verify-answers.mjs` 的通过文案从「全部 N 题与答案表一致，可以交卷。」改为「…答题完成。」+ 提示等待用户交卷；失败文案改为「先修正再复核」。退出码语义不变。
- `references/commands.md` 新增「复核通过后的默认收尾（不交卷）」段；交卷段标题改为「仅在用户明确授权时」，滑块段补上授权试拖的分支。
- `references/chaoxing-dom.md` 滑块结论按门禁 1 重述。
- `README.md` 顶部加「两个硬门禁」表与三种指令的行为对照表；「边界」一节把"不自动交卷"写明。

### Unchanged

- 阶段 0–3 的技术路线（iframe 穿透 `bsk_inspect extract`、`span.num_option[qid][data]` 精确点击、`dependsOn`、`check_answer` 判定选中）完全没动。
- 零依赖、无需构建、无需 `npm install`。

## [1.0.0] — 2026-11-05

首个版本。基于一次真实 15 题考试实操提炼。

### Added

- `SKILL.md`：五阶段流程 —— 侦察隐藏字段 → 进入考试（`agree_check` 事件派发 / `#startBtn` / `#confirmEnterWin` / 滑块）→ `bsk_inspect extract` 读全卷 → 循环点击作答 → 强制复核 → 交卷。
- `references/chaoxing-dom.md`：三层页面结构、iframe `frame_url` 参数表、说明页与滑块验证码选择器、答题页 HTML 片段、`#sigleQuestionDiv_<qid>` 定位模板、交卷弹窗。
- `references/bsk-pitfalls.md`：8 类坑与错误速查表（一次 sync 一个动作、`maxTokens` 决定 ref 表、`evaluate` 在抖页不可用、`click` 必须带 `dependsOn`、坐标落错元素、selector 与 iframe、人操作使动作失效）。
- `references/commands.md`：可直接粘贴的 bsk 调用模板。
- `scripts/verify-answers.mjs`：零依赖复核脚本，支持 `--emit-key`，答案表三种写法（`order` / `byIndex` / `byQid`），判断题接受 `true|false|对|错|√|×`，MISMATCH 时直接打印修正用 target，退出码 `0/1/2`。
- `scripts/fixtures/`：真实提取结果脱敏副本 + 正常/异常答案表，用于回归。
