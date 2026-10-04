import { useMemo, useRef, useState } from 'react';
import { useNotes, useSettings } from '../../db/hooks';
import { addNote, updateNote } from '../../db/actions';
import { db } from '../../db/db';
import type { Theme } from '../../schema';
import { translate, speak } from '../../lib/speech';
import { langLabel } from '../../ui/langs';
import { usePrefs, setPrefs } from '../../ui/prefs';
import { toast } from '../../ui/toast';
import { ThemePicker } from '../NoteEditor';
import { BulkImport } from './BulkImport';

const todayInput = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function AddPage({ deckId }: { deckId: string }) {
  const [tab, setTab] = useState<'one' | 'bulk'>('one');
  return (
    <div className="page add">
      <div className="toolbar">
        <button type="button" className={`pill${tab === 'one' ? ' is-on' : ''}`} onClick={() => setTab('one')}>单个添加</button>
        <button type="button" className={`pill${tab === 'bulk' ? ' is-on' : ''}`} onClick={() => setTab('bulk')}>批量导入</button>
      </div>
      {tab === 'one' ? <AddOne deckId={deckId} /> : <BulkImport deckId={deckId} />}
    </div>
  );
}

function AddOne({ deckId }: { deckId: string }) {
  const s = useSettings();
  const notes = useNotes();
  const prefs = usePrefs();
  const [word, setWord] = useState('');
  const [day, setDay] = useState(todayInput);
  const [tags, setTags] = useState<Theme[]>([]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [dupWarned, setDupWarned] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const recent = useMemo(() => (notes ?? []).filter((n) => n.deckId === deckId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 8), [notes, deckId]);
  if (!s || !notes) return null;

  const add = async () => {
    const lemma = word.trim();
    if (!lemma) return;
    const dup = notes.some((n) => n.deckId === deckId && n.lemma.toLowerCase() === lemma.toLowerCase());
    if (dup && dupWarned !== lemma) {
      setDupWarned(lemma);
      toast(`"${lemma}" 已经在这个牌组里了，再按一次回车仍然添加`, true);
      return;
    }
    setDupWarned(null);
    const [y, m, d] = day.split('-').map(Number);
    const created = new Date(y, m - 1, d, new Date().getHours(), new Date().getMinutes()).getTime();
    const { noteId } = await addNote({ deckId, lemma, createdAtMs: created, tags });
    setWord('');
    input.current?.focus();
    if (prefs.autoPlay) void speak(lemma, s.sourceLang);
    setPending((x) => new Set(x).add(noteId));
    const [t1, t2] = await Promise.all([translate(lemma, s.sourceLang, s.targetLang1), translate(lemma, s.sourceLang, s.targetLang2)]);
    const cur = await db.notes.get(noteId);
    // 只填空字段：翻译回来之前手动改过的内容不覆盖
    if (cur && (t1 || t2)) await updateNote(noteId, { meaningZh: cur.meaningZh || t1 || '', meaningEn: cur.meaningEn || t2 || '' });
    setPending((x) => { const n = new Set(x); n.delete(noteId); return n; });
    toast(t1 && t2 ? `✓ ${lemma} → ${t1} / ${t2}` : `翻译失败：${lemma}，可在词库里手动编辑`, !(t1 && t2));
  };

  return (
    <div>
      <p className="muted small">{langLabel(s.sourceLang)} → {langLabel(s.targetLang1)} + {langLabel(s.targetLang2)}（翻译在后台完成，可以连续输入）</p>
      <div className="add-row">
        <input ref={input} className="word-input" autoFocus placeholder={`输入${langLabel(s.sourceLang)}单词或短语，回车添加`} value={word}
          onChange={(e) => setWord(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void add(); }} />
        <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button type="button" className="btn is-primary" disabled={!word.trim()} onClick={() => void add()}>添加</button>
      </div>
      <div className="field"><span className="field-label">主题（对接下来添加的词都生效）</span><ThemePicker value={tags} onChange={setTags} /></div>
      <div className="toolbar">
        <button type="button" className={`pill${prefs.autoPlay ? ' is-on' : ''}`} onClick={() => setPrefs({ autoPlay: !prefs.autoPlay })}>自动发音</button>
        {pending.size > 0 && <span className="muted small pulse">翻译中（{pending.size}）</span>}
      </div>
      <h3 className="sub">最近添加</h3>
      <ul className="recent">
        {recent.map((n) => (
          <li key={n.id}>
            <b>{n.lemma || n.sentence}</b><span className="arrow">→</span>
            <span>{n.meaningZh || (pending.has(n.id) ? '…' : '')}</span><span className="sep">/</span><span className="t2">{n.meaningEn || (pending.has(n.id) ? '…' : '')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
