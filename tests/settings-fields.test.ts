import { describe, expect, it } from 'vitest';
import { DEFAULTS, META, defText, fmtValue } from '../src/features/settings/fields';
import type { Settings } from '../src/schema';

describe('settings defaults', () => {
  it('every setting shown has a default text, and number defaults are within their own limits', () => {
    for (const [k, m] of Object.entries(META)) {
      expect(defText(k as keyof Settings), k).toBeTruthy();
      if (m?.kind === 'num') {
        const v = (DEFAULTS[k as keyof Settings] as number) * (m.scale ?? 1);
        if (m.min != null) expect(v, k).toBeGreaterThanOrEqual(m.min);
        if (m.max != null) expect(v, k).toBeLessThanOrEqual(m.max);
      }
    }
  });
  it('formats values the way the page shows them', () => {
    expect(defText('newPerDay')).toBe('20 张');
    expect(defText('reviewsPerDay')).toBe('0（不限）');
    expect(defText('desiredRetention')).toBe('90 %');
    expect(defText('retentionRecognition')).toBe('85 %');
    expect(defText('learningSteps')).toBe('10 1440 分钟');
    expect(defText('newReviewOrder')).toBe('穿插在复习中');
    expect(defText('genderDisplay')).toBe('只标考查部分');
    expect(fmtValue('productionAfterRecognition', false)).toBe('关');
    expect(defText('fuzzPercent')).toBe('±5%');
  });
});
