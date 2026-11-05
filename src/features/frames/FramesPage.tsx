// 写作语块库：按任务 → 槽位排的句框，每个句框的学习状态和"用上了"次数；考前速查只列学过的，可以打印。
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCards, useNotes } from '../../db/hooks';
import { addNotes, bumpUsed } from '../../db/actions';
import { frameSortKey, hasSlots, LENSES, lensOf } from '../../lib/frames';
import { importStarterFrames, pendingStarterFrames } from '../../lib/frames-import';
import { STABLE_DAYS } from '../../lib/reading';
import { renderFrame } from '../CardFace';
import { NoteEditor } from '../NoteEditor';
import { toast } from '../../ui/toast';
import type { Card, Note } from '../../schema';

type Status = 'none' | 'new' | 'learning' | 'review' | 'stable';
const STATUS_LABEL: Record<Status, string> = { none: '无句框卡', new: '未学', learning: '学习中', review: '复习中', stable: '稳定' };
function statusOf(card: Card | undefined): Status {
  if (!card) return 'none';
  if (card.state === 'new') return 'new';
  if (card.state !== 'review') return 'learning';
  return card.interval >= STABLE_DAYS ? 'stable' : 'review';
}
const learned = (s: Status) => s === 'review' || s === 'stable';
const TASKS = ['T3', '口语', 'T1', 'T2'];

export function FramesPage({ deckId }: { deckId: string }) {
  const notes = useNotes();
  const cards = useCards();
  const [view, setView] = useState<'list' | 'sheet'>('list');
  const [task, setTask] = useState('');
  const [lens, setLens] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const frames = useMemo(() => (notes ?? []).filter((n) => !n.deleted && n.frame).sort((a, b) => (frameSortKey(a) < frameSortKey(b) ? -1 : 1)), [notes]);
  useEffect(() => { void pendingStarterFrames().then(setPending); }, [frames.length]);
  const frameCard = useMemo(() => {
    const m = new Map<string, Card>();
    for (const c of cards ?? []) if (c.type === 'frame' && !c.deleted) m.set(c.noteId, c);
    return m;
  }, [cards]);
  if (!notes || !cards) return null;

  const status = (n: Note) => statusOf(frameCard.get(n.id));
  const shown = frames.filter((n) => (!task || n.frame!.task === task) && (!lens || (n.frame!.lens ?? '').includes(lens)));
  const learnedCount = frames.filter((n) => learned(status(n))).length;

  const doImport = async () => {
    setBusy(true);
    try { toast(`已加入 ${await importStarterFrames(deckId)} 个句框，新卡按手册顺序出`); } finally { setBusy(false); }
  };

  return (
    <div className="page frames">
      <div className="frames-head no-print">
        <div className="chips">
          <button type="button" className={`pill${view === 'list' ? ' is-on' : ''}`} onClick={() => setView('list')}>语块库 {frames.length}</button>
          <button type="button" className={`pill${view === 'sheet' ? ' is-on' : ''}`} onClick={() => setView('sheet')}>考前速查 {learnedCount}</button>
        </div>
        {!!pending && (
          <button type="button" className="pill is-suggest" disabled={busy} onClick={() => void doImport()} title="LENTILLES 透镜句框、T3 九句模板（含进阶和变体）、T1 / T2 套式、口语 T3；已有的跳过">
            导入手册句框（{pending} 个）到当前牌组
          </button>
        )}
      </div>

      {view === 'list' ? (
        <>
          {!frames.length && (
            <div className="frames-intro">
              <p>句框是按论证功能组织的句型：正面写功能，背面是带 ⬚ 的句框，换题照样能用。</p>
              <p className="muted small">每个句框有两张卡：<b>句框卡</b>看功能写出句框；句框卡进入复习以后才出<b>套用卡</b>，给一个随机主题，用句框写一整句（脑中或纸上），翻面对照后自评。两种卡都算进每天的新卡数；句框卡每天最多出几张，在设置里改。</p>
            </div>
          )}
          {!!frames.length && (
            <div className="frames-filters no-print">
              <div className="chips">
                <button type="button" className={`chip${!task ? ' is-on' : ''}`} onClick={() => setTask('')}>全部</button>
                {TASKS.filter((t) => frames.some((n) => n.frame!.task === t)).map((t) => (
                  <button key={t} type="button" className={`chip${task === t ? ' is-on' : ''}`} onClick={() => setTask(task === t ? '' : t)}>{t}</button>
                ))}
              </div>
              <div className="chips">
                {Object.entries(LENSES).map(([k, v]) => (
                  <button key={k} type="button" className={`chip${lens === k ? ' is-on' : ''}`} onClick={() => setLens(lens === k ? '' : k)}>{k} {v}</button>
                ))}
              </div>
            </div>
          )}
          {!!frames.length && !shown.length && <p className="muted">没有符合筛选的句框。</p>}
          <FrameGroups frames={shown} render={(n) => <FrameRow key={n.id} n={n} status={status(n)} onEdit={() => setEditing(n)} />} />
          <NewFrame deckId={deckId} />
        </>
      ) : (
        <Sheet frames={frames.filter((n) => n.frame!.task === 'T3' || n.frame!.task === '口语')} status={status} />
      )}
      {editing && <NoteEditor note={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** 任务 → 槽位分组（frames 已经排好序） */
function FrameGroups({ frames, render }: { frames: Note[]; render: (n: Note) => ReactNode }) {
  const groups: Array<{ task: string; slots: Array<{ slot: string; items: Note[] }> }> = [];
  for (const n of frames) {
    const t = n.frame!.task || '其他';
    let g = groups.find((x) => x.task === t);
    if (!g) groups.push((g = { task: t, slots: [] }));
    const sl = n.frame!.slot ?? '';
    let s = g.slots.find((x) => x.slot === sl);
    if (!s) g.slots.push((s = { slot: sl, items: [] }));
    s.items.push(n);
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.task}>
          <h3 className="sub">{g.task}</h3>
          {g.slots.map((s) => (
            <div key={s.slot} className="frame-slot">
              {s.slot && <div className="frame-slot-h">{s.slot}</div>}
              <ul className="frame-list">{s.items.map(render)}</ul>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

function FrameRow({ n, status, onEdit }: { n: Note; status: Status; onEdit: () => void }) {
  const lens = lensOf(n);
  return (
    <li className="frame-row">
      <div className="frame-main">
        <div className="frame-text">{renderFrame(n.lemma)}</div>
        <div className="frame-fn">{n.meaningZh}</div>
        <div className="frame-tags">
          <span className={`badge st-${status}`}>{STATUS_LABEL[status]}</span>
          {lens && <span className="badge is-theme">{lens} {LENSES[lens]}</span>}
          {n.frame!.register && <span className="badge">{n.frame!.register}</span>}
          {!hasSlots(n.lemma) && <span className="badge" title="没有 ⬚ 的固定表达，只出句框卡">固定</span>}
        </div>
      </div>
      <div className="frame-actions">
        <button type="button" className="pill" title="这个句框在写作或口语里用上了一次" onClick={() => void bumpUsed(n.id).then(() => toast(`累计用上 ${n.usedCount + 1} 次`))}>用上 {n.usedCount} +1</button>
        <button type="button" className="pill" onClick={onEdit}>编辑</button>
      </div>
    </li>
  );
}

/** 手动加一个句框（读文章时摘到的） */
function NewFrame({ deckId }: { deckId: string }) {
  const [f, setF] = useState({ lemma: '', meaningZh: '', sentence: '', task: 'T3', slot: '', lens: '' });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.lemma.trim() || !f.meaningZh.trim()) return toast('句框和功能都要填');
    await addNotes([{
      deckId, lemma: f.lemma, meaningZh: f.meaningZh, sentence: f.sentence, layer: 'core', source: '自己摘的',
      cardTypes: hasSlots(f.lemma) ? ['frame', 'apply'] : ['frame'],
      frame: { task: f.task || 'T3', slot: f.slot.trim() || null, lens: f.lens || null, register: null },
    }]);
    setF({ lemma: '', meaningZh: '', sentence: '', task: f.task, slot: '', lens: '' });
    toast('已加入');
  };
  return (
    <details className="frame-new no-print">
      <summary className="sub">＋ 新句框</summary>
      <p className="muted small">摘整个句框，把话题词换成 ⬚：Loin de réduire les inégalités, cette mesure les accentue. → Loin de ⬚, ⬚ les accentue.</p>
      <label className="field"><span className="field-label">句框</span><input value={f.lemma} onChange={(e) => set('lemma', e.target.value)} placeholder="Loin de ⬚, ⬚ les accentue." /></label>
      <div className="chips"><button type="button" className="chip" onClick={() => set('lemma', `${f.lemma}⬚`)}>末尾插入 ⬚</button></div>
      <label className="field"><span className="field-label">功能（正面写论证功能，不写中文句子）</span><input value={f.meaningZh} onChange={(e) => set('meaningZh', e.target.value)} placeholder="反事实：非但没减少，反而加剧" /></label>
      <label className="field"><span className="field-label">例句（原句）</span><input value={f.sentence} onChange={(e) => set('sentence', e.target.value)} /></label>
      <div className="grid2">
        <label className="field"><span className="field-label">任务</span>
          <select value={f.task} onChange={(e) => set('task', e.target.value)}>{TASKS.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <label className="field"><span className="field-label">槽位</span><input value={f.slot} onChange={(e) => set('slot', e.target.value)} placeholder="⑤ / ⑦ / T1-04" /></label>
        <label className="field"><span className="field-label">透镜</span>
          <select value={f.lens} onChange={(e) => set('lens', e.target.value)}>
            <option value="">（无）</option>
            {Object.entries(LENSES).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}
          </select>
        </label>
      </div>
      <button type="button" className="btn" onClick={() => void save()}>加入</button>
    </details>
  );
}

/** 考前速查：T3 按九句顺序 + 口语，默认只列学过的，可以打印 */
function Sheet({ frames, status }: { frames: Note[]; status: (n: Note) => Status }) {
  const [all, setAll] = useState(false);
  const list = all ? frames : frames.filter((n) => learned(status(n)));
  return (
    <div className="frame-sheet">
      <div className="chips no-print">
        <button type="button" className={`chip${!all ? ' is-on' : ''}`} onClick={() => setAll(false)}>只看学过的</button>
        <button type="button" className={`chip${all ? ' is-on' : ''}`} onClick={() => setAll(true)}>全部</button>
        <button type="button" className="pill" disabled={!list.length} onClick={() => window.print()}>打印</button>
      </div>
      {!list.length && <p className="muted no-print">还没有学过的 T3 句框。句框卡进入复习后会出现在这里。</p>}
      <ol className="sheet-list">
        {list.map((n) => (
          <li key={n.id}>
            <span className="sheet-slot">{n.frame!.slot ?? ''}</span>
            <span className="sheet-frame">{renderFrame(n.lemma)}</span>
            <span className="sheet-fn">{n.meaningZh}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
