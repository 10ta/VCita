// 短文挖词：粘贴一段法语，按自己的词汇标色（阅读页那套逻辑），列出生词和它所在的句子，
// 一键复制成「词(原句」的格式交给 Claude 做卡，或放进摘句篮。点词 / 选中照常弹查词气泡。
import { useMemo, useRef, useState } from 'react';
import { useDeckSettings, useTexts } from '../../db/hooks';
import { isFrench, langLabel } from '../../ui/langs';
import { addClip, setKnown } from '../../db/actions';
import { useFrDict } from '../../lib/gender/dict';
import { annotate, coverage, coverageAdvice, importFile, useReadingIndex, wordCount, type Tok } from '../../lib/reading';
import { usePrefs, setPrefs } from '../../ui/prefs';
import { toast } from '../../ui/toast';

const STATUS_LABEL: Record<NonNullable<Tok['status']>, string> = { known: '认识', learning: '学习中', new: '有卡未学', unknown: '生词' };

/** 切成句子（保留句末标点），换行也算断句 */
export function splitSentences(text: string): string[] {
  return text.replace(/\r/g, '').split(/\n+/).flatMap((p) => p.match(/[^.!?…]+[.!?…]*(?:[\s\u00a0]*[»”"')])*\s*/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

export interface Unknown { key: string; form: string; sentence: string; count: number }
/** 文中的生词（按原形去重）：第一次出现的词形、所在句子、出现次数；按出现顺序 */
export function unknownWords(sentences: Array<{ text: string; toks: Tok[] }>): Unknown[] {
  const m = new Map<string, Unknown>();
  for (const s of sentences) for (const t of s.toks) {
    if (t.status !== 'unknown' || !t.key) continue;
    const u = m.get(t.key);
    if (u) u.count++;
    else m.set(t.key, { key: t.key, form: t.text, sentence: s.text, count: 1 });
  }
  return [...m.values()];
}
export const mineLine = (u: Pick<Unknown, 'form' | 'sentence'>) => `${u.form}(${u.sentence}`;

export function MineText({ deckId }: { deckId: string }) {
  const ds = useDeckSettings(deckId);
  if (ds && !isFrench(ds.sourceLang)) {
    return <p className="muted">短文挖词靠法语词典（词频、原形）判断生词，当前牌组的学习语言是{langLabel(ds.sourceLang)}，暂时不支持。</p>;
  }
  return <MineFr />;
}

function MineFr() {
  const prefs = usePrefs();
  const dict = useFrDict(true);
  const index = useReadingIndex(true);
  const texts = useTexts();
  const [body, setBody] = useState('');
  const [source, setSource] = useState('');
  const [off, setOff] = useState<Set<string>>(new Set()); // 取消勾选的生词
  const file = useRef<HTMLInputElement>(null);

  const sentences = useMemo(() => splitSentences(body).map((text) => ({ text, toks: annotate(text, index, dict) })), [body, index, dict]);
  const paras = useMemo(() => body.split(/\n+/).filter((p) => p.trim()).map((p) => annotate(p, index, dict)), [body, index, dict]);
  const cov = useMemo(() => coverage(paras.flat()), [paras]);
  const unknown = useMemo(() => unknownWords(sentences), [sentences]);
  const chosen = unknown.filter((u) => !off.has(u.key));
  const colors = prefs.readColors;

  const toggle = (k: string) => setOff((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const copy = async () => {
    const text = chosen.map(mineLine).join('\n');
    try { await navigator.clipboard.writeText(text); toast(`已复制 ${chosen.length} 个生词，发给 Claude 做卡`); }
    catch { window.prompt('复制下面的内容', text); }
  };
  const toBasket = async () => {
    let n = 0;
    for (const u of chosen) if (!(await addClip({ kind: 'expr', text: u.form, context: u.sentence, source: source.trim() || null })).existed) n++;
    toast(`放进摘句篮 ${n} 条${n < chosen.length ? `（${chosen.length - n} 条已经在篮子里）` : ''}`);
  };
  const markKnown = async (u: Unknown) => { await setKnown(u.key, true); toast(`${u.key} 标为认识，以后不再算生词`); };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = importFile(f.name, await f.text());
    setBody(r.body); setSource(r.title); setOff(new Set());
  };
  // 点一个词：选中它，划词气泡会接着读选区
  const click = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.rw');
    if (!el || !window.getSelection()?.isCollapsed) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  };

  return (
    <div className="mine">
      <textarea className="read-input" rows={body ? 4 : 8} value={body} onChange={(e) => { setBody(e.target.value); setOff(new Set()); }}
        placeholder="粘贴一段法语（文章、社论、听写稿），下面会标出生词并列出它们所在的句子；也可以导入 .txt / .md / .srt / .vtt" />
      <div className="toolbar">
        <input className="grow" value={source} onChange={(e) => setSource(e.target.value)} placeholder="出处（可选，放进摘句篮时记下）" />
        <button type="button" className="btn" onClick={() => file.current?.click()}>导入文件</button>
        {!!texts?.length && (
          <select aria-label="之前保存的文章" value="" onChange={(e) => { const t = texts.find((x) => x.id === e.target.value); if (t) { setBody(t.body); setSource(t.source || t.title); setOff(new Set()); } }}>
            <option value="">之前保存的文章（{texts.length}）</option>
            {texts.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        )}
        <input ref={file} type="file" hidden accept=".txt,.md,.markdown,.srt,.vtt,text/plain" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {body.trim() && (index ? (
        <>
          <div className="read-stats">
            <div className="cov-bar" title={`认识 ${cov.known} · 学习中 ${cov.learning} · 有卡未学 ${cov.new} · 生词 ${cov.unknown}`}>
              <span className="cov-known" style={{ width: `${(cov.known / Math.max(1, cov.total)) * 100}%` }} />
              <span className="cov-learning" style={{ width: `${(cov.learning / Math.max(1, cov.total)) * 100}%` }} />
              <span className="cov-new" style={{ width: `${(cov.new / Math.max(1, cov.total)) * 100}%` }} />
            </div>
            <p className="small"><b>已知 {cov.pct}%</b> · {coverageAdvice(cov.pct)} <span className="muted">· {cov.total || wordCount(body)} 词，生词 {unknown.length} 个</span></p>
          </div>

          <div className="mine-head">
            <h3 className="sub">生词 {chosen.length}/{unknown.length}</h3>
            <span className="grow" />
            <button type="button" className={`pill${colors ? ' is-on' : ''}`} onClick={() => setPrefs({ readColors: !colors })}>原文标色</button>
            <button type="button" className="btn" disabled={!chosen.length} onClick={() => void toBasket()} title="放进摘句篮，晚上统一做">放进摘句篮</button>
            <button type="button" className="btn is-primary" disabled={!chosen.length} onClick={() => void copy()} title="复制成「词(原句」，一行一个">复制给 Claude 做卡</button>
          </div>
          {!unknown.length
            ? <p className="muted small">没有生词。短语、搭配可以在原文里选中，用查词气泡里的「摘句」放进摘句篮。</p>
            : (
              <ul className="mine-list">
                {unknown.map((u) => (
                  <li key={u.key} className={off.has(u.key) ? 'is-off' : undefined}>
                    <label className="mine-pick"><input type="checkbox" checked={!off.has(u.key)} onChange={() => toggle(u.key)} /><b>{u.form}</b>{u.form.toLowerCase() !== u.key && <span className="muted small"> {u.key}</span>}{u.count > 1 && <span className="muted small"> ×{u.count}</span>}</label>
                    <span className="mine-sent muted small">{u.sentence}</span>
                    <button type="button" className="pill" title="其实认识：以后读到不再算生词" onClick={() => void markKnown(u)}>认识</button>
                  </li>
                ))}
              </ul>
            )}

          <h3 className="sub">原文</h3>
          <div className={`read-body${colors ? ' is-colored' : ''}`} onClick={click} data-lookup-source={source || undefined}>
            {paras.map((toks, i) => (
              <p key={i}>{toks.map((k, j) => (k.status ? <span key={j} className={`rw st-${k.status}`} title={colors ? STATUS_LABEL[k.status] : undefined}>{k.text}</span> : k.text))}</p>
            ))}
          </div>
        </>
      ) : <p className="muted small pulse">加载词典…</p>)}
    </div>
  );
}
