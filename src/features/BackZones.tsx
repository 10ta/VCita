// 卡片背面的固定分区：用法 | 其他语境 / 词源 | 词族 / 注意（按需）/ 出处。
// 四个格子位置永远不变，没内容时显示虚线占位，看熟以后眼睛可以直接跳到想看的格子。
// 「补充」字段按开头的标记拆进各区：高频 近义 同义 也说 → 用法；⚠ ❌ 已有卡 语法锁 → 注意；原文 句意 TCF 错题 → 出处；
// 其他义 另义 → 其他语境（和笔记的其他语境重复的不再列）；认不出的放在出处下面的「补充」。
// 标记前面可以是换行，也可以是 ；或 。
import { centerWord } from '../srs/related';
import type { ReactNode } from 'react';
import type { Note, Settings } from '../schema';
import { Fr } from './FrText';

export interface Entry { fr: string; zh: string }
export interface Zones {
  use: Entry[]; ctx: Entry[]; ety: string | null; fam: Entry[];
  warn: string[]; src: string[]; more: string[]; sourceUrl: string | null;
}
export type ZoneHeads = NonNullable<Settings['zoneHeads']>;
export const zoneHeadsOf = (s: Pick<Settings, 'zoneHeads'> | undefined): ZoneHeads => s?.zoneHeads ?? 'icon';

const HAN = /[㐀-鿿]/;
const MARKS = '高频|近义|同义|也可说|也说|朴素版|⚠|❌|🔴|误写|已有卡|语法锁|原文形式|原文|句意|回译|TCF 错题|其他义|另义';
/** 标记前面的分隔：换行、｜（任何时候都拆），或者 ；。， 后面紧跟标记 */
const SPLIT = new RegExp(`[；;。，,]\\s*(?=(?:${MARKS}))`);
const BAR = /\s*[｜|]\s*/;
const trimEnd = (x: string) => x.trim().replace(/[。；;]+$/, '').trim();

/** 一条「法语 + 中文」：fr：zh、fr → zh、或者第一个汉字之前是法语；整段包在括号里的中文去掉括号 */
export function splitEntry(raw: string): Entry {
  const s = trimEnd(raw);
  let m = /^(.+?)\s*：\s*(.+)$/s.exec(s);
  if (m && !HAN.test(m[1])) return { fr: m[1].trim(), zh: m[2].trim() };
  m = /^(.+?)\s+→\s+(.+)$/s.exec(s);
  if (m && !HAN.test(m[1])) return { fr: m[1].trim(), zh: m[2].trim() };
  const i = s.search(HAN);
  if (i < 0) return { fr: s, zh: '' };
  if (i === 0) return { fr: '', zh: s };
  let fr = s.slice(0, i);
  let zh = s.slice(i);
  const open = /[（(]\s*$/.exec(fr);
  if (open) { fr = fr.slice(0, open.index); zh = open[0].trim() + zh; }
  zh = zh.trim();
  const wrapped = /^[（(]([^（()）]*)[）)]$/.exec(zh);
  if (wrapped) zh = wrapped[1];
  return { fr: fr.trim().replace(/[，,:：。]$/, '').trim(), zh: zh.replace(/[。；]+$/, '') };
}

/** 一串条目：；分隔；没有中文的一条再按 、 分（attraper la grippe、le vaccin contre la grippe） */
const items = (s: string) => attachZh(s.split(/[；;]/).map((x) => x.trim()).filter(Boolean)
  .flatMap((x) => (HAN.test(x) ? [x] : x.split('、').map((y) => y.trim()).filter(Boolean))));

const LATIN = /[A-Za-zÀ-ÖØ-öø-ÿŒœ]/;
/** 拆开后没有法语的一段是上一条中文义的一部分（éprouver 感受；考验）：并回上一条 */
function attachZh(parts: string[]): Entry[] {
  const out: Entry[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && !LATIN.test(p) && last.fr) last.zh = last.zh ? `${last.zh}；${p}` : p;
    else out.push(splitEntry(p));
  }
  return out;
}

/** 词族：a 意 · b 意，或 a（意）、b（意） */
const family = (s: string) => attachZh(s.split(/\s+·\s+|[；;]|(?<=[）)])\s*[、,，]\s*/).map((x) => x.trim()).filter(Boolean));

const marks = (s: string | null | undefined) => [...(s ?? '').matchAll(/\{\{(.*?)\}\}/g)].map((m) => m[1].split('::')[0].trim()).filter(Boolean).join(' … ');
/** 产出题的换说法 → 目标表达；没有法语题面时 null */
export function plainPair(note: Pick<Note, 'promptFr' | 'answerFr' | 'promptKind'>): Entry | null {
  const p = marks(note.promptFr), a = marks(note.answerFr);
  if (!p || !a || p === a || /^(…|\.{3}|_{2,})$/.test(p)) return null;
  return { fr: `${p} → ${a}`, zh: note.promptKind ? `朴素说法 · ${note.promptKind}` : '朴素说法' };
}

export function backZones(note: Note, plain = true): Zones {
  const z: Zones = { use: [], ctx: [], ety: note.etymology?.trim() || null, fam: [], warn: [], src: [], more: [], sourceUrl: null };
  if (note.usage?.trim()) z.use.push(splitEntry(note.usage));
  // 朴素说法：产出题面高亮里的换说法 → 答案高亮（下位 / 平替），两个方向都看得到
  const pp = plain ? plainPair(note) : null;
  if (pp) z.use.push(pp);
  const otherSense: Entry[] = [];
  const segs = (note.extra ?? '').split('\n').flatMap((l) => l.split(BAR)).flatMap((l) => l.split(SPLIT)).map(trimEnd).filter(Boolean);
  for (const seg of segs) {
    const m = new RegExp(`^(${MARKS})\\s*[：:]?\\s*`).exec(seg);
    const mark = m?.[1];
    const rest = m ? seg.slice(m[0].length) : seg;
    if (mark === '高频') z.use.push(...items(rest));
    else if (mark === '近义' || mark === '同义' || mark === '也说' || mark === '也可说' || mark === '朴素版') z.use.push(...items(rest).map((e) => (e.zh ? e : { ...e, zh: mark })));
    else if (mark === '⚠') z.warn.push(rest);
    else if (mark === '❌' || mark === '🔴' || mark === '误写' || mark === '已有卡' || mark === '语法锁') z.warn.push(seg);
    else if (mark === '原文' || mark === '原文形式' || mark === '句意' || mark === '回译' || mark === 'TCF 错题') z.src.push(seg);
    else if (mark === '其他义' || mark === '另义') otherSense.push(...rest.split(/[；;]/).map((x) => x.trim()).filter(Boolean).map(splitEntry));
    else z.more.push(seg);
  }
  const ctx = note.contexts ?? [];
  z.ctx = [...ctx.map(splitEntry), ...otherSense.filter((e) => !ctx.some((c) => c.includes(e.zh || e.fr)))];
  if (note.cueFamily?.trim()) z.fam = family(note.cueFamily);
  const src = note.source?.trim();
  if (src) {
    if (/^https?:\/\//.test(src)) z.sourceUrl = src;
    else z.src.unshift(src);
  }
  z.src = [...new Set(z.src.map((x) => x.trim()))];
  return z;
}

/* ---------------- 渲染 ---------------- */

type ZoneKey = 'use' | 'ctx' | 'ety' | 'fam' | 'warn' | 'src';
const LABEL: Record<ZoneKey, string> = { use: '用法 · 常用搭配', ctx: '其他语境', ety: '词源', fam: '词族', warn: '注意', src: '出处' };
const ICON: Record<ZoneKey, ReactNode> = {
  use: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
  ctx: <><path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M12 22v-8.3a4 4 0 0 0-1.17-2.87L3 3" /><path d="m15 9 6-6" /></>,
  warn: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  ety: <><path d="M7 20h10" /><path d="M10 20c5.5-2.5.8-6.4 3-10" /><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" /><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" /></>,
  fam: <><rect x="16" y="16" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="9" y="2" width="6" height="6" rx="1" /><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" /><path d="M12 12V8" /></>,
  src: <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>,
};

function Head({ k, count, empty }: { k: ZoneKey; count?: number; empty?: boolean }) {
  return (
    <div className="z-head">
      <span className="z-title">
        <svg className="z-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[k]}</svg>
        {LABEL[k]}
      </span>
      {empty ? <span className="z-none">—</span> : !!count && <span className="z-count">{count}</span>}
    </div>
  );
}

function Entries({ list }: { list: Entry[] }) {
  return (
    <>
      {list.map((e, i) => (
        <div key={i} className="z-entry">
          {e.fr && <span className="z-fr" lang="fr">{e.fr}</span>}
          {e.zh && <span className={e.fr ? 'z-zh' : 'z-fr'}>{e.zh}</span>}
        </div>
      ))}
    </>
  );
}

function Zone({ k, count, children }: { k: ZoneKey; count?: number; children?: ReactNode }) {
  const empty = !children;
  return (
    <div className={`zone z-${k}${empty ? ' is-empty' : ''}`}>
      <Head k={k} count={count} empty={empty} />
      {children}
    </div>
  );
}

/** 词源：→ ← = + 变淡，法语 / 拉丁词斜体 */
function Etym({ text }: { text: string }) {
  return (
    <div className="z-ety">
      {text.split(/(\s*(?:→|←|=|\+)\s*)/).map((part, i) =>
        i % 2 ? <span key={i} className="z-op">{part}</span>
          : part.split(/([A-Za-zÀ-ÖØ-öø-ÿŒœÆæ][A-Za-zÀ-ÖØ-öø-ÿŒœÆæ'’.-]*(?:\s+[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ'’.-]+)*)/).map((t, j) =>
            j % 2 ? <i key={`${i}-${j}`} className="z-lat">{t}</i> : t))}
    </div>
  );
}

/** ≠ 用注意区的颜色 */
const neq = (t: string) => t.split(/(≠)/).map((x, i) => (x === '≠' ? <b key={i} className="z-neq">≠</b> : x));

/** 「原文：…」这类带标签的一行：标签变淡 */
function Labeled({ text }: { text: string }) {
  const m = /^(原文形式|原文|句意|TCF 错题|已有卡|语法锁|误写)\s*[：:]\s*/.exec(text);
  return m ? <><span className="z-lbl">{m[1]}</span>{neq(text.slice(m[0].length))}</> : <>{neq(text)}</>;
}

export function BackZones({ note, heads, plain = true, famExtra = [] }: { note: Note; heads: ZoneHeads; plain?: boolean; famExtra?: Entry[] }) {
  const z = backZones(note, plain);
  // 词族 = 手写的词族线索 + 库里同词族的卡（关联引擎算出，已经写在线索里的不重复）
  const cue = new Set(z.fam.flatMap((e) => e.fr.toLowerCase().split(/[^a-zà-ÿœæ-]+/)));
  z.fam = [...z.fam, ...famExtra.filter((e) => !cue.has(centerWord(e.fr)))];
  const host = z.sourceUrl ? z.sourceUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : '';
  return (
    <Fr>
      <div className={`zones zh-${heads}`}>
        {/* 四个格子位置固定，没内容就留虚线空位（找东西靠位置，不靠读标题） */}
        <div className="z-grid">
          <Zone k="use" count={z.use.length}>{z.use.length ? <Entries list={z.use} /> : null}</Zone>
          <Zone k="ctx" count={z.ctx.length}>{z.ctx.length ? <Entries list={z.ctx} /> : null}</Zone>
          <Zone k="ety">{z.ety ? <Etym text={z.ety} /> : null}</Zone>
          <Zone k="fam" count={z.fam.length}>{z.fam.length ? <Entries list={z.fam} /> : null}</Zone>
        </div>
        {!!z.warn.length && (
          <div className="z-warn">
            <Head k="warn" />
            <div className="z-warn-list">{z.warn.map((w, i) => <div key={i}><Labeled text={w} /></div>)}</div>
          </div>
        )}
        {(!!z.src.length || z.sourceUrl) && (
          <div className="z-src">
            <Head k="src" />
            <div className="z-src-list">
              {z.src.map((x, i) => <div key={i}><Labeled text={x} /></div>)}
              {z.sourceUrl && <div><a href={z.sourceUrl} target="_blank" rel="noreferrer">{host}</a></div>}
            </div>
          </div>
        )}
        {!!z.more.length && (
          <div className="z-src z-more">
            <div className="z-head"><span className="z-title">补充</span></div>
            <div className="z-src-list">{z.more.map((x, i) => <div key={i}>{neq(x)}</div>)}</div>
          </div>
        )}
      </div>
    </Fr>
  );
}
