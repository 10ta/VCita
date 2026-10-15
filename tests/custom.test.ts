import { describe, expect, it } from 'vitest';
import { nextQueue, pickCustom } from '../src/srs/custom';

const S = { label: 'x', queue: ['a', 'b', 'c', 'd', 'e'], total: 5, done: 0 };
describe('自定义学习队列', () => {
  it('忘了 → 隔 3 张；困难 → 最后；良好 → 完成', () => {
    expect(nextQueue(S, 'a', 1).queue).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(nextQueue(S, 'a', 2).queue).toEqual(['b', 'c', 'd', 'e', 'a']);
    const g = nextQueue(S, 'a', 3);
    expect([g.queue, g.done]).toEqual([['b', 'c', 'd', 'e'], 1]);
    expect(nextQueue({ ...S, queue: ['a', 'b'] }, 'a', 1).queue).toEqual(['b', 'a']);
  });
});

describe('自定义学习：兄弟卡隔开', () => {
  const c = (id: string, noteId: string, suspended = false) => [id, { id, noteId, suspended }] as const;
  const m = new Map([c('p', 'n1'), c('z', 'n1'), c('x', 'n2'), c('y', 'n3'), c('s', 'n4', true)]);
  it('刚答过的笔记的卡往后挪；只剩兄弟卡时才出', () => {
    expect(pickCustom(['z', 'x'], m, ['n1'])).toBe('x');
    expect(pickCustom(['z', 's', 'x'], m, ['n1'])).toBe('x');
    expect(pickCustom(['z'], m, ['n1'])).toBe('z');
    expect(pickCustom(['z', 'y'], m, ['n1', 'n2', 'n3', 'n4'])).toBe('z'); // n1 已经隔了 3 张
  });
});
