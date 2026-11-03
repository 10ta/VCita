import { describe, expect, it } from 'vitest';
import { findConfusables } from '../src/srs/confusable';

const n = (id: string, lemma: string, meaningZh: string, contrastGroup: string | null = null) => ({ id, lemma, meaningZh, contrastGroup, deleted: false });

describe('可能易混', () => {
  it('意思相近：同一个不常见的中文词；同词族不算', () => {
    const p = findConfusables([n('a', 'teinter qqch', '给…染上色彩；染'), n('b', 'colorer', '染上色彩；着色'), n('c', 'la coloration', '着色')]);
    expect(p.map((x) => [x.a, x.b].sort().join())).toEqual(expect.arrayContaining(['a,b']));
    expect(p.some((x) => [x.a, x.b].sort().join() === 'b,c')).toBe(false); // colorer / coloration 同词族
  });
  it('拼写相近只差一个字母、不是首字母；已经在同一组的不再提示', () => {
    expect(findConfusables([n('a', 'une amende', '罚款'), n('b', 'une amande', '杏仁')])).toHaveLength(1);
    expect(findConfusables([n('a', 'mettre', '放'), n('b', 'une lettre', '信')])).toHaveLength(0);
    expect(findConfusables([n('a', 'une amende', '罚款', 'g'), n('b', 'une amande', '杏仁', 'g')])).toHaveLength(0);
  });
});
