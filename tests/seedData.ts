// 测试用的种子数据：两个牌组（B1、A2），笔记按天分布（每天 5 条），三分之二已复习、各带 3 条日志
import { db } from '../src/db/db';
import type { Card, Deck, Note, ReviewLog } from '../src/schema';
import { addDaysToDay, dayStartMs, noonIso } from '../src/lib/time';

const STAMP = '2026-10-01T10:00:00.000Z';

export async function seedData(total = 40) {
  const decks: Deck[] = [
    { id: 'd_default', name: 'B1', order: 0, updatedAt: STAMP, deleted: false },
    { id: 'd_a2', name: 'A2', order: 1, updatedAt: STAMP, deleted: false },
  ];
  const notes: Note[] = [], cards: Card[] = [], logs: ReviewLog[] = [];
  for (let n = 0; n < total; n++) {
    const day = addDaysToDay('2026-04-01', Math.floor(n / 5));
    const createdAt = noonIso(day);
    const reviewed = n % 3 !== 0;
    const note: Note = {
      id: `n_old${n}`, deckId: 'd_default', createdAt, lemma: `mot${n}`, sentence: '', meaningZh: `词${n}`, meaningEn: `word${n}`,
      cueFamily: null, promptFr: null, intentZh: null, hint: null, clozeHint: null, clozeSentence: null, etymology: null, answerFr: null, extra: null, source: null, altSentences: [], altIntents: [],
      layer: 'mid', cardTypes: ['recognition'], tags: n % 4 === 0 ? ['SOCIÉTÉ'] : [], usedCount: 0, usedAt: [], rot: n % 3, legacy: null,
      updatedAt: STAMP, deleted: false,
    };
    const card: Card = {
      id: `c_old${n}`, noteId: note.id, deckId: note.deckId, createdAt, type: 'recognition',
      state: reviewed ? 'review' : 'new', due: reviewed ? new Date(dayStartMs(addDaysToDay(day, 11), 4)).toISOString() : createdAt,
      interval: reviewed ? 8 + (n % 20) : 0, ease: 2.5, reps: reviewed ? 3 : 0, lapses: 0, step: 0,
      lastReviewedAt: reviewed ? noonIso(addDaysToDay(day, 3)) : null, isLeech: false, suspended: false, updatedAt: STAMP, deleted: false,
    };
    if (reviewed) {
      [0, 1, 3].forEach((o, i) => {
        const d = addDaysToDay(day, o);
        logs.push({
          id: `l_old${n}_${i}`, cardId: card.id, noteId: note.id, ts: noonIso(d), day: d, rating: 3,
          prevState: i === 0 ? 'new' : 'review', newState: 'review', prevInterval: null, newInterval: [1, 3, 8][i],
          prevEase: null, newEase: null, prevDue: null, newDue: null, elapsedMs: null, source: 'app', updatedAt: STAMP, deleted: false,
        });
      });
    }
    notes.push(note); cards.push(card);
  }
  await db.transaction('rw', [db.decks, db.notes, db.cards, db.logs], async () => {
    await db.decks.bulkPut(decks); await db.notes.bulkPut(notes); await db.cards.bulkPut(cards); await db.logs.bulkPut(logs);
  });
}
