import { useMemo, useState } from 'react';
import { useCards, useDecks, useNotes, useSettings } from '../../db/hooks';
import { deleteNotes, resetNotes, setSuspended, updateNote, updateNotes } from '../../db/actions';
import { THEMES, type Card, type Note, type Theme } from '../../schema';
import { fromIso, noonIso } from '../../lib/time';
import { usePrefs, setPrefs } from '../../ui/prefs';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toast';
import { langLabel } from '../../ui/langs';
import { CardStats, Cues, renderSentence, SpeakBtn } from '../CardFace';
import { NoteEditor, ThemePicker } from '../NoteEditor';

type Status = 'all' | 'new' | 'learning' | 'due' | 'leech' | 'suspended' | 'nosentence';
const STATUS: Array<[Status, string]> = [
  ['all', '全部'], ['due', '到期'], ['new', '新卡'], ['learning', '学习中'], ['leech', '待改造'], ['suspended', '已暂停'], ['nosentence', '待补句子'],
];
const PAGE_SIZES = [10, 30, 50, 100];

export function LibraryPage({ deckId }: { deckId: string }) {
  const s = useSettings();
  const notes = useNotes();
  const cards = useCards();
  const decks = useDecks();
  const prefs = usePrefs();
  const [kw, setKw] = useState('');
  const [theme, setTheme] = useState<Theme | ''>('');
  const [status, setStatus] = useState<Status>('all');
  const [day, setDay] = useState('');
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Note | null>(null);
  const [batch, setBatch] = useState<null | 'theme' | 'deck' | 'date' | 'delete'>(null);

  const cardsByNote = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of cards ?? []) m.set(c.noteId, [...(m.get(c.noteId) ?? []), c]);
    return m;
  }, [cards]);

  const list = useMemo(() => {
    if (!notes) return [];
    const now = Date.now();
    const k = kw.trim().toLowerCase();
    return notes
      .filter((n) => n.deckId === deckId)
      .filter((n) => !theme || n.tags.includes(theme))
      .filter((n) => !day || n.createdAt.slice(0, 10) === day)
      .filter((n) => !k || [n.lemma, n.sentence, n.meaningZh, n.meaningEn, n.source ?? ''].some((x) => x.toLowerCase().includes(k)))
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
        }
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  }, [notes, deckId, theme, day, kw, status, cardsByNote]);

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
      <div className="filters">
        <input className="search" placeholder="搜索单词、句子、意思、出处…" value={kw} onChange={(e) => { setKw(e.target.value); resetPage(); }} />
        <select value={theme} onChange={(e) => { setTheme(e.target.value as Theme | ''); resetPage(); }}>
          <option value="">全部主题</option>
          {THEMES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date" value={day} onChange={(e) => { setDay(e.target.value); resetPage(); }} title="按创建日期筛选" />
        {day && <button type="button" className="pill" onClick={() => setDay('')}>✕</button>}
      </div>
      <div className="toolbar">
        {STATUS.map(([k, label]) => (
          <button key={k} type="button" className={`pill${status === k ? ' is-on' : ''}`} onClick={() => { setStatus(k); resetPage(); }}>{label}</button>
        ))}
        <span className="grow" />
        <span className="muted small">{list.length} 条</span>
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
                </div>
              </div>
              <div className="note-actions">
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
