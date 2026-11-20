import { useEffect, useRef, useState } from 'react';
import type { Card, Note } from '../../schema';
import { clusterRecall, undoClusterRecall, type ClusterOutcome } from '../../db/actions';
import { daysBetween, fmtDays, fromIso, studyDay } from '../../lib/time';
import { useSettings } from '../../db/hooks';
import { Fr } from '../FrText';
import { head } from '../../lib/headword';
import { fold } from '../../lib/gender/rules';

const words = (s: string) => fold(s.toLowerCase()).split(/[^a-z-]+/).filter(Boolean);

/** 同群的其他说法；这张卡上已经出现的不算（产出卡题面用同群的 informer 当换说法时，"还有 1 种"就是题面上那个） */
export function clusterMates(note: Pick<Note, 'id' | 'cluster'>, notes: Note[], shown = ''): Note[] {
  const name = note.cluster?.trim();
  if (!name) return [];
  const seen = words(shown);
  const onCard = (m: Note) => { const h = head(m.lemma); return h.length > 2 && seen.some((w) => w === h || (h.length >= 5 && w.startsWith(h.slice(0, 5)))); };
  return notes.filter((n) => n.id !== note.id && !n.deleted && n.cluster?.trim() === name && !onCard(n))
    .sort((a, b) => a.lemma.localeCompare(b.lemma, 'fr'));
}

const MAX = 6;

/** 撤销用：一张卡（一次显示）离开时表达群的状态和「没想起来」的结果。recKey 由复习页给，每次显示一个 */
interface StripState { open: boolean; ok: string[]; res: Record<string, ClusterOutcome> }
const records = new Map<string, { state: StripState; missed: Promise<ClusterOutcome[]> }>();
const restores = new Map<string, StripState>();
/**
 * 撤销一张卡时调用：撤回翻页时按「没想起来」生效的那几条，表达群恢复到翻页前的样子（展开、哪几条是绿的）。
 * 点绿的那几条当时就已生效、翻页前也还是生效的，保持不动
 */
export async function undoClusterLeave(recKey: string) {
  const r = records.get(recKey);
  if (!r) return;
  records.delete(recKey);
  for (const o of (await r.missed).reverse()) await undoClusterRecall(o.undo);
  restores.set(recKey, r.state);
}
/** 第一个中文意思；括号里带法语的去掉（「铺天盖地的指控（un déluge de …）」会直接露出答案） */
export const firstMeaning = (n: Note) =>
  (n.meaningZh ?? '').split(/[；;]/)[0].replace(/\s*[(（][^)）]*[A-Za-zÀ-ÿœ][^)）]*[)）]/g, '').trim() || n.meaningEn || '（没写意思）';

const TYPE: Partial<Record<Card['type'], string>> = { production: '产出', recognition: '认读' };

/**
 * 表达群：背面只告诉「这个意思还有几种说法」，不给任何提示，先自己纯回忆。
 * 点「看答案」就算做了这次回想：每行先是淡红「没想起 → 明天」（还没生效），想起来的点一下变绿，立即往后推（再点撤回）；
 * 翻到下一张卡时，没点绿的才按「没想起来」生效（那张卡提前到明天）。不点「看答案」什么都不记
 */
export function ClusterStrip({ note, notes, cards, shown = '', recKey = '' }: { note: Note; notes: Note[]; cards: Card[]; shown?: string; recKey?: string }) {
  const name = note.cluster?.trim();
  if (!name) return null;
  const mates = clusterMates(note, notes, shown);
  if (!mates.length) return null;
  const learned = new Set(cards.filter((c) => !c.deleted && c.state !== 'new').map((c) => c.noteId));
  return <Strip key={`${note.id}|${recKey}`} recKey={recKey} name={name} known={mates.filter((m) => learned.has(m.id)).slice(0, MAX)} fresh={mates.filter((m) => !learned.has(m.id))} />;
}

function Strip({ name, known, fresh, recKey }: { name: string; known: Note[]; fresh: Note[]; recKey: string }) {
  // 撤销回来的：恢复翻页前的状态
  const [init] = useState(() => { const r = restores.get(recKey); restores.delete(recKey); return r ?? null; });
  const [open, setOpen] = useState(init?.open ?? false);
  const [ok, setOk] = useState<Set<string>>(() => new Set(init?.ok ?? []));
  const [res, setRes] = useState<Record<string, ClusterOutcome>>(init?.res ?? {});
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const live = useRef({ open: init?.open ?? false, ok: new Set<string>(init?.ok ?? []), res: (init?.res ?? {}) as Record<string, ClusterOutcome> });
  const s = useSettings();

  // 翻到下一张卡（这一块卸载）时，展开过答案、又没点绿的按「没想起来」生效。
  // 只在卸载时跑一次（父组件每次重渲染都会生成新的 known 数组，不能放进依赖）
  const knownIds = useRef(known.map((m) => m.id));
  knownIds.current = known.map((m) => m.id);
  useEffect(() => () => {
    const { open: o, ok: got, res: r } = live.current;
    if (!o) return;
    const missed = knownIds.current.filter((id) => !got.has(id));
    const done = chain.current.then(async () => {
      const out: ClusterOutcome[] = [];
      for (const id of missed) out.push(await clusterRecall(id, false));
      return out;
    }).catch(() => [] as ClusterOutcome[]);
    chain.current = done;
    if (recKey) records.set(recKey, { state: { open: true, ok: [...got], res: { ...r } }, missed: done });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reveal = () => { live.current.open = true; setOpen(true); };
  // 点一下变绿、立即生效；再点撤回。连点时排队执行
  const toggle = (id: string) => {
    const on = !live.current.ok.has(id);
    const next = new Set(live.current.ok); if (on) next.add(id); else next.delete(id);
    live.current.ok = next; setOk(next);
    chain.current = chain.current.then(async () => {
      const prev = live.current.res[id];
      if (prev) await undoClusterRecall(prev.undo);
      const r = on ? await clusterRecall(id, true) : null;
      const map = { ...live.current.res }; if (r) map[id] = r; else delete map[id];
      live.current.res = map; setRes(map);
    }).catch(() => {});
  };

  const rel = (iso: string) => {
    const d = daysBetween(studyDay(Date.now(), s?.dayStartHour ?? 4), studyDay(fromIso(iso), s?.dayStartHour ?? 4));
    return d <= 0 ? '今天' : d === 1 ? '明天' : `${fmtDays(d)}后`;
  };
  const outcome = (m: Note) => {
    if (!ok.has(m.id)) {
      const n = (m.recallMisses ?? []).length;
      return <span className="cl-out">没想起 → 明天再练{n >= 1 ? `（之前没想起 ${n} 次）` : ''}</span>;
    }
    const r = res[m.id];
    if (!r) return <span className="muted">…</span>;
    const t = r.type ? TYPE[r.type] ?? '' : '';
    const text = r.kind === 'credited' ? `${t}卡 ${rel(r.from!)} → ${rel(r.to!)}`
      : !r.type ? '还没进复习，不动' : `${t}卡不用动（今天已复习或已排得够远）`;
    return <span className="cl-out">{text}</span>;
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
          ? <span className="muted"> · 还有 <b className="cl-count">{known.length}</b> 种说法你学过{fresh.length ? `（另有 ${fresh.length} 种还没学）` : ''}{open ? '，想起来的点一下变绿；没点的明天再练' : '，先在心里说出来'}</span>
          : <span className="muted"> · 另有 {fresh.length} 种说法，都还没学</span>}
      </div>
      {known.length > 0 && !open && (
        <button type="button" className="pill" title="看了答案就算做了这次回想：没点绿的明天再练" onClick={reveal}>看答案</button>
      )}
      {known.length > 0 && open && (
        <ul>
          {known.map((m) => {
            const got = ok.has(m.id);
            return (
              <li key={m.id} className="cluster-mate">
                <button type="button" className={`cl-toggle ${got ? 'is-ok' : 'is-miss'}`}
                  title={got ? '想起来了（已往后推）。再点一下撤回' : '想起来了就点一下；不点，翻到下一张时按"没想起来"处理（明天再练）'}
                  aria-pressed={got ? 'true' : 'false'} onClick={() => toggle(m.id)}>
                  <span className="cl-mark">{got ? '✓' : '✗'}</span>
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
