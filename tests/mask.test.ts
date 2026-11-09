// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isMasked } from '../src/features/FrText';

// 听力卡没揭开的文字悬停不弹阴阳性迷你条，免得把要听的词直接露出来
const card = (peek: 0 | 1 | 2) => {
  document.body.innerHTML = `<div class="answer listen-mask peek-${peek}"><div class="a1"><span>ce lecteur est devenu <span data-fw="lecteur" id="ctx">lecteur</span> <b class="cloze"><span data-fw="obsolète" id="ans">obsolète</span></b></span></div></div><p><span data-fw="mot" id="out">mot</span></p>`;
  const $ = (id: string) => document.getElementById(id)!;
  return { ctx: $('ctx'), ans: $('ans'), out: $('out') };
};

describe('listening mask hides the gender popover', () => {
  it('peek 0: the whole line is masked', () => {
    const { ctx, ans, out } = card(0);
    expect([isMasked(ctx), isMasked(ans), isMasked(out)]).toEqual([true, true, false]);
  });
  it('peek 1: context shows, the part to hear stays masked', () => {
    const { ctx, ans } = card(1);
    expect([isMasked(ctx), isMasked(ans)]).toEqual([false, true]);
  });
  it('peek 2: nothing masked', () => {
    const { ctx, ans } = card(2);
    expect([isMasked(ctx), isMasked(ans)]).toEqual([false, false]);
  });
  it('data-masked works anywhere', () => {
    document.body.innerHTML = '<div data-masked><span data-fw="x" id="m">x</span></div>';
    expect(isMasked(document.getElementById('m')!)).toBe(true);
  });
});
