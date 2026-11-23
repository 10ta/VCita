// 出题队列的唯一入口：顶部导航的计数、复习页、统计页都用它，三处的数字一定一样
import { useEffect, useMemo } from 'react';
import { useCards, useDeckSettings, useNotes, useTodayLogs } from '../../db/hooks';
import { buildQueue, type QueueState } from '../../srs/queue';
import { saveNewPlan, useNewPlans } from '../../ui/newPlan';
import { useNoteFreqs } from '../FrText';

export function useDeckQueue(deckId: string | null, opts: { now: number; skipped?: Set<string>; learnAheadAll?: boolean }): QueueState | null {
  const s = useDeckSettings(deckId);
  const cards = useCards();
  const notes = useNotes();
  const logs = useTodayLogs(s?.dayStartHour, opts.now);
  const freq = useNoteFreqs();
  const plans = useNewPlans();
  const noteMap = useMemo(() => (notes ? new Map(notes.map((n) => [n.id, n])) : undefined), [notes]);
  const stored = deckId ? plans[deckId] : undefined;
  // 新的计划要等词频表加载好再做（新卡按常用程度排序）；没加载好之前先临时算，不保存
  const planIn = stored ?? (freq ? null : undefined);
  const q = useMemo(
    () => (s && cards && noteMap && logs && deckId
      ? buildQueue({ cards, todayLogs: logs, deckId, now: opts.now, settings: s, skipped: opts.skipped, learnAheadAll: opts.learnAheadAll, notes: noteMap, freq, newPlan: planIn })
      : null),
    [s, cards, noteMap, logs, deckId, opts.now, opts.skipped, opts.learnAheadAll, freq, planIn],
  );
  useEffect(() => {
    if (q && planIn !== undefined && q.newPlan !== stored) saveNewPlan(q.newPlan);
  }, [q, planIn, stored]);
  return q;
}
