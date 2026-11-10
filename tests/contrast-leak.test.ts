import { describe, expect, it } from 'vitest';
import { contrastLeaks } from '../src/schema/validate';

const tenir = [{ lemma: 'tenir à qqch / qqn' }, { lemma: 'se tenir à (la rampe)' }, { lemma: "s'en tenir à qqch" }];
const n = (lemma: string, sentence: string, altSentences: string[] = []) => ({ lemma, sentence, altSentences });

describe('contrast card leaks', () => {
  it('reflexive pronoun outside the blank gives away a pronominal verb', () => {
    expect(contrastLeaks(n("s'attacher à qqn / qqch", 'Au fil des mois, je me suis {{attaché à}} ce petit village.'), tenir)).toHaveLength(1);
    expect(contrastLeaks(n("s'attacher à qqn / qqch", 'Au fil des mois, je {{me suis attaché à}} ce petit village.'), tenir)).toEqual([]);
    expect(contrastLeaks(n('se servir de qqch', 'Je me {{sers de}} mon vieux Pentax.'), [{ lemma: 'servir à (+ inf.)' }])).toHaveLength(1);
    // tout le monde est (ou n'est pas) pronominal : pas de fuite
    expect(contrastLeaks(n('se tenir à (la rampe)', 'Il faut se {{tenir à}} la rampe.'), [{ lemma: "s'accrocher à qqch" }])).toEqual([]);
  });
  it('gendered determiner before the blank when the group mixes genders', () => {
    expect(contrastLeaks(n('la journée', "J'ai enchaîné trois réunions dans la même {{journée}}."), [{ lemma: 'le jour' }])).toHaveLength(1);
    expect(contrastLeaks(n('la journée', '{{Quelle journée}} ! Trois réunions et un dossier à rendre.'), [{ lemma: 'le jour' }])).toEqual([]);
    expect(contrastLeaks(n('le jour', 'Je bois trois cafés par {{jour}}.'), [{ lemma: 'la journée' }])).toEqual([]);
    // même genre : un vrai bienfait / le bénéfice
    expect(contrastLeaks(n('un bienfait', 'Ce soleil est un vrai {{bienfait}}.'), [{ lemma: 'le bénéfice' }])).toEqual([]);
  });
  it('a preposition right after the blank when members take different ones', () => {
    expect(contrastLeaks(n('servir à (+ inf.)', 'Ce trépied ne {{sert}} à rien.'), [{ lemma: 'se servir de qqch' }])).toHaveLength(1);
    expect(contrastLeaks(n('servir à (+ inf.)', 'Ce trépied ne {{sert à}} rien.'), [{ lemma: 'se servir de qqch' }])).toEqual([]);
  });
  it('checks alternative sentences too', () => {
    expect(contrastLeaks(n("s'attacher à qqn / qqch", 'Je {{me suis attaché à}} ce village.', ['On se {{attache}} vite aux gens ici.']), tenir)[0]).toMatch(/备用例句 1/);
  });
});
it('same preposition in every member is not a clue', () => {
  expect(contrastLeaks({ lemma: 'le sentiment de (+ inf.)', sentence: "Le bénévolat donne le {{sentiment}} d'être utile." }, [{ lemma: "le sens de (l'humour, du devoir)" }])).toEqual([]);
});

import { pickIntent, variantCount } from '../src/features/CardFace';
import { NoteV2 } from '../src/schema/v2';
it('an alternative prompt identical to the main one is not counted twice', () => {
  const note = NoteV2.parse({ id: 'n1', deckId: 'd', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', lemma: 'x', sentence: '{{x}}', meaningZh: '', meaningEn: '', cardTypes: ['production'],
    promptFr: 'A {{b}}.', answerFr: 'A {{c}}.', intentZh: 'z',
    altIntents: [{ promptFr: 'A {{b}}.', answerFr: 'A {{c}}.', intentZh: 'z' }, { promptFr: 'D {{e}}.', answerFr: 'D {{f}}.', intentZh: 'y' }, { promptFr: 'D {{e}}.', answerFr: 'D {{f}}.', intentZh: 'y' }] });
  expect(variantCount(note).intents).toBe(2);
  expect([0, 1, 2, 3].map((v) => pickIntent(note, v).promptFr)).toEqual(['A {{b}}.', 'D {{e}}.', 'A {{b}}.', 'D {{e}}.']);
});

import { choiceLabel } from '../src/schema/validate';
describe('contrast choices', () => {
  it('option labels drop the examples in parentheses and later alternatives', () => {
    expect(choiceLabel("le sens de (l'humour, du devoir)")).toBe('le sens de');
    expect(choiceLabel('le sentiment de + inf.')).toBe('le sentiment de + inf.');
    expect(choiceLabel('dépourvu de qqch ; prendre qqn au dépourvu')).toBe('dépourvu de qqch');
    expect(choiceLabel('se tenir à (la rampe)')).toBe('se tenir à');
  });
  it('a word outside the blank that only this option carries gives the answer away', () => {
    const r = contrastLeaks({ lemma: 'un vrai sens du rythme', sentence: 'Il a un vrai {{sens du}} rythme.' }, [{ lemma: 'le sentiment de + inf.' }]);
    expect(r.join()).toMatch(/rythme/);
    expect(contrastLeaks({ lemma: "le sens de (l'humour, du devoir)", sentence: "Il faut un vrai {{sens de}} l'humour pour supporter ce chef." }, [{ lemma: 'le sentiment de + inf.' }])).toEqual([]);
  });
});

import { blankEchoes } from '../src/schema/validate';
it('a blanked word that shows up again elsewhere in the sentence', () => {
  expect(blankEchoes("Beaucoup de gens {{se vantent de}} ne rien comprendre, alors que personne n'oserait se vanter de ne pas savoir lire.")).toEqual(['vantent']);
  expect(blankEchoes('Il faut un vrai {{sens de}} l\'humour pour supporter ce chef.')).toEqual([]);
});
