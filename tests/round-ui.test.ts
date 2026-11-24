// 下一张卡的发音预载范围、说明的分组和搜索、新版本检查
import { describe, expect, it } from 'vitest';
import { speakables } from '../src/features/review/ReviewPage';
import { HELP, searchHelp } from '../src/features/Help';
import { deployedBuild } from '../src/ui/UpdateBadge';

describe('预载发音：题面和背面每一个能读的面，不看自动读设置', () => {
  it('题面 + 所有答案，空的跳过，重复的只下载一次', () => {
    const v = {
      question: { speakText: 'Elle a enfin réussi à s’affranchir du regard des autres.', lang: 'fr' },
      answers: [
        { speakText: 'Elle a enfin réussi à s’affranchir du regard des autres.', lang: 'fr' },
        { speakText: '摆脱、挣脱', lang: 'zh-CN' },
        { speakText: '', lang: 'en' },
      ],
    };
    expect(speakables(v)).toEqual([
      { text: 'Elle a enfin réussi à s’affranchir du regard des autres.', lang: 'fr' },
      { text: '摆脱、挣脱', lang: 'zh-CN' },
    ]);
  });
  it('挖空卡题面不读（speakText 为空），背面的整句照样预载', () => {
    expect(speakables({ question: { speakText: '', lang: 'fr' }, answers: [{ speakText: 'phrase', lang: 'fr' }] })).toEqual([{ text: 'phrase', lang: 'fr' }]);
  });
});

describe('说明', () => {
  it('四组，每组都有小节，条目一条没丢', () => {
    expect(HELP.map((g) => g.title)).toEqual(['复习', '卡片', '排期', '工具']);
    expect(HELP.every((g) => g.sections.length >= 3)).toBe(true);
    expect(HELP.flatMap((g) => g.sections.flatMap((s) => s.rows)).length).toBe(94);
  });
  it('搜索跨组，按「组 · 小节」列出', () => {
    const hits = searchHelp('表达群');
    expect(hits.some((h) => h.where === '复习 · 卡片背面')).toBe(true);
    expect(searchHelp('   ')).toEqual([]);
  });
});

describe('新版本检查', () => {
  const res = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  it('取到部署的构建编号；取不到时返回 null', async () => {
    expect(await deployedBuild(res({ build: '2026-11-15T15:00:00.000Z' }))).toBe('2026-11-15T15:00:00.000Z');
    expect(await deployedBuild(res({}, false))).toBeNull();
    expect(await deployedBuild((async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
  });
});
