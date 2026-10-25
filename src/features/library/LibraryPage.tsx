import { useEffect, useMemo, useState } from 'react';
import { useCards, useDecks, useLogsSince, useNotes, useSettings } from '../../db/hooks';
import { deleteNotes, resetNotes, setSuspended, updateNote, updateNotes } from '../../db/actions';
import { THEMES, noteOrigin, type Card, type Note, type NoteOrigin, type Theme } from '../../schema';
import { addDaysToDay, fromIso, noonIso, studyDay } from '../../lib/time';
import { findDuplicates } from '../../srs/dups';
import { startCustom } from '../../srs/custom';
import { NoteDetail } from './NoteDetail';
import { usePrefs, setPrefs } from '../../ui/prefs';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';
import { langLabel } from '../../ui/langs';
import { CardStats, Cues, renderSentence, SpeakBtn, TYPE_LABEL } from '../CardFace';
import { NoteEditor, ThemePicker } from '../NoteEditor';

type Status = 'all' | 'new' | 'learning' | 'due' | 'leech' | 'suspended' | 'nosentence' | 'stable' | 'core' | 'needprod' | 'forgot' | 'lowease' | 'dup';
// 后半部分是"分拣"用的筛选（改造方案 §6）：已稳定的保留；同源词选中后批量暂停；顽固卡补句子、加线索；核心词补产出卡
const STATUS: Array<[Status, string, string?]> = [
  ['all', '全部'], ['due', '到期'], ['new', '新卡'], ['learning', '学习中'], ['suspended', '已暂停'],
  ['stable', '已稳定', '间隔超过 30 天且遗忘不超过 1 次'], ['leech', '待改造', '遗忘达到阈值，已自动暂停'],
  ['nosentence', '待补句子', '迁移来的旧卡，还没有例句'], ['core', '核心'], ['needprod', '待补产出', '核心词还没有产出卡'],
  // 弱项：在变成顽固卡之前先改句子、加线索
  ['forgot', '近 7 天忘过', '最近 7 个学习日里至少有一次评"忘了"'], ['lowease', '倍率 < 2', '有卡的倍率低于 2：经常答困难或忘了'],
  ['dup', '疑似重复', '单词、考查部分或整句相同，或例句高度相似；同组排在一起'],
];
type Sort = 'created' | 'lapses' | 'ease' | 'due' | 'reviewed';
const SORTS: Array<[Sort, string]> = [['created', '最新添加'], ['lapses', '遗忘最多'], ['ease', '倍率最低'], ['due', '最早到期'], ['reviewed', '最近复习']];
/** 一条笔记用于排序的值：取它最"差"的那张卡 */
function sortValue(cs: Card[], by: Sort): number {
  const live = cs.filter((c) => c.state !== 'new');
  if (by === 'lapses') return -Math.max(0, ...cs.map((c) => c.lapses));
  if (by === 'ease') return live.length ? Math.min(...live.map((c) => c.ease)) : Infinity;
  if (by === 'due') return live.length ? Math.min(...live.map((c) => fromIso(c.due))) : Infinity;
  if (by === 'reviewed') return -Math.max(0, ...cs.map((c) => (c.lastReviewedAt ? fromIso(c.lastReviewedAt) : 0)));
  return 0;
}
const PAGE_SIZES = [10, 30, 50, 100];

/** #/library?note=ID&edit=1 → 只显示这条笔记（从复习页跳过来） */
const readFocus = () => {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  return { note: q.get('note'), edit: q.get('edit') === '1' };
};

export function LibraryPage({ deckId }: { deckId: string }) {
  const s = useSettings();
  const notes = useNotes();
  const cards = useCards();
  const decks = useDecks();
  const prefs = usePrefs();
  const [kw, setKw] = useState('');
  const [theme, setTheme] = useState<Theme | ''>('');
  const [origin, setOrigin] = useState<NoteOrigin | ''>('');
  const [status, setStatus] = useState<Status>('all');
  const [day, setDay] = useState('');
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Note | null>(null);
  const [batch, setBatch] = useState<null | 'theme' | 'deck' | 'date' | 'delete'>(null);
  const [focus, setFocus] = useState(readFocus);
  const [sort, setSort] = useState<Sort>('created');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [study, setStudy] = useState(false);
  const since = s ? addDaysToDay(studyDay(Date.now(), s.dayStartHour), -6) : null;
  const recentLogs = useLogsSince(status === 'forgot' ? since : null);
  const forgotNotes = useMemo(() => new Set((recentLogs ?? []).filter((l) => l.rating === 1).map((l) => l.noteId)), [recentLogs]);
  const dups = useMemo(() => (status === 'dup' && notes ? findDuplicates(notes.filter((n) => n.deckId === deckId)) : new Map<string, number>()), [status, notes, deckId]);
  useEffect(() => {
    const on = () => setFocus(readFocus());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // 带 edit=1 进来时自动打开编辑；只打开一次，关掉后留在这条笔记上
  useEffect(() => {
    if (!focus.note || !focus.edit || !notes) return;
    const n = notes.find((x) => x.id === focus.note);
    if (n) setEditing(n);
    history.replaceState(null, '', `#/library?note=${encodeURIComponent(focus.note)}`);
    setFocus({ note: focus.note, edit: false });
  }, [focus, notes]);
  const clearFocus = () => {
    history.replaceState(null, '', '#/library');
    setFocus({ note: null, edit: false });
  };

  const cardsByNote = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of cards ?? []) { const arr = m.get(c.noteId); if (arr) arr.push(c); else m.set(c.noteId, [c]); }
    return m;
  }, [cards]);

  const list = useMemo(() => {
    if (!notes) return [];
    if (focus.note) return notes.filter((n) => n.id === focus.note);
    const now = Date.now();
    const k = kw.trim().toLowerCase();
    return notes
      .filter((n) => n.deckId === deckId)
      .filter((n) => !theme || n.tags.includes(theme))
      .filter((n) => !origin || noteOrigin(n) === origin)
      .filter((n) => !day || n.createdAt.slice(0, 10) === day)
      .filter((n) => !k || [n.lemma, n.sentence, n.meaningZh, n.meaningEn, n.source ?? '', ...(n.altSentences ?? [])].some((x) => x.toLowerCase().includes(k)))
      .filter((n) => {
        const cs = cardsByNote.get(n.id) ?? [];
        switch (status) {
          case 'all': return true;
          case 'new': return cs.some((c) => c.state === 'new');
          case 'learning': return cs.some((c) => c.state === 'learning' || c.state === 'relearning');
          case 'due': return cs.some((c) => !c.suspended && c.state !== 'new' && fromIso(c.due) <= now);
          case 'leech': return cs.some((c) => c.isLeech);
          case 'suspended': return cs.some((c) => c.suspended);
          case 'nosentence': return !n.sentence;
          case 'stable': return cs.length > 0 && cs.every((c) => c.state === 'review' && c.interval > 30 && c.lapses <= 1);
          case 'core': return n.layer === 'core';
          case 'needprod': return n.layer === 'core' && !cs.some((c) => c.type === 'production');
          case 'forgot': return forgotNotes.has(n.id);
          case 'lowease': return cs.some((c) => c.state !== 'new' && c.ease < 2);
          case 'dup': return dups.has(n.id);
        }
      })
      .sort((a, b) => {
        // 疑似重复：同组排在一起
        if (status === 'dup') { const d = dups.get(a.id)! - dups.get(b.id)!; if (d) return d; }
        if (sort !== 'created') {
          const d = sortValue(cardsByNote.get(a.id) ?? [], sort) - sortValue(cardsByNote.get(b.id) ?? [], sort);
          if (d) return d;
        }
        return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1;
      });
  }, [notes, deckId, theme, origin, day, kw, status, cardsByNote, focus.note, sort, forgotNotes, dups]);

  if (!s || !notes || !cards) return null;
  const pages = Math.max(1, Math.ceil(list.length / prefs.pageSize));
  const p = Math.min(page, pages - 1);
  const shown = list.slice(p * prefs.pageSize, (p + 1) * prefs.pageSize);
  const ids = [...sel];
  const toggle = (id: string) => setSel((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const done = (msg: string) => { toast(msg); setSel(new Set()); setBatch(null); };
  const resetPage = () => setPage(0);

  return (
    <div className="page library">
      {focus.note && (
        <div className="focus-bar">
          <span className="muted small">只显示从复习页打开的这条笔记</span>
          <span className="grow" />
          <a className="pill" href="#/review">← 返回复习</a>
          <button type="button" className="pill" onClick={clearFocus}>显示全部</button>
        </div>
      )}
      <div className="filters">
        <input className="search" placeholder="搜索单词、句子、意思、出处…" value={kw} onChange={(e) => { setKw(e.target.value); resetPage(); }} />
        <select value={theme} onChange={(e) => { setTheme(e.target.value as Theme | ''); resetPage(); }}>
          <option value="">全部主题</option>
          {THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={origin} title="挖矿卡：从自己输入里摘的；词表卡：批量导入的。没标过的按有没有填出处推断" onChange={(e) => { setOrigin(e.target.value as NoteOrigin | ''); resetPage(); }}>
          <option value="">全部来源</option>
          <option value="mined">挖矿卡</option>
          <option value="list">词表卡</option>
        </select>
        <input type="date" value={day} onChange={(e) => { setDay(e.target.value); resetPage(); }} title="按创建日期筛选" />
        {day && <button type="button" className="pill" onClick={() => setDay('')}>✕</button>}
        <select value={sort} onChange={(e) => { setSort(e.target.value as Sort); resetPage(); }} title="排序（按这条笔记里最差的那张卡）">
          {SORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </div>
      <div className="toolbar">
        {STATUS.map(([k, label, tip]) => (
          <button key={k} type="button" title={tip} className={`pill${status === k ? ' is-on' : ''}`} onClick={() => { setStatus(k); resetPage(); }}>{label}</button>
        ))}
        <span className="grow" />
        <span className="muted small">{list.length} 条</span>
        <button type="button" className="pill is-on" disabled={!list.length} title="用当前筛选结果（或选中的笔记）开一轮自定义学习" onClick={() => setStudy(true)}>
          学这 {sel.size || list.length} 条
        </button>
      </div>
      <div className="toolbar">
        <button type="button" className={`pill${sel.size && sel.size === list.length ? ' is-on' : ''}`}
          onClick={() => setSel(sel.size === list.length ? new Set() : new Set(list.map((n) => n.id)))}>
          {sel.size ? `已选 ${sel.size}` : '全选'}
        </button>
        {sel.size > 0 && <button type="button" className="pill" onClick={() => setSel(new Set())}>✕</button>}
        <span className="muted small">显示</span>
        <button type="button" className={`pill${prefs.showT1 ? ' is-on' : ''}`} onClick={() => setPrefs({ showT1: !prefs.showT1 })}>{langLabel(s.targetLang1)}</button>
        <button type="button" className={`pill${prefs.showT2 ? ' is-on' : ''}`} onClick={() => setPrefs({ showT2: !prefs.showT2 })}>{langLabel(s.targetLang2)}</button>
      </div>
      {sel.size > 0 && (
        <div className="toolbar batch">
          <button type="button" className="pill" onClick={() => void updateNotes(ids, (n) => ({ rot: (n.rot + 1) % 3 })).then(() => done(`已旋转 ${ids.length} 条`))}>旋转</button>
          <button type="button" className="pill" onClick={() => setBatch('theme')}>设主题</button>
          <button type="button" className="pill" onClick={() => setBatch('deck')}>移到牌组</button>
          <button type="button" className="pill" onClick={() => setBatch('date')}>改日期</button>
          <button type="button" className="pill" onClick={() => void setSuspended(ids, true).then(() => done(`已暂停 ${ids.length} 条`))}>暂停</button>
          <button type="button" className="pill" onClick={() => void setSuspended(ids, false).then(() => done(`已恢复 ${ids.length} 条`))}>恢复</button>
          <button type="button" className="pill" title="只改层级；产出卡要在编辑里补上中文意图和答案后勾选" onClick={() => void updateNotes(ids, () => ({ layer: 'core' })).then(() => done(`已设为核心 ${ids.length} 条`))}>设为核心</button>
          <button type="button" className="pill" onClick={() => void updateNotes(ids, () => ({ layer: 'mid' })).then(() => done(`已设为中频 ${ids.length} 条`))}>设为中频</button>
          <button type="button" className="pill" title="从自己输入里摘的：新卡额度按来源拆分时最新的先出" onClick={() => void updateNotes(ids, () => ({ origin: 'mined' })).then(() => done(`已设为挖矿 ${ids.length} 条`))}>设为挖矿</button>
          <button type="button" className="pill" title="批量导入的词表：按核心 → 中频慢慢消化" onClick={() => void updateNotes(ids, () => ({ origin: 'list' })).then(() => done(`已设为词表 ${ids.length} 条`))}>设为词表</button>
          <button type="button" className="pill" onClick={() => void resetNotes(ids).then(() => done(`已重置 ${ids.length} 条为新卡`))}>重置为新卡</button>
          <button type="button" className="pill is-danger" onClick={() => setBatch('delete')}>删除</button>
        </div>
      )}

      <ul className="note-list">
        {shown.map((n) => {
          const cs = cardsByNote.get(n.id) ?? [];
          const card = cs.find((c) => c.type === 'recognition') ?? cs[0];
          const isSel = sel.has(n.id);
          const due = card && !card.suspended && card.state !== 'new' && fromIso(card.due) <= Date.now();
          return (
            <li key={n.id} className={`note${isSel ? ' is-sel' : ''}${due ? ' is-due' : ''}`}
              onClick={(e) => { if (!(e.target as HTMLElement).closest('button,input,select,a,label') && !window.getSelection()?.toString()) toggle(n.id); }}>
              <input type="checkbox" checked={isSel} onChange={() => toggle(n.id)} aria-label="选择" />
              <div className="note-main">
                <div className="note-front">
                  <span>{n.sentence ? renderSentence(n.sentence) : n.lemma}</span>
                  <SpeakBtn text={n.sentence ? n.sentence.replace(/\{\{|\}\}/g, '') : n.lemma} lang={s.sourceLang} />
                  {n.rot !== 0 && <span className="badge" title="卡片旋转：复习时题面换成别的字段">旋转{n.rot}</span>}
                </div>
                {(prefs.showT1 || prefs.showT2) && (
                  <div className="note-mean">
                    {prefs.showT1 && <span>{n.meaningZh}</span>}
                    {prefs.showT1 && prefs.showT2 && <span className="sep">/</span>}
                    {prefs.showT2 && <span className="t2">{n.meaningEn}</span>}
                  </div>
                )}
                {(prefs.showT1 || prefs.showT2) && <Cues note={n} />}
                <div className="note-meta">
                  {card && <CardStats card={card} s={s} />}
                  {n.tags.map((t) => <span key={t} className="badge is-theme">{t}</span>)}
                  {!n.sentence && <span className="badge">待补句子</span>}
                  {n.layer === 'core' && <span className="badge is-core">核心</span>}
                  <span className="badge" title={n.origin ? undefined : '没标过，按有没有填出处推断'}>{noteOrigin(n) === 'mined' ? '挖矿' : '词表'}{n.origin ? '' : '?'}</span>
                  {cs.filter((c) => c.type !== 'recognition').map((c) => <span key={c.id} className={`badge is-type t-${c.type}`}>{TYPE_LABEL[c.type]}</span>)}
                  {n.usedCount > 0 && <span className="badge" title="写作、口语里用上的次数">用上 {n.usedCount}</span>}
                  {dups.has(n.id) && <span className="badge is-dup" title="同组的笔记疑似重复，可以删掉或暂停其中一条">重复组 {dups.get(n.id)}</span>}
                </div>
                {open.has(n.id) && <NoteDetail noteId={n.id} cards={cs} s={s} />}
              </div>
              <div className="note-actions">
                <button type="button" className="icon" title={open.has(n.id) ? '收起' : '展开：每张卡的状态和复习历史'}
                  onClick={() => setOpen((x) => { const y = new Set(x); if (y.has(n.id)) y.delete(n.id); else y.add(n.id); return y; })}>{open.has(n.id) ? '▴' : '▾'}</button>
                <button type="button" className="icon" title="旋转题面" onClick={() => void updateNote(n.id, { rot: (n.rot + 1) % 3 })}>⟳</button>
                <button type="button" className="icon" title="编辑" onClick={() => setEditing(n)}>✎</button>
                {card?.suspended
                  ? <button type="button" className="icon" title="恢复" onClick={() => void setSuspended([n.id], false)}>▶</button>
                  : <button type="button" className="icon" title="暂停" onClick={() => void setSuspended([n.id], true)}>⏸</button>}
                <button type="button" className="icon is-danger" title="删除" onClick={() => void deleteNotes([n.id]).then(() => toast('已删除'))}>🗑</button>
              </div>
            </li>
          );
        })}
      </ul>
      {list.length === 0 && <div className="empty"><p>{notes.some((n) => n.deckId === deckId) ? '没有符合条件的笔记' : '这个牌组还没有笔记'}</p></div>}

      <div className="pager">
        {PAGE_SIZES.map((n) => <button key={n} type="button" className={`pill${prefs.pageSize === n ? ' is-on' : ''}`} onClick={() => { setPrefs({ pageSize: n }); resetPage(); }}>{n}</button>)}
        {pages > 1 && (
          <span className="pages">
            <button type="button" className="pill" disabled={p === 0} onClick={() => setPage(p - 1)}>‹</button>
            <span className="muted small">{p + 1} / {pages}</span>
            <button type="button" className="pill" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>›</button>
          </span>
        )}
      </div>

      {editing && <NoteEditor note={editing} onClose={() => setEditing(null)} />}
      {study && <StudyDialog notes={sel.size ? list.filter((n) => sel.has(n.id)) : list} cardsByNote={cardsByNote} label={studyLabel(status, theme, kw, sel.size)} onClose={() => setStudy(false)} />}
      {batch && <BatchDialog kind={batch} count={ids.length} decks={decks ?? []} onClose={() => setBatch(null)} onApply={async (v) => {
        if (batch === 'theme') { await updateNotes(ids, () => ({ tags: v as Theme[] })); done(`已设置 ${ids.length} 条的主题`); }
        if (batch === 'deck') { await updateNotes(ids, () => ({ deckId: v as string })); done(`已移动 ${ids.length} 条`); }
        if (batch === 'date') { await updateNotes(ids, () => ({ createdAt: noonIso(v as string) })); done(`已修改 ${ids.length} 条的日期`); }
        if (batch === 'delete') { await deleteNotes(ids); done(`已删除 ${ids.length} 条`); }
      }} />}
    </div>
  );
}

function BatchDialog({ kind, count, decks, onClose, onApply }: {
  kind: 'theme' | 'deck' | 'date' | 'delete'; count: number; decks: Array<{ id: string; name: string }>;
  onClose: () => void; onApply: (v: unknown) => Promise<void>;
}) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [deck, setDeck] = useState(decks[0]?.id ?? '');
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const title = { theme: '设置主题', deck: '移到牌组', date: '修改创建日期', delete: '确认删除' }[kind];
  const value = { theme: themes, deck, date: day, delete: null }[kind];
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>取消</button>
      <button type="button" className={`btn ${kind === 'delete' ? 'is-danger' : 'is-primary'}`} onClick={() => void onApply(value)}>确定</button>
    </>}>
      <p className="hint">对选中的 {count} 条笔记{kind === 'delete' ? '执行删除（复习日志保留，用于统计）。' : '生效：'}</p>
      {kind === 'theme' && <ThemePicker value={themes} onChange={setThemes} />}
      {kind === 'deck' && <select value={deck} onChange={(e) => setDeck(e.target.value)}>{decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
      {kind === 'date' && <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />}
    </Modal>
  );
}

function studyLabel(status: Status, theme: string, kw: string, selected: number): string {
  if (selected) return `选中的 ${selected} 条`;
  const parts = [status !== 'all' ? STATUS.find(([k]) => k === status)?.[1] : '', theme, kw.trim() ? `"${kw.trim()}"` : ''].filter(Boolean);
  return parts.join(' · ') || '全部';
}

/** 开一轮自定义学习：选卡型、张数、顺序 */
function StudyDialog({ notes, cardsByNote, label, onClose }: { notes: Note[]; cardsByNote: Map<string, Card[]>; label: string; onClose: () => void }) {
  const [types, setTypes] = useState<Card['type'][]>(['recognition', 'production', 'cloze']);
  const [limit, setLimit] = useState('50');
  const [shuffle, setShuffle] = useState(true);
  const pool = notes.flatMap((n) => (cardsByNote.get(n.id) ?? []).filter((c) => !c.suspended && types.includes(c.type)));
  const max = Math.max(0, Math.floor(Number(limit)) || 0);
  const start = () => {
    const ids = pool.map((c) => c.id);
    if (shuffle) for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const picked = max ? ids.slice(0, max) : ids;
    startCustom(label, picked);
    location.hash = '#/review';
  };
  const n = max ? Math.min(max, pool.length) : pool.length;
  return (
    <Modal title="自定义学习" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn is-primary" disabled={!n} onClick={start}>开始（{n} 张）</button></>}>
      <p className="hint">范围：{label}，{notes.length} 条笔记、{pool.length} 张卡（不含已暂停）。</p>
      <div className="field"><span className="field-label">卡型</span>
        <div className="chips">
          {(['recognition', 'production', 'cloze'] as const).map((t) => (
            <button key={t} type="button" className={`chip${types.includes(t) ? ' is-on' : ''}`} aria-pressed={types.includes(t)}
              onClick={() => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])}>{TYPE_LABEL[t]}</button>
          ))}
        </div>
      </div>
      <div className="row">
        <label className="field" style={{ maxWidth: '10rem' }}><span className="field-label">最多几张（0 = 全部）</span>
          <input type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} /></label>
        <label className="toggle"><input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} /><span>打乱顺序</span></label>
      </div>
      <p className="muted small">本来就到期的卡照常调度并记入复习；没到期的卡和新卡只练习，不改变复习安排。忘了 → 隔 3 张再出，困难 → 本轮最后，良好 / 容易 → 本轮完成。</p>
    </Modal>
  );
}
