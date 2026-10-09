import { describe, expect, it } from 'vitest';
import { preview, schedule, type SrsParams } from '../src/srs/scheduler';
import { SettingsSchema } from '../src/schema';
import { studyDay, fromIso, toIso } from '../src/lib/time';

const P: SrsParams = { ...SettingsSchema.parse({ updatedAt: toIso(0) }), fuzz: false };
const NOW = new Date(2026, 9, 3, 15, 0).getTime(); // 2026-10-03 15:00
const reviewCard = (over = {}) => ({
  state: 'review' as const, due: toIso(NOW), interval: 10, ease: 2.5, reps: 5, lapses: 0, step: 0,
  lastReviewedAt: null, isLeech: false, suspended: false, ...over,
});
const newCard = () => ({ ...reviewCard(), state: 'new' as const, interval: 0, reps: 0 });
const dueDay = (c: { due: string }) => studyDay(fromIso(c.due), P.dayStartHour);

describe('文档 §9 调度验收（interval=10, ease=2.5, 关闭扰动）', () => {
  it('良好 → 25，ease 不变', () => {
    const { card } = schedule(reviewCard(), 3, NOW, P);
    expect([card.interval, card.ease, card.state]).toEqual([25, 2.5, 'review']);
    expect(dueDay(card)).toBe('2026-10-28');
  });
  it('困难 → 12，ease 2.35', () => {
    const { card } = schedule(reviewCard(), 2, NOW, P);
    expect([card.interval, card.ease]).toEqual([12, 2.35]);
  });
  it('容易 → 33，ease 2.65', () => {
    const { card } = schedule(reviewCard(), 4, NOW, P);
    expect([card.interval, card.ease]).toEqual([33, 2.65]);
  });
  it('忘了 → lapses+1，ease 2.3，进入重学；重学完成后间隔 5', () => {
    const r1 = schedule(reviewCard(), 1, NOW, P);
    expect([r1.card.state, r1.card.lapses, r1.card.ease]).toEqual(['relearning', 1, 2.3]);
    expect(fromIso(r1.card.due) - NOW).toBe(10 * 60_000);
    const r2 = schedule(r1.card, 3, NOW + 10 * 60_000, P);
    expect([r2.card.state, r2.card.interval]).toEqual(['review', 5]);
  });
});

describe('逾期答对加成（带上限）', () => {
  const DAY = 86400000;
  it('逾期 8 天：困难 +2、良好 +10、容易 +26（未超上限）', () => {
    const c = reviewCard({ due: toIso(NOW - 8 * DAY) });
    // 困难 (10+2)*1.2=14.4→14；良好 (10+4)*2.5=35；容易 (10+8)*2.5*1.3=58.5→59
    expect([2, 3, 4].map((r) => schedule(c, r as 2 | 3 | 4, NOW, P).card.interval)).toEqual([14, 35, 59]);
    const pv = preview(c, P, NOW);
    expect([pv[2], pv[3], pv[4]]).toEqual([{ days: 14 }, { days: 35 }, { days: 59 }]);
  });
  it('额外天数不超过上限；上限 0 = 不加成；忘了不受影响', () => {
    const c = reviewCard({ due: toIso(NOW - 158 * DAY), interval: 1, ease: 1.9 });
    // 无加成：困难 2、良好 3、容易 4；良好有加成 (1+79)*1.9=152 → 封顶 3+30
    expect(schedule(c, 3, NOW, P).card.interval).toBe(33);
    expect(schedule(c, 3, NOW, { ...P, overdueBonusMaxDays: 0 }).card.interval).toBe(3);
    expect(schedule(c, 3, NOW, { ...P, overdueBonusMaxDays: 5 }).card.interval).toBe(8);
    expect(schedule(c, 1, NOW, P).card.interval).toBe(1);
  });
});

describe('学习步骤', () => {
  it('新卡：良好 → 10 分钟 → 良好 → 第二天 4 点 → 良好 → 毕业 3 天', () => {
    const a = schedule(newCard(), 3, NOW, P);
    // 新卡第一下"良好"从第 0 步进到第 1 步（1 天）
    expect([a.card.state, a.card.step]).toEqual(['learning', 1]);
    expect(a.card.due).toBe(toIso(new Date(2026, 9, 4, 4).getTime()));
    const b = schedule(a.card, 3, fromIso(a.card.due), P);
    expect([b.card.state, b.card.interval]).toEqual(['review', 3]);
    expect(dueDay(b.card)).toBe('2026-10-07');
  });
  it('新卡：忘了 → 10 分钟后；容易 → 直接毕业 4 天', () => {
    expect(fromIso(schedule(newCard(), 1, NOW, P).card.due) - NOW).toBe(600_000);
    const e = schedule(newCard(), 4, NOW, P).card;
    expect([e.state, e.interval]).toEqual(['review', 4]);
  });
  it('凌晨 2 点（切换前）学的卡，"1 天"步骤到当天 4 点后的下一个学习日', () => {
    const t = new Date(2026, 9, 4, 2).getTime(); // 仍属 10-03 学习日
    const a = schedule({ ...newCard(), state: 'learning' as const, step: 0 }, 3, t, P);
    expect(a.card.due).toBe(toIso(new Date(2026, 9, 4, 4).getTime()));
  });
  it('预览与实际一致', () => {
    const pv = preview(reviewCard(), P, NOW);
    expect(pv).toEqual({ 1: { minutes: 10 }, 2: { days: 12 }, 3: { days: 25 }, 4: { days: 33 } });
  });
});

describe('顽固卡', () => {
  it('遗忘达到阈值时自动暂停', () => {
    const r = schedule(reviewCard({ lapses: 7 }), 1, NOW, P);
    expect([r.card.lapses, r.card.isLeech, r.card.suspended, r.leechNow]).toEqual([8, true, true, true]);
  });
  it('ease 不低于下限', () => {
    expect(schedule(reviewCard({ ease: 1.35 }), 1, NOW, P).card.ease).toBe(1.3);
  });
});

describe('扰动', () => {
  it('打开扰动时间隔在 ±5% 内', () => {
    const PF = { ...P, fuzz: true };
    for (let i = 0; i < 50; i++) {
      const ivl = schedule(reviewCard({ interval: 100 }), 3, NOW, PF).card.interval;
      expect(ivl).toBeGreaterThanOrEqual(237);
      expect(ivl).toBeLessThanOrEqual(263);
    }
  });
});
