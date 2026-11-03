// 生成法语词典数据：src/lib/gender/fr-dict.txt（词频 + 词性 + 阴阳性 + 原形）和 src/lib/gender/stats.gen.ts（词尾规则的统计）。
// 数据来源（下载后把路径传进来，原始文件不进仓库）：
//   Lexique 3.83（New, Pallier & Brysbaert，CC BY-SA 4.0）：http://www.lexique.org —— 词频、词性、原形、大部分名词的性
//   Lefff 3.4（Sagot，LGPL-LR）：https://gitlab.inria.fr/almanach/lefff —— 补 Lexique 没标性别的名词（main、maison、voiture…）
// 用法：node scripts/build-fr-dict.mjs <Lexique383.txt (latin-1)> <lefff-3.4.mlex>
import { readFileSync, writeFileSync } from 'node:fs';
import { GENDER_OVERRIDES, GENDER_RULES, HOMOGRAPHS, matchRule, norm } from '../src/lib/gender/rules.ts';

const [lexPath, lefffPath] = process.argv.slice(2);
if (!lexPath || !lefffPath) { console.error('usage: node scripts/build-fr-dict.mjs Lexique383.txt lefff-3.4.mlex'); process.exit(1); }
const num = (s) => Number((s || '0').replace(',', '.')) || 0;

// ---- Lefff：名词的性 ----
const lefff = new Map(); // form → Set('m'|'f')
for (const line of readFileSync(lefffPath, 'utf8').split('\n')) {
  const [form, cat, , tag = ''] = line.split('\t');
  if (cat !== 'nc' || !form || /\s/.test(form)) continue;
  const k = norm(form);
  const set = lefff.get(k) ?? new Set();
  if (tag.includes('m')) set.add('m');
  if (tag.includes('f')) set.add('f');
  lefff.set(k, set);
}

// ---- Lexique ----
const POS = { NOM: 'N', ADJ: 'A', VER: 'V', AUX: 'V' };
const rows = readFileSync(lexPath, 'latin1').split('\n').slice(1).map((l) => l.split('\t')).filter((r) => r.length > 9 && r[0]);
const byForm = new Map();
for (const r of rows) {
  const form = norm(r[0]);
  const row = { form, lemma: norm(r[2]), pos: POS[r[3]] ?? 'O', g: r[4], n: r[5], f: num(r[8]) + num(r[9]), lf: (num(r[6]) + num(r[7])) / 2 };
  (byForm.get(form) ?? byForm.set(form, []).get(form)).push(row);
}
const homo = new Set(HOMOGRAPHS.map((h) => h.word));

/** 名词的性：同形异义表 → 人工核对表 → Lexique → Lefff → 都没有时：常用词多是阴阳同形的指人名词（artiste、élève），
 *  算 b；不常用的记 ?（未知，悬停时按词尾推测） */
function nounGender(form, nounRows) {
  const lemma = nounRows[0].lemma;
  if (homo.has(form) || homo.has(lemma)) return 'h';
  if (GENDER_OVERRIDES[form] || GENDER_OVERRIDES[lemma]) return GENDER_OVERRIDES[form] || GENDER_OVERRIDES[lemma];
  const gs = new Set(nounRows.map((r) => r.g).filter(Boolean));
  if (gs.size === 1) return [...gs][0];
  if (gs.size === 2) return 'b';
  const lg = lefff.get(form) ?? lefff.get(lemma);
  if (lg?.size === 1) return [...lg][0];
  return Math.max(...nounRows.map((r) => r.lf)) >= 5 || /istes?$/.test(form) ? 'b' : '?';
}

const out = [];
const lemmaFreq = new Map();
for (const [form, rs] of byForm) {
  for (const r of rs) if (r.lf > (lemmaFreq.get(`${r.pos}:${r.lemma}`) ?? 0)) lemmaFreq.set(`${r.pos}:${r.lemma}`, r.lf);
  rs.sort((a, b) => b.f - a.f || b.lf - a.lf);
  const top = rs[0];
  // 动词只留不定式（笔记的 lemma 用原形），名词 / 形容词全留（悬停要用变形）
  if (top.pos === 'V' && top.lemma !== form) continue;
  if (top.pos === 'O' && top.lf < 1) continue;
  let g = '';
  if (top.pos === 'N') g = nounGender(form, rs.filter((r) => r.pos === 'N'));
  else if (top.pos === 'A') g = top.g || '';
  const n = top.pos === 'N' || top.pos === 'A' ? top.n : '';
  out.push([form, top.pos, g, n, top.lemma === form ? '' : top.lemma, Math.round(top.lf * 100) / 100]);
}
// Lefff 里有、Lexique 里没有的名词（après-midi 等），词频记 0
for (const [form, gs] of lefff) {
  if (byForm.has(form) || form.includes(' ')) continue;
  out.push([form, 'N', homo.has(form) ? 'h' : GENDER_OVERRIDES[form] ?? (gs.size === 1 ? [...gs][0] : gs.size === 2 ? 'b' : '?'), '', '', 0]);
}
out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
const header = '# VCita 法语词典：形式\t词性(N/A/V/O)\t性(m/f/b 阴阳同形/h 同形异义/? 未知)\t数(s/p)\t原形(同形式时空)\t原形词频(每百万词)\n'
  + '# 数据：Lexique 3.83 (CC BY-SA 4.0, lexique.org) + Lefff 3.4 (LGPL-LR)。由 scripts/build-fr-dict.mjs 生成\n';
writeFileSync(new URL('../src/lib/gender/fr-dict.txt', import.meta.url), header + out.map((r) => r.join('\t')).join('\n') + '\n');

// ---- 词尾规则统计：单数名词原形、性别明确、不是同形异义 / 两性同形 ----
const nouns = [];
for (const [form, rs] of byForm) {
  const r = rs.find((x) => x.pos === 'N' && x.lemma === form);
  if (!r) continue;
  const g = nounGender(form, rs.filter((x) => x.pos === 'N'));
  // 有异性形式的指人名词（acteur / actrice）按所指的人定性，不算进词尾统计
  if (g === 'm' || g === 'f') nouns.push({ form, g, f: r.lf });
}
const pairedLemmas = new Set();
for (const rs of byForm.values()) for (const r of rs) if (r.pos === 'N' && r.lemma !== r.form && r.g && r.n === 's') pairedLemmas.add(r.lemma), pairedLemmas.add(r.form);
const pool = nouns.filter((x) => !pairedLemmas.has(x.form) && x.f >= 0.5 && !/[\s]/.test(x.form));
const stats = GENDER_RULES.map((rule) => {
  const hit = pool.filter((x) => matchRule(x.form) === rule);
  const same = hit.filter((x) => x.g === rule.gender);
  const ex = hit.filter((x) => x.g !== rule.gender && x.f >= 1).sort((a, b) => b.f - a.f).slice(0, 6).map((x) => x.form);
  return { suffix: rule.suffix, n: hit.length, pct: hit.length ? Math.round((same.length / hit.length) * 100) : 0, exceptions: ex };
});
const fallback = ['e', ''].map((end) => {
  const hit = pool.filter((x) => !matchRule(x.form) && (end ? x.form.endsWith('e') : !x.form.endsWith('e')));
  return { end, n: hit.length, fem: Math.round((hit.filter((x) => x.g === 'f').length / Math.max(1, hit.length)) * 100) };
});
writeFileSync(new URL('../src/lib/gender/stats.gen.ts', import.meta.url),
  `// 由 scripts/build-fr-dict.mjs 生成，不要手改。统计对象：Lexique 3.83 里词频 ≥ 0.5/百万、性别明确的单数名词（不含 acteur / actrice 这类按所指定性的指人名词）\n`
  + `export const RULE_STATS: Record<string, { n: number; pct: number; exceptions: string[] }> = {\n${stats.map((s) => `  ${JSON.stringify(s.suffix)}: ${JSON.stringify({ n: s.n, pct: s.pct, exceptions: s.exceptions })},`).join('\n')}\n};\n`
  + `/** 不符合任何词尾规则时：以 -e 结尾 / 不以 -e 结尾的名词里阴性占比 */\n`
  + `export const FALLBACK_STATS = ${JSON.stringify({ e: fallback[0], other: fallback[1] })};\n`);
console.log('forms', out.length, 'rules', stats.map((s) => `${s.suffix}:${s.pct}%/${s.n}`).join(' '), 'fallback', JSON.stringify(fallback));
