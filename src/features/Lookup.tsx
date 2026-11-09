// 划词查词：在页面里选中法语（词、表达或句子）弹出气泡。
// 单词 / 短表达：Wiktionnaire 法法释义 + 机翻（几条释义拼成一段翻，越长越准）+ 所在句子的机翻；
// 长句：只给机翻。气泡里可以朗读、放进摘句篮、跳到外部词典。
// 不弹的地方：输入框、复习卡正面（data-no-lookup，免得提前看到答案）、主内容区以外。
// 点气泡以外的地方、按任意键、滚动、换页时自动关掉。
// 布局：标题和底部按钮固定，只有中间的释义滚动；气泡按选区上下哪边空间大摆放，高度不超出屏幕。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDeckSettings, useKnown, useNotes } from '../db/hooks';
import { usePrefs } from '../ui/prefs';
import { isFrench } from '../ui/langs';
import { addClip, recordEncounter, setKnown } from '../db/actions';
import { canonicalLemma, lemmaCandidates, lemmaOf, useFrVerbs, type FrDict } from '../lib/gender/dict';
import { isFunctionWord, useReadingIndex } from '../lib/reading';
import type { Encounter } from '../schema';
import { externalLinks, lookupWiktionnaire, sentenceAround, translateCached, translateSenses, type DictResult } from '../lib/dictionary';
import { speak } from '../lib/speech';
import { toast } from '../ui/toast';

interface Anchor { top: number; bottom: number; left: number; width: number }
interface Sel { text: string; context: string; anchor: Anchor; source: string | null; textId: string | null }

const MARGIN = 8;
/** 宽度不超过 380（手机上占满减两边留白） */
export const bubbleWidth = (vw: number) => Math.min(380, vw - 2 * MARGIN);
/**
 * 气泡放在选区的上方还是下方、最多多高：下方够 340 就放下方，否则放空间大的一边；
 * 两边都不到 200（选了好几行的长句）就贴着屏幕底部，盖住一部分选区也比读不全好。
 */
export function placeBubble(a: Anchor, vw: number, vh: number): { left: number; width: number; top?: number; bottom?: number; maxHeight: number } {
  const width = bubbleWidth(vw);
  const left = Math.min(Math.max(MARGIN, a.left + a.width / 2 - width / 2), vw - width - MARGIN);
  const cap = Math.min(560, Math.round(vh * 0.75));
  const below = vh - a.bottom - 2 * MARGIN;
  const above = a.top - 2 * MARGIN;
  if (Math.max(below, above) < 200) return { left, width, bottom: MARGIN, maxHeight: Math.min(cap, Math.round(vh * 0.6)) };
  if (below >= 340 || below >= above) return { left, width, top: a.bottom + MARGIN, maxHeight: Math.min(cap, below) };
  return { left, width, bottom: vh - a.top + MARGIN, maxHeight: Math.min(cap, above) };
}
type Mode = 'word' | 'phrase' | 'sentence';

const WORD_RE = /^[\p{L}'’-]+$/u;
const ELISION = /^(?:[ldjmnstc]|qu|jusqu|lorsqu|puisqu)['’]/i;
const hasLetter = (s: string) => /\p{L}/u.test(s);
export const modeOf = (t: string): Mode => {
  const words = t.trim().split(/\s+/).length;
  if (words === 1 && WORD_RE.test(t.trim())) return 'word';
  return words <= 6 && !/[.!?;:]\s*$/.test(t.trim()) ? 'phrase' : 'sentence';
};

/** 一个选区所在的文本块（最近的块级祖先）和选区在块里的位置 */
function contextOf(range: Range): { block: string; start: number; end: number } {
  let el: Element | null = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  while (el && el.parentElement && getComputedStyle(el).display.startsWith('inline')) el = el.parentElement;
  if (!el) return { block: range.toString(), start: 0, end: range.toString().length };
  const pre = document.createRange();
  pre.setStart(el, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { block: el.textContent ?? '', start, end: start + range.toString().length };
}

/** 选区是否在允许查词的地方 */
function allowed(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el || !el.closest('main')) return false;
  return !el.closest('[data-no-lookup], input, textarea, select, [contenteditable="true"], .lookup-pop');
}

export function LookupBubble({ dict }: { dict: FrDict | null }) {
  const [sel, setSel] = useState<Sel | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const last = useRef('');
  useEffect(() => {
    const close = () => { last.current = ''; setSel(null); };
    const read = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) return;
      const text = s.toString().replace(/\s+/g, ' ').trim();
      if (!text || text.length > 400 || !hasLetter(text) || !allowed(s.anchorNode) || !allowed(s.focusNode)) return;
      const range = s.getRangeAt(0);
      const r = range.getBoundingClientRect();
      const key = `${text}@${Math.round(r.left)},${Math.round(r.top)}`;
      if (key === last.current) return;
      last.current = key;
      const { block, start, end } = contextOf(range);
      const context = modeOf(text) === 'sentence' ? text : sentenceAround(block, start, end) || text;
      const startEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const host = startEl?.closest('[data-lookup-source]');
      setSel({
        text, context, source: host?.getAttribute('data-lookup-source') || null,
        textId: startEl?.closest('[data-text-id]')?.getAttribute('data-text-id') || null,
        anchor: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
      });
      window.dispatchEvent(new Event('vcita:lookup-open'));
    };
    let pointerDown = false;
    let timer: number | undefined;
    const down = (e: PointerEvent) => {
      pointerDown = true;
      if (!box.current?.contains(e.target as Node)) close();
    };
    const up = (e: PointerEvent) => {
      pointerDown = false;
      if (box.current?.contains(e.target as Node)) return;
      window.setTimeout(read, 0);
    };
    // 手机上长按选词、拖动选区手柄不一定有 pointerup：选区停下来半秒后再读
    const change = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (!pointerDown) read(); }, 500);
    };
    const key = (e: KeyboardEvent) => { if (!box.current?.contains(e.target as Node)) close(); };
    const scroll = (e: Event) => { if (!box.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('selectionchange', change);
    window.addEventListener('keydown', key, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('hashchange', close);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('selectionchange', change);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('hashchange', close);
    };
  }, []);
  if (!sel) return null;
  const place = placeBubble(sel.anchor, window.innerWidth, window.innerHeight);
  return (
    <div ref={box} className="lookup-pop" style={place} role="dialog" aria-label={`查词：${sel.text}`}>
      <LookupBody key={`${sel.text}|${sel.context}`} sel={sel} dict={dict} onClose={() => { last.current = ''; setSel(null); }} />
    </div>
  );
}

interface Found { dict: DictResult | null; zh: string[] | null; zhWhole: string | null; sentenceZh: string | null; textZh: string | null; error: boolean }

function LookupBody({ sel, dict, onClose }: { sel: Sel; dict: FrDict | null; onClose: () => void }) {
  const prefs = usePrefs();
  const s = useDeckSettings(prefs.deckId);
  // 学习语言不是法语：不查 Wiktionnaire、不还原原形，只机翻 + 外部词典
  const fr = isFrench(s?.sourceLang);
  const notes = useNotes();
  const known = useKnown();
  const verbs = useFrVerbs(true);
  const index = useReadingIndex(true);
  const mode = modeOf(sel.text);
  const bare = mode === 'word' ? sel.text.replace(ELISION, '') : sel.text;
  // 变位动词（mangeait → manger）要等变位表加载完才知道原形
  const lemma = mode === 'word' && dict ? lemmaOf(dict, verbs, bare)?.lemma ?? null : null;
  const ready = mode !== 'word' || !fr || (!!dict && !!verbs);
  // 记遇见、标认识的键：和阅读页标色用同一个（候选原形里最常用的）
  const key = (mode === 'word' ? (dict && lemma ? canonicalLemma(dict, verbs, bare) : bare) : sel.text).toLowerCase();
  const [found, setFound] = useState<Found | null>(null);
  const [clipped, setClipped] = useState(false);
  const [seen, setSeen] = useState<Encounter[] | null>(null);
  const [etymOpen, setEtymOpen] = useState(false);

  // 记一次遇见（单词按原形，表达按小写原样；长句不记）
  useEffect(() => {
    if (mode === 'sentence' || !ready) return;
    let alive = true;
    void recordEncounter({ key, form: bare, sentence: sel.context, textId: sel.textId, source: sel.source }).then((list) => alive && setSeen(list));
    return () => { alive = false; };
  }, [mode, ready, key, bare, sel.context, sel.textId, sel.source]);

  useEffect(() => {
    if (!s || !ready) return;
    let alive = true;
    const sl = s.sourceLang, tl = s.targetLang1;
    void (async () => {
      let error = false;
      const wk = mode === 'sentence' || !fr ? Promise.resolve(null) : lookupWiktionnaire(lemma && lemma !== bare ? [lemma, bare] : [bare]).catch(() => { error = true; return null; });
      const sentenceZh = mode !== 'sentence' && sel.context && sel.context !== sel.text ? translateCached(sel.context, sl, tl) : Promise.resolve(null);
      const textZh = mode === 'word' && fr ? Promise.resolve(null) : translateCached(sel.text, sl, tl);
      const d = await wk;
      const defs = (d?.entries ?? []).slice(0, 2).flatMap((e) => e.senses.slice(0, 4).map((x) => x.def));
      const [zh, sz, tz] = await Promise.all([translateSenses(defs, sl, tl), sentenceZh, textZh]);
      if (alive) setFound({ dict: d, zh: zh.lines, zhWhole: zh.lines ? null : zh.whole, sentenceZh: sz, textZh: tz, error });
    })();
    return () => { alive = false; };
  }, [s, ready, mode, bare, lemma, sel.context, sel.text, fr]);

  // 已有的笔记：词条里出现这个原形（或选中的表达）
  const existing = useMemo(() => {
    const key = (lemma ?? bare).toLowerCase();
    // la、de 这种虚词几乎每张卡都有，列出来没有意义
    if (!notes || key.length < 2 || (mode === 'word' && isFunctionWord(key))) return [];
    const re = new RegExp(`(^|[^\\p{L}])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu');
    return notes.filter((n) => re.test(n.lemma)).slice(0, 3);
  }, [notes, lemma, bare, mode]);
  // 有没有卡：和阅读页标色用同一套（一个词形可能属于几个原形，任何一个有卡就算）
  const hasCard = existing.length > 0 || (mode === 'word' && !!dict && !!index && [key, ...lemmaCandidates(dict, verbs, bare)].some((k) => index.notes.has(k)));

  if (!s) return null;
  const clip = async () => {
    const isSentence = mode === 'sentence';
    const i = sel.context.toLowerCase().indexOf(sel.text.toLowerCase());
    const context = isSentence || i < 0 ? sel.context : `${sel.context.slice(0, i)}{{${sel.context.slice(i, i + sel.text.length)}}}${sel.context.slice(i + sel.text.length)}`;
    const first = found?.dict?.entries[0]?.senses[0];
    const gloss = first ? [first.def, found?.zh?.[0]].filter(Boolean).join(' · ') : (found?.textZh ?? '');
    const r = await addClip({
      kind: isSentence ? 'sentence' : 'expr', text: isSentence ? sel.text : (lemma && mode === 'word' ? lemma : sel.text),
      context, translation: (isSentence ? found?.textZh : found?.sentenceZh) ?? '', gloss, source: sel.source, textId: sel.textId,
    });
    setClipped(true);
    toast(r.existed ? '摘句篮里已经有这一条了' : '已放进摘句篮（添加 → 摘句篮）');
  };

  const entries = found?.dict?.entries.slice(0, 2) ?? [];
  let line = 0;
  return (
    <>
      <div className="lk-head">
        <b className="lk-word">{mode === 'sentence' ? '句子' : bare}</b>
        {mode !== 'sentence' && (() => {
          // 词条标题（原形）以 Wiktionnaire 实际查到的为准，没查到时用本地词典的原形
          const base = found?.dict?.title ?? lemma;
          return base && base.toLowerCase() !== bare.toLowerCase() ? <span className="muted small">原形 <b>{base}</b></span> : null;
        })()}
        <span className="grow" />
        <button type="button" className="icon" title="朗读" onClick={() => void speak(sel.text, s.sourceLang)}>🔊</button>
        <button type="button" className="icon lk-close" title="关闭（Esc）" aria-label="关闭" onClick={onClose}>✕</button>
      </div>
      <div className="lk-scroll">
      {!found ? <p className="muted small pulse">查询中…</p> : (
        <div className="lk-body">
          {found.textZh && <p className="lk-zh">{found.textZh}</p>}
          {found.dict?.formNote && <p className="muted small lk-form">{bare}：{found.dict.formNote}</p>}
          {entries.map((e, ei) => (
            <div key={ei} className="lk-entry">
              <div className="lk-pos">{e.pos}{e.gender && <span className={`lk-g g-${e.gender === 'féminin' ? 'f' : e.gender === 'masculin' ? 'm' : 'b'}`}> · {e.gender}</span>}</div>
              <ol>
                {e.senses.slice(0, 4).map((x, i) => {
                  const zh = found.zh?.[line++];
                  return (
                    <li key={i}>
                      <span className="lk-def">{x.def}</span>
                      {zh && <span className="lk-def-zh">{zh}</span>}
                      {i === 0 && ei === 0 && x.example && <span className="lk-ex">{x.example}</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
          {found.zhWhole && <p className="lk-zh small">{found.zhWhole}</p>}
          {mode !== 'sentence' && fr && !entries.length && (
            <p className="muted small">{found.error ? '连不上 Wiktionnaire（网络问题），可以用下面的外部词典' : 'Wiktionnaire 里没有这个词条'}</p>
          )}
          {found.dict?.etymology && (
            <p className={`lk-etym small${etymOpen ? ' is-open' : ''}`} title={etymOpen ? undefined : '点击展开'} onClick={() => setEtymOpen(true)}>
              <span className="muted">词源 </span>{found.dict.etymology}
            </p>
          )}
          {found.sentenceZh && <p className="lk-sent small"><span className="muted">整句 </span>{found.sentenceZh}</p>}
          {existing.length > 0 ? <p className="small"><span className="muted">已有卡 </span>{existing.map((n) => n.lemma).join('；')}</p>
            : hasCard && <p className="small muted">已有包含这个词的卡</p>}
        </div>
      )}
      {seen && seen.length > 1 && (
        <div className={`lk-seen small${!hasCard ? ' is-hint' : ''}`}>
          <b>第 {seen.length} 次遇见</b>{!hasCard && '，还没有卡：建议摘句'}
          {seen.filter((e) => e.sentence !== sel.context).slice(-2).map((e) => <div key={e.id} className="muted">· {e.sentence}{e.source ? `（${e.source}）` : ''}</div>)}
        </div>
      )}
      </div>
      <div className="lk-actions">
        <button type="button" className={`pill${clipped ? ' is-on' : seen && seen.length > 1 && !hasCard ? ' is-suggest' : ''}`} disabled={clipped} onClick={() => void clip()}>{clipped ? '已摘 ✓' : '摘句'}</button>
        {mode === 'word' && known && (
          <button type="button" className={`pill${known.has(key) ? ' is-on' : ''}`} title="短文挖词里不再算生词" onClick={() => void setKnown(key, !known.has(key))}>{known.has(key) ? '已认识 ✓' : '认识'}</button>
        )}
        <span className="grow" />
        <nav className="lk-dicts" aria-label="外部词典">
          {externalLinks(mode === 'word' ? (lemma ?? bare) : sel.text, s.sourceLang, s.targetLang1).map((l) => (
            <a key={l.label} href={l.url} target="_blank" rel="noreferrer" title={`在 ${l.label} 查`}>{l.short}</a>
          ))}
        </nav>
      </div>
    </>
  );
}
