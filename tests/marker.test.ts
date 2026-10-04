import { describe, expect, it } from 'vitest';
import { fromTokens, toTokens } from '../src/features/NoteParts';

const toggle = (v: string, word: string) => {
  const t = toTokens(v);
  const i = t.findIndex((x) => x.t === word);
  return fromTokens(t.map((x, j) => (j === i ? { ...x, on: !x.on } : x)));
};

describe('点词标记', () => {
  it('原样往返', () => {
    for (const s of ['Il faut tenir compte de l’avis.', 'a {{b c}} d', "les enfants ont perdu leurs {{repères}}."]) expect(fromTokens(toTokens(s))).toBe(s);
  });
  it('点一个词 → 包上 {{}}；标点不进括号', () => {
    expect(toggle('ont perdu leurs repères.', 'repères')).toBe('ont perdu leurs {{repères}}.');
  });
  it('相邻的词合并成一个考查部分；中间断开则分成两个', () => {
    let s = 'Il faut tenir compte de ça';
    for (const w of ['tenir', 'compte', 'de']) s = toggle(s, w);
    expect(s).toBe('Il faut {{tenir compte de}} ça');
    expect(toggle(s, 'compte')).toBe('Il faut {{tenir}} compte {{de}} ça');
  });
  it('省音词可以只标后半：l’{{avis}}', () => {
    expect(toggle("de l'avis des gens", 'avis')).toBe("de l'{{avis}} des gens");
  });
  it('再点一次取消', () => {
    expect(toggle('leurs {{repères}}.', 'repères')).toBe('leurs repères.');
  });
});
