// 合并笔记：同一个词的同一个义项只留一条笔记，不同搭配变成它的轮换例句、轮换题面和用法条目。
// 规划是纯函数（App 的「合并」和整理数据的脚本共用）：
//  - 保留的笔记：并入其他笔记的例句、产出题、用法、其他语境、词族、补充、出处、主题、话题；
//    自己没有产出题时，第一道并进来的题当主题
//  - 卡片：保留的笔记没有的卡型，把被并笔记的那张卡挪过来（复习记录跟着卡走）；其余的卡打墓碑
//  - 被并的笔记打墓碑
import type { Card, Note } from '../schema';

const hasMark = (s: string | null | undefined) => !!s && /\{\{.+?\}\}/.test(s);
const uniq = <T,>(xs: T[], key: (x: T) => string = String) => {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = key(x); if (!k || seen.has(k)) return false; seen.add(k); return true; });
};
const joinUniq = (xs: Array<string | null | undefined>, sep: string) => {
  const parts = uniq(xs.map((x) => x?.trim() ?? '').filter(Boolean));
  return parts.length ? parts.join(sep) : null;
};

type Intent = Note['altIntents'][number];
const mainIntent = (n: Note): Intent | null =>
  n.answerFr?.trim() && (n.promptFr?.trim() || n.intentZh?.trim())
    ? { promptFr: n.promptFr?.trim() || null, intentZh: n.intentZh ?? '', answerFr: n.answerFr, hint: n.hint ?? null }
    : null;

export interface MergePlan {
  /** 保留笔记要改的字段 */
  patch: Partial<Note>;
  /** 挪到保留笔记下的卡（被并笔记里、保留笔记没有的卡型） */
  move: Card[];
  /** 打墓碑的卡 */
  drop: Card[];
}

export function planMerge(keep: Note, others: Note[], cards: Card[]): MergePlan {
  const all = [keep, ...others];
  // 例句：保留笔记的主句不动，其余主句和备用例句都进备用例句
  const sentences = uniq([keep.sentence, ...keep.altSentences, ...others.flatMap((o) => [o.sentence, ...o.altSentences])].filter(hasMark), (x) => x.trim());
  const altSentences = sentences.filter((x) => x.trim() !== keep.sentence.trim());
  // 产出题：保留笔记有主题就保留；没有就拿第一道并进来的题当主题
  const intents = uniq([mainIntent(keep), ...keep.altIntents, ...others.flatMap((o) => [mainIntent(o), ...o.altIntents])].filter((x): x is Intent => !!x?.answerFr?.trim()),
    (x) => `${x.promptFr ?? ''}|${x.answerFr.trim()}`);
  const main = mainIntent(keep) ?? intents[0] ?? null;
  const altIntents = intents.filter((x) => x !== main && !(main && x.answerFr.trim() === main.answerFr.trim() && (x.promptFr ?? '') === (main.promptFr ?? '')));
  // 用法：保留笔记的用法不动；别的笔记的用法（没有就用 词条：意思）写进补充的「高频」，背面列在用法区
  const usageLines = others.map((o) => (o.usage?.trim() ? o.usage.trim() : `${o.lemma.trim()}：${o.meaningZh.trim()}`)).filter((x) => x.length > 1);
  const extra = joinUniq([keep.extra, ...usageLines.map((u) => `高频：${u}`), ...others.map((o) => o.extra)], '\n');
  const contexts = uniq(all.flatMap((n) => n.contexts ?? []), (x) => x.trim());
  const topics = uniq(all.flatMap((n) => n.topics ?? []), (x) => x.trim());
  const contrastGroup = keep.contrastGroup ?? others.find((o) => o.contrastGroup)?.contrastGroup ?? null;
  const cardTypes = uniq(all.flatMap((n) => n.cardTypes)).filter((t) => t !== 'contrast' || !!contrastGroup) as Card['type'][];
  if (main && !cardTypes.includes('production')) cardTypes.push('production');

  const patch: Partial<Note> = {
    altSentences, altIntents,
    ...(main ? { promptFr: main.promptFr, intentZh: main.intentZh || null, answerFr: main.answerFr, hint: main.hint } : {}),
    usage: keep.usage?.trim() || null,
    extra,
    contexts: contexts.length ? contexts : undefined,
    topics: topics.length ? topics : undefined,
    cueFamily: joinUniq(all.map((n) => n.cueFamily), ' · '),
    etymology: keep.etymology?.trim() || others.find((o) => o.etymology?.trim())?.etymology || null,
    source: joinUniq(all.map((n) => n.source), ' · '),
    clozeSentence: keep.clozeSentence ?? others.find((o) => o.clozeSentence)?.clozeSentence ?? null,
    cluster: keep.cluster?.trim() || others.find((o) => o.cluster?.trim())?.cluster || null,
    contrastGroup, contrastNote: keep.contrastNote ?? others.find((o) => o.contrastNote)?.contrastNote ?? null,
    tags: uniq(all.flatMap((n) => n.tags)).slice(0, 2) as Note['tags'],
    layer: all.some((n) => n.layer === 'core') ? 'core' : 'mid',
    origin: keep.origin ?? others.find((o) => o.origin)?.origin ?? null,
    usedCount: all.reduce((a, n) => a + (n.usedCount ?? 0), 0),
    usedAt: all.flatMap((n) => n.usedAt ?? []).sort(),
    cardTypes,
  };

  const live = cards.filter((c) => !c.deleted);
  const have = new Set(live.filter((c) => c.noteId === keep.id).map((c) => c.type));
  const move: Card[] = [];
  const drop: Card[] = [];
  const otherIds = new Set(others.map((o) => o.id));
  // 同一卡型有好几张时，挪复习次数最多的那张
  for (const c of live.filter((x) => otherIds.has(x.noteId)).sort((a, b) => b.reps - a.reps)) {
    if (!have.has(c.type) && cardTypes.includes(c.type)) { move.push({ ...c, noteId: keep.id, deckId: keep.deckId, createdAt: keep.createdAt }); have.add(c.type); }
    else drop.push({ ...c, deleted: true });
  }
  return { patch, move, drop };
}
