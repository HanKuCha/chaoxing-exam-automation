# chaoxing-exam-automation

给 DeepSeek Harness（DSH）用的技能：在你已登录的 Chromium 里接管一场**学习通 / 超星（chaoxing）**考试——过说明页、读题、勾选、复核、交卷。

实测环境：Chrome + `bsk_*` 浏览器工具，考试入口 `mooc1-api.chaoxing.com/exam-ans/exam/test/examcode/examnotes`，答题页 `mooc1-api.chaoxing.com/exam-ans/mooc2/exam/preview`。

## 为什么需要单独一个技能

学习通考试页有几个反直觉的地方，踩过一遍才知道：

1. **题目在 iframe 里**。主文档的 `document.querySelector`、`bsk_interact` 的 CSS selector、`evaluate` 全都够不到选项。只有 `bsk_inspect extract` 和带 `qid` 属性的选择器能穿透。
2. **选项不是 `input[type=radio]`**。真实结构是 `div.answerBg[onclick="saveSingleSelect(this,'<qid>')"]` 包着 `span.num_option[qid][data]`，选中态是 class 里出现 `check_answer`。VOM 里的 `[unchecked]` 不可信。
3. **点击坐标会落错**。点 VOM 的 radio 节点，坐标落在选项文字上，`onclick` 不触发，但工具回执照样显示"已点击"。
4. **页面每秒在变**。倒计时刷新 + 第三方搜题浮层持续改写 DOM，任何非定向动作都会被 "observed content changed" 拒绝；只有 `target` + `dependsOn` 的点击能稳定落地。
5. **回执成功 ≠ 生效**。必须用 extract 复核真实选中态，不能凭点击回执下结论。

## 安装

### 作为 DSH 技能

DSH 实时扫描的用户级技能根是 **`~/.dsh/skills`**（项目级是 `<工作区>/.dsh/skills`），放进去即生效，不用重启、不用改 `settings.yaml`：

```powershell
$dst = "$env:USERPROFILE\.dsh\skills\chaoxing-exam-automation"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy . $dst /E /XD .git /NFL /NDL /NJH /NJS /NP
```

或直接 `git clone https://github.com/HanKuCha/chaoxing-exam-automation.git "$env:USERPROFILE\.dsh\skills\chaoxing-exam-automation"`（clone 进来的 `.git` 不影响扫描）。

注意两个**不是**扫描根的路径，别装错：

| 路径 | 实际情况 |
|---|---|
| `~/.dsh/profiles/<profile>/skills/` | 该目录里的技能来自插件 `customSkillDirs` 的副本，不是扫描来源 |
| `~/.dsh/plugins/*/skills/` | 随插件分发的同名副本，改动不会生效 |

验证是否装好：对 DSH 说一句"用 chaoxing-exam-automation 技能"，能加载出完整 `SKILL.md` 即成功；技能列表里应能看到 `chaoxing-exam-automation`。

### 依赖

- DSH 桌面版 + 已注入的 `bsk_*` 工具（`browser-skill`）
- Node.js 18+（只有复核脚本需要，零依赖）

## 用法

装好后对 DSH 说"帮我做一下这份学习通考试"即可触发；也可以手动按 `SKILL.md` 的阶段走。

交卷前复核：

```bash
# 从 bsk_inspect extract 的返回存成 extract.json
node scripts/verify-answers.mjs --extract extract.json --emit-key key.json   # 生成答案模板
node scripts/verify-answers.mjs --extract extract.json --key key.json        # 逐题比对
```

输出示例：

```
#   qid          选项            已选    应为    结果
1   886801693    A/B/C/D         A       A       OK
...
9   886801701    A/B/C/D         A       B       MISMATCH
15  886801707    true/false      -       false   UNANSWERED
----------------------------------------------------------------
发现 2 处问题，先修正再交卷：
  第 9 题 (qid 886801701) [MISMATCH] 点了 A，应为 B
    target: span.num_option[qid="886801701"][data="B"]
```

答案表支持三种写法：

```json
{ "order": ["A", "B", "B", "C", "A", "B", "B", "A", "B", "A", "true", "false", "true", "true", "false"] }
{ "byIndex": { "1": "A", "2": "B" } }
{ "byQid": { "886801693": "A", "886801694": "B" } }
```

判断题可写 `true`/`false`，也可写 `对`/`错`、`√`/`×`；单选题大小写不敏感。

退出码：`0` 全部一致 / `1` 有问题 / `2` 参数或文件错误。

## 目录

```
SKILL.md                     主流程（阶段 0 侦察 → 1 进入 → 2 读取 → 3 作答 → 4 复核 → 5 交卷）
references/chaoxing-dom.md   真实 DOM、选择器、滑块验证码结构、交卷弹窗
references/bsk-pitfalls.md   bsk 工具在该页上的 8 类坑与错误速查表
scripts/verify-answers.mjs   交卷前逐题复核
scripts/fixtures/            回归测试数据（真实提取结果的脱敏副本）
```

## 回归测试

```bash
node scripts/verify-answers.mjs --extract scripts/fixtures/extract-sample.json --key scripts/fixtures/answer-key.json
# 期望：全部 15 题与答案表一致，可以交卷；退出码 0
```

`scripts/fixtures/extract-broken.json` 是故意做坏的样本（第 9 题错选、第 15 题漏答），对应期望输出 2 处问题、退出码 1。

## 边界

- 滑块拼图验证码**不尝试自动破解**：背景图是自然照片，列像素统计无法定位缺口；单段位移拖动会被判为机器轨迹并刷新图片。技能里直接转人工（`bsk_assist request-help`），这是最快路径。
- 只操作用户本人账号、用户明确指定的那份试卷；不导出 cookie/token，不调成绩接口，不碰他人作答记录。
- 答案正确性由答题者负责。本技能解决的是"怎么在这套页面上点得动、点得准、点完能验"，不是"选什么是对的"。

## License

MIT
