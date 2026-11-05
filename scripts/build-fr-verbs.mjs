// 生成动词变位表：src/lib/gender/fr-verbs.txt（变位形式 → 不定式），给阅读页和划词把 est、mangeait、déroge 还原成原形。
// fr-dict.txt 只收了不定式；这里只收它里面已有的动词（5 千多个），歧义形式（allions：aller / allier）取词频高的那个。
// 数据：Lefff 3.4（Sagot，LGPL-LR）：https://gitlab.inria.fr/almanach/lefff（npm 包 node-lefff 里也带了同一个 lefff-3.4.mlex）
// 用法：node scripts/build-fr-verbs.mjs <lefff-3.4.mlex>
import { readFileSync, writeFileSync } from 'node:fs';

const norm = (s) => s.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/’/g, "'");
const [lefffPath] = process.argv.slice(2);
if (!lefffPath) { console.error('usage: node scripts/build-fr-verbs.mjs lefff-3.4.mlex'); process.exit(1); }

// 词典里的动词不定式和词频
const freq = new Map();
for (const line of readFileSync(new URL('../src/lib/gender/fr-dict.txt', import.meta.url), 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [form, pos, , , lemma, f] = line.split('\t');
  if (pos === 'V') freq.set(lemma || form, Math.max(freq.get(lemma || form) ?? 0, Number(f) || 0));
}

const best = new Map(); // form → lemma
for (const line of readFileSync(lefffPath, 'utf8').split('\n')) {
  const [rawForm, cat, rawLemma] = line.split('\t');
  if (!rawForm || !/^(v|auxAvoir|auxEtre)$/.test(cat) || /\s/.test(rawForm)) continue;
  const form = norm(rawForm), lemma = norm(rawLemma);
  if (form === lemma || !freq.has(lemma)) continue;
  const cur = best.get(form);
  if (!cur || freq.get(lemma) > freq.get(cur)) best.set(form, lemma);
}
// 按不定式分组，一行一个动词：不定式\t变位1 变位2 …（比一行一个形式小一半）
const byLemma = new Map();
for (const [f, l] of best) (byLemma.get(l) ?? byLemma.set(l, []).get(l)).push(f);
const lines = [...byLemma].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([l, fs]) => `${l}\t${fs.sort().join(' ')}`);
const header = '# VCita 动词变位表：不定式\t变位形式（空格分隔）。数据：Lefff 3.4 (LGPL-LR)。由 scripts/build-fr-verbs.mjs 生成\n';
writeFileSync(new URL('../src/lib/gender/fr-verbs.txt', import.meta.url), header + lines.join('\n') + '\n');
console.log(`${best.size} forms, ${lines.length} verbs`);
