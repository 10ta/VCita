import { describe, expect, it } from 'vitest';
import { autoMark } from '../src/lib/markTarget';

// 测试里没有词典：只靠原形 / 词首相同；给几个不规则变位的小表
const tiny: Record<string, string> = { pris: 'prendre', rend: 'rendre', suis: 'être', sers: 'servir', tient: 'tenir', tiens: 'tenir', ai: 'avoir', a: 'avoir' };
const lem = (f: string) => (tiny[f.toLowerCase()] ? [tiny[f.toLowerCase()]] : []);
const m = (s: string, l: string) => autoMark(s, l, lem);

describe('autoMark', () => {
  it('marks the expression, inflected', () => {
    expect(m('Avec mon père, il faut le prendre dans le sens du poil.', 'prendre qqn dans le sens du poil')).toBe('Avec mon père, il faut le {{prendre dans le sens du poil}}.');
    expect(m('Ce commentateur caresse toujours les fans dans le sens du poil.', 'prendre qqn dans le sens du poil')).toBe('Ce commentateur caresse toujours les fans {{dans le sens du poil}}.');
    expect(m("Ces années à Paris ont teinté ma vision de la ville.", 'teinter qqch')).toBe('Ces années à Paris ont {{teinté}} ma vision de la ville.');
  });
  it('pronominal verbs take the pronoun and auxiliary along', () => {
    expect(m('Au fil des mois, je me suis attaché à ce petit village.', "s'attacher à qqn / qqch")).toBe('Au fil des mois, je {{me suis attaché à}} ce petit village.');
    expect(m("Il s'est attaché à elle.", "s'attacher à qqn")).toBe("Il {{s'est attaché à}} elle.");
    expect(m('Je me sers de mon vieux Pentax.', 'se servir de qqch')).toBe('Je {{me sers de}} mon vieux Pentax.');
  });
  it('split expressions are marked in pieces', () => {
    expect(m('Il ne se rend pas compte de la chance qu\'il a.', 'se rendre compte de qqch')).toBe("Il ne {{se rend}} pas {{compte de}} la chance qu'il a.");
    expect(m("Je suis content d'avoir ces trois idées en tête.", 'avoir qqch en tête')).toBe("Je suis content d'{{avoir}} ces trois idées {{en tête}}.");
  });
  it('nouns: the leading article of the lemma is not required', () => {
    expect(m("J'ai reçu une amende salée.", 'une amende')).toBe("J'ai reçu une {{amende}} salée.");
    expect(m('Les amendes ont doublé.', 'une amende')).toBe('Les {{amendes}} ont doublé.');
    expect(m('Après trois jours de procès, le verdict tombe enfin.', 'un procès, le verdict')).toMatch(/\{\{(procès|verdict)\}\}/);
  });
  it('a lone auxiliary stays outside, like existing cards', () => {
    expect(m("J'ai écopé d'une amende.", "écoper d'une amende")).toBe("J'ai {{écopé d'une amende}}.");
  });
  it('lemma notes: alternatives, = explanations, + grammar, hyphenated imperatives', () => {
    expect(m('Nombre d\'étudiants travaillent l\'été.', 'nombre de (+ nom pluriel, sans article)')).toBe("{{Nombre d'}}étudiants travaillent l'été.");
    expect(m('Le juge était entouré de deux assesseurs.', "un assesseur = l'assistant d'un juge")).toBe('Le juge était entouré de deux {{assesseurs}}.');
    expect(m("On progresse, à condition de parler.", 'à condition de + inf. / à condition que + subj.')).toBe('On progresse, {{à condition de}} parler.');
    expect(m("L'escalier est glissant, tiens-toi à la rampe.", 'se tenir à (la rampe)')).toBe("L'escalier est glissant, {{tiens-toi à}} la rampe.");
  });
  it('returns null when the expression is not there', () => {
    expect(m('Il fait beau aujourd\'hui.', 'prendre qqn dans le sens du poil')).toBeNull();
  });
  it('replaces existing marks', () => {
    expect(m('Je {{suis}} attaché à ce village.', "s'attacher à qqn")).toBe('Je suis {{attaché à}} ce village.');
  });
});
