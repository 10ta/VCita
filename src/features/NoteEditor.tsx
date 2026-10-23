import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { THEMES, type Note, type Theme } from '../schema';
import { defaultCardTypes, hasCloze, noteErrors } from '../schema/validate';
import { bumpUsed, updateNote } from '../db/actions';
import { useDecks, useSettings } from '../db/hooks';
import { langLabel } from '../ui/langs';
import { noonIso } from '../lib/time';
import { CardPreviews, CARD_TYPES, ClozeMarker } from './NoteParts';
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

const TYPES = CARD_TYPES;

export function NoteEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  const s = useSettings();
  const decks = useDecks();
  const [f, setF] = useState({
    lemma: note.lemma, sentence: note.sentence, meaningZh: note.meaningZh, meaningEn: note.meaningEn,
    cueFamily: note.cueFamily ?? '', source: note.source ?? '', extra: note.extra ?? '',
    intentZh: note.intentZh ?? '', hint: note.hint ?? '', clozeHint: note.clozeHint ?? '', clozeSentence: note.clozeSentence ?? '', etymology: note.etymology ?? '', answerFr: note.answerFr ?? '',
    layer: note.layer, cardTypes: note.cardTypes, tags: note.tags, deckId: note.deckId, day: note.createdAt.slice(0, 10),
    alts: (note.altSentences ?? []).join('\n'),
    altIntents: (note.altIntents ?? []).map((x) => [x.intentZh, x.answerFr, x.hint ?? ''].join(' | ').replace(/ \| $/, '')).join('\n'),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const altSentences = f.alts.split('\n').map((x) => x.trim()).filter(Boolean);
  const altIntents = f.altIntents.split('\n').map((x) => x.trim()).filter(Boolean).map((line) => {
    const [intentZh = '', answerFr = '', hint = ''] = line.split('|').map((x) => x.trim());
    return { intentZh, answerFr, hint: hint || null };
  });
  const errors = [
    ...noteErrors(f),
    ...(altSentences.some((x) => !hasCloze(x)) ? ['备用例句每句都要用 {{…}} 标出考查部分'] : []),
    ...(altIntents.some((x) => !x.intentZh || !x.answerFr) ? ['备用产出题每行写成：中文意图 | 法语答案 | 提示（可选）'] : []),
  ];
  const save = async () => {
    if (errors.length) return;
    const nul = (x: string) => (x.trim() ? x.trim() : null);
    await updateNote(note.id, {
      lemma: f.lemma.trim(), sentence: f.sentence.trim(), meaningZh: f.meaningZh.trim(), meaningEn: f.meaningEn.trim(),
      cueFamily: nul(f.cueFamily), source: nul(f.source), extra: nul(f.extra),
      intentZh: nul(f.intentZh), hint: nul(f.hint), clozeHint: nul(f.clozeHint), clozeSentence: nul(f.clozeSentence), etymology: nul(f.etymology), answerFr: nul(f.answerFr),
      layer: f.layer, cardTypes: TYPES.map(([t]) => t).filter((t) => f.cardTypes.includes(t)),
      tags: f.tags, deckId: f.deckId, altSentences, altIntents,
      ...(f.day !== note.createdAt.slice(0, 10) ? { createdAt: noonIso(f.day) } : {}),
    });
    toast('已保存');
    onClose();
  };
  type TextKey = 'lemma' | 'sentence' | 'meaningZh' | 'meaningEn' | 'cueFamily' | 'source' | 'extra' | 'intentZh' | 'hint' | 'clozeHint' | 'clozeSentence' | 'etymology' | 'answerFr';
  const text = (k: TextKey, label: string, ph = '') => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); }} />
    </label>
  );
  // 预览用编辑中的内容
  const draft: Note = { ...note, ...f, altSentences, altIntents, cueFamily: f.cueFamily || null, source: f.source || null, extra: f.extra || null, intentZh: f.intentZh || null, hint: f.hint || null, clozeHint: f.clozeHint || null, clozeSentence: f.clozeSentence || null, etymology: f.etymology || null, answerFr: f.answerFr || null };
  const labels: [string, string, string] = s ? [langLabel(s.sourceLang), langLabel(s.targetLang1), langLabel(s.targetLang2)] : ['', '', ''];
  const wantProd = f.cardTypes.includes('production');
  return (
    <Modal title="编辑笔记" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn is-primary" disabled={errors.length > 0} onClick={() => void save()}>保存</button></>}>
      <div className="row">
        <label className="field"><span className="field-label">层级</span>
          <select value={f.layer} onChange={(e) => { const layer = e.target.value as Note['layer']; setF((x) => ({ ...x, layer, cardTypes: defaultCardTypes(layer) })); }}>
            <option value="mid">中频（认得就行）</option>
            <option value="core">核心（要用出来）</option>
          </select>
        </label>
        <div className="field"><span className="field-label">生成哪些卡</span>
          <div className="chips">
            {TYPES.map(([t, label, tip]) => (
              <button key={t} type="button" title={tip} className={`chip${f.cardTypes.includes(t) ? ' is-on' : ''}`} aria-pressed={f.cardTypes.includes(t)}
                onClick={() => set('cardTypes', f.cardTypes.includes(t) ? f.cardTypes.filter((x) => x !== t) : [...f.cardTypes, t])}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      {text('sentence', '例句', '用 {{…}} 标出要考的部分，例如：les enfants ont perdu leurs {{repères}}')}
      {f.sentence.trim() && <><ClozeMarker value={f.sentence} onChange={(v) => set('sentence', v)} /><p className="muted small" style={{ marginTop: -6, marginBottom: 10 }}>点词标记 / 取消考查部分（认读卡加粗、挖空卡挖掉）</p></>}
      {text('lemma', `单词（${labels[0]}）`, '旧卡的正面；有例句时可留空')}
      {text('meaningZh', `意思（${labels[1]}）`)}
      {text('meaningEn', `意思（${labels[2]}）`)}
      {text('cueFamily', '词族线索', '例如：repérer 找出、标出')}
      {text('source', '出处', '例如：InnerFrench · 第 12 集')}
      {text('extra', '补充', '例如：≠ se tenir à 扶住')}
      {text('etymology', '词源（可选，认读 / 挖空卡背面显示）', '例如：tentacule 触手 + -aire → 像触手一样四处伸展的')}
      {f.cardTypes.includes('cloze') && <>
        {text('clozeSentence', '挖空例句（可选，和上面的例句不同更好记）', '同样用 {{…}} 标出挖掉的部分；不填就用上面的例句')}
        {f.clozeSentence.trim() && <ClozeMarker value={f.clozeSentence} onChange={(v) => set('clozeSentence', v)} />}
      </>}
      {(f.cardTypes.includes('recognition') || f.cardTypes.includes('cloze')) && (
        <label className="field">
          <span className="field-label">备用例句（可选，每行一句，用 {'{{…}}'} 标出；认读 / 挖空卡每次复习轮换）</span>
          <textarea className="bulk" rows={3} value={f.alts} placeholder="Elle a fini par {{trouver preneur}} pour son vieux vélo." onChange={(e) => set('alts', e.target.value)} />
        </label>
      )}
      {f.cardTypes.includes('cloze') && text('clozeHint', '挖空提示（可选，横线处显示）', `例如：飞越。留空时正面显示${labels[1]}意思`)}
      {wantProd && (
        <fieldset className="prod">
          <legend>产出卡</legend>
          {text('intentZh', '中文意图（正面）', '例如：搬家后孩子们失去了熟悉的依靠')}
          {text('hint', '提示（可选）', '例如：首字母 p… r…')}
          {text('answerFr', `${labels[0]}答案（背面）`, '例如：perdre ses repères')}
          <label className="field">
            <span className="field-label">备用产出题（可选，每行：中文意图 | {labels[0]}答案 | 提示；每次复习轮换场景）</span>
            <textarea className="bulk" rows={3} value={f.altIntents} placeholder="讲搬家：'刚到法国时我完全失去了方向' | En arrivant en France, j'avais perdu mes repères." onChange={(e) => set('altIntents', e.target.value)} />
          </label>
          <div className="row">
            <span className="muted small">写作、口语里用上 {note.usedCount} 次</span>
            <button type="button" className="pill" onClick={() => void bumpUsed(note.id).then(() => toast('已记录'))}>用上了 +1</button>
          </div>
        </fieldset>
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
