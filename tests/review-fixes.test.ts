// 换卡停音、旧音频不能在新音频之后播出；addNotes 保留话题 / 我的句子 / 待修；词频排名；合并带上新字段
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseNote, type Note } from '../src/schema';
import { planMerge } from '../src/lib/merge';
import { serialize } from '../src/sync/files';
import { parseDict } from '../src/lib/gender/dict';

const played: string[] = [];
const paused: string[] = [];
class FakeAudio {
  src: string; onended: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(src: string) { this.src = src; }
  play() { played.push(this.src); return Promise.resolve(); }
  pause() { paused.push(this.src); } load() {} removeAttribute() {}
}

describe('换卡时的发音', () => {
  beforeEach(async () => {
    vi.resetModules();
    played.length = 0; paused.length = 0;
    vi.stubGlobal('Audio', FakeAudio);
    let n = 0;
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => `blob:${n++}`, revokeObjectURL: () => {} }));
    const { db } = await import('../src/db/db');
    await db.audio.clear();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('上一张卡的音频下载慢、晚于本卡到达：不再播放，本卡的照常播', async () => {
    let releaseSlow: (() => void) | null = null;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('Lente')) await new Promise<void>((r) => { releaseSlow = r; });
      return new Response(new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }), { headers: { 'content-type': 'audio/mpeg' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { speak, stopSpeech } = await import('../src/lib/speech');
    const old = speak('Lente phrase.', 'fr');
    await vi.waitFor(() => expect(releaseSlow).not.toBeNull());
    stopSpeech();
    await speak('Nouvelle carte.', 'fr');
    expect(played).toHaveLength(1);
    releaseSlow!();
    await old;
    expect(played).toHaveLength(1);
  });

  it('stopSpeech 停掉正在播放的', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }), { headers: { 'content-type': 'audio/mpeg' } })));
    const { speak, stopSpeech } = await import('../src/lib/speech');
    await speak('Une phrase.', 'fr');
    stopSpeech();
    expect(paused).toContain(played[0]);
  });
});

describe('新字段和话题', () => {
  it('addNotes 不再丢掉话题；我的句子、待修也带上', async () => {
    const { addNotes, clearAllLocalData } = await import('../src/db/actions');
    const { db } = await import('../src/db/db');
    await clearAllLocalData();
    await addNotes([{ deckId: 'd', lemma: 'trancher', sentence: 'Il faut {{trancher}}.', topics: ['决定', ' 决定 '], mine: "Je dois trancher entre Paris et Montréal.", fixme: '题面不唯一（产出）' }]);
    const n = (await db.notes.toArray())[0];
    expect(n.topics).toEqual(['决定']);
    expect(n.mine).toContain('Montréal');
    expect(n.fixme).toBe('题面不唯一（产出）');
  });
  it('没写的笔记同步文件不变', () => {
    const T = '2026-11-19T00:00:00.000Z';
    const s = serialize(parseNote({ id: 'x', deckId: 'd', createdAt: T, updatedAt: T, lemma: 'x' }));
    expect(s).not.toContain('mine');
    expect(s).not.toContain('fixme');
  });
  it('合并笔记：我的句子、待修都留下', () => {
    const T = '2026-11-19T00:00:00.000Z';
    const a: Note = parseNote({ id: 'a', deckId: 'd', createdAt: T, updatedAt: T, lemma: 'une mise en demeure', mine: 'A' });
    const b: Note = parseNote({ id: 'b', deckId: 'd', createdAt: T, updatedAt: T, lemma: 'une lettre de mise en demeure', mine: 'B', fixme: '关联不对' });
    const p = planMerge(a, [b], []);
    expect(p.patch.mine).toBe('A\nB');
    expect(p.patch.fixme).toBe('关联不对');
  });
});

describe('词频排名', () => {
  it('rankOf：越常用排名越小', () => {
    const d = parseDict(['avoir\tV\t\t\tavoir\t1000', 'maison\tN\tf\ts\tmaison\t300', 'haleine\tN\tf\ts\thaleine\t8', 'épilogue\tN\tm\ts\tépilogue\t2'].join('\n'));
    expect(d.rankOf(1000)).toBe(1);
    expect(d.rankOf(8)).toBe(3);
    expect(d.rankOf(2)).toBe(4);
    expect(d.rankOf(5000)).toBe(1);
  });
});
