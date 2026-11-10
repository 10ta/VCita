// 添加页和编辑弹窗共用：卡型列表、点词标记考查部分、三种卡的预览
import type { Card, Note, Settings } from '../schema';
import { cardView, Cues } from './CardFace';
import { fromTokens, toTokens } from '../lib/markTarget';

export const CARD_TYPES: Array<[Card['type'], string, string]> = [
  ['recognition', '认读', '看句子（或单词）想意思'],
  ['production', '产出', '看法语题面里高亮的简单说法，换成目标表达'],
  ['cloze', '挖空', '句子里挖掉考查部分，填出来'],
];
/** 句框笔记的卡型 */
export const FRAME_TYPES: Array<[Card['type'], string, string]> = [
  ['frame', '句框', '看功能，写出句框'],
  ['apply', '套用', '功能 + 一个随机主题，用句框写一整句，自评'],
];

export { toTokens, fromTokens } from '../lib/markTarget';

/** 把句子显示成可点的词：点一下标记 / 取消考查部分 */
/** readOnly：只显示高亮，不能点（产出题正面的预览） */
export function ClozeMarker({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly?: boolean }) {
  const toks = toTokens(value);
  if (!toks.some((t) => t.word)) return null;
  if (readOnly) return <div className="marker is-readonly">{toks.map((k, i) => <span key={i} className={k.on ? 'tok is-on' : undefined}>{k.t}</span>)}</div>;
  return (
    <div className="marker" aria-label="点词标记考查部分">
      {toks.map((k, i) => k.word
        ? <button key={i} type="button" className={`tok${k.on ? ' is-on' : ''}`}
            onClick={() => onChange(fromTokens(toks.map((x, j) => (j === i ? { ...x, on: !x.on } : x))))}>{k.t}</button>
        : <span key={i}>{k.t}</span>)}
    </div>
  );
}

/** 选中卡型的正反面预览 */
export function CardPreviews({ draft, s, labels }: { draft: Note; s: Settings; labels: [string, string, string] }) {
  const types = [...CARD_TYPES, ...FRAME_TYPES].filter(([t]) => draft.cardTypes.includes(t));
  if (!types.length) return null;
  return (
    <div className="previews">
      {types.map(([t, label]) => {
        const v = cardView(t, draft, s, labels);
        return (
          <div key={t} className="mini">
            <span className={`badge is-type t-${t}`}>{label}</span>
            <div className="mini-q">{v.question.text || <i className="muted">（空）</i>}</div>
            {v.hint && <div className="cue">提示：{v.hint}</div>}
            <div className="mini-a">{v.answers.map((a, i) => <div key={i}>{a.text || <i className="muted">（翻译中或为空）</i>}</div>)}<Cues note={draft} only={v.cues === 'extra' ? 'extra' : undefined} /></div>
          </div>
        );
      })}
    </div>
  );
}
