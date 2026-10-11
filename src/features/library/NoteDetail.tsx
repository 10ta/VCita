// 词库里展开一条笔记：每张卡的调度状态 + 复习历史
import { useNoteLogs } from '../../db/hooks';
import type { Card, Settings } from '../../schema';
import { fmtDays, fromIso } from '../../lib/time';
import { CardStats, TYPE_LABEL } from '../CardFace';

const RATING = ['', '忘了', '困难', '良好', '容易'];
const RCLS = ['', 'is-red', 'is-warn', 'is-green', 'is-blue'];
const fmtIvl = (d: number | null) => (d === null ? '—' : d === 0 ? '0' : fmtDays(d));

export function NoteDetail({ noteId, cards, s }: { noteId: string; cards: Card[]; s: Settings }) {
  const logs = useNoteLogs(noteId);
  const typeOf = new Map(cards.map((c) => [c.id, c.type]));
  const sorted = [...cards].sort((a, b) => ['recognition', 'production', 'cloze'].indexOf(a.type) - ['recognition', 'production', 'cloze'].indexOf(b.type));
  return (
    <div className="note-detail">
      {sorted.map((c) => {
        const ls = (logs ?? []).filter((l) => l.cardId === c.id);
        const fails = ls.filter((l) => l.rating === 1).length;
        return (
          <div key={c.id} className="nd-card">
            <span className={`badge is-type t-${c.type}`}>{TYPE_LABEL[c.type]}</span>
            <CardStats card={c} s={s} />
            <span className="muted small">复习 {ls.length} 次{ls.length ? ` · 忘了 ${fails} 次` : ''}</span>
            {/* 最近 20 次评分，从旧到新 */}
            <span className="nd-dots" title="最近的评分，从旧到新">
              {ls.slice(0, 20).reverse().map((l) => <i key={l.id} className={`dot r${l.rating}`} title={`${l.day} ${RATING[l.rating]}`} />)}
            </span>
          </div>
        );
      })}
      {logs && logs.length > 0 ? (
        <table className="nd-log">
          <thead><tr><th>时间</th><th>卡</th><th>评分</th><th>间隔</th><th>倍率</th></tr></thead>
          <tbody>
            {logs.slice(0, 50).map((l) => (
              <tr key={l.id}>
                <td>{new Date(fromIso(l.ts)).toLocaleString([], { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{TYPE_LABEL[typeOf.get(l.cardId) ?? 'recognition']}</td>
                <td><span className={`stat ${RCLS[l.rating]}`}>{RATING[l.rating]}</span></td>
                <td>{fmtIvl(l.prevInterval)} → {fmtIvl(l.newInterval)}</td>
                <td>{l.prevEase?.toFixed(2) ?? '—'}{l.newEase !== null && l.newEase !== l.prevEase ? ` → ${l.newEase.toFixed(2)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">还没有复习记录</p>
      )}
      {logs && logs.length > 50 && <p className="muted small">只显示最近 50 次（共 {logs.length} 次）</p>}
    </div>
  );
}
