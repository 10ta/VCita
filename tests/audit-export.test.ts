// 全量体检：对一份导出里的每条笔记、每种卡、每个轮换版本，检查「考查部分 = 词条」等规则。
// 平时跳过；要查时：env VCITA_EXPORT=<导出的 .json 或 .json.gz> npx vitest run tests/audit-export.test.ts --reporter=verbose
// 第二个文件（VCITA_FIX，可选）是准备导入的修正包：先并进去再查，用来确认修完后各项归零。
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { db } from '../src/db/db';
import { clearAllLocalData } from '../src/db/actions';
import { importBundle } from '../src/io/bundle';
import { noteErrors, markErrors, productionErrors, contrastLeaks, lemmaOutsideMark, markOffLemma, hasCloze } from '../src/schema/validate';
import { pickSentence, variantCount } from '../src/features/CardFace';

const { VCITA_EXPORT, VCITA_FIX } = process.env;
const load = (p: string) => JSON.parse((p.endsWith('.gz') ? gunzipSync(readFileSync(p)) : readFileSync(p)).toString('utf8'));

it.skipIf(!VCITA_EXPORT)('导出全量体检', async () => {
  await clearAllLocalData();
  await importBundle(load(VCITA_EXPORT!));
  if (VCITA_FIX) console.log('修正包：', JSON.stringify(await importBundle(load(VCITA_FIX))));
  const notes = (await db.notes.toArray()).filter((n) => !n.deleted && !n.frame);
  const types = new Map<string, string[]>();
  for (const c of await db.cards.toArray()) if (!c.deleted) (types.get(c.noteId) ?? types.set(c.noteId, []).get(c.noteId)!).push(c.type);
  const hits: Record<string, string[]> = { '1-2 例句标注': [], '3 只标了词条一部分的备用 / 挖空句（只给挖空卡用）': [], '4 卡面：高亮 / 挖空不是整个词条': [], '5 产出题面': [], '6 提示与其他': [], '7 辨析卡破绽': [], '8 认读卡缺词源': [] };
  for (const n of notes) {
    const ts = types.get(n.id) ?? [];
    for (const e of markErrors(n)) hits['1-2 例句标注'].push(`${n.lemma}：${e}`);
    for (const x of [n.clozeSentence ?? '', ...(n.altSentences ?? [])]) if (x && hasCloze(x) && lemmaOutsideMark(x, n.lemma).length) hits['3 只标了词条一部分的备用 / 挖空句（只给挖空卡用）'].push(`${n.lemma}：${x}`);
    // 每种卡、每个轮换版本实际显示的句子
    for (const t of ['recognition', 'contrast', 'cloze'] as const) {
      if (!ts.includes(t)) continue;
      const seen = new Set<string>();
      for (let v = 0; v < variantCount(n).sentences; v++) {
        const s = pickSentence(n, t === 'cloze' ? 'cloze' : 'recognition', v);
        if (!s || seen.has(s) || !hasCloze(s)) continue;
        seen.add(s);
        if (markOffLemma(s, n.lemma) || (t !== 'cloze' && lemmaOutsideMark(s, n.lemma).length)) hits['4 卡面：高亮 / 挖空不是整个词条'].push(`${n.lemma}［${t} 第 ${v + 1} 版］${s}`);
      }
    }
    const pe = productionErrors(n);
    for (const e of pe) hits['5 产出题面'].push(`${n.lemma}：${e}`);
    for (const e of noteErrors(n)) if (!pe.includes(e)) hits['6 提示与其他'].push(`${n.lemma}：${e}`);
    if (n.contrastGroup) for (const e of contrastLeaks(n, notes.filter((x) => x.id !== n.id && x.contrastGroup === n.contrastGroup))) hits['7 辨析卡破绽'].push(`${n.lemma}：${e}`);
    if (ts.includes('recognition') && !n.etymology?.trim()) hits['8 认读卡缺词源'].push(n.lemma);
  }
  console.log(`查了 ${notes.length} 条笔记`);
  for (const [k, v] of Object.entries(hits)) console.log(`${k}：${v.length}${v.length ? `\n  ${v.join('\n  ')}` : ''}`);
  // 第 3 项是清单不是错误；其余都要是 0
  for (const [k, v] of Object.entries(hits)) if (!k.startsWith('3')) expect(v, k).toEqual([]);
});
