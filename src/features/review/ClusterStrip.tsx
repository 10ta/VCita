import { useState } from 'react';
import type { Card, Note } from '../../schema';
import { clusterRecall } from '../../db/actions';
import { maskLabel } from '../../schema/validate';
import { Fr } from '../FrText';

const MAX = 6;
/** 第一个中文意思；括号里带法语的去掉（「铺天盖地的指控（un déluge de …）」会直接露出答案） */
export const firstMeaning = (n: Note) =>
  (n.meaningZh ?? '').split(/[；;]/)[0].replace(/\s*[(（][^)）]*[A-Za-zÀ-ÿœ][^)）]*[)）]/g, '').trim() || n.meaningEn || '（没写意思）';

/**
 * 表达群：背面列出同群的其他说法（同一个功能，例如「说"很多"」），答案遮住，先看意思自己回想再点开。
 * 想起来了 → 那条笔记的认读卡顺带记一次（只往后推）；没想起来 → 只在笔记上做标记（词库可筛出来）
 */
export function ClusterStrip({ note, notes, cards }: { note: Note; notes: Note[]; cards: Card[] }) {
  const name = note.cluster?.trim();
  if (!name) return null;
  const learned = new Set(cards.filter((c) => !c.deleted && c.state !== 'new').map((c) => c.noteId));
  // 学过的排前面（可以回想），还没学的放后面只看意思
  const mates = notes.filter((n) => n.id !== note.id && !n.deleted && n.cluster?.trim() === name)
    .sort((a, b) => Number(learned.has(b.id)) - Number(learned.has(a.id)) || a.lemma.localeCompare(b.lemma, 'fr'));
  if (!mates.length) return null;
  return (
    <div className="cluster small" key={note.id}>
      <div className="cluster-head"><span className="muted">表达群 · </span><b>{name}</b><span className="muted"> · 同样的意思还能怎么说？</span></div>
      <ul>
        {mates.slice(0, MAX).map((m) => <Mate key={m.id} m={m} learned={learned.has(m.id)} />)}
      </ul>
      {mates.length > MAX && <div className="muted">还有 {mates.length - MAX} 条，在词库搜群名看全部</div>}
    </div>
  );
}

function Mate({ m, learned }: { m: Note; learned: boolean }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<null | 'credited' | 'skipped' | 'marked'>(null);
  const mark = (ok: boolean) => void clusterRecall(m.id, ok).then(setDone);
  return (
    <li className={`cluster-mate${learned ? '' : ' is-new'}`}>
      <span className="cl-mean">{firstMeaning(m)}</span>
      {!learned ? (
        <span className="muted" title="这条还没开始学，先不考">还没学</span>
      ) : !open ? (
        <button type="button" className="cl-mask" title="先想一想，再点开看答案" onClick={() => setOpen(true)}>{maskLabel(m.lemma)}</button>
      ) : (
        <>
          <span className="cl-lemma"><Fr>{m.lemma}</Fr></span>
          {done === null ? (
            <span className="cl-btns">
              <button type="button" className="pill" title="认读卡顺带往后推一点（今天已复习过或还没到复习阶段就不动）" onClick={() => mark(true)}>想起来了</button>
              <button type="button" className="pill" title="只做个标记，不改排期；词库里可以筛出来" onClick={() => mark(false)}>没想起来</button>
            </span>
          ) : (
            <span className="muted">{done === 'credited' ? '✓ 已顺带记一次' : done === 'skipped' ? '✓' : '已标记'}</span>
          )}
        </>
      )}
    </li>
  );
}
