// 翻译和发音都直连 Google（不需要服务器）。
// 发音：index.html 里设了 <meta name="referrer" content="no-referrer">，Google TTS 不会因来源页面拒绝请求；
// 依次尝试：同源代理 ./api/tts（CF Pages / Vercel 部署时随站点一起发布）→ 直连 Google → 浏览器自带语音。
const TIMEOUT = 8000;

export async function translate(text: string, sl: string, tl: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=${sl}&tl=${tl}&dt=t&dj=1&q=${encodeURIComponent(text)}`,
      { signal: ctrl.signal },
    );
    if (!r.ok) return null;
    const d = (await r.json()) as { sentences?: Array<{ trans?: string }> };
    return d.sentences?.map((s) => s.trans).filter(Boolean).join('') || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
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

function playUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (current) release(current);
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
