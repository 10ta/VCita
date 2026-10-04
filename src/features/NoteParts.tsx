// 添加页和编辑弹窗共用：卡型列表、点词标记考查部分、三种卡的预览
import type { Card, Note, Settings } from '../schema';
import { cardView, Cues } from './CardFace';

export const CARD_TYPES: Array<[Card['type'], string, string]> = [
  ['recognition', '认读', '看句子（或单词）想意思'],
  ['production', '产出', '看中文意图写出法语'],
  ['cloze', '挖空', '句子里挖掉考查部分，填出来'],
];

interface Tok { t: string; word: boolean; on: boolean }
const SEP = /(\s+|[.,;:!?…«»"“”()–—]+|(?<=['’]))/;
const isSep = (t: string) => /^(\s+|[.,;:!?…«»"“”()–—]+)$/.test(t);

/** "a {{b c}} d" → 词元列表，记录每个词是否在 {{…}} 里 */
export function toTokens(v: string): Tok[] {
  const out: Tok[] = [];
  let on = false;
  for (const part of v.split(/(\{\{|\}\})/)) {
    if (part === '{{') { on = true; continue; }
    if (part === '}}') { on = false; continue; }
    for (const t of part.split(SEP).filter(Boolean)) out.push({ t, word: !isSep(t), on: on && !isSep(t) });
  }
  return out;
}

/** 词元 → 文本：相邻（中间只隔空格或省音号）的标记词合并成一个 {{…}} */
export function fromTokens(toks: Tok[]): string {
  let s = '';
  let i = 0;
  while (i < toks.length) {
    if (toks[i].word && toks[i].on) {
      let j = i, end = i;
      while (j + 1 < toks.length) {
        const n = toks[j + 1];
        if (n.word && n.on) { j++; end = j; }
        else if (/^\s+$/.test(n.t) && toks[j + 2]?.word && toks[j + 2]?.on) j++;
        else break;
      }
      s += `{{${toks.slice(i, end + 1).map((x) => x.t).join('')}}}`;
      i = end + 1;
    } else { s += toks[i].t; i++; }
  }
  return s;
}

/** 把句子显示成可点的词：点一下标记 / 取消考查部分 */
export function ClozeMarker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const toks = toTokens(value);
  if (!toks.some((t) => t.word)) return null;
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
  const types = CARD_TYPES.filter(([t]) => draft.cardTypes.includes(t));
  if (!types.length) return null;
  return (
    <div className="previews">
      {types.map(([t, label]) => {
        const v = cardView(t, draft, s, 0, labels);
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
