// 划词查词：法语维基词典（Wiktionnaire）的法法释义，再用 Google 机翻成中文。
// - Wiktionnaire：MediaWiki 接口加 origin=* 可以在浏览器里匿名跨域调用，不需要服务器
// - 机翻的特点是给的文字越长越准，所以一个词的几条释义拼成一段一次翻译，再按行拆开
// - 结果缓存在本机（cache 表），同一个词 / 同一句话不重复请求
import { db } from '../db/db';
import { translate } from './speech';

export interface Sense { def: string; example: string | null }
export interface DictEntry {
  /** 词性标题：Nom commun、Verbe、Locution verbale…… */
  pos: string;
  /** masculin / féminin / masculin et féminin，词典里没写时为 null */
  gender: string | null;
  senses: Sense[];
}
export interface DictResult {
  /** 实际查到的词条（可能和查的词不同：原形、重定向） */
  title: string;
  entries: DictEntry[];
  etymology: string | null;
}

/** 不是词性的三级标题：这些标题下面的列表不当释义 */
const NOT_POS = /^(étymologie|prononciation|voir aussi|références|anagrammes|traductions|paronymes|homophones|variantes|notes?|attestations|dérivés|apparentés|vocabulaire|hyperonymes|hyponymes|synonymes|antonymes|forme de )/i;
const FORM_OF = /^forme de /i;

const clean = (s: string) => s.replace(/\[\s*(modifier|éditer|edit)[^\]]*\]/gi, '').replace(/\s+/g, ' ').trim();

/** 标题元素（h2/h3/h4，或新版 MediaWiki 包在 div.mw-heading 里的）→ 级别；不是标题返回 0 */
function headingLevel(el: Element): number {
  const m = /^H([1-6])$/.exec(el.tagName);
  if (m) return Number(m[1]);
  const w = /\bmw-heading([1-6])\b/.exec(el.className || '');
  return w ? Number(w[1]) : 0;
}
function headingText(el: Element): string {
  const h = /^H[1-6]$/.test(el.tagName) ? el : el.querySelector('h1,h2,h3,h4,h5,h6') ?? el;
  const c = h.cloneNode(true) as Element;
  c.querySelectorAll('.mw-editsection').forEach((x) => x.remove());
  return clean(c.textContent ?? '');
}
/** 一条释义：去掉里面的例句、子义项和注释编号 */
function liText(li: Element): string {
  const c = li.cloneNode(true) as Element;
  c.querySelectorAll('ul, ol, dl, sup.reference, .mw-editsection').forEach((x) => x.remove());
  return clean(c.textContent ?? '');
}
function liExample(li: Element): string | null {
  const ex = [...li.children].filter((x) => x.tagName === 'UL').flatMap((ul) => [...ul.querySelectorAll('.example')])[0];
  if (!ex) return null;
  const c = ex.cloneNode(true) as Element;
  c.querySelectorAll('.sources, sup.reference').forEach((x) => x.remove());
  return clean(c.textContent ?? '') || null;
}

/** 解析 action=parse 返回的 HTML，只取「Français」那一节 */
export function parseWiktionnaire(html: string, title: string): DictResult | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('.mw-parser-output') ?? doc.body;
  const kids = [...root.children];
  const start = kids.findIndex((el) => headingLevel(el) === 2 && /^français\b/i.test(headingText(el)));
  if (start < 0) return null;
  const entries: DictEntry[] = [];
  let etymology: string | null = null;
  let h3 = '';
  let underPos = false; // 最近的标题就是词性标题（下面的 ol 才是释义；四级标题下的列表是同义词、派生词）
  let lastP: Element | null = null;
  for (const el of kids.slice(start + 1)) {
    const lv = headingLevel(el);
    if (lv === 2) break;
    if (lv) {
      if (lv === 3) { h3 = headingText(el).replace(/\s*\d+$/, ''); underPos = !NOT_POS.test(h3) || FORM_OF.test(h3); }
      else underPos = false;
      lastP = null;
      continue;
    }
    if (/^étymologie/i.test(h3) && !etymology && (el.tagName === 'DL' || el.tagName === 'P')) {
      etymology = clean(el.textContent ?? '') || null;
      continue;
    }
    if (el.tagName === 'P') { lastP = el; continue; }
    if (el.tagName === 'OL' && underPos) {
      const senses: Sense[] = [];
      for (const li of [...el.children].filter((x) => x.tagName === 'LI')) {
        const def = liText(li);
        if (def) senses.push({ def, example: liExample(li) });
        // 子义项（ol 套 ol）
        for (const sub of [...li.children].filter((x) => x.tagName === 'OL').flatMap((o) => [...o.children].filter((x) => x.tagName === 'LI'))) {
          const d = liText(sub);
          if (d) senses.push({ def: `· ${d}`, example: liExample(sub) });
        }
      }
      if (!senses.length) continue;
      const line = clean(lastP?.textContent ?? '');
      const gender = /masculin et féminin|épicène/i.test(line) ? 'masculin et féminin' : /\bféminin\b/i.test(line) ? 'féminin' : /\bmasculin\b/i.test(line) ? 'masculin' : null;
      entries.push({ pos: h3, gender, senses });
      underPos = false; // 同一个词性只取第一个释义列表
    }
  }
  return entries.length || etymology ? { title, entries, etymology } : null;
}

// ---------------- 缓存 ----------------

const WEEK = 7 * 864e5;
async function cached<T>(key: string, maxAge: number, load: () => Promise<T | null>): Promise<T | null> {
  try {
    const hit = await db.cache.get(key);
    if (hit && Date.now() - hit.at < maxAge) return hit.value as T | null;
  } catch { /* 缓存坏了就当没有 */ }
  const v = await load();
  // 查不到（null）也缓存一天，避免反复请求同一个不存在的词；网络错误抛出，不缓存
  try { await db.cache.put({ key, value: v, at: v === null ? Date.now() - maxAge + 864e5 : Date.now() }); } catch { /* 忽略 */ }
  return v;
}

const TIMEOUT = 8000;
/** 取 Wiktionnaire 的页面 HTML；页面不存在返回 null，网络失败抛错 */
async function fetchPage(word: string): Promise<{ title: string; html: string } | null> {
  const url = `https://fr.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2&prop=text&redirects=1&disableeditsection=1&origin=*&page=${encodeURIComponent(word)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Wiktionnaire ${r.status}`);
    const d = (await r.json()) as { parse?: { title: string; text: string }; error?: { code: string } };
    if (d.error?.code === 'missingtitle' || !d.parse) return null;
    return { title: d.parse.title, html: d.parse.text };
  } finally {
    clearTimeout(timer);
  }
}

/** 查一个词或表达：依次试 原形 → 原样 → 小写；都没有返回 null */
export async function lookupWiktionnaire(candidates: string[]): Promise<DictResult | null> {
  const tried = new Set<string>();
  for (const w of candidates.flatMap((x) => [x.trim(), x.trim().toLowerCase()])) {
    if (!w || tried.has(w)) continue;
    tried.add(w);
    const r = await cached(`wk:${w}`, 4 * WEEK, async () => {
      const page = await fetchPage(w);
      return page ? parseWiktionnaire(page.html, page.title) : null;
    });
    if (r?.entries.length) return r;
  }
  return null;
}

/** 机翻（缓存）：Google → MyMemory */
export function translateCached(text: string, sl: string, tl: string): Promise<string | null> {
  const t = text.trim();
  if (!t) return Promise.resolve(null);
  return cached(`tr:${sl}:${tl}:${t}`, 4 * WEEK, () => translate(t, sl, tl));
}

/**
 * 把几条释义拼成一段一起翻译（越长越准），再按行拆回每一条。
 * 行数对不上时（机翻合并了行）返回整段，由界面整段显示。
 */
export async function translateSenses(defs: string[], sl: string, tl: string): Promise<{ lines: string[] | null; whole: string | null }> {
  if (!defs.length) return { lines: null, whole: null };
  const whole = await translateCached(defs.map((d) => d.replace(/\n/g, ' ')).join('\n'), sl, tl);
  if (!whole) return { lines: null, whole: null };
  const lines = whole.split('\n').map((x) => x.trim()).filter(Boolean);
  return lines.length === defs.length ? { lines, whole } : { lines: null, whole };
}

/** 选中文字所在的那句话：从包含它的文本块里，按句末标点往两边扩 */
export function sentenceAround(block: string, start: number, end: number): string {
  const stop = /[.!?…;]/;
  let a = start;
  while (a > 0 && !stop.test(block[a - 1])) a--;
  let b = end;
  while (b < block.length && !stop.test(block[b])) b++;
  if (b < block.length) b++;
  return block.slice(a, b).replace(/\s+/g, ' ').trim();
}

/** 外部词典（手册里用的查词工具） */
export const externalLinks = (q: string) => [
  { label: 'Wiktionnaire', url: `https://fr.wiktionary.org/wiki/${encodeURIComponent(q.replace(/ /g, '_'))}` },
  { label: 'Le Robert', url: `https://dictionnaire.lerobert.com/definition/${encodeURIComponent(q.toLowerCase().replace(/ /g, '-'))}` },
  { label: 'WordReference', url: `https://www.wordreference.com/fren/${encodeURIComponent(q)}` },
  { label: 'Reverso', url: `https://context.reverso.net/traduction/francais-chinois/${encodeURIComponent(q.replace(/ /g, '+'))}` },
];
