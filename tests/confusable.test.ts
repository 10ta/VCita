import { describe, expect, it } from 'vitest';
import { findConfusables } from '../src/srs/confusable';
import { suggestClusters } from '../src/srs/clusterSuggest';
import { parseLinks } from '../src/lib/wikt';

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
  const wikt = parseLinks([
    'éminent\timminent',
    'conjoncture\tconjecture',
    'ver\t\tvers,verre,vert',
    'amende\t\tamande',
    'stupéfait\t\t\tsidéré,médusé',
  ].join('\n'));
  it('近音：Wiktionnaire 里任一方列了另一方就算（拼写差得远也能找到）', () => {
    const notes = [n('a', 'éminent', '杰出的'), n('b', 'imminent', '迫在眉睫的'), n('c', 'une conjecture', '猜测'), n('d', 'la conjoncture', '形势')];
    expect(findConfusables(notes)).toHaveLength(0);
    expect(findConfusables(notes, wikt).map((x) => x.reason)).toEqual(['近音：éminent / imminent', '近音：conjecture / conjoncture']);
  });
  it('同音：短词也算；同一组的不再提示；已经报过同音的不再报拼写相近', () => {
    const p = findConfusables([n('a', 'un ver', '虫子'), n('b', 'le verre', '玻璃；杯子'), n('c', 'vert', '绿色的')], wikt);
    expect(p.map((x) => x.reason).sort()).toEqual(['同音：ver / verre', '同音：ver / vert']);
    expect(findConfusables([n('a', 'un ver', '虫子', 'g'), n('b', 'le verre', '杯子', 'g')], wikt)).toHaveLength(0);
    expect(findConfusables([n('a', 'une amende', '罚款'), n('b', 'une amande', '杏仁')], wikt).map((x) => x.reason)).toEqual(['同音：amande / amende']);
  });
  it('索引为空或没加载到时，结果和不传索引完全一样', () => {
    const notes = [n('a', 'teinter qqch', '给…染上色彩；染'), n('b', 'colorer', '染上色彩；着色'), n('c', 'une amende', '罚款'), n('d', 'une amande', '杏仁'), n('e', 'un ver', '虫子'), n('f', 'le verre', '杯子')];
    const base = findConfusables(notes);
    expect(findConfusables(notes, null)).toEqual(base);
    expect(findConfusables(notes, new Map())).toEqual(base);
    expect(findConfusables(notes, parseLinks('# 占位\n'))).toEqual(base);
  });
  it('表达群建议：互为同义词、不在同一个群里；一边有群就并进去，各有各的群不建议', () => {
    const c = (id: string, lemma: string, meaningZh: string, cluster: string | null = null) => ({ id, lemma, meaningZh, cluster, deleted: false });
    expect(suggestClusters([c('a', 'stupéfait', '惊呆的；愣住'), c('b', 'sidéré', '惊愕的')], wikt)).toEqual([{ a: 'a', b: 'b', cluster: '说「惊呆的」', fresh: true, join: ['a', 'b'] }]);
    expect(suggestClusters([c('a', 'stupéfait', '惊呆的', '惊呆了'), c('b', 'sidéré', '惊愕的')], wikt)).toEqual([{ a: 'a', b: 'b', cluster: '惊呆了', fresh: false, join: ['b'] }]);
    expect(suggestClusters([c('a', 'stupéfait', '惊呆的', '惊呆了'), c('b', 'sidéré', '惊愕的', '惊呆了')], wikt)).toEqual([]);
    expect(suggestClusters([c('a', 'stupéfait', '惊呆的', '甲'), c('b', 'sidéré', '惊愕的', '乙')], wikt)).toEqual([]);
    expect(suggestClusters([c('a', 'stupéfait', '惊呆的'), c('b', 'sidéré', '惊愕的')], null)).toEqual([]);
  });
});
