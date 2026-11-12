// 生成 Wiktionnaire 离线数据：src/lib/wikt/fr-links.txt（近音 / 同音 / 同义 / 词族）和 src/lib/wikt/fr-etym.txt（词源原文）。
// 数据来源（原始文件不进仓库）：
//   kaikki.org 的法语维基词典提取（tatuylonen/wiktextract，大约每周更新）：
//   https://kaikki.org/dictionary/downloads/fr/fr-extract.jsonl.gz（压缩后约 700 MB，解压约 6.4 GB）
//   内容来自 Wiktionnaire (fr.wiktionary.org)，CC BY-SA 4.0
// 用法：node scripts/build-fr-wikt.mjs <fr-extract.jsonl.gz 的路径，或它的 https 网址>
//   流式读取：不解压到磁盘、不整个读进内存；传网址时边下载边处理，连 700 MB 的压缩包也不落盘，
//   连接中途断开会自动从断点续传。
// 规则：
//   - 只保留 fr-dict.txt 里词频大于 0 的原形；同一个词多个词性的行合并
//   - 链接词只保留在 fr-dict.txt 里出现的，按词频从高到低，每类最多 8 个
//   - 关系补成双向（A 把 B 列为近音词，B 那一行也有 A）：Wiktionnaire 里常常只有一边写了
//   - 超过目标大小时，从词频最低的原形开始丢
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';
import { norm } from '../src/lib/gender/rules.ts';

export const MAX_LINKS = 8;
export const MAX_ETYM = 300;
export const LINKS_BUDGET = 1.5 * 1024 * 1024;
export const ETYM_BUDGET = 3 * 1024 * 1024;
const COLS = ['paronyms', 'homophones', 'synonyms', 'family'];
const COL_ZH = { paronyms: '近音', homophones: '同音', synonyms: '同义', family: '词族', etym: '词源' };

const LINKS_HEADER = '# VCita Wiktionnaire 索引：原形\t近音(paronymes)\t同音(homophones)\t同义(synonymes)\t词族(dérivés / apparentés)；各列用 , 分隔，按词频从高到低，每类最多 8 个\n'
  + '# 数据：Wiktionnaire (fr.wiktionary.org, CC BY-SA 4.0)，经 kaikki.org / wiktextract 提取。由 scripts/build-fr-wikt.mjs 生成\n';
const ETYM_HEADER = '# VCita Wiktionnaire 词源：原形\t词源原文（法语，第一条，最多 300 字符）\n'
  + '# 数据：Wiktionnaire (fr.wiktionary.org, CC BY-SA 4.0)，经 kaikki.org / wiktextract 提取。由 scripts/build-fr-wikt.mjs 生成\n';

/** fr-dict.txt → 原形的词频（> 0 的）和所有形式的词频（变形按原形的词频） */
export function readDict(text) {
  const lemmas = new Map();
  const forms = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [form, , , , lemma, freq, flag] = line.split('\t');
    const f = Number(freq) || 0;
    if (flag === 'v') { if (!forms.has(form)) forms.set(form, f); continue; }
    forms.set(form, f);
    if (!lemma && f > 0) lemmas.set(form, f);
  }
  return { lemmas, forms };
}

const NO_ETYM = /^(étymologie (manquante|obscure|inconnue)|\(?date à préciser\)?\s*$|→ voir\s*$)/i;
const clean = (s) => String(s).replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const cs = [...s]; return cs.length <= n ? s : cs.slice(0, n - 1).join('').trimEnd() + '…'; };

/** 逐条喂词条（JSONL 的一行解析后的对象），最后 finish() 得到两个文件的内容和统计 */
export function createBuilder(dictText, opts = {}) {
  const { lemmas, forms } = readDict(dictText);
  const linksBudget = opts.linksBudget ?? LINKS_BUDGET;
  const etymBudget = opts.etymBudget ?? ETYM_BUDGET;
  const acc = new Map(); // 原形 → { paronyms: Set, homophones: Set, synonyms: Set, family: Set, etym }
  const slot = (k) => acc.get(k) ?? acc.set(k, { paronyms: new Set(), homophones: new Set(), synonyms: new Set(), family: new Set(), etym: '' }).get(k);
  const link = (k, col, raw) => {
    if (typeof raw !== 'string') return;
    const t = norm(raw.trim());
    if (!t || t === k || !forms.has(t)) return;
    if (lemmas.has(k)) slot(k)[col].add(t);
    if (lemmas.has(t)) slot(t)[col].add(k); // 反方向
  };
  let used = 0;

  function add(e) {
    if (!e || e.lang_code !== 'fr' || typeof e.word !== 'string') return;
    // 专有名词（Vert、Paris）不并进普通词
    if (e.word !== e.word.toLowerCase()) return;
    const k = norm(e.word.trim());
    if (!forms.has(k)) return;
    used++;
    const each = (field, col) => {
      for (const x of e[field] ?? []) link(k, col, x?.word);
      for (const s of e.senses ?? []) for (const x of s?.[field] ?? []) link(k, col, x?.word);
    };
    each('paronyms', 'paronyms');
    each('synonyms', 'synonyms');
    each('derived', 'family');
    each('related', 'family');
    for (const s of e.sounds ?? []) {
      if (typeof s?.homophone === 'string') link(k, 'homophones', s.homophone);
      for (const h of Array.isArray(s?.homophones) ? s.homophones : []) link(k, 'homophones', typeof h === 'string' ? h : h?.word);
    }
    // 词源：取第一条有内容的；变形词条（form-of）的不要
    if (lemmas.has(k) && !slot(k).etym && !(e.tags ?? []).includes('form-of')) {
      const t = (e.etymology_texts ?? []).map(clean).find((x) => x && !NO_ETYM.test(x));
      if (t) slot(k).etym = cut(t, opts.maxEtym ?? MAX_ETYM);
    }
  }

  function finish() {
    const byFreq = (a, b) => (forms.get(b) ?? 0) - (forms.get(a) ?? 0) || (a < b ? -1 : 1);
    const rows = new Map(); // 原形 → { cols: string[][], etym }
    for (const [k, v] of acc) {
      const cols = COLS.map((c) => [...v[c]].sort(byFreq).slice(0, opts.maxLinks ?? MAX_LINKS));
      if (cols.some((c) => c.length) || v.etym) rows.set(k, { cols, etym: v.etym });
    }
    // 超过目标大小：从词频最低的原形开始丢
    const fit = (lines, budget, headerLen) => {
      const order = [...lines].sort((a, b) => lemmas.get(b[0]) - lemmas.get(a[0]) || (a[0] < b[0] ? -1 : 1));
      let size = headerLen, n = 0;
      for (; n < order.length; n++) { const s = Buffer.byteLength(order[n][1]) + 1; if (size + s > budget) break; size += s; }
      return { kept: order.slice(0, n).sort((a, b) => (a[0] < b[0] ? -1 : 1)), dropped: order.length - n };
    };
    const linkLines = [...rows].filter(([, r]) => r.cols.some((c) => c.length)).map(([k, r]) => [k, [k, ...r.cols.map((c) => c.join(','))].join('\t').replace(/\t+$/, '')]);
    const etymLines = [...rows].filter(([, r]) => r.etym).map(([k, r]) => [k, `${k}\t${r.etym}`]);
    const L = fit(linkLines, linksBudget, Buffer.byteLength(LINKS_HEADER));
    const E = fit(etymLines, etymBudget, Buffer.byteLength(ETYM_HEADER));
    const links = LINKS_HEADER + L.kept.map((x) => x[1]).join('\n') + (L.kept.length ? '\n' : '');
    const etym = ETYM_HEADER + E.kept.map((x) => x[1]).join('\n') + (E.kept.length ? '\n' : '');

    // 覆盖率：词频前 N 的原形里，各列非空的比例
    const keptL = new Set(L.kept.map((x) => x[0])), keptE = new Set(E.kept.map((x) => x[0]));
    const ranked = [...lemmas].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((x) => x[0]);
    const coverage = {};
    for (const n of [5000, 20000]) {
      const top = ranked.slice(0, n);
      const c = { n: top.length };
      COLS.forEach((col, i) => { c[col] = top.filter((w) => keptL.has(w) && rows.get(w).cols[i].length).length / Math.max(1, top.length); });
      c.etym = top.filter((w) => keptE.has(w)).length / Math.max(1, top.length);
      coverage[n] = c;
    }
    const has = (a, b, i) => (keptL.has(a) && rows.get(a).cols[i].includes(b)) || (keptL.has(b) && rows.get(b).cols[i].includes(a));
    return {
      links, etym, coverage,
      stats: { used, lemmas: lemmas.size, linkRows: L.kept.length, linkDropped: L.dropped, etymRows: E.kept.length, etymDropped: E.dropped, linksBytes: Buffer.byteLength(links), etymBytes: Buffer.byteLength(etym) },
      /** 抽查：这一对在不在（任一方向） */
      hasPair: (kind, a, b) => has(norm(a), norm(b), COLS.indexOf(kind)),
    };
  }
  return { add, finish };
}

// 验收用的抽查词对
export const SPOT = {
  paronyms: [['éminent', 'imminent'], ['allocution', 'allocation'], ['collision', 'collusion'], ['conjecture', 'conjoncture']],
  homophones: [['ver', 'verre'], ['ver', 'vert'], ['ver', 'vers'], ['seau', 'sceau'], ['seau', 'sot'], ['seau', 'saut'], ['cou', 'coup'], ['cou', 'coût']],
};

/** 从网址读：连接中途断了（kaikki 的服务器会断开长连接）就从断点用 Range 续传，最多连续失败 8 次 */
export async function* httpChunks(url, { retries = 8, wait = 3000, log = (m) => process.stderr.write(m) } = {}) {
  let offset = 0, fails = 0, total = null;
  for (;;) {
    try {
      const r = await fetch(url, offset ? { headers: { Range: `bytes=${offset}-` } } : undefined);
      if (offset && r.status !== 206) throw Object.assign(new Error(`服务器不支持断点续传（${r.status}）：先用 curl -C - 下载到本地，再把路径传给脚本`), { fatal: true });
      if (!r.ok || !r.body) throw Object.assign(new Error(`下载失败：${r.status} ${r.statusText}`), { fatal: r.status >= 400 && r.status < 500 });
      if (!offset) total = Number(r.headers.get('content-length')) || null;
      for await (const chunk of r.body) { offset += chunk.length; fails = 0; yield chunk; }
      if (total && offset < total) throw new Error(`连接提前结束（${offset} / ${total} 字节）`);
      return;
    } catch (e) {
      if (e.fatal || ++fails > retries) throw e;
      log(`\n连接断开（${e.cause?.code ?? e.message}），${Math.round(wait / 1000)} 秒后从 ${(offset / 1024 / 1024).toFixed(0)} MB 处续传（第 ${fails} 次重试）\n`);
      await new Promise((ok) => setTimeout(ok, wait));
    }
  }
}

async function open(src) {
  return /^https?:\/\//.test(src) ? Readable.from(httpChunks(src), { objectMode: false }) : createReadStream(src);
}

async function main() {
  const [src] = process.argv.slice(2);
  if (!src) { console.error('usage: node scripts/build-fr-wikt.mjs <fr-extract.jsonl.gz | https://kaikki.org/dictionary/downloads/fr/fr-extract.jsonl.gz>'); process.exit(1); }
  const b = createBuilder(readFileSync(new URL('../src/lib/gender/fr-dict.txt', import.meta.url), 'utf8'));
  const input = await open(src);
  const rl = createInterface({ input: /\.gz($|\?)/.test(src) ? input.pipe(createGunzip()) : input, crlfDelay: Infinity });
  const FR = /"lang_code": ?"fr"/;
  let n = 0, bad = 0;
  const t0 = Date.now();
  for await (const line of rl) {
    if (++n % 500000 === 0) process.stderr.write(`\r已读 ${(n / 1e6).toFixed(1)} 百万行，${Math.round((Date.now() - t0) / 1000)} 秒`);
    if (!FR.test(line)) continue; // 先粗筛再解析，省一大半时间
    try { b.add(JSON.parse(line)); } catch { bad++; }
  }
  process.stderr.write('\n');
  const r = b.finish();
  writeFileSync(new URL('../src/lib/wikt/fr-links.txt', import.meta.url), r.links);
  writeFileSync(new URL('../src/lib/wikt/fr-etym.txt', import.meta.url), r.etym);

  const mb = (x) => `${(x / 1024 / 1024).toFixed(2)} MB`;
  const pct = (x) => `${(x * 100).toFixed(1)}%`.padStart(6);
  const s = r.stats;
  console.log(`读了 ${n} 行（解析失败 ${bad} 行），用到法语词条 ${s.used} 个；词频 > 0 的原形 ${s.lemmas} 个`);
  console.log(`fr-links.txt：${s.linkRows} 行，${mb(s.linksBytes)}（目标 ≤ ${mb(LINKS_BUDGET)}${s.linkDropped ? `，超出目标，丢了词频最低的 ${s.linkDropped} 行` : ''}）`);
  console.log(`fr-etym.txt ：${s.etymRows} 行，${mb(s.etymBytes)}（目标 ≤ ${mb(ETYM_BUDGET)}${s.etymDropped ? `，超出目标，丢了词频最低的 ${s.etymDropped} 行` : ''}）`);
  console.log('\n覆盖率（词频前 N 的原形里，这一列非空的比例）：');
  console.log(`  ${'前 N'.padEnd(8)}${[...COLS, 'etym'].map((c) => COL_ZH[c].padStart(5)).join('  ')}`);
  for (const [k, c] of Object.entries(r.coverage)) console.log(`  ${String(k).padEnd(9)}${[...COLS, 'etym'].map((col) => pct(c[col])).join('  ')}`);
  console.log('\n抽查：');
  for (const [kind, pairs] of Object.entries(SPOT)) console.log(`  ${COL_ZH[kind]}  ${pairs.map(([a, c]) => `${r.hasPair(kind, a, c) ? '✔' : '✘'} ${a} / ${c}`).join('   ')}`);
  const top = r.coverage[5000];
  if (!s.used) { console.error('\n✘ 没有读到任何法语词条：文件不对，或者 wiktextract 的格式变了'); process.exit(1); }
  if (top.paronyms < 0.1 || top.homophones < 0.1) {
    console.log(`\n⚠ 前 5000 里近音 ${pct(top.paronyms).trim()}、同音 ${pct(top.homophones).trim()}，有一列低于 10%：先别提交，把上面的输出发回对话，再决定易混检测（4.3 的 A）要不要用这份数据`);
  } else console.log('\n✔ 近音、同音两列在前 5000 里的覆盖率都不低于 10%');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
