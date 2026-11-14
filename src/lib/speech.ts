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
/** 经同站代理下载音频（本机有就直接返回）。代理不可用（本地开发、没部署函数）返回 null，以后不再试 */
function fetchAudio(text: string, lang: string): Promise<Blob | null> {
  const key = audioKey(text, lang);
  const hit = fetching.get(key);
  if (hit) return hit;
  const p = (async () => {
    const c = await cachedAudio(key);
    if (c) return c;
    if (proxyOk === false) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const r = await fetch(sources[0](text, lang), { signal: ctrl.signal });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !type.startsWith('audio')) { if (r.status === 404 || !type.startsWith('audio')) proxyOk = false; return null; }
      const blob = await r.blob();
      proxyOk = true;
      if (blob.size > 0) void storeAudio(key, blob);
      return blob.size > 0 ? blob : null;
    } catch { return null; } finally { clearTimeout(timer); }
  })();
  fetching.set(key, p);
  void p.finally(() => fetching.delete(key));
  return p;
}
/** 提前下载一句的发音（下一张卡、翻面后要读的答案），播放时直接用本机的 */
export function preloadSpeech(text: string, lang: string) {
  const t = text?.trim();
  if (!t || t.length > 200 || proxyOk === false) return;
  void fetchAudio(t, lang);
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
function playUrl(url: string, blobUrl = false): Promise<void> {
  return new Promise((resolve, reject) => {
    if (current) release(current);
    if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
    if (blobUrl) currentBlobUrl = url;
    const a = new Audio(url);
    current = a;
    a.onended = () => { release(a); if (current === a) current = null; };
    a.onerror = () => reject(new Error('audio error'));
    a.play().then(resolve, reject);
  });
}

/** 浏览器自带语音：必须找到对应语言的声音才读。刚打开页面时声音列表还是空的，等它加载（最多 1.5 秒）；
 *  找不到就不读——否则会用默认的英语声音去读法语 */
async function speakNative(text: string, lang: string) {
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
  const base = lang.toLowerCase().split('-')[0];
  const voice = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base);
  if (!voice) return;
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice.lang;
  u.voice = voice;
  s.speak(u);
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

export async function speak(text: string, lang: string) {
  if (!text) return;
  pendingAuto = null;
  // 先走本机缓存 / 同站代理下载（能缓存）；拿不到再按原来的顺序直接播放
  if (proxyOk !== false && text.length <= 200) {
    const blob = await fetchAudio(text, lang);
    if (blob) {
      try {
        await playUrl(URL.createObjectURL(blob), true);
        working = 0;
        return;
      } catch (e) {
        const name = (e as Error).name;
        if (name === 'AbortError') return;
        if (name === 'NotAllowedError') return playAfterGesture(text, lang);
      }
    }
  }
  const order = working === null ? sources.map((_, i) => i) : [working];
  for (const i of order) {
    try {
      await playUrl(sources[i](text, lang));
      working = i;
      return;
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'AbortError') return; // 被下一次播放打断，不算失败
      if (name === 'NotAllowedError') return playAfterGesture(text, lang); // 来源没问题，只是还不允许自动播放
    }
  }
  working = null;
  await speakNative(text, lang);
}
