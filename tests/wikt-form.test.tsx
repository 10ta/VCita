// 笔记表单里的 Wiktionnaire 候选：词族候选（库里已有的排前面）和词源参考（只显示，不自动填）
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoteV2 } from '../src/schema/v2';
import { fromNote } from '../src/features/noteform/model';
import { getSettings } from '../src/db/actions';

const mine = NoteV2.parse({ id: 'n2', deckId: 'd', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lemma: 'le constat', meaningZh: '认定；结论', meaningEn: 'finding', cardTypes: ['recognition'] });
vi.mock('../src/db/hooks', async (orig) => ({ ...(await orig<typeof import('../src/db/hooks')>()), useNotes: () => [mine] }));
vi.mock('../src/lib/wikt', async (orig) => {
  const m = await orig<typeof import('../src/lib/wikt')>();
  const on = { v: true };
  return {
    ...m, __on: on,
    useWiktLinks: (enabled = true) => (enabled && on.v ? m.parseLinks('constater\t\t\tremarquer\tconstatation,constat\n') : null),
    useWiktEtym: (enabled = true) => (enabled && on.v ? m.parseEtym('constater\tDu latin constat, « il est établi ».\n') : null),
  };
});

describe('笔记表单：Wiktionnaire 候选', async () => {
  const { NoteForm } = await import('../src/features/noteform/NoteForm');
  const wikt = await import('../src/lib/wikt') as unknown as { __on: { v: boolean } };
  const note = NoteV2.parse({ id: 'n1', deckId: 'd', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lemma: 'constater que', meaningZh: '发现', meaningEn: 'note', cardTypes: ['recognition'], cueFamily: 'constat 认定' });
  const s = { ...(await getSettings()), addShowMore: true };
  const html = () => renderToStaticMarkup(<NoteForm d={fromNote(note, 'list')} setD={() => undefined} s={s} labels={['法语', '中文', '英语']} mode="add" onSubmit={() => undefined} showErrors={false} />);

  it('词族候选：库里已有的排前面并标出；已经填进词族线索的是选中状态；词源原文只显示', () => {
    const h = html();
    expect(h.indexOf('>constat<')).toBeGreaterThan(0);
    expect(h.indexOf('>constat<')).toBeLessThan(h.indexOf('>constatation<'));
    expect(h).toMatch(/class="pill nf-cand is-on is-mine" aria-pressed="true" title="认定；结论">constat</);
    expect(h).toMatch(/class="pill nf-cand" aria-pressed="false">constatation</);
    expect(h).toContain('Wiktionnaire · Du latin constat, « il est établi ».');
    expect(h).not.toContain('value="Du latin'); // 不自动填
  });
  it('索引没加载到：表单和以前一样', () => {
    wikt.__on.v = false;
    const h = html();
    expect(h).not.toContain('nf-cand');
    expect(h).not.toContain('Wiktionnaire ·');
    wikt.__on.v = true;
  });
});
