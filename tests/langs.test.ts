import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { isFrench, withDeckLangs } from '../src/ui/langs';
import { externalLinks } from '../src/lib/dictionary';
import { clearAllLocalData, createDeck, setDeckLangs } from '../src/db/actions';
import { db } from '../src/db/db';

describe('牌组语言', () => {
  const s = { sourceLang: 'fr', targetLang1: 'zh-CN', targetLang2: 'en', newPerDay: 20 };
  it('牌组没设的跟默认，设了的覆盖', () => {
    expect(withDeckLangs(s, null)).toBe(s);
    expect(withDeckLangs(s, { sourceLang: null, targetLang1: null, targetLang2: null })).toEqual(s);
    expect(withDeckLangs(s, { sourceLang: 'en', targetLang1: null, targetLang2: 'fr' })).toEqual({ ...s, sourceLang: 'en', targetLang2: 'fr' });
  });
  it('法语专用功能的开关', () => {
    expect(isFrench('fr')).toBe(true);
    expect(isFrench('fr-CA')).toBe(true);
    expect(isFrench('en')).toBe(false);
    expect(externalLinks('serendipity', 'en', 'zh-CN').map((l) => l.short)).toEqual(['Wikt', 'Google']);
    expect(externalLinks('serendipity', 'en', 'zh-CN')[0].url).toContain('en.wiktionary.org');
    expect(externalLinks('dérober').map((l) => l.short)).toEqual(['Wikt', 'Robert', 'WR', 'Reverso']);
  });
  it('保存到牌组（同步用 updatedAt 往后推）', async () => {
    await clearAllLocalData();
    const id = await createDeck('English');
    const before = (await db.decks.get(id))!;
    expect(before.sourceLang ?? null).toBeNull();
    await setDeckLangs(id, { sourceLang: 'en', targetLang2: 'fr' });
    const after = (await db.decks.get(id))!;
    expect(after).toMatchObject({ sourceLang: 'en', targetLang2: 'fr' });
    expect(after.updatedAt > before.updatedAt).toBe(true);
  });
});
