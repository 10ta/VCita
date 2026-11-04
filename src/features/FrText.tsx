// 法语文字里的名词 / 形容词：名词按阴阳性加下划线颜色（阳性蓝、阴性红），鼠标悬停（手机上点一下）弹出迷你条：
// 这个词的性、另一个性的形式、按词尾的记忆规则（含可靠度和最常见的例外），同形异义词给两个意思。
import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { genderInfo, lemmaFreq, useFrDict, type FrDict, type GenderInfo } from '../lib/gender/dict';
import { useNotes, useSettings } from '../db/hooks';
import type { Settings } from '../schema';

interface Ctx { dict: FrDict | null }
const FrCtx = createContext<Ctx>({ dict: null });

export type GenderDisplay = NonNullable<Settings['genderDisplay']>;
/** 没设过时：旧开关关掉过 → off，否则默认只标考查部分（focus） */
export const genderDisplayOf = (s: Pick<Settings, 'genderDisplay' | 'genderColors'> | undefined): GenderDisplay =>
  s?.genderDisplay ?? (s?.genderColors === false ? 'off' : 'focus');

export function FrProvider({ children }: { children: ReactNode }) {
  const s = useSettings();
  const dict = useFrDict(true);
  const mode = genderDisplayOf(s);
  // 显示方式只靠 CSS 切换（<html data-gender>），换设置不用重新切词
  useEffect(() => { document.documentElement.dataset.gender = mode; }, [mode]);
  return (
    <FrCtx.Provider value={{ dict }}>
      {children}
      {dict && <GenderPopover dict={dict} />}
    </FrCtx.Provider>
  );
}

/** 每条笔记的词频（词典加载完之前是 undefined） */
export function useNoteFreqs(): Map<string, number | null> | undefined {
  const { dict } = useContext(FrCtx);
  const notes = useNotes();
  return useMemo(() => (dict && notes ? new Map(notes.map((n) => [n.id, lemmaFreq(dict, n.lemma)])) : undefined), [dict, notes]);
}

const WORD = /(\p{L}+(?:-\p{L}+)*)/u;
const URL_RE = /https?:\/\/\S+/;
const URL_SPLIT = /(https?:\/\/\S+)/;

/** 把 children 里的法语文字切成词，名词 / 形容词包一层可悬停的 span。
 *  考查部分（{{…}} 渲染成的 .cloze）里的词多一个 fw-t，"只标考查部分"模式只给它们画线 */
export function Fr({ children }: { children: ReactNode }) {
  const { dict } = useContext(FrCtx);
  if (!dict) return <>{children}</>;
  const st = { prev: null as string | null, key: 0, target: false };
  const walk = (node: ReactNode): ReactNode => {
    if (typeof node === 'string') {
      // 网址原样保留
      if (URL_RE.test(node)) return node.split(URL_SPLIT).map((x, i) => (i % 2 ? x : walk(x)));
      return node.split(WORD).map((part, i) => {
        if (i % 2 === 0) {
          // 标点、空格：句号之类断开冠词和名词的联系，空格、撇号不断（l'arbre）
          if (/[^\s'’]/u.test(part)) st.prev = null;
          return part;
        }
        const prev = st.prev;
        st.prev = part;
        // 单个字母（j'、m'、字母 e）不算
        const e = part.length > 1 ? dict.get(part) : undefined;
        if (!e || (e.pos !== 'N' && e.pos !== 'A')) return part;
        const cls = (e.pos === 'N' && (e.g === 'm' || e.g === 'f') ? ` g-${e.g}` : '') + (st.target ? ' fw-t' : '');
        return <span key={`fw${st.key++}`} className={`fw${cls}`} data-fw={part} data-prev={prev ?? ''}>{part}</span>;
      });
    }
    if (Array.isArray(node)) return Children.map(node, walk);
    if (isValidElement(node)) {
      const el = node as ReactElement<{ children?: ReactNode; className?: string }>;
      if (el.props.children === undefined || el.props.className?.includes('blank')) return el;
      const outer = st.target;
      if (el.props.className?.split(/\s+/).includes('cloze')) st.target = true;
      const kids = walk(el.props.children);
      st.target = outer;
      return cloneElement(el, undefined, kids);
    }
    return node;
  };
  return <>{walk(children)}</>;
}

const GENDER_ZH = { m: '阳性', f: '阴性' } as const;
/** 不定冠词 + 词：复数用 des（看不出性，性在后面的标签里） */
const article = (w: string, g: 'm' | 'f', plural = false) => `${plural ? 'des' : g === 'm' ? 'un' : 'une'} ${w}`;

function GenderBody({ info }: { info: GenderInfo }) {
  const g = info.ctxGender ?? (info.gender === 'm' || info.gender === 'f' ? info.gender : null);
  const num = info.number === 'p' ? '复数' : info.number === 's' ? '单数' : '';
  if (info.pos === 'A') {
    return (
      <>
        <div className="gp-head"><b>{info.word}</b> <span className="muted">形容词{info.gender ? ` · ${GENDER_ZH[info.gender as 'm' | 'f'] ?? ''}${num}` : ' · 阴阳同形'}</span></div>
        {info.other.length > 0 && <div>{info.gender === 'f' ? '阳性' : '阴性'}：<b className={`g-${info.gender === 'f' ? 'm' : 'f'}`}>{info.other.join(' / ')}</b></div>}
      </>
    );
  }
  return (
    <>
      <div className="gp-head">
        <b>{g ? article(info.word, g, info.number === 'p') : info.word}</b>{' '}
        {g ? <span className={`gp-g g-${g}`}>{GENDER_ZH[g]}{num && ` · ${num}`}</span>
          : info.gender === 'b' ? <span className="gp-g">阴阳同形</span>
          : info.gender === 'h' ? <span className="gp-g">两个性，意思不同</span>
          : <span className="gp-g muted">词典没标性别</span>}
      </div>
      {info.homograph && (
        <div className="gp-homo">
          <div className={info.ctxGender === 'f' ? 'dim' : ''}><b className="g-m">le</b> {info.homograph.m}</div>
          <div className={info.ctxGender === 'm' ? 'dim' : ''}><b className="g-f">la</b> {info.homograph.f}</div>
        </div>
      )}
      {info.gender === 'b' && !info.homograph && <div className="muted">le / la 都用：指人时按性别，或者两性都可以</div>}
      {info.other.length > 0 && <div>{info.gender === 'f' ? '阳性' : '阴性'}：<b className={`g-${info.gender === 'f' ? 'm' : 'f'}`}>{info.other.join(' / ')}</b> <span className="muted">（指人，性跟着所指的人）</span></div>}
      {info.special && <div className="gp-special">⚠ {info.special}</div>}
      {info.rule && (
        <div className={`gp-rule${info.rule.isException ? ' is-ex' : ''}`}>
          {info.rule.isException
            ? <>⚠ 例外：<b>-{info.rule.suffix}</b> 结尾通常是<b className={`g-${info.rule.gender}`}>{GENDER_ZH[info.rule.gender]}</b>（{info.rule.pct}%），这个词是{GENDER_ZH[info.rule.gender === 'm' ? 'f' : 'm']}</>
            : info.gender === '?'
              ? <>按词尾推测：<b>-{info.rule.suffix}</b> → <b className={`g-${info.rule.gender}`}>{GENDER_ZH[info.rule.gender]}</b>（{info.rule.pct}%）</>
              : <>规则：<b>-{info.rule.suffix}</b> → <b className={`g-${info.rule.gender}`}>{GENDER_ZH[info.rule.gender]}</b> <span className="muted">（{info.rule.n} 个常用词里 {info.rule.pct}% 符合，例：{info.rule.example}）</span></>}
          {info.rule.pct < 75 && <div className="muted">这个词尾两性都常见，规则不可靠，要单独记</div>}
          {info.rule.exceptions.length > 0 && <div className="muted">常见例外：{info.rule.exceptions.slice(0, 6).join('、')}</div>}
          {info.rule.tip && <div className="muted">{info.rule.tip}</div>}
        </div>
      )}
      {info.fallback && (
        <div className="gp-rule muted">
          没有明显的词尾规则。大致倾向：{info.fallback.endsWithE ? `以 -e 结尾的名词约 ${info.fallback.femPct}% 是阴性` : `不以 -e 结尾的名词约 ${100 - info.fallback.femPct}% 是阳性`}
        </div>
      )}
    </>
  );
}

/** 全页只有一个迷你条：在 [data-fw] 上悬停时显示（手机上点一下） */
function GenderPopover({ dict }: { dict: FrDict }) {
  const [state, setState] = useState<{ info: GenderInfo; x: number; y: number; below: boolean } | null>(null);
  const hide = useRef<number | undefined>(undefined);
  useEffect(() => {
    const show = (el: HTMLElement) => {
      const info = genderInfo(dict, el.dataset.fw!, el.dataset.prev || null);
      if (!info) return;
      window.clearTimeout(hide.current);
      const r = el.getBoundingClientRect();
      const below = r.bottom + 180 < window.innerHeight;
      setState({ info, x: Math.min(Math.max(8, r.left + r.width / 2 - 160), window.innerWidth - 328), y: below ? r.bottom + 6 : r.top - 6, below });
    };
    const over = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-fw]') as HTMLElement | null;
      if (el) show(el);
      else if ((e.target as HTMLElement | null)?.closest?.('.gender-pop')) window.clearTimeout(hide.current);
    };
    // 触屏点一下之后浏览器会补发 mouseover / mouseout，别让它把刚打开的迷你条关掉
    let touchedAt = 0;
    const out = (e: Event) => {
      if (Date.now() - touchedAt < 1000) return;
      if (!(e.target as HTMLElement | null)?.closest?.('[data-fw], .gender-pop')) return;
      window.clearTimeout(hide.current);
      hide.current = window.setTimeout(() => setState(null), 200);
    };
    // 触屏：点词显示，点别处关掉
    const tap = (e: Event) => {
      touchedAt = Date.now();
      const el = (e.target as HTMLElement | null)?.closest?.('[data-fw]') as HTMLElement | null;
      if (el) show(el);
      else if (!(e.target as HTMLElement | null)?.closest?.('.gender-pop')) setState(null);
    };
    const close = () => setState(null);
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('touchstart', tap, { passive: true });
    window.addEventListener('scroll', close, true);
    window.addEventListener('hashchange', close);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('touchstart', tap);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('hashchange', close);
    };
  }, [dict]);
  if (!state) return null;
  return (
    <div className={`gender-pop${state.below ? '' : ' is-above'}`} role="tooltip" style={{ left: state.x, top: state.y }}>
      <GenderBody info={state.info} />
    </div>
  );
}
