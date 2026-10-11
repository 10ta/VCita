import { describe, expect, it } from 'vitest';
import { nextQueue } from '../src/srs/custom';

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
