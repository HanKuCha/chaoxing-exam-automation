# bsk 工具在抖页上的坑位

学习通答题页有倒计时每秒刷新、还有第三方「搜题」浮层持续改写 DOM，导致工具的一致性校验频繁失败。以下是实测有效的规避方式。

## 1. 一次 sync = 一个动作

`bsk_session sync` 返回的 `context_id` 只能用在一个动作上，动作结束（无论成败）都要重新 sync。
跳过 sync 直接用旧 context 会得到：

```
This action requires the context returned by the latest cooperate sync
```

## 2. maxTokens 决定 ref 表完整性

`sync` 的 observation 会被 `maxTokens` 截断，`ref_count` 随之变小。

- `maxTokens: 200` → `ref_count: 5`，ref 只到 `@e5`，用 `@e8` 报 `ref @e8 unknown for tab 1826082183`
- `maxTokens: 5000~6000` → `ref_count: 48~86`，整卷 ref 齐全

策略：需要读题用 5000+；只需要一个 `context_id` 做点击时用 50~80 足够。

## 3. evaluate 在这种页面上不可用

```text
bsk evaluate failed: The action's observed content changed; synchronize and replan
```

原因：`evaluate` 是 untargeted 动作，走整页校验，倒计时每秒变一次，永远过不去。`dependsOn` 对它无效（且 >16 个 ref 会报 `depends_on requires at most 16 observed refs/selectors`）。

结论：**批量勾选不要走 evaluate**。要写多个值就一个个 click，或者接受 `evaluate` 只用于进入前那些无倒计时的页面。

## 4. click 必须带 dependsOn

```json
{
  "action": "click",
  "contextId": "<sync 返回>",
  "target": "span.num_option[qid=\"886801701\"][data=\"B\"]",
  "dependsOn": ["span.num_option[qid=\"886801701\"][data=\"B\"]"]
}
```

不带 `dependsOn` 时，倒计时/浮层一动就被拒。带了之后即使仍报 "observed content changed"，重试一次通常就成功。

**回执成功 ≠ 点击生效**：实测出现过 `clicked at (637, 231.8)` 但 extract 显示该题仍未选中的情况。所有写入都要用 extract 复核。

## 5. 坐标会落到错误的元素

- 点 `@e8`（role=radio 的 VOM 节点）→ 坐标 (637, 231.8) 落在选项文字上，外层 `div.answerBg` 的 `onclick` 不触发。
- 点 `span.num_option[qid][data]` → 坐标 (339.8, 325.4) 落在选项圆点上，正常触发 `saveSingleSelect`。

## 6. selector 与 iframe

`dependsOn: ["input[type=radio]"]` 报 `did not match any element`，因为考试页在 iframe 里且选项根本不是 `input`。
主文档 `ul.stem_answer li:nth-child(1)` 之类同样无效。
带 `qid` 属性的选择器（工具内部会跨 frame 解析）与 `bsk_inspect extract` 是唯一可靠的两条路。

## 7. 人的操作会让动作失效

用户滚动、切窗口时 `state.mode` 变 `human`，`settle` 返回 `not_ready`。此时：

```text
bsk_session({ action: "wait-user" })
bsk_session({ action: "sync", settle: true })
```

然后重新规划，不要重放上一个动作。

## 8. 高频错误速查

| 错误原文 | 含义 | 处置 |
|---|---|---|
| `The action's observed content changed; synchronize and replan` | 观测后页面变了 | 重新 sync，加/改 dependsOn，重试 |
| `ref @eNN unknown for tab` | ref 不在本次 observation 里 | 增大 maxTokens 重新 sync |
| `did not match any element` | 选择器没匹配到（frame/结构不符） | 换 `qid` 选择器或 ref |
| `requires the context returned by the latest cooperate sync` | context 已消耗 | 重新 sync |
| `depends_on requires at most 16 observed refs/selectors` | dependsOn 太长 | 只挑目标区附近的 |
| `action may already have completed; inspect the step receipt` | step 动作结果不确定 | **不要重放**，先 extract 看实际状态 |
