# 可直接粘贴的命令模板

把 `<SID>` 换成 `bsk_session start` 返回的 sessionId，`<CTX>` 换成最近一次 sync 返回的 `context_id`。
一次 context 只能用于一个动作，动作后必须重新 sync。

## 侦察

```text
bsk_session({"action":"start"})
bsk_tabs({"action":"list","scope":"user"})
bsk_tabs({"action":"borrow","tabId":<考试标签ID>})
bsk_session({"action":"sync","maxTokens":6000})
```

## 进入考试

```js
// evaluate，说明页上没有倒计时，可以用
const el = document.querySelector('div.face_agreement i.agree_check');
if (!el.className.includes('agree_checked')) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}
document.getElementById('startBtn').click();
```

滑块出现后（**默认：用户没说让你自己进，就走这条**）：

```text
bsk_assist({"action":"request-help","prompt":"请手动拖动滑块完成安全验证"})
bsk_session({"action":"wait-user"})
bsk_session({"action":"sync","settle":true})
```

只有用户明确授权「你自己进考试」时，才允许自己试：

```text
bsk_interact({"action":"drag","session":"<SID>","contextId":"<CTX>",
  "target":"#cx_rightBtn","deltaX":<缺口X>,"durationMs":900})
```

失败会刷新图片，最多 4 次，仍不过就回到 request-help。

## 读全部作答状态

```text
bsk_inspect({
  "action":"extract","session":"<SID>",
  "selector":"body","itemSelector":"div.answerBg",
  "extractKind":"list","maxRows":60,
  "extractFields":"{\"fields\":[{\"key\":\"qid\",\"selector\":\"span.num_option\",\"read\":\"attribute\",\"attribute\":\"qid\"},{\"key\":\"data\",\"selector\":\"span.num_option\",\"read\":\"attribute\",\"attribute\":\"data\"},{\"key\":\"cls\",\"selector\":\"span.num_option\",\"read\":\"attribute\",\"attribute\":\"class\"}]}"
})
```

读题干：

```text
bsk_session({"action":"sync","maxTokens":6000})
```

## 选一个选项

```text
bsk_session({"action":"sync","maxTokens":80,"settle":true})
bsk_interact({"action":"click","session":"<SID>","contextId":"<CTX>",
  "target":"span.num_option[qid=\"<QID>\"][data=\"<A|B|C|D|true|false>\"]",
  "dependsOn":["span.num_option[qid=\"<QID>\"][data=\"<目标值>\"]"]})
```

## 复核通过后的默认收尾（不交卷）

```text
bsk_inspect({"action":"screenshot","session":"<SID>"})
```

然后正文告诉用户：全部题目已作答并核对无误，等你确认后自己点交卷。**不要 stop 会话**——用户可能要你看着。

## 交卷（仅在用户明确授权「答完帮我交卷」时）

```text
bsk_session({"action":"sync","maxTokens":3000})
bsk_interact({"action":"click","contextId":"<CTX>","target":"@e4","dependsOn":["@e3","@e4"]})
bsk_session({"action":"sync","maxTokens":800})
bsk_interact({"action":"click","contextId":"<CTX>","target":"@e3","dependsOn":["@e3","@e4"]})
bsk_inspect({"action":"screenshot","session":"<SID>"})
bsk_session({"action":"stop","session":"<SID>"})
```

## 复核脚本

```bash
node scripts/verify-answers.mjs --extract extract.json --emit-key key.json
node scripts/verify-answers.mjs --extract extract.json --key key.json
```
