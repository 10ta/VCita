// 生成替代说法卡用的静态数据（原始文件不进仓库）：
//   src/lib/alts/rl-alts.txt  RL-fr（Réseau Lexical du Français，ATILF，CC BY 4.0）按义项分开的同义关系：
//                             Syn = 平替；Syn⊂（意思更宽）= 下位；Syn⊃（意思更窄、更强）= 上位；Syn∩（部分重叠）= 近义。
//                             每个义项再带十来个例句里的关键词，App 用卡片例句和它们比对，判断这张卡是哪个义项
//   src/lib/alts/flelex.txt   FLELex-TT（CENTAL / UCLouvain，CC BY-NC-SA）每个原形的 CEFR 级别：
//                             教材语料里每百万词出现 ≥ 3 次的最低级别（第一次「常见」的级别，不是第一次出现）
// 下载：RL-fr https://hdl.handle.net/11403/lexical-system-fr（解压后取 ls-fr-V*/ 目录）；
//       FLELex https://cental.uclouvain.be/cefrlex/flelex/download/（FLELex-TT 的 CSV）
// 用法：node scripts/build-alts-data.mjs <ls-fr-V3.2 目录> <FleLex_TT.csv>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LEVEL_MIN_FREQ = 3;
export const KEYWORDS = 8;
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const KIND = { Syn: '平替', 'Syn^sex': '平替', 'Syn_⊂': '下位', 'Syn_⊂^sex': '下位', 'Syn_⊃': '上位', 'Syn_⊃^sex': '上位', 'Syn_∩': '近义' };
const INVERSE = { 下位: '上位', 上位: '下位', 平替: '平替', 近义: '近义' };
const COLS = ['下位', '平替', '近义', '上位'];
const STOP = new Set('les des une dans pour avec sans sous sur par que qui quoi dont où est sont été être avoir fait faire mais plus moins très tout tous toute toutes cette ces ceux celle elle elles ils nous vous leur leurs son ses sa mon mes ton tes notre votre comme aussi bien encore même alors donc ainsi entre après avant depuis pendant chez vers peu trop rien aucun autre autres quand quel quelle avait était sera serait peut doit cela ceci ça'.split(' '));

/** 带引号的制表符分隔文件（字段里可能有换行、成对的 ""）→ 对象数组 */
export function parseTsv(text) {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === '\t') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const tokens = (s) => (s.toLowerCase().match(/[a-zà-ÿœæ]+/g) ?? []).filter((w) => w.length > 3 && !STOP.has(w));

export function buildRl(dir) {
  const read = (f) => parseTsv(readFileSync(join(dir, f), 'utf8'));
  const entries = new Map(read('02-lsentries.csv').map((r) => [r.id, r.name]));
  const nodes = new Map(read('01-lsnodes.csv').map((r) => [r.id, { name: entries.get(r.entry) ?? '', num: r.lexnum }]));
  const lfName = new Map([...readFileSync(join(dir, '14-lslf-model.xml'), 'utf8').matchAll(/id="(ls:fr:lf:\d+)" name="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const alts = new Map(); // node → { 下位: Set, ... }
  const add = (n, k, w) => { if (!alts.has(n)) alts.set(n, Object.fromEntries(COLS.map((c) => [c, new Set()]))); alts.get(n)[k].add(w); };
  for (const r of read('15-lslf-rel.csv')) {
    const k = KIND[lfName.get(r.lf)];
    const s = nodes.get(r.source), t = nodes.get(r.target);
    // 数字条目（10 000 mètres…）对学说法没用
    if (!k || !s || !t || !s.name || !t.name || s.name === t.name || /\d/.test(s.name + t.name)) continue;
    add(r.source, k, t.name);
    add(r.target, INVERSE[k], s.name); // 关系补成双向：A 比 B 宽，B 就比 A 窄
  }
  // 义项关键词：这个义项的例句里的词，按「越少义项用到越有区分度」排
  const exText = new Map(read('17-lsex.csv').map((r) => [r.id, r.content.replace(/<[^>]+>/g, ' ')]));
  const bag = new Map();
  for (const r of read('18-lsex-rel.csv')) {
    if (!alts.has(r.node)) continue;
    const b = bag.get(r.node) ?? bag.set(r.node, new Map()).get(r.node);
    for (const w of new Set(tokens(exText.get(r.example) ?? ''))) b.set(w, (b.get(w) ?? 0) + 1);
  }
  const df = new Map();
  for (const b of bag.values()) for (const w of b.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const lines = [];
  for (const [id, a] of alts) {
    const n = nodes.get(id);
    const own = new Set(tokens(n.name));
    const kw = [...(bag.get(id) ?? new Map())].filter(([w]) => !own.has(w))
      .map(([w, c]) => [w, c / Math.log(2 + (df.get(w) ?? 0))]).sort((x, y) => y[1] - x[1]).slice(0, KEYWORDS).map(([w]) => w);
    lines.push([n.name, n.num, kw.join(' '), ...COLS.map((c) => [...a[c]].join('|'))].join('\t'));
  }
  lines.sort((x, y) => (x < y ? -1 : 1));
  return '# VCita 替代说法：RL-fr 义项\t编号\t例句关键词\t下位(Syn⊂)\t平替(Syn)\t近义(Syn∩)\t上位(Syn⊃)；同一列用 | 分隔\n'
    + '# 数据：Réseau Lexical du Français (ATILF, CNRS / Université de Lorraine)，CC BY 4.0。由 scripts/build-alts-data.mjs 生成\n'
    + lines.join('\n') + '\n';
}

export function buildFlelex(csv) {
  const best = new Map();
  for (const line of csv.split('\n').slice(1)) {
    const p = line.split('\t');
    if (p.length < 8 || !p[0]) continue;
    const j = p.slice(2, 8).map(Number).findIndex((f) => f >= LEVEL_MIN_FREQ);
    if (j < 0) continue;
    if (!best.has(p[0]) || j < best.get(p[0])) best.set(p[0], j);
  }
  const lines = [...best].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([w, j]) => `${w}\t${LEVELS[j]}`);
  return `# VCita CEFR 级别：原形\t级别（FLELex 教材语料里每百万词 ≥ ${LEVEL_MIN_FREQ} 次的最低级别）\n`
    + '# 数据：FLELex-TT (CENTAL, UCLouvain / Aix-Marseille Université)，CC BY-NC-SA。由 scripts/build-alts-data.mjs 生成\n'
    + lines.join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir, csv] = process.argv.slice(2);
  if (!dir || !csv) { console.error('用法：node scripts/build-alts-data.mjs <ls-fr-V3.2 目录> <FleLex_TT.csv>'); process.exit(1); }
  const out = new URL('../src/lib/alts/', import.meta.url);
  const rl = buildRl(dir), fl = buildFlelex(readFileSync(csv, 'utf8'));
  writeFileSync(new URL('rl-alts.txt', out), rl);
  writeFileSync(new URL('flelex.txt', out), fl);
  console.log(`rl-alts.txt ${rl.split('\n').length - 3} 个义项，${(rl.length / 1024).toFixed(0)} KB；flelex.txt ${fl.split('\n').length - 3} 个原形，${(fl.length / 1024).toFixed(0)} KB`);
}
