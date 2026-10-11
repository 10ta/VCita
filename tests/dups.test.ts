import { describe, expect, it } from 'vitest';
import { findDuplicates, normKey } from '../src/srs/dups';
import { NoteV2 } from '../src/schema/v2';
import { toIso } from '../src/lib/time';

let i = 0;
const note = (lemma: string, sentence = '', deckId = 'd') =>
  NoteV2.parse({ id: `n${++i}`, updatedAt: toIso(0), createdAt: toIso(i * 1000), deckId, lemma, sentence });

describe('疑似重复', () => {
  it('normKey：去冠词和 ê，保留 se；不误删 des- 开头的词', () => {
    expect(normKey("L'{{écrasante}} majorité")).toBe('écrasante majorité');
    expect(normKey('ê condamné')).toBe('condamné');
    expect(normKey('se poursuivre')).toBe('se poursuivre');
    expect(normKey('dessaisir')).toBe('dessaisir');
  });
  it('单词某一项相同、考查部分相同、例句相似 → 同组；不同牌组、se 动词不算', () => {
    const a = note('un crime passionnel', 'La défense plaide {{le crime passionnel}}.');
    const b = note('crime passionnel', 'Le tribunal a refusé la qualification de {{crime passionnel}}.');
    const c = note('engouement', 'Le vélo électrique suscite un véritable {{engouement}}.');
    const d = note('suscite un engouement', 'Le vélo électrique suscite un {{véritable}} engouement.');
    const e = note('poursuivre', 'Il veut {{poursuivre}} son employeur.');
    const f = note('se poursuivre', 'Les négociations vont {{se poursuivre}}.');
    const g = note('engouement', '', 'other');
    const m = findDuplicates([a, b, c, d, e, f, g]);
    expect(m.get(a.id)).toBe(m.get(b.id));
    expect(m.get(c.id)).toBe(m.get(d.id));
    expect(m.get(a.id)).not.toBe(m.get(c.id));
    expect([m.has(e.id), m.has(f.id), m.has(g.id)]).toEqual([false, false, false]);
  });
});
