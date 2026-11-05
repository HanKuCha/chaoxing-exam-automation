# 学习通考试页的真实结构

实测环境：2026-11-05，Chrome + bsk 工具，考试入口
`https://mooc1-api.chaoxing.com/exam-ans/exam/test/examcode/examnotes?examId=...&courseId=...&classId=...&cpi=...`

## 三层页面

```
主文档  examnotes（说明页 / 外层壳）
  └─ iframe  https://mooc1-api.chaoxing.com/exam-ans/mooc2/exam/preview
             ?courseId=&classId=&start=0&cpi=
             &examRelationId=<examId>
             &examRelationAnswerId=<answerId>
             &newMooc=true&openc=<token>
             &monitorStatus=0&monitorOp=-1
             &remainTimeParam=<秒>
             &relationAnswerLastUpdateTime=<ms>
             &enc=<校验串>
```

关键后果：主文档 `document.querySelector(...)`、`bsk_interact` 的 CSS selector、`evaluate` 全部**够不到** iframe 内部的题目节点。`bsk_inspect extract` 是唯一能穿透的读取通道；点击要么用 VOM ref（`@eNN`），要么用带 `qid` 的精确 selector（工具会跨 frame 解析）。

iframe 的 `src` 里带 `enc` 校验串，直接拼 URL 跳转会被打回「无权限访问」。

## 说明页（进入考试前）

| 元素 | 选择器 | 说明 |
|---|---|---|
| 同意勾选 | `div.face_agreement > i.agree_check` | 点击只切 class，加 `agree_checked` |
| 开始按钮 | `#startBtn` | 需先勾同意 |
| 确认弹窗 | `#confirmEnterWin` | 文案含「本次考试答题时长为 N 分钟…」 |
| 弹窗内进入 | 弹窗中的「进入考试」按钮 | 点完出滑块验证码 |

`i.agree_check` 的合成坐标点击无效，必须派发事件：

```js
const el = document.querySelector('div.face_agreement i.agree_check');
if (!el.className.includes('agree_checked')) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}
```

## 滑块验证码（chaoxing captcha）

结构（尺寸为 CSS px，坐标以视口左上角为原点）：

| 组件 | 选择器 | 尺寸 / 位置 |
|---|---|---|
| 容器 | `#eject.u-captcha.u-layer` | 352×302 @ (404,176) |
| 图片区 | `#cx_image_margin` | 320×218 @ (419,243) |
| 背景图 | `#cx_imgBg` | 320×160，背景图 `https://captcha-b.chaoxing.com/slide/big/<HASH>.jpg?t=<n>` |
| 拼图块 | `#cx_imgBtn` | 44×171，内含 56×160 的 IMG |
| 缺口层 | `#cx_obstacle_canvas` | canvas 320×160，**像素读取全透明，无法定位缺口** |
| 轨道 | `#cx_hkinnerWrap` | 320×42 @ (419,419) |
| 拖动按钮 | `#cx_rightBtn` | 40×40 @ (420,420) |

实测结论：把背景图以 `crossOrigin='anonymous'` 载入 canvas 后按列统计暗像素，命中范围铺满 0–319（自然照片噪点），定位失败；直接 `bsk_interact drag` 单段位移也会被判定为机器轨迹并刷新图片。**这一关交给人工**，用 `bsk_assist({ action: "request-help" })` 请用户拖一次，比在算法上硬碰省时间。

## 答题页（整卷预览）

外层壳（主文档可见）：`@e3` 返回、`@e4` 交卷、`@e5` 倒计时、`@e6` 题量信息、每题一个「标记」按钮。
**注意**：VOM 里题目选项以 `role=radio` 呈现，`[unchecked]` 与真实选中态无关，不要据此判断。

iframe 内真实 DOM：

```html
<div id="sigleQuestionDiv_<qid>">
  <h3>…题干…</h3>
  <form>
    <div>
      <div class="clearfix answerBg" tabindex="0" role="radio"
           onclick="saveSingleSelect(this,'<qid>')">
        <span class="saveSingleSelect choice<qid> num_option  fl check_answer"
              data="A" qid="<qid>">A</span>
        <div class="... answer_p">选项文字</div>
      </div>
      … B/C/D 或 true/false …
    </div>
  </form>
</div>
```

- 选中态 = `span.num_option` 的 class 里含 **`check_answer`**。
- 单选 `data` = `A|B|C|D`；判断 `data` = `true|false`（true=对，false=错）。
- 选项是 **toggle**：点已选中的项会取消选择。
- 外层 `div.answerBg` 才是 `onclick` 宿主，但坐标点它容易落在文字上而不触发；直接点 `span.num_option[qid][data]` 最稳。

逐题定位模板（extract 的 `row_sources.locator` 会给出来）：

```
#sigleQuestionDiv_<qid> > form:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(N)
```

N=1..4 对应 A..D（判断题 N=1 是 true，N=2 是 false）。

## 交卷

- 主文档 `@e4` = 「交卷」链接。
- 点击后出现 `alertdialog`：`提示` / `确认交卷？` / `@e3` 确定 / `@e4` 取消。
- 成功后整页换成「交卷成功」，列出姓名、学号、领取时间、提交时间、考试用时、提交方式「学生交卷」，常见附注「本试卷考后不允许查看」。
