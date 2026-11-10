import { useState } from 'react';
import type { Card, Note } from '../../schema';
import { clusterRecall, type ClusterOutcome } from '../../db/actions';
import { daysBetween, fmtDays, fromIso, studyDay } from '../../lib/time';
import { useSettings } from '../../db/hooks';
import { Fr } from '../FrText';

const MAX = 6;
/** 第一个中文意思；括号里带法语的去掉（「铺天盖地的指控（un déluge de …）」会直接露出答案） */
export const firstMeaning = (n: Note) =>
  (n.meaningZh ?? '').split(/[；;]/)[0].replace(/\s*[(（][^)）]*[A-Za-zÀ-ÿœ][^)）]*[)）]/g, '').trim() || n.meaningEn || '（没写意思）';

const TYPE: Partial<Record<Card['type'], string>> = { production: '产出', recognition: '认读' };

/**
 * 表达群：背面只告诉「这个意思还有几种说法」，不给任何提示，先自己纯回忆；
 * 看答案后勾上想起来的，确定：
 * 想起来的 → 产出卡（没有就认读卡）隐性记一次「困难」，只往后推；没想起来的 → 那张卡提前到明天
 */
export function ClusterStrip({ note, notes, cards }: { note: Note; notes: Note[]; cards: Card[] }) {
  const name = note.cluster?.trim();
  if (!name) return null;
  const mates = notes.filter((n) => n.id !== note.id && !n.deleted && n.cluster?.trim() === name)
    .sort((a, b) => a.lemma.localeCompare(b.lemma, 'fr'));
  if (!mates.length) return null;
  const learned = new Set(cards.filter((c) => !c.deleted && c.state !== 'new').map((c) => c.noteId));
  return <Strip key={note.id} name={name} known={mates.filter((m) => learned.has(m.id)).slice(0, MAX)} fresh={mates.filter((m) => !learned.has(m.id))} />;
}

function Strip({ name, known, fresh }: { name: string; known: Note[]; fresh: Note[] }) {
  const [phase, setPhase] = useState<'ask' | 'reveal' | 'done'>('ask');
  const [got, setGot] = useState<Set<string>>(new Set());
  const [res, setRes] = useState<Map<string, ClusterOutcome>>(new Map());
  const [busy, setBusy] = useState(false);
  const s = useSettings();

  const submit = async () => {
    setBusy(true);
    const out = new Map<string, ClusterOutcome>();
    for (const m of known) out.set(m.id, await clusterRecall(m.id, got.has(m.id)));
    setRes(out); setPhase('done'); setBusy(false);
  };
  const rel = (iso: string) => {
    const d = daysBetween(studyDay(Date.now(), s?.dayStartHour ?? 4), studyDay(fromIso(iso), s?.dayStartHour ?? 4));
    return d <= 0 ? '今天' : d === 1 ? '明天' : `${fmtDays(d)}后`;
  };
  const outcome = (m: Note) => {
    const r = res.get(m.id); if (!r) return null;
    const t = r.type ? TYPE[r.type] ?? '' : '';
    const ok = got.has(m.id);
    let text: string;
    if (r.kind === 'credited') text = `${t}卡 ${rel(r.from!)} → ${rel(r.to!)}`;
    else if (r.kind === 'pulled') text = `${t}卡 ${rel(r.from!)} → 明天`;
    else if (!r.type) text = ok ? '还没进复习，不动' : '已标记（还没进复习）';
    else text = ok ? `${t}卡不用动（今天已复习或已排得够远）` : `${t}卡明天前本来就到期`;
    const hint = !ok && r.misses >= 2
      ? (r.hasProduction ? ` · 第 ${r.misses} 次没想起，考虑改造（换例句、补用法）` : ` · 第 ${r.misses} 次没想起，建议加产出卡`) : '';
    return <span className={ok ? 'cl-ok' : 'cl-miss'}>{ok ? '✓' : '✗'} {text}{hint}</span>;
  };

  const freshLine = fresh.length > 0 && (
    <ul className="cl-fresh">{fresh.slice(0, MAX).map((m) => (
      <li key={m.id} className="cluster-mate is-new"><span className="cl-mean">{firstMeaning(m)}</span><span className="muted">还没学</span></li>
    ))}</ul>
  );

  return (
    <div className="cluster small">
      <div className="cluster-head">
        <span className="muted">表达群 · </span><b>{name}</b>
        {known.length > 0
          ? <span className="muted"> · 还有 <b className="cl-count">{known.length}</b> 种说法你学过{fresh.length ? `（另有 ${fresh.length} 种还没学）` : ''}，先在心里说出来</span>
          : <span className="muted"> · 另有 {fresh.length} 种说法，都还没学</span>}
      </div>
      {known.length > 0 && phase === 'ask' && (
        <button type="button" className="pill" onClick={() => setPhase('reveal')}>看答案</button>
      )}
      {known.length > 0 && phase !== 'ask' && (
        <>
          <ul>
            {known.map((m) => (
              <li key={m.id} className="cluster-mate">
                {phase === 'reveal' ? (
                  <label className="cl-check">
                    <input type="checkbox" checked={got.has(m.id)} onChange={(e) => {
                      const next = new Set(got); if (e.target.checked) next.add(m.id); else next.delete(m.id);
                      setGot(next); e.currentTarget.blur();
                    }} />
                    <span className="cl-lemma"><Fr>{m.lemma}</Fr></span>
                  </label>
                ) : <span className="cl-lemma"><Fr>{m.lemma}</Fr></span>}
                <span className="cl-mean">{firstMeaning(m)}</span>
                {phase === 'done' && outcome(m)}
              </li>
            ))}
          </ul>
          {phase === 'reveal' && (
            <div className="cl-btns">
              <button type="button" className="pill" disabled={busy} title="勾上的往后推一点（按困难）；没勾的提前到明天复习" onClick={() => void submit()}>
                确定（想起 {got.size} / {known.length}）
              </button>
              <span className="muted">勾上想起来的，没勾的明天再练</span>
            </div>
          )}
        </>
      )}
      {(known.length === 0 || phase !== 'ask') && freshLine}
    </div>
  );
}
