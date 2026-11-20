// @vitest-environment happy-dom
// 撤销一张卡：表达群里翻页时按「没想起来」生效的撤回，界面回到翻页前（展开、绿的还是绿的）
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { addNotes, clearAllLocalData } from '../src/db/actions';
import { ClusterStrip, undoClusterLeave } from '../src/features/review/ClusterStrip';
import { toIso } from '../src/lib/time';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const DAY = 86_400_000;
const flush = async () => { for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };

describe('表达群 · 撤销', () => {
  it('没想起来的撤回、想起来的保留，重新显示时状态恢复', async () => {
    await clearAllLocalData();
    const mk = (lemma: string) => ({ deckId: 'd', lemma, sentence: `Je suis {{${lemma}}}.`, cluster: '惊呆了', cardTypes: ['recognition' as const] });
    const ids = (await addNotes([mk('sidéré'), mk('stupéfait'), mk('médusé')])).map((r) => r.noteId);
    const now = Date.now();
    for (const id of ids) {
      const c = (await db.cards.where('noteId').equals(id).toArray())[0];
      await db.cards.put({ ...c, state: 'review', interval: 10, reps: 3, due: toIso(now + 9 * DAY), lastReviewedAt: toIso(now - 6 * DAY) });
    }
    const notes = await db.notes.toArray();
    const cards = await db.cards.toArray();
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    const self = notes.find((n) => n.id === ids[0])!;
    await act(async () => root.render(<ClusterStrip note={self} notes={notes} cards={cards} recKey="k1" />));
    const btn = (t: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(t))!;
    await act(async () => btn('看答案').click());
    await act(async () => btn('médusé').click());     // médusé 想起来了
    await flush();
    const dueOf = async (lemma: string) => (await db.cards.where('noteId').equals(notes.find((n) => n.lemma === lemma)!.id).first())!.due;
    const meduseDue = await dueOf('médusé');
    expect(meduseDue).not.toBe(toIso(now + 9 * DAY));
    await act(async () => root.unmount());           // 翻到下一张：stupéfait 按没想起来生效
    await flush();
    expect(await dueOf('stupéfait')).not.toBe(toIso(now + 9 * DAY));
    await undoClusterLeave('k1');                     // 撤销
    expect(await dueOf('stupéfait')).toBe(toIso(now + 9 * DAY));
    expect(await dueOf('médusé')).toBe(meduseDue);
    const root2 = createRoot(host);
    await act(async () => root2.render(<ClusterStrip note={self} notes={await db.notes.toArray()} cards={await db.cards.toArray()} recKey="k1" />));
    expect(host.querySelector('.cl-toggle.is-ok')?.textContent).toContain('médusé');
    expect(host.querySelector('.cl-toggle.is-miss')?.textContent).toContain('stupéfait');
    expect(btn('看答案')).toBeUndefined();
    await act(async () => root2.unmount());
  });
});
