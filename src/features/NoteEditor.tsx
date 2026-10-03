import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { THEMES, type Note, type Theme } from '../schema';
import { updateNote } from '../db/actions';
import { useDecks, useSettings } from '../db/hooks';
import { langLabel } from '../ui/langs';
import { noonIso } from '../lib/time';
import { renderSentence } from './CardFace';
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

export function NoteEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  const s = useSettings();
  const decks = useDecks();
  const [f, setF] = useState({
    lemma: note.lemma, sentence: note.sentence, meaningZh: note.meaningZh, meaningEn: note.meaningEn,
    cueFamily: note.cueFamily ?? '', source: note.source ?? '', extra: note.extra ?? '',
    tags: note.tags, deckId: note.deckId, day: note.createdAt.slice(0, 10),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const sentenceBad = f.sentence.trim() !== '' && !/\{\{.+?\}\}/.test(f.sentence);
  const save = async () => {
    if (sentenceBad) return;
    const nul = (x: string) => (x.trim() ? x.trim() : null);
    await updateNote(note.id, {
      lemma: f.lemma.trim(), sentence: f.sentence.trim(), meaningZh: f.meaningZh.trim(), meaningEn: f.meaningEn.trim(),
      cueFamily: nul(f.cueFamily), source: nul(f.source), extra: nul(f.extra), tags: f.tags, deckId: f.deckId,
      ...(f.day !== note.createdAt.slice(0, 10) ? { createdAt: noonIso(f.day) } : {}),
    });
    toast('已保存');
    onClose();
  };
  const text = (k: 'lemma' | 'sentence' | 'meaningZh' | 'meaningEn' | 'cueFamily' | 'source' | 'extra', label: string, ph = '') => (
    <label className="field">
      <span className="field-label">{label}</span>
      <input value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); }} />
    </label>
  );
  return (
    <Modal title="编辑笔记" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>取消</button><button type="button" className="btn is-primary" disabled={sentenceBad} onClick={() => void save()}>保存</button></>}>
      {text('lemma', `单词（${langLabel(s?.sourceLang ?? 'fr')}）`)}
      {text('sentence', '例句', '用 {{…}} 标出要考的部分，例如：les enfants ont perdu leurs {{repères}}')}
      {sentenceBad && <p className="form-error">例句里要用 {'{{…}}'} 标出考查的部分</p>}
      {f.sentence.trim() && !sentenceBad && <p className="preview">预览：{renderSentence(f.sentence)}</p>}
      {text('meaningZh', `意思（${langLabel(s?.targetLang1 ?? 'zh-CN')}）`)}
      {text('meaningEn', `意思（${langLabel(s?.targetLang2 ?? 'en')}）`)}
      {text('cueFamily', '词族线索', '例如：repérer 找出、标出')}
      {text('source', '出处', '例如：InnerFrench · 第 12 集')}
      {text('extra', '补充', '例如：≠ se tenir à 扶住')}
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
