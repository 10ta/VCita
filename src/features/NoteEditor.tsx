import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { THEMES, noteOrigin, type Note, type NoteOrigin, type Theme } from '../schema';
import { defaultCardTypes, hasCloze, noteErrors, promptErrors } from '../schema/validate';
import { bumpUsed, deleteNotes, leaveContrast, updateNote } from '../db/actions';
import { useDeckSettings, useDecks, useNotes } from '../db/hooks';
import { langLabel } from '../ui/langs';
import { noonIso } from '../lib/time';
import { CardPreviews, CARD_TYPES, ClozeMarker, FRAME_TYPES } from './NoteParts';
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
  const allNotes = useNotes();
  const groupMates = note.contrastGroup ? (allNotes ?? []).filter((n) => n.contrastGroup === note.contrastGroup && n.id !== note.id) : [];
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
  const wantProd = f.cardTypes.includes('production');
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
      {isFrame && (
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
      {!isFrame && <>
      {text('sentence', '例句', '用 {{…}} 标出要考的部分，例如：les enfants ont perdu leurs {{repères}}')}
      {f.sentence.trim() && <><ClozeMarker value={f.sentence} onChange={(v) => set('sentence', v)} /><p className="muted small" style={{ marginTop: -6, marginBottom: 10 }}>点词标记 / 取消考查部分（认读卡加粗、挖空卡挖掉）</p></>}
      {text('lemma', `单词（${labels[0]}）`, '旧卡的正面；有例句时可留空')}
      {text('meaningZh', `意思（${labels[1]}）`)}
      {text('meaningEn', `意思（${labels[2]}）`)}
      {text('cueFamily', '词族线索', '例如：repérer 找出、标出')}
      {text('source', '出处', '例如：InnerFrench · 第 12 集')}
      {text('extra', '补充', '例如：≠ se tenir à 扶住')}
      {text('etymology', '词源（可选，认读 / 挖空卡背面显示）', '例如：tentacule 触手 + -aire → 像触手一样四处伸展的')}
      </>}
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
      {f.cardTypes.includes('cloze') && text('clozeHint', '挖空提示（可选，横线处显示，只用于挖空主句）', `写横线处的意思，例如：飞越（复合过去时）；不写答案的词或原形，不只写「介词」这类标签；只挖介词、冠词等小词时留空即可（上下文决定答案）。备用例句各写各的：{{答案::提示}}。留空时正面显示${labels[1]}意思（只挖小词时不显示）`)}
      {note.contrastGroup && (
        <div className="contrast-edit">
          <span className="field-label">易混组：和 {groupMates.map((n) => n.lemma).join(' / ') || '（其他笔记已删除）'} 辨析，每条笔记一张辨析卡</span>
          <label className="field">
            <span className="field-label">辨析说明（这个词和组里其他词的区别，辨析卡背面显示）</span>
            <input value={f.contrastNote} placeholder="例如：抽象地给…染上色彩（经历、情绪）；colorer 多指字面上色" onChange={(e) => set('contrastNote', e.target.value)} />
          </label>
          <button type="button" className="pill" onClick={() => void leaveContrast(note.id).then(() => { toast('已移出易混组，辨析卡已删除（复习记录保留）'); onClose(); })}>移出易混组</button>
        </div>
      )}
      {wantProd && (
        <fieldset className="prod">
          <legend>产出卡</legend>
          {text('promptFr', `${labels[0]}题面（正面，用 {{…}} 高亮一个更简单的说法，不能用答案里的词）`, "例如：Après le déménagement, les enfants {{ne savaient plus où ils en étaient}}.")}
          {f.promptFr.trim() && <ClozeMarker value={f.promptFr} onChange={(v) => set('promptFr', v)} />}
          {text('answerFr', `${labels[0]}答案（背面，可用 {{…}} 高亮目标表达）`, "例如：Après le déménagement, les enfants {{ont perdu leurs repères}}.")}
          {text('hint', '提示（可选；有法语题面时不用填，自动用答案句生成）', '例如：首字母 p… r…')}
          {text('intentZh', `${labels[1]}注释（背面；没有${labels[0]}题面时作为正面）`, '例如：失去方向感、不知所措')}
          <label className="field">
            <span className="field-label">备用产出题（可选，每行：{labels[0]}题面 | {labels[0]}答案 | 提示 | {labels[1]}注释；每次复习轮换场景）</span>
            <textarea className="bulk" rows={3} value={f.altIntents} placeholder="En arrivant en France, je {{ne savais plus du tout où j'en étais}}. | En arrivant en France, j'{{avais perdu mes repères}}. | p… r… | 失去方向感" onChange={(e) => set('altIntents', e.target.value)} />
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
