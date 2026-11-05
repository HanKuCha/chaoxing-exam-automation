---
name: chaoxing-exam-automation
description: Use when the user asks to take or answer a Chaoxing (学习通 / 超星 / mooc1-api.chaoxing.com) exam in their own logged-in browser — entering the exam past the agreement gate and slider captcha, reading all questions out of the exam preview iframe, selecting answers by real DOM selector, verifying every choice before submitting, and clicking 交卷.
---

# 学习通 / 超星 考试自动答题

一套在用户已登录 Chromium 里跑通的固定流程。核心结论先说：

- 考试正文**在 iframe 里**，主文档的 CSS 选择器、`evaluate` 里的 `document.querySelectorAll` 全部够不到题目。
- 选项不是 `input[type=radio]`，而是 `div.answerBg` + `span.num_option`，选中态是 **class 里出现 `check_answer`**。
- 页面有每秒刷新的倒计时 + 第三方插件，任何**非定向**动作都会被 "observed content changed" 顶掉；只有「精确 selector + `dependsOn`」的点击能稳定生效。
- 唯一可靠的读写组合是：`bsk_inspect extract` 读、`bsk_interact click` 写、再 extract 复核。

先读 [学习通页面结构](references/chaoxing-dom.md) 拿选择器，卡住时读 [bsk 工具坑位](references/bsk-pitfalls.md)。

## 阶段 0 — 侦察（不要跳过）

```text
bsk_session({ action: "start" })
bsk_tabs({ action: "list", scope: "user" })
bsk_tabs({ action: "borrow", tabId: <考试标签> })
bsk_session({ action: "sync", maxTokens: 6000 })
```

从页面 HTML 里先抠出这些隐藏字段，后面每一步都要用：

| 字段 | 用途 |
|---|---|
| `examId` / `examRelationId` | 试卷 ID |
| `answerId` / `examRelationAnswerId` | 本次作答记录 ID |
| `courseId` / `classId` / `cpi` | 上下文参数 |
| `limitTime` | 考试时长（分钟） |
| `expiredAutoSubmit` | 到时自动交卷（通常 1） |
| `forbidMultiterminal` | 禁止多端（1 时别开第二个窗口） |

同时记下 `bsk_inspect extract discover` 返回的 `frame_id` 和 `frame_url`——那就是真正的答题页地址，形如
`https://mooc1-api.chaoxing.com/exam-ans/mooc2/exam/preview?...&examRelationId=...&examRelationAnswerId=...&enc=...`。

## 阶段 1 — 进入考试

说明页（`pageType=examnotes`）的进入顺序固定，且**不要**去拼 `reVersionTestStartNew` 的 URL 直接跳转，缺校验令牌会得到「无权限访问」。

1. 勾选同意。`div.face_agreement > i.agree_check` 只切 CSS class，合成坐标点击无效，用事件派发：

```js
const el = document.querySelector('div.face_agreement i.agree_check');
if (!el.className.includes('agree_checked')) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}
```

2. 点开始：`document.getElementById('startBtn').click();`
3. 确认弹窗 `#confirmEnterWin` 出现后点「进入考试」。
4. 出现滑块验证码时**立刻转人工**：`bsk_assist({ action: "request-help", prompt: "请手动拖动滑块完成安全验证" })`，然后 `bsk_session({ action: "sync" })` 等用户做完。图像像素分析在本平台验证失败（见 references），不要浪费时间重试。
5. 进入后页面标题变成「整卷预览」，左侧倒计时开始走。

## 阶段 2 — 一次性读出全部题目与作答状态

`bsk_inspect extract` 能穿透 iframe，这是本流程的基石：

```text
bsk_inspect({
  action: "extract",
  session: "<id>",
  selector: "body",
  itemSelector: "div.answerBg",
  extractKind: "list",
  maxRows: 60,
  extractFields: "{\"fields\":[
    {\"key\":\"qid\",\"selector\":\"span.num_option\",\"read\":\"attribute\",\"attribute\":\"qid\"},
    {\"key\":\"data\",\"selector\":\"span.num_option\",\"read\":\"attribute\",\"attribute\":\"data\"},
    {\"key\":\"cls\",\"selector\":\"span.num_option\",\"read\":\"attribute\",\"attribute\":\"class\"}
  ]}"
})
```

每行输出 `qid / data / cls`。判定规则：

- `cls` 含 **`check_answer`** → 该项已被选中。
- 单选题 `data` ∈ `A B C D`；判断题 `data` ∈ `true false`（`true` = 对，`false` = 错）。
- 按 `qid` 首次出现的顺序即为题号顺序（本平台实测从 `88680169X` 开始连续递增）。

读完整张卷的题干文字用一次 `sync`（`maxTokens` ≥ 5000）即可，observation 会列出 `@eNN radio "<选项文字>"`。**注意**：VOM 里的 `[unchecked]` 一律不可信，实际选中态只认 extract 的 `check_answer`。

## 阶段 3 — 答题

每题只有一个正确项时，按下面循环，**一次只做一个动作**：

```text
bsk_session({ action: "sync", maxTokens: 60, settle: true })   // 只拿 context_id
bsk_interact({
  action: "click",
  session: "<id>",
  contextId: "<刚拿到的>",
  target: "span.num_option[qid=\"<QID>\"][data=\"<A|B|C|D|true|false>\"]",
  dependsOn: ["span.num_option[qid=\"<QID>\"][data=\"<目标值>\"]"]
})
```

要点：

- **点内层 `span.num_option`，不要点外层 `div.answerBg` 的文字区**。点外层时坐标落在文本上，`onclick="saveSingleSelect(this,'<qid>')"` 不触发，回执却是成功。
- `dependsOn` 必须带上目标选择器本身；否则倒计时/插件抖动会让动作被拒。
- 报 "The action's observed content changed" 时，重新 `sync` 再点即可，通常第二次就过。**这个错误不代表点击失败**，永远用 extract 复核，不要凭回执下结论。
- 选项是 toggle：点已选中的项可能取消选择。所以写之前一定要先 extract 确认当前状态。
- 每次同步后 ref 会重排，不要跨 sync 复用 `@eNN`。

## 阶段 4 — 交卷前复核（强制）

再跑一次阶段 2 的 extract，把 50 行结果整理成 `qid → 选中项`，与答案表逐题比对：

```text
node scripts/verify-answers.mjs --extract extract.json --key answer-key.json
```

脚本输出 `OK` / `MISMATCH` / `UNANSWERED` 三类；只要出现后两类就回到阶段 3 修正，再复核一次。全部 OK 才允许交卷。

## 阶段 5 — 交卷

```text
bsk_session({ action: "sync", maxTokens: 3000 })
bsk_interact({ action: "click", contextId: "<id>", target: "@e4", dependsOn: ["@e3","@e4"] })  // 「交卷」
bsk_session({ action: "sync", maxTokens: 800 })   // 弹窗变成 alertdialog「确认交卷？」
bsk_interact({ action: "click", contextId: "<id>", target: "@e3", dependsOn: ["@e3","@e4"] })  // 「确定」
```

成功标志（页面证据，不是回执）：标题「交卷成功」，并列出姓名、学号、领取时间、提交时间、考试用时、提交方式「学生交卷」。截一张 `bsk_inspect screenshot` 存档。

最后 `bsk_session({ action: "stop", session: "<id>" })` 归还标签页。

## 失败处理

| 现象 | 处置 |
|---|---|
| `ref @eNN unknown for tab` | 该次 sync 的 `maxTokens` 太小，ref 表被截断。用 ≥ 5000 重新 sync。 |
| `did not match any element` | 元素在 iframe 里，主文档选择器无效。改用 extract 读、或 `@eNN` ref。 |
| `requires the context returned by the latest cooperate sync` | 上一动作已消耗 context，中间必须重新 sync。 |
| 连续多次 "observed content changed" | 先 `settle: true` sync；仍失败就换 `span.num_option` 精确选择器，别用坐标。 |
| 用户滚动/切窗口 | `state.mode` 会变 `human`，动作失效。`wait-user` → sync → 重新规划。 |
| 倒计时归零 | 平台自动交卷，之后只做结果取证，不要再尝试改答案。 |

## 合规边界

只在用户本人的账号、用户明确要求作答的那份试卷上操作；不导出 cookie/token，不改成绩接口，不碰他人作答记录。分数与答案正确性由答题者负责——本技能解决的是"怎么点得动"，不是"选什么是对的"。
