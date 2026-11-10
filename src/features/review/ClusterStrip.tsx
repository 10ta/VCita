import { useRef, useState } from 'react';
import type { Card, Note } from '../../schema';
import { clusterRecall, undoClusterRecall, type ClusterOutcome } from '../../db/actions';
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
 * 看答案后点每一行切换：灰（不记）→ 绿（想起来了）→ 红（没想起来）→ 灰，点了立即生效，切换时先撤回上一次：
 * 绿 → 产出卡（没有就认读卡）隐性记一次「困难」，只往后推；红 → 那张卡提前到明天
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

type Mark = 'ok' | 'miss';
const NEXT: Record<'none' | Mark, 'none' | Mark> = { none: 'ok', ok: 'miss', miss: 'none' };

function Strip({ name, known, fresh }: { name: string; known: Note[]; fresh: Note[] }) {
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [res, setRes] = useState<Record<string, ClusterOutcome>>({});
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const s = useSettings();

  // 点一下立即生效；连点时排队执行，切换前先撤回上一次的效果
  const cycle = (id: string) => {
    const next = NEXT[marks[id] ?? 'none'];
    setMarks((m) => { const x = { ...m }; if (next === 'none') delete x[id]; else x[id] = next; return x; });
    chain.current = chain.current.then(async () => {
      const prev = resRef.current[id];
      if (prev) await undoClusterRecall(prev.undo);
      const r = next === 'none' ? null : await clusterRecall(id, next === 'ok');
      resRef.current = { ...resRef.current }; if (r) resRef.current[id] = r; else delete resRef.current[id];
      setRes(resRef.current);
    }).catch(() => {});
  };
  const resRef = useRef<Record<string, ClusterOutcome>>({});

  const rel = (iso: string) => {
    const d = daysBetween(studyDay(Date.now(), s?.dayStartHour ?? 4), studyDay(fromIso(iso), s?.dayStartHour ?? 4));
    return d <= 0 ? '今天' : d === 1 ? '明天' : `${fmtDays(d)}后`;
  };
  const outcome = (m: Note) => {
    const mk = marks[m.id]; const r = res[m.id];
    if (!mk) return null;
    if (!r) return <span className="muted">…</span>;
    const t = r.type ? TYPE[r.type] ?? '' : '';
    const ok = mk === 'ok';
    let text: string;
    if (r.kind === 'credited') text = `${t}卡 ${rel(r.from!)} → ${rel(r.to!)}`;
    else if (r.kind === 'pulled') text = `${t}卡 ${rel(r.from!)} → 明天`;
    else if (!r.type) text = ok ? '还没进复习，不动' : '已标记（还没进复习）';
    else text = ok ? `${t}卡不用动（今天已复习或已排得够远）` : `${t}卡明天前本来就到期`;
    const hint = !ok && r.misses >= 2
      ? (r.hasProduction ? ` · 第 ${r.misses} 次没想起，考虑改造（换例句、补用法）` : ` · 第 ${r.misses} 次没想起，建议加产出卡`) : '';
    return <span className="cl-out">{text}{hint}</span>;
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
          ? <span className="muted"> · 还有 <b className="cl-count">{known.length}</b> 种说法你学过{fresh.length ? `（另有 ${fresh.length} 种还没学）` : ''}{open ? '，点一下：绿 = 想起来了，红 = 没想起来' : '，先在心里说出来'}</span>
          : <span className="muted"> · 另有 {fresh.length} 种说法，都还没学</span>}
      </div>
      {known.length > 0 && !open && (
        <button type="button" className="pill" onClick={() => setOpen(true)}>看答案</button>
      )}
      {known.length > 0 && open && (
        <ul>
          {known.map((m) => {
            const mk = marks[m.id];
            return (
              <li key={m.id} className="cluster-mate">
                <button type="button" className={`cl-toggle${mk ? ` is-${mk}` : ''}`}
                  title="点一下切换：想起来了（绿）→ 没想起来（红）→ 不记（灰）。绿：往后推一点；红：明天再练"
                  aria-pressed={mk ? 'true' : 'false'} onClick={() => cycle(m.id)}>
                  <span className="cl-mark">{mk === 'ok' ? '✓' : mk === 'miss' ? '✗' : '·'}</span>
                  <span className="cl-lemma"><Fr>{m.lemma}</Fr></span>
                  <span className="cl-mean">{firstMeaning(m)}</span>
                </button>
                {outcome(m)}
              </li>
            );
          })}
        </ul>
      )}
      {(known.length === 0 || open) && freshLine}
    </div>
  );
}
