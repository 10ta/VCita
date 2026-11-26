// 翻译和发音都直连 Google（不需要服务器），翻译失败时退到 MyMemory。
import { db } from '../db/db';
// 发音：index.html 里设了 <meta name="referrer" content="no-referrer">，Google TTS 不会因来源页面拒绝请求；
// 依次尝试：同源代理 ./api/tts（CF Pages / Vercel 部署时随站点一起发布）→ 直连 Google → 浏览器自带语音。
const TIMEOUT = 8000;

/** 机翻：Google（越长越准）→ 失败时 MyMemory（匿名每天 5,000 字符，单次 500 字节以内） */
export async function translate(text: string, sl: string, tl: string): Promise<string | null> {
  return (await translateGoogle(text, sl, tl)) ?? (await translateMyMemory(text, sl, tl));
}

async function getJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function translateGoogle(text: string, sl: string, tl: string): Promise<string | null> {
  const d = await getJson<{ sentences?: Array<{ trans?: string }> }>(
    `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=${sl}&tl=${tl}&dt=t&dj=1&q=${encodeURIComponent(text)}`,
  );
  return d?.sentences?.map((s) => s.trans).filter(Boolean).join('') || null;
}

async function translateMyMemory(text: string, sl: string, tl: string): Promise<string | null> {
  if (new TextEncoder().encode(text).length > 500) return null;
  const d = await getJson<{ responseStatus?: number | string; responseData?: { translatedText?: string } }>(
    `https://api.mymemory.translated.net/get?langpair=${encodeURIComponent(`${sl}|${tl}`)}&q=${encodeURIComponent(text)}`,
  );
  const t = d?.responseData?.translatedText;
  // 额度用完时它返回 200 + 一段英文警告当译文
  return Number(d?.responseStatus) === 200 && t && !/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t) ? t : null;
}

// ---- 发音缓存 ----
// 同站代理 ./api/tts 能用时，音频先下载成 Blob 存进本机（db.audio），再播放：重听、下次再出现、离线都是零等待。
// 直连 Google 是跨域的（拿不到音频数据），那条路照旧直接播放、不缓存。
// 存最近用过的 AUDIO_MAX 条（一条约 10–30 KB，上限约 30–50 MB），超出时删最久没用的
export const AUDIO_MAX = 2000;
const audioKey = (text: string, lang: string) => `${lang}|${text}`;
/** 代理是否可用：null = 还没试过 */
let proxyOk: boolean | null = null;
const fetching = new Map<string, Promise<Blob | null>>();
let writes = 0;

async function cachedAudio(key: string): Promise<Blob | null> {
  try {
    const row = await db.audio.get(key);
    if (!row) return null;
    void db.audio.update(key, { at: Date.now() }).catch(() => {});
    return row.blob;
  } catch { return null; }
}
async function storeAudio(key: string, blob: Blob) {
  try {
    await db.audio.put({ key, blob, at: Date.now() });
    // 每写 50 条检查一次总数，超出时按最近使用时间删最旧的
    if (++writes % 50 === 0) {
      const n = await db.audio.count();
      if (n > AUDIO_MAX) await db.audio.orderBy('at').limit(n - AUDIO_MAX).delete();
    }
  } catch { /* 存不下（隐私模式、空间满）就不缓存 */ }
}
// 内存里再留最近的 MEM_MAX 条：一天里反复轮到的卡（学习、重学）连 IndexedDB 都不用读
const MEM_MAX = 300;
const mem = new Map<string, Blob>();
function remember(key: string, blob: Blob) {
  mem.delete(key);
  mem.set(key, blob);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value!);
}

// 同时最多 NET_MAX 个网络请求：预加载一次排好几张卡，并发太多容易被 Google 限流（429），反而全都要现下载。
// 要马上播的插队到最前面
const NET_MAX = 3;
let inFlight = 0;
const waiting: Array<{ run: () => void; urgent: boolean; key: string }> = [];
function slot(urgent: boolean, key: string): Promise<() => void> {
  return new Promise((resolve) => {
    const run = () => { inFlight++; resolve(() => { inFlight--; waiting.shift()?.run(); }); };
    if (inFlight < NET_MAX) run();
    else if (urgent) waiting.unshift({ run, urgent, key }); else waiting.push({ run, urgent, key });
  });
}

/** 经同站代理下载音频（内存 / 本机有就直接返回）。代理不可用（本地开发、没部署函数）返回 null，以后不再试 */
function fetchAudio(text: string, lang: string, urgent = true): Promise<Blob | null> {
  const key = audioKey(text, lang);
  const m = mem.get(key);
  if (m) { remember(key, m); return Promise.resolve(m); }
  const hit = fetching.get(key);
  if (hit) {
    // 预加载还在排队时轮到播放：把它提到队首
    if (urgent) { const i = waiting.findIndex((w) => w.key === key); if (i > 0) { const [w] = waiting.splice(i, 1); w.urgent = true; waiting.unshift(w); } }
    return hit;
  }
  const p = (async () => {
    const c = await cachedAudio(key);
    if (c) { remember(key, c); return c; }
    if (proxyOk === false) return null;
    const done = await slot(urgent, key);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const r = await fetch(sources[0](text, lang), { signal: ctrl.signal });
      const type = r.headers.get('content-type') ?? '';
      // 只有「代理不存在」才永久停用：404，或返回了网页（本地开发时是 index.html）。
      // Google 偶尔限流（429 / 5xx）只是这一次失败，下次照样走代理——以前一次限流就整场停用代理，之后经常没声音
      if (!r.ok || !type.startsWith('audio')) { if (r.status === 404 || (r.ok && !type.startsWith('audio'))) proxyOk = false; return null; }
      const blob = await r.blob();
      proxyOk = true;
      if (blob.size > 0) { remember(key, blob); void storeAudio(key, blob); }
      return blob.size > 0 ? blob : null;
    } catch { return null; } finally { clearTimeout(timer); done(); }
  })();
  fetching.set(key, p);
  void p.finally(() => fetching.delete(key));
  return p;
}

/** 提前下载一句的发音（这张卡的各面、接下来可能出的卡），播放时直接用内存 / 本机的。
 *  这一次没下成（限流、超时）隔 2 秒再试一次，免得轮到它时还要现下载 */
export function preloadSpeech(text: string, lang: string) {
  const t = text?.trim();
  if (!t || proxyOk === false) return;
  for (const part of splitForTts(t)) {
    void fetchAudio(part, lang, false).then((b) => {
      if (!b && proxyOk !== false) setTimeout(() => void fetchAudio(part, lang, false), 2000);
    });
  }
}

const sources = [
  (q: string, tl: string) => `./api/tts?q=${encodeURIComponent(q)}&tl=${encodeURIComponent(tl)}`,
  (q: string, tl: string) => `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(q)}`,
];
/** 第一个能用的来源，记住后不再逐个尝试 */
let working: number | null = null;
let current: HTMLAudioElement | null = null;

// 播完或被下一个替换时释放音源：否则"空格=播放/暂停"类浏览器扩展会抓住残留的音频，按空格时反复播放上一张卡
function release(a: HTMLAudioElement) {
  try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* 忽略 */ }
}

let currentBlobUrl: string | null = null;
/** 每次 speak / stopSpeech 加一：下载或等待声音列表期间被新的一次替换（换卡了），旧的就不再播放。
 *  否则上一张卡的音频下载得慢，会在本卡的音频开始之后才播出来，把本卡的顶掉 */
let gen = 0;

/** 停下正在读的（换卡时调用）：正在播放的、还在下载的、等用户按键再播的都作废 */
export function stopSpeech() {
  gen++;
  pendingAuto = null;
  if (current) { release(current); current = null; }
  try { globalThis.speechSynthesis?.cancel(); } catch { /* 忽略 */ }
}
/** 每个音频播完 / 出错 / 被替换时 resolve，长句分段时等上一段读完再读下一段 */
const endOf = new WeakMap<HTMLAudioElement, Promise<void>>();
function playUrl(url: string, blobUrl = false): Promise<HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    if (current) release(current);
    if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
    if (blobUrl) currentBlobUrl = url;
    const a = new Audio(url);
    current = a;
    let finish: () => void = () => {};
    endOf.set(a, new Promise<void>((r) => { finish = r; }));
    a.onended = () => { release(a); if (current === a) current = null; finish(); };
    a.onpause = () => { if (a.ended || !a.getAttribute('src')) finish(); };
    a.onerror = () => { finish(); reject(new Error('audio error')); };
    a.play().then(() => resolve(a), (e) => { finish(); reject(e); });
  });
}

/** Google TTS 一次最多约 200 字符：长句按句号、逗号切成几段依次读（以前超过 200 字直接退到浏览器自带语音，没有法语声音时就没声） */
export function splitForTts(text: string, max = 180): string[] {
  const t = text.trim();
  if (t.length <= max) return [t];
  const out: string[] = [];
  let rest = t;
  while (rest.length > max) {
    const win = rest.slice(0, max + 1);
    let cut = -1;
    for (const re of [/[.!?…»]\s/g, /[;:]\s/g, /,\s/g, /\s/g]) {
      let m: RegExpExecArray | null; let last = -1;
      while ((m = re.exec(win))) last = m.index + 1;
      if (last > max * 0.4) { cut = last; break; }
    }
    if (cut < 0) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** 浏览器自带语音：必须找到对应语言的声音才读。刚打开页面时声音列表还是空的，等它加载（最多 1.5 秒）；
 *  找不到就不读——否则会用默认的英语声音去读法语 */
async function speakNative(text: string, lang: string, my: number) {
  const s = globalThis.speechSynthesis;
  if (!s) return;
  let voices = s.getVoices();
  if (!voices.length) {
    voices = await new Promise<SpeechSynthesisVoice[]>((res) => {
      const done = () => res(s.getVoices());
      s.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1500);
    });
  }
  if (my !== gen) return;
  const base = lang.toLowerCase().split('-')[0];
  const voice = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base);
  if (!voice) return;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice.lang;
  u.voice = voice;
  // Chrome：cancel 之后立刻 speak 偶尔会被吞掉，隔一下再读
  setTimeout(() => { if (my === gen) s.speak(u); }, 60);
}

/**
 * 刷新页面后、用户还没点过或按过任何键时，浏览器不允许自动播放声音（NotAllowedError）。
 * 这时不换来源、也不退回自带语音，而是记下来，等用户第一次按键 / 点击时再播。
 */
let pendingAuto: { text: string; lang: string } | null = null;
// 模块加载时就注册（早于复习页的快捷键监听，后者会拦住按键事件）
const onGesture = () => {
  const p = pendingAuto;
  pendingAuto = null;
  if (p) void speak(p.text, p.lang);
};
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onGesture, true);
  window.addEventListener('pointerdown', onGesture, true);
}
const playAfterGesture = (text: string, lang: string) => { pendingAuto = { text, lang }; };

type One = 'ok' | 'pending' | 'fail' | 'stale';
/** 读一段（≤ 200 字）：本机缓存 / 同站代理 → 直连来源。返回是否开始播放 */
async function speakOne(text: string, lang: string, my: number): Promise<One> {
  if (proxyOk !== false) {
    const blob = await fetchAudio(text, lang);
    if (my !== gen) return 'stale';
    if (blob) {
      try {
        await playUrl(URL.createObjectURL(blob), true);
        working = 0;
        return 'ok';
      } catch (e) {
        const name = (e as Error).name;
        if (name === 'AbortError') return 'stale';
        if (name === 'NotAllowedError') return 'pending';
        // 本机缓存的音频坏了（解码失败）：删掉，下面从网络重来，下次也会重新下载
        mem.delete(audioKey(text, lang));
        try { await db.audio.delete(audioKey(text, lang)); } catch { /* 忽略 */ }
      }
    }
  }
  const order = working === null ? sources.map((_, i) => i) : [working, ...sources.map((_, i) => i).filter((i) => i !== working)];
  for (const i of order) {
    if (my !== gen) return 'stale';
    try {
      await playUrl(sources[i](text, lang));
      working = i;
      return 'ok';
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'AbortError') return 'stale'; // 被下一次播放打断，不算失败
      if (name === 'NotAllowedError') return 'pending'; // 来源没问题，只是还不允许自动播放
    }
  }
  return 'fail';
}

export async function speak(text: string, lang: string) {
  if (!text) return;
  pendingAuto = null;
  const my = ++gen;
  const parts = splitForTts(text);
  for (let k = 0; k < parts.length; k++) {
    const r = await speakOne(parts[k], lang, my);
    if (r === 'stale') return;
    if (r === 'pending') return playAfterGesture(text, lang);
    if (r === 'fail') {
      if (my !== gen) return;
      working = null;
      // 网络来源都不行：剩下的整段交给浏览器自带语音
      return speakNative(parts.slice(k).join(' '), lang, my);
    }
    // 长句：等这一段读完再读下一段
    if (k < parts.length - 1 && current) { await endOf.get(current); if (my !== gen) return; }
  }
}
