import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useCards, useNotes, useSettings, useTodayLogs } from '../../db/hooks';
import { computeStats, type Retention } from '../../srs/stats';
import { buildQueue } from '../../srs/queue';
import { addDaysToDay, studyDay } from '../../lib/time';
import { useNow } from '../../ui/hooks';
import { TYPE_LABEL } from '../CardFace';

const pct = (r: Retention) => (r.rate === null ? '—' : `${Math.round(r.rate * 1000) / 10}%`);
const tone = (r: Retention) => (r.rate === null ? '' : r.rate >= 0.85 && r.rate <= 0.9 ? 'ok' : r.rate > 0.95 || r.rate < 0.8 ? 'warn' : '');

export function StatsPage({ deckId }: { deckId: string }) {
  const s = useSettings();
  const cards = useCards();
  const notes = useNotes();
  const [now] = useNow(60_000);
  const todayLogs = useTodayLogs(s?.dayStartHour, now);
  const from = s ? addDaysToDay(studyDay(now, s.dayStartHour), -29) : null;
  const logs = useLiveQuery(async () => (from ? db.logs.where('day').aboveOrEqual(from).toArray() : []), [from]);
  const st = useMemo(() => (s && cards && notes && logs ? computeStats({ cards, notes, logs, now, dayStartHour: s.dayStartHour, deckId }) : null), [s, cards, notes, logs, now, deckId]);
  const q = useMemo(() => (s && cards && todayLogs ? buildQueue({ cards, todayLogs, deckId, now, settings: s }) : null), [s, cards, todayLogs, deckId, now]);
  if (!s || !st || !q) return null;
  const max = Math.max(1, ...st.forecast);
  return (
    <div className="page stats-page">
      <section>
        <h2>保持率 <small className="muted">过去 14 天 · 参考 85%–90%</small></h2>
        <div className="kpis">
          <div className={`kpi ${tone(st.all)}`}><b>{pct(st.all)}</b><span>全部（{st.all.pass}/{st.all.total}）</span></div>
          <div className={`kpi ${tone(st.young)}`}><b>{pct(st.young)}</b><span>年轻卡（间隔 &lt;21 天）</span></div>
          <div className={`kpi ${tone(st.mature)}`}><b>{pct(st.mature)}</b><span>成熟卡（间隔 ≥21 天）</span></div>
        </div>
        <p className="hint">只统计复习状态的卡；评"困难"及以上算记住。
          {st.suggestion === 'more' && <b className="green"> 保持率高于 95%：可以多加新卡。</b>}
          {st.suggestion === 'less' && <b className="red"> 保持率低于 80%：减少新卡，先处理顽固卡。</b>}
        </p>
      </section>
      <section>
        <h2>按卡型 <small className="muted">过去 30 天</small></h2>
        <table className="stat-table">
          <thead><tr><th>卡型</th><th>保持率</th><th>复习卡次数</th><th>用时中位数</th><th>慢的 10%</th></tr></thead>
          <tbody>
            {st.byType.map((t) => (
              <tr key={t.type}>
                <td><span className={`badge is-type t-${t.type}`}>{TYPE_LABEL[t.type]}</span></td>
                <td className={tone(t.ret)}>{pct(t.ret)}</td>
                <td>{t.ret.total}</td>
                <td>{t.medianSec === null ? '—' : `${t.medianSec.toFixed(1)} 秒`}</td>
                <td>{t.p90Sec === null ? '—' : `≥ ${t.p90Sec.toFixed(0)} 秒`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">保持率只算复习状态的卡；用时不算超过 3 分钟的（多半是走开了）。哪一类明显偏低，就先改那一类：认读低 → 补例句、词源；产出低 → 换更简单的题面说法；用时长 → 卡片太难或信息太多。</p>
        {st.byTheme.length > 0 && (
          <>
            <h3 className="set-sub">按主题（复习 ≥ 15 次）</h3>
            <div className="kpis">
              {st.byTheme.map((t) => <div key={t.theme} className={`kpi ${tone(t.ret)}`}><b>{pct(t.ret)}</b><span>{t.theme}（{t.ret.pass}/{t.ret.total}）</span></div>)}
            </div>
          </>
        )}
      </section>
      <section>
        <h2>今日</h2>
        <div className="kpis">
          <div className="kpi"><b>{q.counts.review + q.counts.learning}</b><span>待复习（含学习中）</span></div>
          <div className="kpi"><b>{q.done.reviewDone}</b><span>已复习</span></div>
          <div className="kpi"><b>{q.done.newDone}/{s.newPerDay}</b><span>新卡已学 / 上限</span></div>
        </div>
      </section>
      <section>
        <h2>顽固卡</h2>
        <div className="kpis">
          <div className={`kpi ${st.leeches ? 'warn' : ''}`}><b>{st.leeches}</b><span>待改造（<a href="#/library">词库 → 待改造</a>）</span></div>
          <div className="kpi"><b>{st.leechesThisWeek}</b><span>最近 7 天又忘过的顽固卡</span></div>
        </div>
        <p className="hint">顽固卡数量不应持续增加。补例句、加线索后在词库里"恢复"。</p>
      </section>
      <section>
        <h2>未来 30 天到期 <small className="muted">用来判断新卡是不是加太多</small></h2>
        <div className="forecast">
          {st.forecast.map((n, i) => (
            <div key={i} className="bar" title={`${i === 0 ? '今天（含逾期）' : `${i} 天后`}：${n} 张`}>
              <span style={{ height: `${(n / max) * 100}%` }} />
              {i % 5 === 0 && <small>{i === 0 ? '今' : `+${i}`}</small>}
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>产出使用</h2>
        <div className="kpis">
          <div className="kpi"><b>{st.usedTotal}</b><span>累计用上</span></div>
          <div className="kpi"><b>{st.usedRecent}</b><span>最近两周新增</span></div>
        </div>
        <p className="hint">在复习产出卡时，或编辑笔记时点"用上了 +1"。</p>
      </section>
    </div>
  );
}
