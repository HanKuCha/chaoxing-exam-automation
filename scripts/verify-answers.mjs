#!/usr/bin/env node
/**
 * verify-answers.mjs — 交卷前复核学习通答题卡
 *
 * 用法：
 *   node verify-answers.mjs --extract extract.json --key answer-key.json
 *   node verify-answers.mjs --extract extract.json --emit-key key-template.json
 *   node verify-answers.mjs --extract extract.json            # 只打印当前选中情况
 *
 * extract.json 直接保存 bsk_inspect extract 的完整返回（含 rows）。
 * answer-key.json 支持三种写法，任选其一：
 *   { "order": ["A","B","B","C", ... ] }            // 按题号顺序
 *   { "byIndex": { "1": "A", "2": "B", ... } }      // 题号 → 答案
 *   { "byQid": { "886801693": "A", ... } }          // qid → 答案
 *
 * 退出码：0 = 全部正确；1 = 存在 MISMATCH/MULTI/UNANSWERED/缺 key；2 = 参数或文件错误。
 */

import { readFileSync, writeFileSync } from 'node:fs';

const SELECTED_CLASS = 'check_answer';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}

function loadJson(path, what) {
  try {
    // Windows 上 PowerShell / 记事本保存的 UTF-8 常带 BOM，先剥掉再解析
    const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (e) {
    fail(`读取 ${what} 失败 (${path}): ${e.message}`);
  }
}

/** 从 extract 返回里抽出 [{qid, data, selected}]，保持文档顺序 */
function rowsFromExtract(doc) {
  const rows = Array.isArray(doc?.rows) ? doc.rows : Array.isArray(doc) ? doc : null;
  if (!rows) fail('extract.json 里找不到 rows 数组，请传入 bsk_inspect extract 的完整返回');

  return rows.map((r, i) => {
    const cls = r.cls ?? r.class ?? '';
    const qid = String(r.qid ?? '');
    const data = String(r.data ?? '');
    if (!qid) fail(`第 ${i + 1} 行缺少 qid 字段`);
    return { qid, data, selected: String(cls).split(/\s+/).includes(SELECTED_CLASS) };
  });
}

/** 按 qid 首次出现顺序聚合成题目列表 */
function groupByQuestion(rows) {
  const order = [];
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.qid)) {
      map.set(row.qid, { qid: row.qid, options: [] });
      order.push(row.qid);
    }
    map.get(row.qid).options.push(row);
  }
  return order.map((qid) => {
    const q = map.get(qid);
    const picked = q.options.filter((o) => o.selected);
    return {
      qid,
      options: q.options.map((o) => o.data),
      selected: picked.map((o) => o.data),
    };
  });
}

function normalizeAnswer(v) {
  const s = String(v).trim();
  if (/^(true|t|对|√|正确)$/i.test(s)) return 'true';
  if (/^(false|f|错|×|错误)$/i.test(s)) return 'false';
  return s.toUpperCase();
}

function buildKey(keyDoc, questions) {
  if (Array.isArray(keyDoc.order)) {
    return new Map(
      keyDoc.order.map((ans, idx) => [questions[idx]?.qid ?? `#${idx + 1}`, normalizeAnswer(ans)])
    );
  }
  if (keyDoc.byQid) {
    return new Map(Object.entries(keyDoc.byQid).map(([q, a]) => [String(q), normalizeAnswer(a)]));
  }
  if (keyDoc.byIndex) {
    const m = new Map();
    for (const [idx, ans] of Object.entries(keyDoc.byIndex)) {
      const q = questions[Number(idx) - 1];
      if (q) m.set(q.qid, normalizeAnswer(ans));
      else console.warn(`warn: 答案表里的第 ${idx} 题在本卷中不存在，已忽略`);
    }
    return m;
  }
  fail('answer-key.json 需要 order / byQid / byIndex 之一');
}

function pad(s, n) {
  const w = [...String(s)].reduce((acc, ch) => acc + (/[\u4e00-\u9fff]/.test(ch) ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.extract) fail('缺少 --extract <path>');

  const extractDoc = loadJson(args.extract, 'extract');
  const questions = groupByQuestion(rowsFromExtract(extractDoc));

  if (questions.length === 0) fail('extract 里没有任何题目行，检查 itemSelector 是否为 div.answerBg');

  if (args['emit-key']) {
    const tpl = { order: questions.map(() => '') };
    writeFileSync(args['emit-key'], JSON.stringify(tpl, null, 2) + '\n', 'utf8');
    console.log(`已生成答案模板 ${args['emit-key']}，共 ${questions.length} 题，请按题号顺序填写。`);
    console.log(`qid 顺序：${questions.map((q) => q.qid).join(', ')}`);
    return 0;
  }

  const keyDoc = args.key ? loadJson(args.key, '答案表') : null;
  const key = keyDoc ? buildKey(keyDoc, questions) : null;

  const bad = [];
  console.log('');
  console.log(`${pad('#', 4)}${pad('qid', 13)}${pad('选项', 16)}${pad('已选', 8)}${pad('应为', 8)}结果`);
  console.log('-'.repeat(64));

  questions.forEach((q, idx) => {
    const n = idx + 1;
    let verdict = 'UNANSWERED';
    const want = key ? key.get(q.qid) : undefined;

    if (q.selected.length === 1) {
      if (!key) verdict = 'ANSWERED';
      else if (want === undefined) verdict = 'NO-KEY';
      else verdict = q.selected[0] === want ? 'OK' : 'MISMATCH';
    } else if (q.selected.length > 1) {
      verdict = 'MULTI';
    } else if (key && want !== undefined) {
      verdict = 'UNANSWERED';
    }

    if (verdict !== 'OK' && verdict !== 'ANSWERED') bad.push({ n, ...q, want, verdict });

    console.log(
      pad(n, 4) +
        pad(q.qid, 13) +
        pad(q.options.join('/'), 16) +
        pad(q.selected.join(',') || '-', 8) +
        pad(want ?? '-', 8) +
        verdict
    );
  });

  console.log('-'.repeat(64));
  if (!key) {
    console.log('未提供 --key：仅展示当前选中情况。用 --emit-key 生成模板后可做逐题比对。');
    return 0;
  }
  if (bad.length === 0) {
    console.log(`全部 ${questions.length} 题与答案表一致，答题完成。`);
    console.log('下一步：停手并通知用户交卷（本技能不自动交卷，除非用户明确授权）。');
    return 0;
  }
  console.log(`发现 ${bad.length} 处问题，先修正再复核：`);
  for (const b of bad) {
    const hint =
      b.verdict === 'MISMATCH'
        ? `点了 ${b.selected.join(',')}，应为 ${b.want}`
        : b.verdict === 'MULTI'
          ? `一题多选：${b.selected.join(',')}`
          : b.verdict === 'UNANSWERED'
            ? `未作答，应为 ${b.want}`
            : '答案表缺少该题';
    console.log(`  第 ${b.n} 题 (qid ${b.qid}) [${b.verdict}] ${hint}`);
    if (b.verdict === 'MISMATCH') {
      console.log(
        `    target: span.num_option[qid="${b.qid}"][data="${b.want}"]`
      );
    }
  }
  return 1;
}

process.exit(main());
