import { describe, expect, it } from 'vitest';
import { splitForTts } from '../src/lib/speech';

describe('splitForTts', () => {
  it('短句不切', () => {
    expect(splitForTts('Bonjour à tous.')).toEqual(['Bonjour à tous.']);
  });
  it('长句按句号、逗号切，每段不超过上限，拼回来不丢字', () => {
    const t = "Quand je suis arrivé à Lyon pour mes études, je ne comprenais presque rien aux conversations des autres étudiants. Il m'a fallu des mois, beaucoup de patience et des centaines d'heures de séries pour enfin suivre une discussion rapide sans demander de répéter.";
    const parts = splitForTts(t);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(180);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(t);
    expect(parts[0].endsWith('études,') || parts[0].endsWith('étudiants.')).toBe(true);
  });
});
