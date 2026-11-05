// 把写作手册里的句框加进牌组（导入一次，之后各自独立）
import { db } from '../db/db';
import { addNotes } from '../db/actions';
import { hasSlots } from './frames';

const key = (s: string) => s.replace(/\s+/g, ' ').replace(/[’]/g, "'").trim().toLowerCase();

/** 手册句框里还没有的条数（句框文字相同就算有了，不管在哪个牌组） */
export async function pendingStarterFrames(): Promise<number> {
  const { SEED_FRAMES } = await import('./frames-seed');
  const have = new Set((await db.notes.toArray()).filter((n) => !n.deleted && n.frame).map((n) => key(n.lemma)));
  return SEED_FRAMES.filter((f) => !have.has(key(f.lemma))).length;
}

/** 导入到 deckId；按手册顺序排（新卡按创建时间出），返回新加的条数 */
export async function importStarterFrames(deckId: string): Promise<number> {
  const { SEED_FRAMES } = await import('./frames-seed');
  const have = new Set((await db.notes.toArray()).filter((n) => !n.deleted && n.frame).map((n) => key(n.lemma)));
  const now = Date.now();
  const todo = SEED_FRAMES.filter((f) => !have.has(key(f.lemma)));
  await addNotes(todo.map((f, i) => ({
    deckId, createdAtMs: now + i,
    lemma: f.lemma, meaningZh: f.meaningZh, sentence: f.sentence, extra: f.extra, source: f.source, frame: f.frame,
    layer: 'core' as const, cardTypes: hasSlots(f.lemma) ? ['frame', 'apply'] : ['frame'],
  })));
  return todo.length;
}
