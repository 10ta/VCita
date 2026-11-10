import { useMemo, useRef, useState } from 'react';
import { useClips, useDeckSettings, useNotes } from '../../db/hooks';
import { addNote, updateClip, updateNote } from '../../db/actions';
import { db } from '../../db/db';
import type { NoteOrigin, Theme } from '../../schema';
import { clozeTarget, hasCloze } from '../../schema/validate';
import { markedText } from '../../lib/markTarget';
import { NoteForm, formErrors } from '../noteform/NoteForm';
import { newRow, otherFields, rowFields, type Draft } from '../noteform/model';
import { translate, speak } from '../../lib/speech';
import { langLabel } from '../../ui/langs';
import { usePrefs, setPrefs } from '../../ui/prefs';
import { toast } from '../../ui/toast';
import { OriginPicker, ThemePicker } from '../NoteEditor';
import { BulkImport } from './BulkImport';
import { MineText } from './MineText';
import { ClipBasket, type ClipPrefill } from './ClipBasket';

const todayInput = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function AddPage({ deckId }: { deckId: string }) {
  const [tab, setTab] = useState<'one' | 'text' | 'bulk' | 'basket'>(() => (location.hash.includes('basket') ? 'basket' : location.hash.includes('text') || location.hash.startsWith('#/read') ? 'text' : 'one'));
  const [prefill, setPrefill] = useState<ClipPrefill | null>(null);
  const clips = useClips();
  const todo = clips?.filter((c) => c.status === 'todo').length ?? 0;
  return (
    <div className="page add">
      <div className="toolbar">
        <button type="button" className={`pill${tab === 'one' ? ' is-on' : ''}`} onClick={() => setTab('one')}>单个添加</button>
        <button type="button" className={`pill${tab === 'text' ? ' is-on' : ''}`} onClick={() => setTab('text')} title="粘贴短文，标出生词，一键复制给 Claude 做卡">短文挖词</button>
        <button type="button" className={`pill${tab === 'bulk' ? ' is-on' : ''}`} onClick={() => setTab('bulk')}>批量导入</button>
        <button type="button" className={`pill${tab === 'basket' ? ' is-on' : ''}`} onClick={() => setTab('basket')}>摘句篮{todo ? ` ${todo}` : ''}</button>
      </div>
      {tab === 'one' ? <AddOne key={prefill?.clipId ?? 'blank'} deckId={deckId} prefill={prefill} />
        : tab === 'text' ? <MineText deckId={deckId} />
        : tab === 'bulk' ? <BulkImport deckId={deckId} />
        : <ClipBasket onMake={(p) => { setPrefill(p); setPrefs({ addOrigin: 'mined' }); setTab('one'); }} />}
    </div>
  );
}

// 单个添加：和编辑笔记同一套表单（noteform/NoteForm）。最快的用法：写表达、回车，生成认读卡，意思在后台翻译
function blankDraft(deckId: string, origin: NoteOrigin, prefill?: ClipPrefill | null): Draft {
  const d: Draft = {
    lemma: '', meaningZh: '', meaningEn: '', cueFamily: '', source: prefill?.source ?? '', extra: prefill?.extra ?? '', etymology: '', contrastNote: '',
    layer: 'mid', origin, cardTypes: ['recognition'], tags: [], deckId, day: todayInput(), rows: [],
  };
  const t = prefill?.text.trim() ?? '';
  // 摘句篮来的：带 {{…}} 的整句 → 一句例句 + 标出的部分当表达；没标的整句 → 例句（点词标出）；否则就是表达
  if (hasCloze(t)) { d.rows = [{ ...newRow('ex', t), manual: true }]; d.lemma = markedText(t); }
  else if (t.split(/\s+/).length >= 5 || /[.!?…]$/.test(t)) d.rows = [newRow('ex', t)];
  else d.lemma = t;
  return d;
}

function AddOne({ deckId, prefill }: { deckId: string; prefill?: ClipPrefill | null }) {
  // 从摘句篮来的那一条：第一次添加后标为已做卡
  const clipRef = useRef(prefill?.clipId ?? null);
  const s = useDeckSettings(deckId);
  const notes = useNotes();
  const prefs = usePrefs();
  const [d, setDraft] = useState<Draft>(() => blankDraft(deckId, prefs.addOrigin, prefill));
  const setD = (fn: (d: Draft) => Draft) => setDraft(fn);
  const [tags, setTags] = useState<Theme[]>([]);
  const [day, setDay] = useState(todayInput);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [dupWarned, setDupWarned] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const lemmaInput = useRef<HTMLInputElement>(null);

  const recent = useMemo(() => (notes ?? []).filter((n) => n.deckId === deckId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 8), [notes, deckId]);
  if (!s || !notes) return null;
  const labels: [string, string, string] = [langLabel(s.sourceLang), langLabel(s.targetLang1), langLabel(s.targetLang2)];

  const add = async () => {
    setTried(true);
    const fields = rowFields(d);
    // 表达空着时用第一句例句里标出的部分
    const lemma = d.lemma.trim() || markedText(fields.sentence);
    if (!lemma && !fields.sentence) return;
    const errs = formErrors({ ...d, lemma }, null);
    if (errs.count) return;
    const dup = notes.some((n) => n.deckId === deckId && ((lemma && n.lemma.toLowerCase() === lemma.toLowerCase()) || (fields.sentence && n.sentence === fields.sentence)));
    const key = lemma || fields.sentence;
    if (dup && dupWarned !== key) {
      setDupWarned(key);
      toast(`"${key}" 已经在这个牌组里了，再添加一次仍然添加`, true);
      return;
    }
    setDupWarned(null);
    const [y, m, dd] = day.split('-').map(Number);
    const created = new Date(y, m - 1, dd, new Date().getHours(), new Date().getMinutes()).getTime();
    const { noteId } = await addNote({
      deckId, createdAtMs: created, ...otherFields(d), lemma, ...fields, tags, origin: prefs.addOrigin,
      cardTypes: d.cardTypes, layer: d.cardTypes.includes('production') ? 'core' : 'mid',
    });
    // 从摘句篮来的：标为已做卡
    if (clipRef.current) { void updateClip(clipRef.current, { status: 'done', noteId }); clipRef.current = null; }
    const typed = { zh: d.meaningZh.trim(), en: d.meaningEn.trim() };
    setDraft(blankDraft(deckId, prefs.addOrigin)); setTried(false); setFormKey((k) => k + 1);
    requestAnimationFrame(() => lemmaInput.current?.focus());
    if (prefs.autoPlay) void speak(lemma, s.sourceLang);
    if (typed.zh && typed.en) { toast(`✓ ${lemma}`); return; }
    // 意思在后台翻译，可以接着输入下一个
    setPending((x) => new Set(x).add(noteId));
    const [t1, t2] = await Promise.all([typed.zh ? '' : translate(lemma, s.sourceLang, s.targetLang1), typed.en ? '' : translate(lemma, s.sourceLang, s.targetLang2)]);
    const cur = await db.notes.get(noteId);
    if (cur && (t1 || t2)) await updateNote(noteId, { meaningZh: cur.meaningZh || t1 || '', meaningEn: cur.meaningEn || t2 || '' });
    setPending((x) => { const n = new Set(x); n.delete(noteId); return n; });
    const ok = (typed.zh || t1) && (typed.en || t2);
    toast(ok ? `✓ ${lemma} → ${typed.zh || t1} / ${typed.en || t2}` : `翻译失败：${lemma}，可在词库里手动编辑`, !ok);
  };

  return (
    <div>
      <p className="muted small">{labels[0]} → {labels[1]} + {labels[2]}。写表达、回车就生成认读卡，意思在后台翻译，可以连续输入。要例句、挖空、产出就在下面加；整句也可以直接写进例句，点词标出要学的部分。</p>
      <NoteForm key={formKey} d={d} setD={setD} s={s} labels={labels} mode="add" onSubmit={() => void add()} lemmaRef={lemmaInput} showErrors={tried} />
      <div className="row add-actions">
        <label className="field"><span className="field-label">日期</span><input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
        <span className="grow" />
        <button type="button" className="btn is-primary" onClick={() => void add()}>添加</button>
      </div>
      <div className="field"><span className="field-label">来源（记住上次的选择）</span><OriginPicker value={prefs.addOrigin} onChange={(v) => setPrefs({ addOrigin: v })} /></div>
      <div className="field"><span className="field-label">主题（对接下来添加的都生效）</span><ThemePicker value={tags} onChange={setTags} /></div>

      <div className="toolbar">
        <button type="button" className={`pill${prefs.autoPlay ? ' is-on' : ''}`} onClick={() => setPrefs({ autoPlay: !prefs.autoPlay })}>自动发音</button>
        {pending.size > 0 && <span className="muted small pulse">翻译中（{pending.size}）</span>}
      </div>
      <h3 className="sub">最近添加</h3>
      <ul className="recent">
        {recent.map((n) => (
          <li key={n.id}>
            <b>{n.lemma || clozeTarget(n.sentence)}</b><span className="arrow">→</span>
            <span>{n.meaningZh || (pending.has(n.id) ? '…' : '')}</span><span className="sep">/</span><span className="t2">{n.meaningEn || (pending.has(n.id) ? '…' : '')}</span>
            {n.cardTypes.filter((t) => t !== 'recognition').map((t) => <span key={t} className={`badge is-type t-${t}`}>{t === 'production' ? '产出' : t === 'cloze' ? '挖空' : t === 'contrast' ? '辨析' : t}</span>)}
          </li>
        ))}
      </ul>
    </div>
  );
}
