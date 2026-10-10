import { useMemo, useRef, useState } from 'react';
import { useNotes, useSettings } from '../../db/hooks';
import { addNote, updateNote } from '../../db/actions';
import { db } from '../../db/db';
import type { Card, Note, Theme } from '../../schema';
import { clozeTarget, hasCloze, noteErrors } from '../../schema/validate';
import { CARD_TYPES, CardPreviews, ClozeMarker } from '../NoteParts';
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

// 单个添加：默认只填一个框、回车生成认读卡；打开"产出""挖空"时就地展开需要的字段
function AddOne({ deckId }: { deckId: string }) {
  const s = useSettings();
  const notes = useNotes();
  const prefs = usePrefs();
  const [text, setText] = useState('');
  const [day, setDay] = useState(todayInput);
  const [tags, setTags] = useState<Theme[]>([]);
  const [types, setTypes] = useState<Card['type'][]>(['recognition']);
  // 默认展开与否看设置；本页内手动点过"收起 / 更多字段"后以手动为准
  const [moreOverride, setMore] = useState<boolean | null>(null);
  const more = moreOverride ?? s?.addShowMore ?? true;
  const [f, setF] = useState(EMPTY);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [dupWarned, setDupWarned] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof EMPTY>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));

  const recent = useMemo(() => (notes ?? []).filter((n) => n.deckId === deckId).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 8), [notes, deckId]);

  // 输入的是整句（4 个词以上）：句子本身就是例句，点词标记考查部分；否则是单词 / 短语，例句另填
  const plain = text.replace(/\{\{|\}\}/g, '').trim();
  const isSentence = plain.split(/\s+/).filter(Boolean).length >= 4;
  const sentence = isSentence ? (hasCloze(text) ? text.trim() : '') : f.sentence.trim();
  const target = sentence ? clozeTarget(sentence) : '';
  const lemma = isSentence ? (hasCloze(text) ? target : plain) : plain;
  const draftFields = { lemma, sentence, cardTypes: types, intentZh: f.intentZh || null, answerFr: f.answerFr || null };
  const errors = plain ? noteErrors(draftFields) : [];
  const has = (t: Card['type']) => types.includes(t);

  // 打开产出卡：答案默认填考查部分（或单词），中文意图自动翻译预填，可以改
  const prefillProduction = async (answer: string) => {
    if (!s || !answer) return;
    setF((x) => ({ ...x, answerFr: x.answerFr || answer }));
    const zh = await translate(answer, s.sourceLang, s.targetLang1);
    if (zh) setF((x) => ({ ...x, intentZh: x.intentZh || zh }));
  };
  const toggle = (t: Card['type']) => {
    const on = !has(t);
    setTypes(on ? [...types, t] : types.filter((x) => x !== t));
    if (on && t === 'production') void prefillProduction(target || plain);
    if (on && t === 'cloze' && !isSentence) setMore(true);
  };

  if (!s || !notes) return null;
  const labels: [string, string, string] = [langLabel(s.sourceLang), langLabel(s.targetLang1), langLabel(s.targetLang2)];

  const add = async () => {
    setTried(true);
    if (!plain || errors.length) return;
    const dup = notes.some((n) => n.deckId === deckId && ((lemma && n.lemma.toLowerCase() === lemma.toLowerCase()) || (sentence && n.sentence === sentence)));
    const key = lemma || sentence;
    if (dup && dupWarned !== key) {
      setDupWarned(key);
      toast(`"${key}" 已经在这个牌组里了，再按一次回车仍然添加`, true);
      return;
    }
    setDupWarned(null);
    const [y, m, d] = day.split('-').map(Number);
    const created = new Date(y, m - 1, d, new Date().getHours(), new Date().getMinutes()).getTime();
    const nul = (x: string) => (x.trim() ? x.trim() : null);
    const { noteId } = await addNote({
      deckId, createdAtMs: created, lemma, sentence, tags, cardTypes: types, layer: has('production') ? 'core' : 'mid',
      intentZh: nul(f.intentZh), hint: nul(f.hint), clozeHint: nul(f.clozeHint), answerFr: nul(f.answerFr), cueFamily: nul(f.cueFamily), source: nul(f.source), extra: nul(f.extra),
    });
    const toTranslate = target || plain;
    setText(''); setF(EMPTY); setTypes(['recognition']); setTried(false);
    input.current?.focus();
    if (prefs.autoPlay) void speak(plain, s.sourceLang);
    // 意思在后台翻译（考查部分或单词），可以接着输入下一个
    setPending((x) => new Set(x).add(noteId));
    const [t1, t2] = await Promise.all([translate(toTranslate, s.sourceLang, s.targetLang1), translate(toTranslate, s.sourceLang, s.targetLang2)]);
    const cur = await db.notes.get(noteId);
    if (cur && (t1 || t2)) await updateNote(noteId, { meaningZh: cur.meaningZh || t1 || '', meaningEn: cur.meaningEn || t2 || '' });
    setPending((x) => { const n = new Set(x); n.delete(noteId); return n; });
    toast(t1 && t2 ? `✓ ${toTranslate} → ${t1} / ${t2}` : `翻译失败：${toTranslate}，可在词库里手动编辑`, !(t1 && t2));
  };
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void add(); } };
  const field = (k: keyof typeof EMPTY, label: string, ph = '') => (
    <label className="field"><span className="field-label">{label}</span>
      <input value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} onKeyDown={onEnter} /></label>
  );
  const draft = {
    ...BLANK_NOTE, lemma, sentence, cardTypes: types, meaningZh: '', meaningEn: '',
    intentZh: f.intentZh || null, hint: f.hint || null, clozeHint: f.clozeHint || null, answerFr: f.answerFr || null,
    cueFamily: f.cueFamily || null, source: f.source || null, extra: f.extra || null,
  };

  return (
    <div>
      <p className="muted small">{labels[0]} → {labels[1]} + {labels[2]}。输入单词、短语或整句，回车添加；意思在后台翻译，可以连续输入。</p>
      <div className="add-row">
        <input ref={input} className="word-input" autoFocus placeholder={`${labels[0]}单词、短语或整句`} value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={onEnter} />
        <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <button type="button" className="btn is-primary" disabled={!plain} onClick={() => void add()}>添加</button>
      </div>
      {isSentence && (
        <>
          <ClozeMarker value={text} onChange={setText} />
          <p className="muted small">点句子里的词标记考查部分：认读卡加粗，挖空卡挖掉。不标记就整句作为正面。</p>
        </>
      )}
      <div className="toolbar">
        <span className="muted small">生成</span>
        {CARD_TYPES.map(([t, label, tip]) => (
          <button key={t} type="button" title={tip} className={`chip${has(t) ? ' is-on' : ''}`} aria-pressed={has(t)} onClick={() => toggle(t)}>{label}</button>
        ))}
        <span className="grow" />
        <button type="button" className={`pill${more ? ' is-on' : ''}`} onClick={() => setMore(!more)}>{more ? '收起' : '更多字段'}</button>
      </div>

      {!isSentence && (more || has('cloze')) && (
        <>
          {field('sentence', has('cloze') ? '例句（挖空卡必填）' : '例句（可选）', '例如：les enfants ont perdu leurs repères')}
          {f.sentence.trim() && <><ClozeMarker value={f.sentence} onChange={(v) => set('sentence', v)} /><p className="muted small">点词标记考查部分</p></>}
        </>
      )}
      {has('cloze') && field('clozeHint', '挖空提示（可选，横线处显示）', `例如：飞越。留空时正面显示${labels[1]}意思`)}
      {has('production') && (
        <fieldset className="prod">
          <legend>产出卡</legend>
          {field('intentZh', '中文意图（正面，已自动翻译，可改）', '想表达的意思，例如：要考虑居民的意见')}
          {field('answerFr', `${labels[0]}答案（背面）`, '例如：tenir compte de l’avis')}
          {field('hint', '提示（可选）', '例如：首字母 t… c… d…')}
        </fieldset>
      )}
      {more && (
        <div className="grid2">
          {field('cueFamily', '词族线索', '例如：repérer 找出、标出')}
          {field('source', '出处', '例如：InnerFrench · 第 12 集')}
          {field('extra', '补充', '例如：≠ se tenir à 扶住')}
        </div>
      )}
      <div className="field"><span className="field-label">主题（对接下来添加的都生效）</span><ThemePicker value={tags} onChange={setTags} /></div>
      {tried && errors.map((e) => <p key={e} className="form-error">{e}</p>)}
      {plain && !errors.length && (has('production') || has('cloze') || sentence) && <CardPreviews draft={draft} s={s} labels={labels} />}

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
            {n.cardTypes.filter((t) => t !== 'recognition').map((t) => <span key={t} className={`badge is-type t-${t}`}>{t === 'production' ? '产出' : '挖空'}</span>)}
          </li>
        ))}
      </ul>
    </div>
  );
}

const EMPTY = { sentence: '', intentZh: '', hint: '', clozeHint: '', answerFr: '', cueFamily: '', source: '', extra: '' };
const BLANK_NOTE: Note = {
  id: 'draft', deckId: '', createdAt: '2026-01-01T00:00:00.000Z', lemma: '', sentence: '', meaningZh: '', meaningEn: '',
  cueFamily: null, intentZh: null, hint: null, clozeHint: null, answerFr: null, extra: null, source: null, layer: 'mid', cardTypes: ['recognition'],
  tags: [], usedCount: 0, usedAt: [], rot: 0, legacy: null, updatedAt: '2026-01-01T00:00:00.000Z', deleted: false,
};
