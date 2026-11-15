// 错题挖点：做完一组 TCF 题，把错题（和蒙对的）一条条记下：题干、原文答案句、正确选项、我的错选、我为什么选它、绊脚点。
// 一键复制成固定格式交给 Claude，按 vcita-cards 做成错题卡（origin = error）：改写对卡、义项卡或挖空卡，每道只抽一个点。
// 只存在这台设备的浏览器里（不同步），复制完可以清空。
import { useEffect, useState } from 'react';
import { toast } from '../../ui/toast';

export interface ErrDraft { id: string; source: string; question: string; sentence: string; answer: string; wrong: string; why: string; trip: string }

const KEY = 'vcita.errDrafts';
const blank = (source = ''): ErrDraft => ({ id: Math.random().toString(36).slice(2, 10), source, question: '', sentence: '', answer: '', wrong: '', why: '', trip: '' });

function load(): ErrDraft[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function save(list: ErrDraft[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 隐私模式等存不了：只留在内存里 */ }
}

/** 一条错题能不能交给 Claude：至少要有原文句、正确选项和我的错选 */
export const errReady = (e: ErrDraft) => !!(e.sentence.trim() && e.answer.trim() && e.wrong.trim());

/** 复制给 Claude 的格式：每道题一段，以 ERR 开头 */
export function errBlock(e: ErrDraft, i: number): string {
  const rows: Array<[string, string]> = [['出处', e.source], ['题干', e.question], ['原文', e.sentence], ['正确', e.answer], ['我选', e.wrong], ['为什么', e.why], ['绊脚点', e.trip]];
  return [`ERR ${i + 1}`, ...rows.filter(([, v]) => v.trim()).map(([k, v]) => `${k}：${v.trim().replace(/\s*\n\s*/g, ' ')}`)].join('\n');
}

const FIELDS: Array<[keyof Omit<ErrDraft, 'id'>, string, string, boolean?]> = [
  ['question', '题干', 'Quel constat est dressé à propos de ce syndrome ?'],
  ['sentence', '原文答案句（定位到的那一句）', "c'est le mal du siècle et pourtant, il n'est pas encore reconnu."],
  ['answer', '正确选项', 'Son existence doit être officialisée.'],
  ['wrong', '我的错选', 'Son traitement est peu efficace'],
  ['why', '我为什么选它（当时的推理）', '定位到 pas encore reconnu，以为是"还没被治好"……', true],
  ['trip', '绊脚点（可选：哪个词或结构读错了）', 'reconnu'],
];

export function MineErrors() {
  const [list, setList] = useState<ErrDraft[]>(load);
  const [cur, setCur] = useState<ErrDraft>(() => blank(list[list.length - 1]?.source ?? ''));
  useEffect(() => save(list), [list]);
  const set = (k: keyof ErrDraft, v: string) => setCur((x) => ({ ...x, [k]: v }));
  const ready = list.filter(errReady);

  const add = () => {
    if (!errReady(cur)) return toast('至少填原文答案句、正确选项和我的错选', true);
    setList((l) => [...l, cur]);
    setCur(blank(cur.source));
    toast(`已记下第 ${list.length + 1} 道`);
  };
  const copy = async () => {
    const text = ready.map(errBlock).join('\n\n');
    try { await navigator.clipboard.writeText(text); toast(`已复制 ${ready.length} 道错题，发给 Claude 做错题卡`); }
    catch { window.prompt('复制下面的内容', text); }
  };
  const remove = (id: string) => setList((l) => l.filter((x) => x.id !== id));
  const edit = (e: ErrDraft) => { setCur(e); remove(e.id); };

  return (
    <div className="mine-errors">
      <p className="muted small">做完一组题，错的和蒙对的各记一条。只要写清当时为什么选它，Claude 会判断陷阱类型和根因，每道抽一个点做成错题卡（新卡最先出）。记录只存在这台设备上。</p>
      <label className="field"><span className="field-label">出处（接下来几道都沿用）</span>
        <input value={cur.source} placeholder="例如：TCF CE 题库 · 第 12 套" onChange={(e) => set('source', e.target.value)} />
      </label>
      {FIELDS.map(([k, label, ph, area]) => (
        <label key={k} className="field"><span className="field-label">{label}</span>
          {area
            ? <textarea rows={2} value={cur[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
            : <input value={cur[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} />}
        </label>
      ))}
      <div className="toolbar">
        <button type="button" className="btn" onClick={add}>记下这道</button>
        <span className="grow" />
        <button type="button" className="btn" disabled={!list.length} onClick={() => { setList([]); toast('已清空'); }}>清空</button>
        <button type="button" className="btn is-primary" disabled={!ready.length} onClick={() => void copy()} title="复制成 ERR 格式，一道一段">复制给 Claude 做卡（{ready.length}）</button>
      </div>
      {list.length > 0 && (
        <ul className="mine-list">
          {list.map((e, i) => (
            <li key={e.id}>
              <span className="mine-pick"><b>{i + 1}.</b> <span lang="fr">{e.wrong}</span> <span className="muted">→</span> <span lang="fr">{e.answer}</span></span>
              <span className="mine-sent muted small">{e.sentence}</span>
              <span className="row-btns">
                <button type="button" className="pill" onClick={() => edit(e)}>改</button>
                <button type="button" className="pill" onClick={() => remove(e.id)}>删</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
