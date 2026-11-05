// 摘句篮：划词时摘下的词、表达、整句。晚上统一做卡（手册：每天不超过 20 张）。
// 两条出口：直接在这里建卡（预填句子、出处），或者复制成 `词(原句` 的格式交给 Claude 批量做卡。
// 做成的卡导入后，篮子里对应的条目自动标为已做卡。
import { useEffect, useMemo, useState } from 'react';
import { useClips, useNotes, useSettings } from '../../db/hooks';
import { deleteClip, updateClip } from '../../db/actions';
import type { Clip, Note } from '../../schema';
import { clozeTarget } from '../../schema/validate';
import { renderSentence } from '../CardFace';
import { Fr } from '../FrText';
import { dayStartMs, fromIso, studyDay } from '../../lib/time';
import { toast } from '../../ui/toast';

export interface ClipPrefill { clipId: string; text: string; source: string | null; extra: string }

const plain = (s: string) => s.replace(/\{\{|\}\}/g, '');
const norm = (s: string) => plain(s).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** 复制给 Claude 的一行：和平时发给 Claude 做卡的格式一样 */
export const clipLine = (c: Clip) => (c.kind === 'sentence' ? `整句：${plain(c.context || c.text)}` : c.context ? `${c.text}(${plain(c.context)}` : c.text);

/** 在摘下之后建的笔记里找做成的那张卡：词条含这个词，或例句就是这句话 */
export function matchNote(c: Clip, notes: Note[]): Note | undefined {
  const t = norm(c.text);
  const ctx = norm(c.context);
  // 用最后修改时间：手动"放回待做"之后，之前那张卡不再算数
  const after = c.updatedAt > c.createdAt ? fromIso(c.updatedAt) : fromIso(c.createdAt) - 60_000;
  const re = new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u');
  return notes.find((n) => fromIso(n.createdAt) >= after && (
    c.kind === 'sentence'
      ? (!!ctx && (norm(n.sentence) === ctx || norm(n.lemma) === ctx))
      : re.test(norm(n.lemma)) || norm(clozeTarget(n.sentence)) === t
  ));
}

export function ClipBasket({ onMake }: { onMake: (p: ClipPrefill) => void }) {
  const clips = useClips();
  const notes = useNotes();
  const s = useSettings();
  const [view, setView] = useState<'todo' | 'done' | 'all'>('todo');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // 导入 Claude 做好的卡之后，自动把篮子里对应的条目标为已做卡
  useEffect(() => {
    if (!clips || !notes) return;
    for (const c of clips) {
      if (c.status !== 'todo') continue;
      const n = matchNote(c, notes);
      if (n) void updateClip(c.id, { status: 'done', noteId: n.id });
    }
  }, [clips, notes]);

  const todayStart = s ? dayStartMs(studyDay(Date.now(), s.dayStartHour), s.dayStartHour) : 0;
  const madeToday = useMemo(() => (notes ?? []).filter((n) => fromIso(n.createdAt) >= todayStart).length, [notes, todayStart]);
  if (!clips || !s) return null;
  const todo = clips.filter((c) => c.status === 'todo');
  const shown = view === 'todo' ? todo : view === 'done' ? clips.filter((c) => c.status !== 'todo') : clips;
  const chosen = shown.filter((c) => picked.has(c.id));
  const toggle = (id: string) => setPicked((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const copy = async () => {
    const list = chosen.length ? chosen : todo;
    if (!list.length) return;
    const text = list.map(clipLine).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast(`已复制 ${list.length} 条，发给 Claude 做卡；导入做好的卡后这里会自动标为已做`);
    } catch {
      window.prompt('复制下面的内容', text);
    }
  };
  const make = (c: Clip) => onMake({
    clipId: c.id,
    // 有上下文就整句进添加页（考查部分已经用 {{…}} 标好），否则只放这个词
    text: c.context && c.kind === 'expr' ? c.context : c.kind === 'sentence' ? plain(c.context || c.text) : c.text,
    source: c.source,
    extra: [c.gloss && `释义：${c.gloss}`, c.translation && `整句：${c.translation}`].filter(Boolean).join(' ｜ '),
  });

  return (
    <div className="basket">
      <p className="muted small">
        划词时点「摘句」放进来，晚上统一做卡。待做 {todo.length} 条 · 今天已建 {madeToday} 条笔记（手册：每天不超过 20 张）。
        {madeToday >= 20 && <span className="accent"> 今天已经到 20 张了，剩下的明天再做。</span>}
      </p>
      <div className="toolbar">
        {([['todo', `待做 ${todo.length}`], ['done', '已做 / 丢弃'], ['all', '全部']] as const).map(([k, label]) => (
          <button key={k} type="button" className={`pill${view === k ? ' is-on' : ''}`} onClick={() => { setView(k); setPicked(new Set()); }}>{label}</button>
        ))}
        <span className="grow" />
        <button type="button" className="btn" disabled={!todo.length && !chosen.length} onClick={() => void copy()}
          title="复制成「词(原句」的格式，一行一条">{chosen.length ? `复制选中的 ${chosen.length} 条给 Claude` : '复制全部待做给 Claude'}</button>
      </div>
      {!shown.length && <p className="empty muted">{view === 'todo' ? '篮子是空的。在复习卡背面、词库里选中法语，点「摘句」。' : '没有记录'}</p>}
      <ul className="clips">
        {shown.map((c) => (
          <li key={c.id} className={`clip is-${c.status}`}>
            <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label="选择" />
            <div className="clip-main">
              <div className="clip-text"><b>{c.kind === 'sentence' ? '整句' : c.text}</b>
                {c.status === 'done' && <span className="badge">已做卡</span>}
                {c.status === 'dropped' && <span className="badge">已丢弃</span>}
              </div>
              {c.context && <div className="clip-ctx"><Fr>{renderSentence(c.context)}</Fr></div>}
              {c.translation && <div className="muted small">{c.translation}</div>}
              {c.gloss && <div className="muted small">{c.gloss}</div>}
              <div className="muted small">{c.source ? `${c.source} · ` : ''}{c.createdAt.slice(0, 10)}</div>
            </div>
            <div className="clip-actions">
              {c.status === 'todo' ? (
                <>
                  <button type="button" className="pill" onClick={() => make(c)}>建卡</button>
                  <button type="button" className="pill" onClick={() => void updateClip(c.id, { status: 'dropped' })}>丢弃</button>
                </>
              ) : (
                <button type="button" className="pill" onClick={() => void updateClip(c.id, { status: 'todo', noteId: null })}>放回待做</button>
              )}
              <button type="button" className="icon is-danger" title="删除" onClick={() => void deleteClip(c.id)}>✕</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
