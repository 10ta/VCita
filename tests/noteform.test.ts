import { describe, expect, it } from 'vitest';
import { NoteV2 } from '../src/schema/v2';
import { fromNote, promptOf, rowFields, newRow } from '../src/features/noteform/model';
import { formErrors, remarkRows } from '../src/features/noteform/NoteForm';

const base = { id: 'n1', deckId: 'd', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', meaningZh: '顺着某人的意', meaningEn: 'humour sb' };

describe('note form model', () => {
  const note = NoteV2.parse({
    ...base, lemma: 'prendre qqn dans le sens du poil', cardTypes: ['recognition', 'cloze', 'production'],
    sentence: 'Avec mon père, il faut le {{prendre dans le sens du poil}}.',
    clozeSentence: 'Avec ma mère aussi, il faut la {{prendre dans le sens du poil}}.', clozeHint: '顺着她（不定式）',
    altSentences: ['Ce commentateur caresse les fans {{dans le sens du poil::顺着毛}}.'],
    promptFr: 'Avec le patron, il faut le {{caresser en le flattant}}.', answerFr: 'Avec le patron, il faut le {{prendre dans le sens du poil}}.', intentZh: '顺着老板',
    altIntents: [{ promptFr: 'Avec le patron, il faut le {{caresser en le flattant}}.', answerFr: 'Avec le patron, il faut le {{prendre dans le sens du poil}}.', intentZh: '顺着老板' }],
  });
  const d = fromNote(note, 'list');
  it('one list of sentences; the cloze sentence joins it and keeps its hint', () => {
    expect(d.rows.filter((r) => r.kind === 'ex').map((r) => [r.text, r.hint])).toEqual([
      ['Avec mon père, il faut le {{prendre dans le sens du poil}}.', ''],
      ['Avec ma mère aussi, il faut la {{prendre dans le sens du poil}}.', '顺着她（不定式）'],
      ['Ce commentateur caresse les fans {{dans le sens du poil}}.', '顺着毛'],
    ]);
  });
  it('production questions become a paraphrase; the duplicate alt is dropped', () => {
    const prod = d.rows.filter((r) => r.kind === 'prod');
    expect(prod).toHaveLength(1);
    expect(prod[0].para).toBe('caresser en le flattant');
    expect(promptOf(prod[0])).toBe(note.promptFr);
  });
  it('saves back to the stored fields', () => {
    const f = rowFields(d);
    expect(f.sentence).toBe(note.sentence);
    expect(f.clozeSentence).toBeNull();
    expect(f.clozeHint).toBeNull();
    expect(f.altSentences).toEqual(['Avec ma mère aussi, il faut la {{prendre dans le sens du poil::顺着她（不定式）}}.', 'Ce commentateur caresse les fans {{dans le sens du poil::顺着毛}}.']);
    expect([f.promptFr, f.answerFr, f.intentZh, f.altIntents]).toEqual([note.promptFr, note.answerFr, '顺着老板', []]);
  });
  it('a paraphrase cannot replace a split expression: asks for a hand-written prompt', () => {
    const r = { ...newRow('prod', "Il ne {{se rend}} pas {{compte de}} sa chance."), para: 'voit' };
    const e = formErrors({ ...d, lemma: 'se rendre compte de', cardTypes: ['production'], rows: [r] }, null);
    expect(e.rows[r.key][0]).toMatch(/整句手写题面/);
  });
  it('changing the expression re-marks the rows not marked by hand', () => {
    const rows = [newRow('ex', 'Je me suis attaché à ce village.'), { ...newRow('ex', 'Je {{tiens}} à ce village.'), manual: true }];
    const r = remarkRows(rows, "s'attacher à qqn");
    expect(r.rows[0].text).toBe('Je {{me suis attaché à}} ce village.');
    expect(r.rows[1].text).toBe('Je {{tiens}} à ce village.');
    expect([r.changed, r.kept]).toEqual([1, 1]);
  });
});
