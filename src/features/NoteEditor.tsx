import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { THEMES, noteOrigin, type Note, type NoteOrigin, type Theme } from '../schema';
import { defaultCardTypes, hasCloze, noteErrors, promptErrors } from '../schema/validate';
import { bumpUsed, deleteNotes, leaveContrast, updateNote } from '../db/actions';
import { useDeckSettings, useDecks, useNotes } from '../db/hooks';
import { langLabel } from '../ui/langs';
import { noonIso } from '../lib/time';
import { CardPreviews, CARD_TYPES, FRAME_TYPES } from './NoteParts';
import { NoteForm, formErrors } from './noteform/NoteForm';
import { fromNote, otherFields, rowFields, type Draft } from './noteform/model';
import { LENSES } from '../lib/frames';
import { toast } from '../ui/toast';

export function ThemePicker({ value, onChange }: { value: Theme[]; onChange: (v: Theme[]) => void }) {
  return (
    <div className="chips">
      {THEMES.map((t) => (
        <button key={t} type="button" className={`chip${value.includes(t) ? ' is-on' : ''}`} aria-pressed={value.includes(t)}
          onClick={() => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])}>{t}</button>
      ))}
    </div>
  );
}

/** 来源类型：挖矿卡 = 从自己的输入（视频、阅读、对话、写作）里摘的；词表卡 = 批量导入的词表 */
export const ORIGINS: [NoteOrigin, string, string][] = [
  ['mined', '挖矿', '从自己的输入里摘的（视频、阅读、对话、写作）：语境越新越好记，新卡额度按来源拆分时最新的先出'],
  ['list', '词表', '批量导入的词表（B1 / B2 等）：哪天学都一样，按核心 → 中频慢慢消化'],
];

export function OriginPicker({ value, onChange }: { value: NoteOrigin; onChange: (v: NoteOrigin) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label="来源">
      {ORIGINS.map(([o, label, tip]) => (
        <button key={o} type="button" role="radio" title={tip} className={`chip${value === o ? ' is-on' : ''}`} aria-checked={value === o} onClick={() => onChange(o)}>{label}</button>
      ))}
    </div>
  );
}


/** 备用产出题的一行：有法语题面时 "法语题面 | 法语答案 | 提示 | 中文"；旧题 "中文意图 | 法语答案 | 提示" */
export function altIntentLine(x: Note['altIntents'][number]): string {
  const cols = x.promptFr?.trim() ? [x.promptFr, x.answerFr, x.hint ?? '', x.intentZh ?? ''] : [x.intentZh ?? '', x.answerFr, x.hint ?? ''];
  return cols.join(' | ').replace(/( \| )+$/, '');
}
/** 第一栏带 {{…}} 的是新格式（法语题面），否则按旧格式（中文意图）读 */
export function parseAltIntent(line: string): Note['altIntents'][number] {
  const [a = '', answerFr = '', hint = '', zh = ''] = line.split('|').map((x) => x.trim());
  return hasCloze(a) ? { promptFr: a, intentZh: zh, answerFr, hint: hint || null } : { promptFr: null, intentZh: a, answerFr, hint: hint || null };
}

export function NoteEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  return note.frame ? <FrameEditor note={note} onClose={onClose} /> : <WordEditor note={note} onClose={onClose} />;
}

/** 单词 / 表达笔记的编辑：一个表达、一张例句表（见 noteform/NoteForm） */
function WordEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  const s = useDeckSettings(note.deckId);
  const decks = useDecks();
  const allNotes = useNotes();
  const [d, setDraft] = useState<Draft>(() => fromNote(note, noteOrigin(note)));
  const setD = (fn: (d: Draft) => Draft) => setDraft(fn);
  const [confirmDel, setConfirmDel] = useState(false);
  const [tried, setTried] = useState(false);
  const groupMates = note.contrastGroup ? (allNotes ?? []).filter((n) => n.contrastGroup === note.contrastGroup && n.id !== note.id) : [];
  if (!s) return null;
  const labels: [string, string, string] = [langLabel(s.sourceLang), langLabel(s.targetLang1), langLabel(s.targetLang2)];
  const errs = formErrors(d, note.contrastGroup);
  const save = async () => {
    setTried(true);
    if (errs.count) return;
    await updateNote(note.id, {
      ...otherFields(d), ...rowFields(d),
      // 辨析卡跟着易混组走，不在这里勾选：保留
      cardTypes: [...CARD_TYPES.map(([t]) => t).filter((t) => d.cardTypes.includes(t)), ...(note.contrastGroup ? ['contrast' as const] : [])],
      deckId: d.deckId,
      // 没标过、也没改的保持"按出处推断"
      origin: note.origin == null && d.origin === noteOrigin(note) ? null : d.origin,
      ...(d.day !== note.createdAt.slice(0, 10) ? { createdAt: noonIso(d.day) } : {}),
    });
    toast('已保存');
    onClose();
  };
  const remove = async () => {
    if (!confirmDel) return setConfirmDel(true);
    await deleteNotes([note.id]);
    toast('已删除这条笔记');
    onClose();
  };
  const meta = (
    <>
      <div className="row">
        <label className="field"><span className="field-label">层级</span>
          <select value={d.layer} onChange={(e) => { const layer = e.target.value as Note['layer']; setD((x) => ({ ...x, layer })); }}>
            <option value="mid">中频（认得就行）</option>
            <option value="core">核心（要用出来）</option>
          </select>
        </label>
        <div className="field"><span className="field-label">来源</span><OriginPicker value={d.origin} onChange={(v) => setD((x) => ({ ...x, origin: v }))} /></div>
      </div>
      <div className="field"><span className="field-label">主题</span><ThemePicker value={d.tags} onChange={(v) => setD((x) => ({ ...x, tags: v }))} /></div>
      <div className="row">
        <label className="field"><span className="field-label">牌组</span>
          <select value={d.deckId} onChange={(e) => setD((x) => ({ ...x, deckId: e.target.value }))}>{decks?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </label>
        <label className="field"><span className="field-label">创建日期</span>
          <input type="date" value={d.day} onChange={(e) => e.target.value && setD((x) => ({ ...x, day: e.target.value }))} />
        </label>
      </div>
      {d.cardTypes.includes('production') && (
        <div className="row">
          <span className="muted small">写作、口语里用上 {note.usedCount} 次</span>
          <button type="button" className="pill" onClick={() => void bumpUsed(note.id).then(() => toast('已记录'))}>用上了 +1</button>
        </div>
      )}
    </>
  );
  const contrastExtra = note.contrastGroup ? (
    <button type="button" className="pill" onClick={() => void leaveContrast(note.id).then(() => { toast('已移出易混组，辨析卡已删除（复习记录保留）'); onClose(); })}>移出易混组</button>
  ) : null;
  return (
    <Modal title="编辑笔记" onClose={onClose}
      footer={<>
        <button type="button" className={`btn footer-left${confirmDel ? ' is-danger' : ' is-danger-ghost'}`} title="删除这条笔记和它的所有卡片" onClick={() => void remove()} onBlur={() => setConfirmDel(false)}>{confirmDel ? '再点一次确认删除' : '删除'}</button>
        {tried && errs.count > 0 && <span className="red small">还有 {errs.count} 处要改</span>}
        <button type="button" className="btn" onClick={onClose}>取消</button>
        <button type="button" className="btn is-primary" onClick={() => void save()}>保存</button>
      </>}>
      <NoteForm d={d} setD={setD} s={s} labels={labels} mode="edit" note={note} groupMates={groupMates} onSubmit={() => void save()} meta={meta} contrastExtra={contrastExtra} showErrors={tried} />
    </Modal>
  );
}

/** 句框笔记的编辑（句框、功能、例句、任务 / 槽位 / 透镜） */
function FrameEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  const s = useDeckSettings(note.deckId);
  const decks = useDecks();
  const [f, setF] = useState({
    lemma: note.lemma, sentence: note.sentence, meaningZh: note.meaningZh, meaningEn: note.meaningEn,
    cueFamily: note.cueFamily ?? '', source: note.source ?? '', extra: note.extra ?? '',
    promptFr: note.promptFr ?? '', intentZh: note.intentZh ?? '', hint: note.hint ?? '', clozeHint: note.clozeHint ?? '', clozeSentence: note.clozeSentence ?? '', etymology: note.etymology ?? '', answerFr: note.answerFr ?? '',
    layer: note.layer, origin: noteOrigin(note), cardTypes: note.cardTypes, tags: note.tags, deckId: note.deckId, day: note.createdAt.slice(0, 10),
    alts: (note.altSentences ?? []).join('\n'),
    altIntents: (note.altIntents ?? []).map(altIntentLine).join('\n'),
    contrastNote: note.contrastNote ?? '',
    fTask: note.frame?.task ?? '', fSlot: note.frame?.slot ?? '', fLens: note.frame?.lens ?? '', fRegister: note.frame?.register ?? '',
  });
  const isFrame = !!note.frame;
  const TYPES = isFrame ? FRAME_TYPES : CARD_TYPES;
  const [confirmDel, setConfirmDel] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const altSentences = f.alts.split('\n').map((x) => x.trim()).filter(Boolean);
  const altIntents = f.altIntents.split('\n').map((x) => x.trim()).filter(Boolean).map(parseAltIntent);
  const errors = [
    ...noteErrors({ ...f, altSentences, frame: isFrame ? { task: f.fTask, slot: null, lens: null, register: null } : null }),
    ...(altSentences.some((x) => !hasCloze(x)) ? ['备用例句每句都要用 {{…}} 标出考查部分'] : []),
    ...(f.cardTypes.includes('production') ? altIntents.flatMap((x, i) => promptErrors(x.promptFr, x.intentZh, x.answerFr, f.lemma).map((e) => `备用产出题第 ${i + 1} 行：${e}`)) : []),
  ];
  const save = async () => {
    if (errors.length) return;
    const nul = (x: string) => (x.trim() ? x.trim() : null);
    await updateNote(note.id, {
      lemma: f.lemma.trim(), sentence: f.sentence.trim(), meaningZh: f.meaningZh.trim(), meaningEn: f.meaningEn.trim(),
      cueFamily: nul(f.cueFamily), source: nul(f.source), extra: nul(f.extra),
      promptFr: nul(f.promptFr), intentZh: nul(f.intentZh), hint: nul(f.hint), clozeHint: nul(f.clozeHint), clozeSentence: nul(f.clozeSentence), etymology: nul(f.etymology), answerFr: nul(f.answerFr),
      // 辨析卡跟着易混组走，不在这里勾选：保留
      layer: f.layer, cardTypes: [...TYPES.map(([t]) => t).filter((t) => f.cardTypes.includes(t)), ...(note.contrastGroup ? ['contrast' as const] : [])],
      contrastNote: nul(f.contrastNote),
      ...(isFrame ? { frame: { ...note.frame, task: f.fTask.trim() || 'T3', slot: nul(f.fSlot), lens: nul(f.fLens), register: nul(f.fRegister) } } : {}),
      tags: f.tags, deckId: f.deckId, altSentences, altIntents,
      // 没标过、也没改的保持"按出处推断"
      origin: note.origin == null && f.origin === noteOrigin(note) ? null : f.origin,
      ...(f.day !== note.createdAt.slice(0, 10) ? { createdAt: noonIso(f.day) } : {}),
    });
    toast('已保存');
    onClose();
  };
  const remove = async () => {
    if (!confirmDel) return setConfirmDel(true);
    await deleteNotes([note.id]);
    toast('已删除这条笔记');
    onClose();
  };
  type TextKey = 'lemma' | 'sentence' | 'meaningZh' | 'meaningEn' | 'cueFamily' | 'source' | 'extra' | 'promptFr' | 'intentZh' | 'hint' | 'clozeHint' | 'clozeSentence' | 'etymology' | 'answerFr';
  const text = (k: TextKey, label: string, ph = '') => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); }} />
    </label>
  );
  // 预览用编辑中的内容
  const draft: Note = { ...note, ...f, altSentences, altIntents, cueFamily: f.cueFamily || null, source: f.source || null, extra: f.extra || null, promptFr: f.promptFr || null, intentZh: f.intentZh || null, hint: f.hint || null, clozeHint: f.clozeHint || null, clozeSentence: f.clozeSentence || null, etymology: f.etymology || null, answerFr: f.answerFr || null };
  const labels: [string, string, string] = s ? [langLabel(s.sourceLang), langLabel(s.targetLang1), langLabel(s.targetLang2)] : ['', '', ''];
  return (
    <Modal title="编辑笔记" onClose={onClose}
      footer={<><button type="button" className={`btn footer-left${confirmDel ? ' is-danger' : ' is-danger-ghost'}`} title="删除这条笔记和它的所有卡片" onClick={() => void remove()} onBlur={() => setConfirmDel(false)}>{confirmDel ? '再点一次确认删除' : '删除'}</button><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn is-primary" disabled={errors.length > 0} onClick={() => void save()}>保存</button></>}>
      <div className="row">
        <label className="field"><span className="field-label">层级</span>
          <select value={f.layer} onChange={(e) => { const layer = e.target.value as Note['layer']; setF((x) => ({ ...x, layer, cardTypes: defaultCardTypes(layer) })); }}>
            <option value="mid">中频（认得就行）</option>
            <option value="core">核心（要用出来）</option>
          </select>
        </label>
        <div className="field"><span className="field-label">来源</span><OriginPicker value={f.origin} onChange={(v) => set('origin', v)} /></div>
        <div className="field"><span className="field-label">生成哪些卡</span>
          <div className="chips">
            {TYPES.map(([t, label, tip]) => (
              <button key={t} type="button" title={tip} className={`chip${f.cardTypes.includes(t) ? ' is-on' : ''}`} aria-pressed={f.cardTypes.includes(t)}
                onClick={() => set('cardTypes', f.cardTypes.includes(t) ? f.cardTypes.filter((x) => x !== t) : [...f.cardTypes, t])}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      {(
        <>
          {text('lemma', '句框（⬚ = 要填的位置）', "例如：Interdire ⬚ ne ferait que déplacer le problème.")}
          {text('meaningZh', '功能（正面，写论证功能，不写中文句子）', '例如：反事实：禁止只会把问题挪到别处')}
          {text('sentence', '例句（填好的整句）', "例如：Interdire les téléphones au collège ne ferait que déplacer le problème.")}
          {text('extra', '语法锁 / 补充', '例如：条件式 ferait；ne faire que + 不定式')}
          <div className="row">
            <label className="field"><span className="field-label">任务</span><input value={f.fTask} placeholder="T3 / T1 / T2 / 口语" onChange={(e) => set('fTask', e.target.value)} /></label>
            <label className="field"><span className="field-label">槽位</span><input value={f.fSlot} placeholder="⑤ / T1-04" onChange={(e) => set('fSlot', e.target.value)} /></label>
            <label className="field"><span className="field-label">透镜</span>
              <select value={f.fLens} onChange={(e) => set('fLens', e.target.value)}>
                <option value="">（无）</option>
                {Object.entries(LENSES).map(([k, v]) => <option key={k} value={k}>{k} {v}</option>)}
              </select>
            </label>
            <label className="field"><span className="field-label">语域</span><input value={f.fRegister} placeholder="保 / 高 / 口语" onChange={(e) => set('fRegister', e.target.value)} /></label>
          </div>
          {text('source', '出处', '例如：LENTILLES · ① 反事实')}
        </>
      )}
      {errors.map((e) => <p key={e} className="form-error">{e}</p>)}
      {s && errors.length === 0 && <CardPreviews draft={draft} s={s} labels={labels} />}
      <div className="field"><span className="field-label">主题</span><ThemePicker value={f.tags} onChange={(v) => set('tags', v)} /></div>
      <div className="row">
        <label className="field"><span className="field-label">牌组</span>
          <select value={f.deckId} onChange={(e) => set('deckId', e.target.value)}>{decks?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </label>
        <label className="field"><span className="field-label">创建日期</span>
          <input type="date" value={f.day} onChange={(e) => e.target.value && set('day', e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
