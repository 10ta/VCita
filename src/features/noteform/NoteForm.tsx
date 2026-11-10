// 笔记表单（添加页和编辑弹窗共用）：
//   ① 表达 + 意思：「考什么」只写这一次
//   ② 例句表：例句直接写普通句子，表达自动标出（点词可以改）；写了「换说法」的句子是一道产出题
//   ③ 卡片：每种卡用了什么、还缺什么，分页预览正反面
//   ④ 背面补充、归类：默认收起
import { useMemo, useState, type ReactNode } from 'react';
import type { Card, Note, Settings } from '../../schema';
import { contrastLeaks, hasCloze, noteErrors, promptErrors, blankIsFunctionWords } from '../../schema/validate';
import { autoMark, markedText, type Lemmatize } from '../../lib/markTarget';
import { lemmaCandidates, useFrDict, useFrVerbs } from '../../lib/gender/dict';
import { isFrench } from '../../ui/langs';
import { cardView, Cues } from '../CardFace';
import { CARD_TYPES, ClozeMarker } from '../NoteParts';
import { newRow, promptOf, rowFields, type Draft, type Row } from './model';

/** 法语牌组：词形还原（词典 + 变位表，第一次用到时下载）；其他语言只靠词首比较 */
export function useLemmatizer(lang: string | undefined): Lemmatize | undefined {
  const fr = !!lang && isFrench(lang);
  const dict = useFrDict(fr);
  const verbs = useFrVerbs(fr);
  return useMemo(() => (dict ? (f: string) => lemmaCandidates(dict, verbs, f) : undefined), [dict, verbs]);
}

const spans = (s: string) => [...s.matchAll(/\{\{(.*?)\}\}/g)].length;

/** 表单的错误：每行各自的（显示在那一行下面）+ 整条笔记的 */
export function formErrors(d: Draft, contrastGroup: string | null): { rows: Record<string, string[]>; all: string[]; count: number } {
  const rows: Record<string, string[]> = {};
  const wantProd = d.cardTypes.includes('production');
  for (const r of d.rows) {
    const e: string[] = [];
    if (r.kind === 'ex' && r.text.trim() && !hasCloze(r.text)) e.push('这句没找到表达：点句子里的词把它标出来');
    if (r.kind === 'prod' && wantProd && (r.text.trim() || r.para.trim() || r.prompt?.trim())) {
      if (r.prompt == null && r.para.trim() && spans(r.text) > 1) e.push('答案里的表达分成了几段，换说法替换不了：点「整句手写题面」');
      else e.push(...promptErrors(promptOf(r), r.zh || null, r.text || null, d.lemma));
    }
    if (e.length) rows[r.key] = e;
  }
  const f = rowFields(d);
  const types = [...d.cardTypes.filter((t) => t !== 'production'), ...(contrastGroup ? ['contrast' as const] : [])];
  const all = noteErrors({ ...f, lemma: d.lemma, cardTypes: types }).filter((x) => !x.startsWith('例句里要用') && !x.startsWith('挖空卡需要带') && !x.startsWith('在易混组里'));
  const ex = d.rows.filter((r) => r.kind === 'ex' && hasCloze(r.text));
  if (!d.cardTypes.length) all.unshift('至少选一种卡');
  if (d.cardTypes.includes('cloze') && !ex.length) all.push('挖空卡需要至少一句标出表达的例句');
  if (contrastGroup && !ex.length) all.push('在易混组里的笔记需要至少一句标出表达的例句（辨析卡挖掉它）');
  if (wantProd && !d.rows.some((r) => r.kind === 'prod' && r.text.trim())) all.push('产出卡至少要一道产出题：点「＋ 产出题」');
  return { rows, all: [...new Set(all)], count: Object.values(rows).flat().length + all.length };
}

/** 改了表达：没手动点过的例句按新表达重新标；返回新的行和重标了几句 */
export function remarkRows(rows: Row[], lemma: string, lemmatize?: Lemmatize): { rows: Row[]; changed: number; kept: number } {
  let changed = 0, kept = 0;
  const out = rows.map((r) => {
    if (!r.text.trim() || !lemma.trim()) return r;
    if (r.manual) { kept++; return r; }
    const m = autoMark(r.text, lemma, lemmatize);
    if (!m || m === r.text) return r;
    changed++;
    return { ...r, text: m };
  });
  return { rows: out, changed, kept };
}

interface Props {
  d: Draft;
  setD: (fn: (d: Draft) => Draft) => void;
  s: Settings;
  labels: [string, string, string];
  mode: 'add' | 'edit';
  /** 编辑时：这条笔记（易混组、用上次数）和组里的其他笔记 */
  note?: Note;
  groupMates?: Note[];
  onSubmit: () => void;
  /** 「表达」输入框（添加页要自动聚焦、添加后回到这里） */
  lemmaRef?: React.Ref<HTMLInputElement>;
  /** 卡片区下面、背面补充上面的额外内容（编辑页的易混组操作等） */
  contrastExtra?: ReactNode;
  /** 归类区的内容（添加页和编辑页不同） */
  meta?: ReactNode;
  showErrors: boolean;
}

export function NoteForm({ d, setD, s, labels, mode, note, groupMates = [], onSubmit, lemmaRef, contrastExtra, meta, showErrors }: Props) {
  const lemmatize = useLemmatizer(s.sourceLang);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Set<string>>(() => new Set(d.rows.filter((r) => !r.text.trim()).map((r) => r.key)));
  const group = note?.contrastGroup ?? null;
  const errs = formErrors(d, group);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setRow = (key: string, patch: Partial<Row>) => setD((x) => ({ ...x, rows: x.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const has = (t: Card['type']) => d.cardTypes.includes(t);
  const ex = d.rows.filter((r) => r.kind === 'ex');
  const prod = d.rows.filter((r) => r.kind === 'prod');

  /** 返回重标了几句 */
  const remark = (lemma: string): number => {
    const r = remarkRows(d.rows, lemma, lemmatize);
    if (r.changed) {
      setD((x) => ({ ...x, rows: r.rows }));
      setNotice(`表达改了：已重新标出 ${r.changed} 句${r.kept ? `，手动标过的 ${r.kept} 句没动，检查一下` : ''}`);
    } else setNotice(null);
    return r.changed;
  };
  /** 写完一句：没写 {{…}} 就按表达自动标；表达还空着、句子里手动标了，就用标出的部分当表达 */
  const commitText = (r: Row, raw: string) => {
    const text = raw.trim();
    setEditing((x) => { const n = new Set(x); n.delete(r.key); return n; });
    if (!text) { setD((x) => ({ ...x, rows: x.rows.filter((y) => y.key !== r.key) })); return; }
    if (hasCloze(text)) {
      setRow(r.key, { text, manual: true });
      if (!d.lemma.trim()) set('lemma', markedText(text));
      return;
    }
    const m = d.lemma.trim() ? autoMark(text, d.lemma, lemmatize) : null;
    setRow(r.key, { text: m ?? text, manual: false });
  };
  const clickMark = (r: Row, v: string) => {
    setRow(r.key, { text: v, manual: true });
    if (!d.lemma.trim() && hasCloze(v)) set('lemma', markedText(v));
  };
  const addRow = (kind: Row['kind']) => {
    const r = newRow(kind);
    setD((x) => ({ ...x, rows: [...x.rows, r] }));
    setEditing((x) => new Set(x).add(r.key));
  };
  const move = (r: Row) => setD((x) => {
    const same = x.rows.filter((y) => y.kind === r.kind);
    const i = same.findIndex((y) => y.key === r.key);
    if (i <= 0) return x;
    [same[i - 1], same[i]] = [same[i], same[i - 1]];
    const other = x.rows.filter((y) => y.kind !== r.kind);
    return { ...x, rows: r.kind === 'ex' ? [...same, ...other] : [...other, ...same] };
  });
  const toggleType = (t: Card['type']) => {
    const on = !has(t);
    set('cardTypes', on ? [...d.cardTypes, t] : d.cardTypes.filter((x) => x !== t));
    if (on && t === 'production' && !prod.length) addRow('prod');
    if (on && t === 'cloze' && !ex.length) addRow('ex');
  };
  const exRoles = [has('recognition') && '认读', has('cloze') && '挖空', group && '辨析'].filter(Boolean).join(' · ') || '（没选用到例句的卡）';
  const leaks = group ? contrastLeaks({ lemma: d.lemma, ...rowFields(d) }, groupMates) : [];

  const rowView = (r: Row, i: number) => {
    const isEditing = editing.has(r.key) || !r.text.trim();
    const rowErr = showErrors || r.text.trim() ? errs.rows[r.key] ?? [] : [];
    const p = r.kind === 'prod' ? promptOf(r) : null;
    return (
      <li key={r.key} className={`nf-row is-${r.kind}`}>
        <div className="nf-row-head">
          <span className="nf-no">{r.kind === 'ex' ? i + 1 : `Q${i + 1}`}</span>
          <div className="nf-sent">
            {isEditing
              ? <RowInput initial={r.text} placeholder={r.kind === 'ex' ? '直接写句子，表达会自动标出' : '答案句：最好换一个和例句不同的场景，表达会自动标出'} onCommit={(v) => commitText(r, v)} />
              : <ClozeMarker value={r.text} onChange={(v) => clickMark(r, v)} />}
          </div>
          <span className={`nf-role${r.kind === 'prod' ? ' is-prod' : ''}`}>{r.kind === 'ex' ? exRoles : '产出'}</span>
          <span className="nf-ops">
            {!isEditing && <button type="button" className="icon" title="改句子（可以直接写 {{…}} 手动标）" aria-label="改句子" onClick={() => setEditing((x) => new Set(x).add(r.key))}>✎</button>}
            {i > 0 && <button type="button" className="icon" title={r.kind === 'ex' ? '往前挪（第一句是主句：卡片第一次出现用它）' : '往前挪'} aria-label="往前挪" onClick={() => move(r)}>↑</button>}
            <button type="button" className="icon is-danger" title="删掉这句" aria-label="删掉这句" onClick={() => setD((x) => ({ ...x, rows: x.rows.filter((y) => y.key !== r.key) }))}>✕</button>
          </span>
        </div>
        {r.kind === 'ex' && has('cloze') && r.text.trim() && !blankIsFunctionWords(r.text) && (
          <label className="nf-sub"><span>挖空提示</span>
            <input value={r.hint} placeholder={`可选：横线处显示的意思，不写答案的词；留空显示${labels[1]}意思`} onChange={(e) => setRow(r.key, { hint: e.target.value })} />
          </label>
        )}
        {r.kind === 'prod' && (
          <>
            {r.prompt == null ? (
              <label className="nf-sub"><span>换说法</span>
                <input value={r.para} placeholder="更简单的说法，替换答案里标出的部分；不能用答案里的词" onChange={(e) => setRow(r.key, { para: e.target.value })} />
                <button type="button" className="pill" title="表达分成几段、或者换说法要改动句子其他部分时用" onClick={() => setRow(r.key, { prompt: p ?? r.text })}>整句手写题面</button>
              </label>
            ) : (
              <label className="nf-sub"><span>题面</span>
                <input value={r.prompt} placeholder="整句题面，用 {{…}} 标出要换掉的说法" onChange={(e) => setRow(r.key, { prompt: e.target.value })} />
                <button type="button" className="pill" onClick={() => setRow(r.key, { prompt: null })}>改用换说法</button>
              </label>
            )}
            {p && <div className="nf-prompt"><span className="muted small">正面：</span><ClozeMarker value={p} onChange={() => undefined} readOnly /></div>}
            {!p && r.zh.trim() && <p className="muted small nf-legacy">没有换说法：正面显示{labels[1]}注释（老式题）</p>}
            <label className="nf-sub"><span>{labels[1]}注释</span>
              <input value={r.zh} placeholder="可选：背面显示；复习时按 H 先看到它" onChange={(e) => setRow(r.key, { zh: e.target.value })} />
            </label>
            {r.legacyHint && !p && <label className="nf-sub"><span>提示</span><input value={r.legacyHint} onChange={(e) => setRow(r.key, { legacyHint: e.target.value })} /></label>}
          </>
        )}
        {rowErr.map((e) => <p key={e} className="form-error small">{e}</p>)}
      </li>
    );
  };

  // 预览用的笔记
  const draftNote: Note = useMemo(() => ({
    ...(note ?? BLANK), ...rowFields(d), lemma: d.lemma, meaningZh: d.meaningZh, meaningEn: d.meaningEn,
    cueFamily: d.cueFamily || null, extra: d.extra || null, etymology: d.etymology || null, source: d.source || null, contrastNote: d.contrastNote || null,
    cardTypes: [...d.cardTypes, ...(group ? ['contrast' as const] : [])],
  }), [d, note, group]);

  const status: Array<[Card['type'], string, boolean]> = [
    ['recognition', ex.length ? `${ex.length} 句例句轮换` : d.lemma.trim() ? '没有例句：正面只显示表达' : '需要例句或表达', !!(ex.length || d.lemma.trim())],
    ['cloze', ex.length ? `${ex.length} 句轮换，挖掉标出的部分` : '需要至少一句例句', ex.length > 0],
    ['production', prod.length ? `${prod.length} 道题轮换` : '还没有产出题：点「＋ 产出题」', prod.length > 0],
  ];

  return (
    <div className="noteform">
      <section className="nf-block">
        <label className="field"><span className="field-label">表达（{labels[0]}）· 考什么只写这一次</span>
          <input ref={lemmaRef} className="nf-lemma" value={d.lemma} autoFocus={mode === 'add'} placeholder="例如：prendre qqn dans le sens du poil"
            onChange={(e) => set('lemma', e.target.value)} onBlur={(e) => remark(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (!remark(d.lemma)) onSubmit(); } }} />
        </label>
        <div className="grid2">
          <label className="field"><span className="field-label">意思（{labels[1]}）</span>
            <input value={d.meaningZh} placeholder={mode === 'add' ? '留空自动翻译' : ''} onChange={(e) => set('meaningZh', e.target.value)} /></label>
          <label className="field"><span className="field-label">意思（{labels[2]}）</span>
            <input value={d.meaningEn} placeholder={mode === 'add' ? '留空自动翻译' : ''} onChange={(e) => set('meaningEn', e.target.value)} /></label>
        </div>
      </section>

      <section className="nf-block">
        <div className="nf-head"><b>例句</b><span className="muted small">表达自动标出，点词可以改；第一句是主句</span></div>
        {notice && <p className="nf-notice small">{notice} <button type="button" className="icon" aria-label="知道了" onClick={() => setNotice(null)}>✕</button></p>}
        <ul className="nf-rows">{ex.map(rowView)}</ul>
        {!!prod.length && <ul className="nf-rows">{prod.map(rowView)}</ul>}
        <div className="row">
          <button type="button" className="pill" onClick={() => addRow('ex')}>＋ 例句</button>
          <button type="button" className="pill" title="写一句答案句和一个更简单的换说法，就是一道产出题" onClick={() => { addRow('prod'); if (!has('production')) set('cardTypes', [...d.cardTypes, 'production']); }}>＋ 产出题</button>
        </div>
      </section>

      <section className="nf-block">
        <div className="nf-head"><b>卡片</b></div>
        <div className="nf-types">
          {status.map(([t, text, ok]) => {
            const label = CARD_TYPES.find(([x]) => x === t)![1];
            const on = has(t);
            return (
              <button key={t} type="button" className={`nf-type${on ? ' is-on' : ''}${on && !ok ? ' is-warn' : ''}`} aria-pressed={on} onClick={() => toggleType(t)}>
                <b>{on ? '✓ ' : ''}{label}</b><small>{on ? text : '点一下生成'}</small>
              </button>
            );
          })}
          {group && (
            <div className="nf-type is-on is-fixed"><b>✓ 辨析</b><small>跟着易混组走：和 {groupMates.map((n) => n.lemma).join(' / ') || '（组里其他笔记已删除）'} 比，用上面的例句</small></div>
          )}
        </div>
        <p className="muted small">听力卡是认读卡的听力版：复习页右上的「听力卡」开关决定出不出。</p>
        {leaks.map((w) => <p key={w} className="warn small">⚠ 辨析卡{w}</p>)}
        {contrastExtra}
        <Previews note={draftNote} s={s} labels={labels} mates={groupMates} ok={errs.count === 0} />
      </section>

      <details className="nf-block nf-more" open={mode === 'add' ? s.addShowMore : undefined}>
        <summary>背面补充 <span className="muted small">{[d.etymology, d.cueFamily, d.extra, d.source].filter((x) => x.trim()).length} / 4 已填 · 词源、词族、补充、出处</span></summary>
        <div className="grid2">
          <label className="field"><span className="field-label">词源（认读卡背面必显示）</span><input value={d.etymology} placeholder="例如：poil 毛 → 顺着毛摸 = 顺着某人的意" onChange={(e) => set('etymology', e.target.value)} /></label>
          <label className="field"><span className="field-label">词族线索</span><input value={d.cueFamily} placeholder="例如：repérer 找出、标出" onChange={(e) => set('cueFamily', e.target.value)} /></label>
          <label className="field"><span className="field-label">补充</span><input value={d.extra} placeholder="例如：≠ se tenir à 扶住" onChange={(e) => set('extra', e.target.value)} /></label>
          <label className="field"><span className="field-label">出处</span><input value={d.source} placeholder="例如：InnerFrench · 第 12 集" onChange={(e) => set('source', e.target.value)} /></label>
        </div>
        {group && <label className="field"><span className="field-label">辨析说明（和组里其他词的区别，辨析卡背面显示）</span>
          <input value={d.contrastNote} placeholder="例如：抽象地给…染上色彩（经历、情绪）；colorer 多指字面上色" onChange={(e) => set('contrastNote', e.target.value)} /></label>}
      </details>

      {meta && <details className="nf-block nf-more"><summary>归类 <span className="muted small">层级、来源、主题{mode === 'edit' ? '、牌组、日期' : ''}</span></summary>{meta}</details>}

      {showErrors && errs.all.map((e) => <p key={e} className="form-error">{e}</p>)}
    </div>
  );
}

/** 一行例句的输入框：失焦或回车时提交（自动标出表达） */
function RowInput({ initial, placeholder, onCommit }: { initial: string; placeholder: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return <input className="nf-input" autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => onCommit(v)}
    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} />;
}

const PREVIEW_TYPES: Array<[Card['type'], string]> = [['recognition', '认读'], ['cloze', '挖空'], ['production', '产出'], ['contrast', '辨析']];

/** 分页预览：每种卡一页，正面 / 背面；「下一句」轮换例句或题目 */
function Previews({ note, s, labels, mates, ok }: { note: Note; s: Settings; labels: [string, string, string]; mates: Note[]; ok: boolean }) {
  const types = PREVIEW_TYPES.filter(([t]) => note.cardTypes.includes(t));
  const [tab, setTab] = useState<Card['type'] | null>(null);
  const [variant, setVariant] = useState(0);
  const cur = types.find(([t]) => t === tab)?.[0] ?? types[0]?.[0];
  if (!cur || !ok) return null;
  const v = cardView(cur, note, s, labels, variant, false, [note, ...mates]);
  return (
    <div className="nf-preview">
      <div className="row">
        <span className="muted small">预览</span>
        {types.map(([t, label]) => <button key={t} type="button" className={`pill${t === cur ? ' is-on' : ''}`} onClick={() => { setTab(t); setVariant(0); }}>{label}</button>)}
        <span className="grow" />
        <button type="button" className="pill" title="看下一句例句 / 下一道题（复习时每次轮换）" onClick={() => setVariant((x) => x + 1)}>下一句 ›</button>
      </div>
      <div className="mini">
        <div className="mini-q">{v.question.text || <i className="muted">（空）</i>}</div>
        {v.hint && <div className="cue">提示：{v.hint}</div>}
        <div className="mini-a">{v.answers.map((a, i) => <div key={i}>{a.text || <i className="muted">（翻译中或为空）</i>}</div>)}<Cues note={note} only={v.cues === 'extra' ? 'extra' : undefined} /></div>
      </div>
    </div>
  );
}

const BLANK: Note = {
  id: 'draft', deckId: '', createdAt: '2026-01-01T00:00:00.000Z', lemma: '', sentence: '', meaningZh: '', meaningEn: '',
  cueFamily: null, promptFr: null, intentZh: null, hint: null, clozeHint: null, clozeSentence: null, etymology: null, answerFr: null, extra: null, source: null, origin: null, altSentences: [], altIntents: [], layer: 'mid', cardTypes: ['recognition'],
  tags: [], usedCount: 0, usedAt: [], rot: 0, contrastGroup: null, contrastNote: null, frame: null, legacy: null, updatedAt: '2026-01-01T00:00:00.000Z', deleted: false,
};
