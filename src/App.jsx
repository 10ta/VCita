import { useState, useEffect, useRef, useMemo } from "react";

const INIT_SRC = __SOURCE_LANG__;
const INIT_T1 = __TARGET_LANG_1__;
const INIT_T2 = __TARGET_LANG_2__;
const INIT_SHOW_SRC = __SHOW_SOURCE__;
const INIT_SHOW_T1 = __SHOW_TARGET_1__;
const INIT_SHOW_T2 = __SHOW_TARGET_2__;
const PAGE_SIZES = __PAGE_SIZES__;
const DEFAULT_PAGE_SIZE = __DEFAULT_PAGE_SIZE__;
const INIT_AUTO_ADD = __AUTO_PLAY_ADD__;
const INIT_AUTO_REVIEW = __AUTO_PLAY_REVIEW__;

// ─── 复习调度配置（在 vite.config.js 中修改；旧版配置没有这一项时用默认值）───
const SRS = {
  newPerDay: 20,
  reviewsPerDay: 200,
  newCardPosition: "mix",   // mix | first | last
  reviewOrder: "due",       // due | random
  relearnInSession: true,
  startingEase: 2.5,
  easyBonus: 1.3,
  hardFactor: 1.2,
  maxInterval: 3650,
  ...(typeof __SRS_CONFIG__ !== "undefined" ? __SRS_CONFIG__ : {}),
};
const MIN_EASE = 1.3;

// ─── 性能参数 ───
const WRITE_CONCURRENCY = 8;           // 导入、删除用户时的并发请求数
const SYNC_CHUNK = 100;                // 一次 sync 请求最多携带的日文件数
const SAVE_DEBOUNCE_MS = 400;          // 修改后合并落盘的等待时间
const SAVE_MAX_WAIT_MS = 2000;         // 连续修改时最长等待，避免一直不落盘
const REMOTE_REFRESH_MIN_GAP_MS = 30000; // 保存后发现远端有改动时，自动刷新的最小间隔
const TRANSLATE_TIMEOUT_MS = 8000;
const UNDO_LIMIT = 20;

const LANGS = [
  { code: "zh-CN", label: "中文" }, { code: "ja", label: "日本語" }, { code: "ko", label: "한국어" },
  { code: "en", label: "English" }, { code: "fr", label: "Français" }, { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" }, { code: "pt", label: "Português" }, { code: "ru", label: "Русский" },
  { code: "ar", label: "العربية" }, { code: "it", label: "Italiano" }, { code: "nl", label: "Nederlands" },
];
const LN = Object.fromEntries(LANGS.map(l => [l.code, l.label]));

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const addDays = (ds, n) => { const d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const fmtShort = ds => ds.slice(2).replace(/-/g, "");
const dateToDayPath = (userId, ds) => { const [y, m, d] = ds.split("-"); return `users/${userId}/${y.slice(2)}${m}/${m}${d}.json`; };
const userMetaPath = uid => `users/${uid}/meta.json`;
const dayDiff = dateStr => daysBetween(todayStr(), dateStr);
const fmtIvl = d => d < 30 ? `${d}天` : d < 365 ? `${+(d / 30).toFixed(1)}月` : `${+(d / 365).toFixed(1)}年`;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ═══ SM-2 调度 ═══
// 卡片字段：state(new|review) interval(天) ease due(YYYY-MM-DD) lapses reps lastReview
// reviewHistory 每条：{ date, rating(1-4), remembered, interval, wasNew? }
const RATINGS = [
  { r: 1, label: "重来", color: "#f87171", bg: "#dc262622", bd: "#dc262655" },
  { r: 2, label: "困难", color: "#fb923c", bg: "#ea580c22", bd: "#ea580c55" },
  { r: 3, label: "良好", color: "#4ade80", bg: "#16a34a22", bd: "#16a34a55" },
  { r: 4, label: "简单", color: "#60a5fa", bg: "#2563eb22", bd: "#2563eb55" },
];
const ratingColor = r => (RATINGS.find(x => x.r === r) || RATINGS[2]).color;

// 间隔 ≥3 天时加 ±5% 随机抖动，避免同一天加的卡永远挤在同一天到期
const fuzzIvl = ivl => {
  if (ivl < 3) return ivl;
  const f = Math.max(1, Math.round(ivl * 0.05));
  return Math.min(SRS.maxInterval, ivl - f + Math.floor(Math.random() * (2 * f + 1)));
};

// 四个评分各自对应的下次间隔（不含抖动），按钮上显示的就是它
const previewIntervals = (card, today) => {
  if (card.state !== "review") return { 1: 1, 2: 1, 3: 1, 4: 4 };
  const ease = card.ease || SRS.startingEase;
  const cur = Math.max(1, card.interval || 1);
  const delay = Math.max(0, daysBetween(card.due || today, today)); // 逾期天数，逾期越久说明记得越牢
  const cap = v => Math.min(SRS.maxInterval, v);
  const hard = cap(Math.max(cur + 1, Math.round((cur + delay / 4) * SRS.hardFactor)));
  const good = cap(Math.max(hard + 1, Math.round((cur + delay / 2) * ease)));
  const easy = cap(Math.max(good + 1, Math.round((cur + delay) * ease * SRS.easyBonus)));
  return { 1: 1, 2: hard, 3: good, 4: easy };
};

const schedule = (card, rating, today, { fuzz = true } = {}) => {
  const wasNew = card.state !== "review";
  let ease = card.ease || SRS.startingEase;
  let lapses = card.lapses || 0;
  let ivl = previewIntervals(card, today)[rating];
  if (!wasNew) {
    if (rating === 1) { lapses += 1; ease -= 0.2; }
    else if (rating === 2) ease -= 0.15;
    else if (rating === 4) ease += 0.15;
  }
  ease = Math.max(MIN_EASE, Math.round(ease * 100) / 100);
  if (fuzz && rating > 1) ivl = fuzzIvl(ivl);
  const due = addDays(today, ivl);
  const entry = { date: today, rating, remembered: rating > 1, interval: ivl, ...(wasNew ? { wasNew: true } : {}) };
  return {
    ...card, state: "review", interval: ivl, ease, due, nextReview: due,
    lapses, reps: (card.reps || 0) + 1, lastReview: today,
    reviewHistory: [...(card.reviewHistory || []), entry],
  };
};

const newCardFields = date => ({ state: "new", interval: 0, ease: SRS.startingEase, due: date, nextReview: date, lapses: 0, reps: 0, lastReview: null });
const resetSrs = card => ({ ...card, ...newCardFields(card.createdAt), reviewHistory: [] });

// 旧版（固定艾宾浩斯日程）卡片 → SM-2：按历史记录逐条回放，绿=良好、红=重来
const migrateCard = card => {
  if (card.state) return null;
  const hist = (card.reviewHistory || []).filter(h => h && typeof h.date === "string").sort((a, b) => a.date.localeCompare(b.date));
  let c = { ...card, ...newCardFields(card.createdAt), reviewHistory: [] };
  for (const h of hist) c = schedule(c, h.remembered ? 3 : 1, h.date, { fuzz: false });
  c.reviewHistory = hist.map(h => ({ ...h, rating: h.rating || (h.remembered ? 3 : 1) }));
  if (hist.length && c.interval >= 3) { c.interval = fuzzIvl(c.interval); c.due = c.nextReview = addDays(c.lastReview, c.interval); }
  delete c.reviewStage;
  return c;
};

const redCountOf = card => (card.reviewHistory || []).filter(h => !h.remembered).length;
const isDueReview = (card, date) => card.state === "review" && card.due <= date;

// 某牌组某天已学的新卡数、已复习数（用于每日上限）
const studiedOn = (cards, deckId, date) => {
  let newDone = 0, revDone = 0;
  for (const c of cards) {
    if (c.deckId !== deckId) continue;
    for (const h of c.reviewHistory || []) if (h.date === date && h.rating) { if (h.wasNew) newDone++; else revDone++; }
  }
  return { newDone, revDone };
};
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// 按每日上限挑出今天要学的卡
const pickSession = (cards, deckId, date) => {
  const { newDone, revDone } = studiedOn(cards, deckId, date);
  let revs = cards.filter(c => c.deckId === deckId && isDueReview(c, date));
  revs = SRS.reviewOrder === "random" ? shuffle(revs) : revs.sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id));
  const news = cards.filter(c => c.deckId === deckId && c.state !== "review" && c.createdAt <= date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return {
    revs: revs.slice(0, Math.max(0, SRS.reviewsPerDay - revDone)),
    news: news.slice(0, Math.max(0, SRS.newPerDay - newDone)),
    dueTotal: revs.length, newTotal: news.length, newDone, revDone,
  };
};
const mergeSession = (revs, news) => {
  if (SRS.newCardPosition === "first") return [...news, ...revs];
  if (SRS.newCardPosition === "last" || !news.length) return [...revs, ...news];
  const out = [];
  const gap = Math.max(1, Math.floor(revs.length / news.length));
  let ni = 0;
  revs.forEach((c, i) => { out.push(c); if ((i + 1) % gap === 0 && ni < news.length) out.push(news[ni++]); });
  while (ni < news.length) out.push(news[ni++]);
  return out;
};

// ─── 并发工具 ───
const mapPool = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};
const withRetry = async (fn, times = 2) => {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= times || /返回的是网页/.test(e.message)) throw e; await new Promise(r => setTimeout(r, 300 * (i + 1))); }
  }
};

// ─── Logging（内存缓冲，1 秒合并写一次 localStorage）───
const LOG_KEY = "vf_logs";
let logBuf = null, logTimer = null;
const getLogBuf = () => {
  if (!logBuf) { try { logBuf = JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { logBuf = []; } }
  return logBuf;
};
const persistLogs = () => { logTimer = null; try { localStorage.setItem(LOG_KEY, JSON.stringify(getLogBuf())); } catch { } };
const log = (level, msg, data) => {
  const logs = getLogBuf();
  logs.push({ ts: new Date().toISOString(), level, msg, ...(data ? { data } : {}) });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  if (!logTimer) logTimer = setTimeout(persistLogs, 1000);
  if (level === "error") console.error(`[VF] ${msg}`, data);
  else if (level !== "debug") console.log(`[VF] ${msg}`, data || "");
};
const exportLogs = () => {
  if (logTimer) { clearTimeout(logTimer); persistLogs(); }
  const blob = new Blob([JSON.stringify(getLogBuf())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `vf-logs-${todayStr()}.json`; a.click();
  URL.revokeObjectURL(url);
};

// ─── TTS ───
const BASE = import.meta.env.BASE_URL;
// 同一时间只保留一个音频；播完或被下一个替换时释放音源。
// 否则"空格=播放/暂停"类浏览器扩展会抓住残留的音频对象，按空格时反复播放上一张卡的发音。
let currentAudio = null;
const releaseAudio = a => { try { a.pause(); a.removeAttribute("src"); a.load(); } catch { } };
const speak = (text, lang) => {
  if (!text) return;
  if (currentAudio) releaseAudio(currentAudio);
  const audio = new Audio(`${BASE}api/tts?q=${encodeURIComponent(text)}&tl=${lang}`);
  currentAudio = audio;
  audio.onended = () => { releaseAudio(audio); if (currentAudio === audio) currentAudio = null; };
  audio.play().catch(e => { if (e.name !== "AbortError") log("error", "TTS failed", { text, lang, error: e.message }); });
};

// ─── File API ───
// 同一路径的写/删严格按调用顺序执行，避免后发先至
const pathChains = new Map();
const serialByPath = (p, fn) => {
  const run = (pathChains.get(p) || Promise.resolve()).catch(() => { }).then(fn);
  pathChains.set(p, run);
  run.finally(() => { if (pathChains.get(p) === run) pathChains.delete(p); }).catch(() => { });
  return run;
};
// 统一解析接口响应。服务端没有对应接口时，Vite 会把请求当成页面访问返回 index.html，这里给出明确提示。
const parseApiResponse = async (r, url) => {
  const text = await r.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error(`接口 ${url} 返回的是网页而不是数据（HTTP ${r.status}）。服务端仍在运行旧版 vite.config.js：请确认新的 vite.config.js 已替换到项目根目录，并重启 Vite。`);
  }
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`接口 ${url} 返回了无法解析的内容（HTTP ${r.status}）`); }
  if (!r.ok) throw new Error(`接口 ${url} 出错（HTTP ${r.status}）：${j?.error || text.slice(0, 200)}`);
  return j;
};
const postJSON = async (url, body) => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return parseApiResponse(r, url);
};
const getJSON = async url => parseApiResponse(await fetch(url, { cache: "no-store" }), url);
const api = {
  write: (p, data) => serialByPath(p, async () => {
    log("debug", "api.write", { path: p });
    return postJSON(`${BASE}api/write`, { path: p, data: typeof data === "string" ? data : JSON.stringify(data, null, 2) });
  }),
  del: p => serialByPath(p, async () => {
    log("debug", "api.delete", { path: p });
    return postJSON(`${BASE}api/delete`, { path: p });
  }),
  async read(p) {
    const j = await postJSON(`${BASE}api/read`, { path: p });
    if (!j.exists) return null;
    try { return JSON.parse(j.data); } catch { return j.data; }
  },
  async list() { return (await getJSON(`${BASE}api/list`)).files || []; },
  // ─── 批量接口（vite.config.js 中实现）───
  snapshot: uid => getJSON(`${BASE}api/snapshot${uid ? `?uid=${encodeURIComponent(uid)}` : ""}`),
  rev: uid => getJSON(`${BASE}api/rev?uid=${encodeURIComponent(uid)}`),
  sync: (uid, files) => postJSON(`${BASE}api/sync`, { uid, files }),
};

const GLOBAL_KEY = "global.json";
const defaultGlobal = () => ({ users: [{ id: "default", name: "Default" }], activeUser: "default" });
const defaultMeta = () => ({ decks: [{ id: "default", name: "Default", createdAt: Date.now() }], sourceLang: INIT_SRC, targetLang1: INIT_T1, targetLang2: INIT_T2 });
const normalizeMeta = m => {
  const x = m && typeof m === "object" && Array.isArray(m.decks) ? m : defaultMeta();
  if (!x.sourceLang) x.sourceLang = INIT_SRC;
  if (!x.targetLang1) x.targetLang1 = INIT_T1;
  if (!x.targetLang2) x.targetLang2 = INIT_T2;
  return x;
};
const saveGlobal = g => api.write(GLOBAL_KEY, g);
const loadUserMeta = async uid => normalizeMeta(await api.read(userMetaPath(uid)));
const saveUserMeta = (uid, m) => api.write(userMetaPath(uid), m);
const isDayFileOf = (uid, f) => f.startsWith(`users/${uid}/`) && !f.endsWith("meta.json");

// 一个请求拿到 global + meta + 该用户所有日文件（uid 为空时由服务端取 activeUser）。
// 顺带：检测"卡片所在文件与 createdAt 不符"或"同一 id 出现在多处"；把旧版卡片升级到 SM-2。
// 需要改动的文件交给 sync 自动写回。
const loadSnapshot = async uidOrNull => {
  const t0 = performance.now();
  const snap = await withRetry(() => api.snapshot(uidOrNull));
  const uid = snap.uid;
  const global = snap.global && Array.isArray(snap.global.users) ? snap.global : defaultGlobal();
  const meta = normalizeMeta(snap.meta);
  const files = snap.files || {};
  const dayFiles = Object.keys(files).filter(f => isDayFileOf(uid, f)).sort();
  const byId = new Map();
  const occurrences = [];
  const repair = new Set();
  for (const f of dayFiles) {
    const arr = files[f];
    if (!Array.isArray(arr)) continue;
    const seenHere = new Set();
    for (const c of arr) {
      if (!c || !c.id || typeof c.createdAt !== "string") continue;
      if (seenHere.has(c.id)) repair.add(f);
      seenHere.add(c.id);
      occurrences.push({ id: c.id, file: f });
      const matched = dateToDayPath(uid, c.createdAt) === f;
      const prev = byId.get(c.id);
      if (!prev) { byId.set(c.id, { card: c, matched }); continue; }
      const better = (matched && !prev.matched) ||
        (matched === prev.matched && (c.reviewHistory || []).length > (prev.card.reviewHistory || []).length);
      if (better) byId.set(c.id, { card: c, matched });
    }
  }
  const drops = new Map();
  for (const { id, file } of occurrences) {
    const target = dateToDayPath(uid, byId.get(id).card.createdAt);
    if (file !== target) {
      if (!drops.has(file)) drops.set(file, new Set());
      drops.get(file).add(id);
      repair.add(file); repair.add(target);
    }
  }
  let migrated = 0;
  const cards = [...byId.values()].map(v => {
    const m = migrateCard(v.card);
    if (!m) return v.card;
    migrated++;
    repair.add(dateToDayPath(uid, m.createdAt));
    return m;
  });
  log("info", "loadSnapshot", { uid, files: dayFiles.length, cards: cards.length, migrated, repair: repair.size, ms: Math.round(performance.now() - t0) });
  return { uid, global, rev: snap.rev, meta, cards, dayFiles, migrated, repairPaths: [...repair], repairDrops: drops };
};

const gTranslate = async (text, sl, tl) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TRANSLATE_TIMEOUT_MS);
  try {
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=${sl}&tl=${tl}&dt=t&dj=1&q=${encodeURIComponent(text)}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return d.sentences?.map(s => s.trans).filter(Boolean).join("") || null;
  } catch (e) {
    log("error", "translate failed", { text, sl, tl, error: e.name === "AbortError" ? "timeout" : e.message });
    return null;
  } finally { clearTimeout(timer); }
};

const I = {
  Plus: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  Check: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>,
  X: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  Download: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  Trash: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>,
  Folder: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>,
  Edit: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
  User: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  ChevronDown: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>,
  Book: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>,
  PlusCircle: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>,
  RefreshCw: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>,
  Layers: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>,
  Save: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>,
  Speaker: ({ size = 13 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 010 14.14" /><path d="M15.54 8.46a5 5 0 010 7.07" /></svg>,
  Rotate: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" /></svg>,
  ArrowUp: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>,
  ArrowDown: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>,
  Flame: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z" /></svg>,
  Tag: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>,
  Undo: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 00-4-4H4" /></svg>,
};

// Rotation display helper
const getCardDisplay = (card, meta) => {
  const rot = (card.rot || 0) % 3;
  const texts = [card.word, card.translation, card.translation2];
  const langs = [meta.sourceLang, meta.targetLang1, meta.targetLang2];
  return { src: texts[rot], t1: texts[(rot + 1) % 3], t2: texts[(rot + 2) % 3], srcL: langs[rot], t1L: langs[(rot + 1) % 3], t2L: langs[(rot + 2) % 3] };
};

// ─── 小组件放在 App 外部：否则每次渲染都是新组件类型，会被卸载重建 ───
const LangSelect = ({ value, onChange }) => <select style={S.langSel} value={value} onChange={e => onChange(e.target.value)}>{LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select>;
const DateInput = ({ value, onChange, style: sx }) => <input type="date" value={value} onChange={e => e.target.value && onChange(e.target.value)} style={{ ...S.dateInput, ...sx }} />;

// 卡片调度状态：下次复习、间隔、难度系数、遗忘次数，以及最近 10 次评分色块
const CardStats = ({ card, center }) => {
  const chip = (txt, color, title) => (
    <span key={title} title={title} style={{ fontFamily: mono, fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "#1c1c20", color, lineHeight: 1.3, whiteSpace: "nowrap" }}>{txt}</span>
  );
  const hist = (card.reviewHistory || []).slice(-10);
  const strip = hist.length > 0 && (
    <span key="h" style={{ display: "inline-flex", gap: 2, alignItems: "center", marginLeft: 2 }}>
      {hist.map((h, i) => <span key={i} title={`${h.date} · ${(RATINGS.find(x => x.r === h.rating) || {}).label || (h.remembered ? "记得" : "忘记")}`}
        style={{ width: 6, height: 10, borderRadius: 1, background: ratingColor(h.rating || (h.remembered ? 3 : 1)), opacity: 0.85 }} />)}
    </span>
  );
  const wrap = { display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center", justifyContent: center ? "center" : "flex-start" };
  if (card.state !== "review") return <div style={wrap}>{chip("新卡", "#60a5fa", "尚未学习")}{strip}</div>;
  const diff = dayDiff(card.due);
  const dueTxt = diff < 0 ? `逾期${-diff}天` : diff === 0 ? "今天到期" : `${diff}天后`;
  return (
    <div style={wrap}>
      {chip(`${dueTxt} · ${fmtShort(card.due)}`, diff <= 0 ? accent : "#aaa", `下次复习 ${card.due}`)}
      {chip(`间隔 ${fmtIvl(card.interval || 0)}`, "#999", "上次复习到下次复习之间隔多久")}
      {chip(`倍率 ×${(card.ease || SRS.startingEase).toFixed(2)}`, (card.ease || SRS.startingEase) < 2 ? "#fb923c" : "#999", "答“良好”时，下次间隔 = 当前间隔 × 倍率。越低说明越难记")}
      {(card.lapses || 0) > 0 && chip(`遗忘${card.lapses}次`, "#f87171", "复习时点了“重来”的次数")}
      {strip}
    </div>
  );
};

export default function App() {
  const [global, setGlobal] = useState(null);
  const [meta, setMeta] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [syncState, setSyncState] = useState("idle"); // idle | pending | saving | error
  const [view, setView] = useState("home");
  const [activeDeck, setActiveDeck] = useState("default");
  const [newWord, setNewWord] = useState("");
  const [addDate, setAddDate] = useState(todayStr());
  const [translatingIds, setTranslatingIds] = useState(new Set());
  // Review：队列只存 { id, retry }，卡片内容始终从内存读取
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewPos, setReviewPos] = useState(0);
  const [reviewRevealed, setReviewRevealed] = useState(false);
  const [reviewDate, setReviewDate] = useState(todayStr());
  const [reviewAutoPlay, setReviewAutoPlay] = useState(INIT_AUTO_REVIEW);
  const [reviewQuizType, setReviewQuizType] = useState(0);
  const [undoCount, setUndoCount] = useState(0);
  //
  const [newDeckName, setNewDeckName] = useState("");
  const [showDeckModal, setShowDeckModal] = useState(false);
  const [renameDeckId, setRenameDeckId] = useState(null);
  const [renameDeckVal, setRenameDeckVal] = useState("");
  const [deleteDeckConfirm, setDeleteDeckConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [editingCard, setEditingCard] = useState(null);
  const [editT0, setEditT0] = useState("");
  const [editT1, setEditT1] = useState("");
  const [editT2, setEditT2] = useState("");
  const [dayFiles, setDayFiles] = useState([]);
  const [deckExpanded, setDeckExpanded] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [showUserModal, setShowUserModal] = useState(false);
  const [deleteUserConfirm, setDeleteUserConfirm] = useState(null);
  const [exportUsers, setExportUsers] = useState(new Set());
  const [autoPlay, setAutoPlay] = useState(INIT_AUTO_ADD);
  // Intensive（强化练习，不改变排期）
  const [intensiveQueue, setIntensiveQueue] = useState([]);
  const [intensivePos, setIntensivePos] = useState(0);
  const [intensiveRevealed, setIntensiveRevealed] = useState(false);
  const [showSrc, setShowSrc] = useState(INIT_SHOW_SRC);
  const [showT1, setShowT1] = useState(INIT_SHOW_T1);
  const [showT2, setShowT2] = useState(INIT_SHOW_T2);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(0);
  const [canScroll, setCanScroll] = useState(false);
  const [filterDate, setFilterDate] = useState("");
  const [filterKeyword, setFilterKeyword] = useState("");
  const [clearTagConfirm, setClearTagConfirm] = useState(false);
  const [batchDateModal, setBatchDateModal] = useState(false);
  const [batchDateVal, setBatchDateVal] = useState(todayStr());
  // Tags
  const [addTags, setAddTags] = useState(new Set());
  const [newTagInput, setNewTagInput] = useState("");
  const [batchTagModal, setBatchTagModal] = useState(false);
  const [batchTagInput, setBatchTagInput] = useState("");
  const [singleTagCard, setSingleTagCard] = useState(null);
  const [intensiveMode, setIntensiveMode] = useState("hard"); // "hard" | "tag:xxx"
  const [showHelp, setShowHelp] = useState(false);
  const inputRef = useRef(null);

  // ─── Store：内存是唯一数据源，所有读取都走 cardsRef，写入先改内存再后台落盘 ───
  const cardsRef = useRef([]);
  const globalRef = useRef(null);
  const storeUidRef = useRef(null);
  const dirtyRef = useRef(new Set());     // 待落盘的日文件路径
  const leftRef = useRef(new Map());      // path -> Set(id)：已移出该文件或已删除，需要服务端从该文件剔除
  const revRef = useRef(null);            // 服务端数据版本号
  const remoteChangedRef = useRef(false); // 发现其他设备改过数据
  const lastRefreshAtRef = useRef(0);
  const flushTimerRef = useRef(null);
  const firstDirtyAtRef = useRef(0);
  const flushChainRef = useRef(Promise.resolve());
  const flushingRef = useRef(false);
  const retryDelayRef = useRef(2000);
  const mutationSeqRef = useRef(0);
  const toastTimerRef = useRef(null);
  const bootedRef = useRef(false);
  const todayAtHideRef = useRef(todayStr());
  const undoRef = useRef([]);             // 复习撤销栈：{ before: 作答前的卡片 | null, queue, pos }
  const keyHandlerRef = useRef(null);
  const handledKeysRef = useRef(new Set());
  const latestRef = useRef({});
  latestRef.current = { view, reviewDate, addDate, activeDeck };

  const uid = () => storeUidRef.current || "default";
  const getLatest = id => cardsRef.current.find(c => c.id === id);
  const hasUnsaved = () => dirtyRef.current.size > 0 || flushingRef.current;

  const showToast = msg => {
    clearTimeout(toastTimerRef.current);
    setToast({ msg, key: Date.now() + Math.random() });
    toastTimerRef.current = setTimeout(() => setToast(null), 2200);
  };

  const setGlobalBoth = g => { globalRef.current = g; setGlobal(g); };

  const addLeft = (p, id) => { let set = leftRef.current.get(p); if (!set) leftRef.current.set(p, set = new Set()); set.add(id); };
  // 服务端每次写都会返回 prevRev/rev；prevRev 与本地记录不一致说明中间有别的设备写过
  const noteRev = r => {
    if (!r || !r.rev || r.uid !== storeUidRef.current) return;
    if (revRef.current && r.prevRev !== revRef.current) remoteChangedRef.current = true;
    revRef.current = r.rev;
  };

  const commitCards = next => { cardsRef.current = next; mutationSeqRef.current++; setCards(next); };

  const markDirty = paths => {
    let added = false;
    for (const p of paths) if (p) { dirtyRef.current.add(p); added = true; }
    if (!added) return;
    const now = Date.now();
    if (!firstDirtyAtRef.current) firstDirtyAtRef.current = now;
    setSyncState(s => (s === "error" || s === "saving") ? s : "pending");
    clearTimeout(flushTimerRef.current);
    const wait = now - firstDirtyAtRef.current >= SAVE_MAX_WAIT_MS ? 0 : SAVE_DEBOUNCE_MS;
    flushTimerRef.current = setTimeout(() => flushNow(), wait);
  };

  // 插入或替换卡片（按 id）。createdAt 变化时旧文件也会被标记，自动完成跨文件移动。
  const upsertCards = list => {
    if (!list.length) return;
    const u = storeUidRef.current;
    const next = cardsRef.current.slice();
    const idx = new Map(next.map((c, i) => [c.id, i]));
    const paths = [];
    for (const card of list) {
      const i = idx.get(card.id);
      const newPath = dateToDayPath(u, card.createdAt);
      if (i !== undefined) {
        const oldPath = dateToDayPath(u, next[i].createdAt);
        if (oldPath !== newPath) { addLeft(oldPath, card.id); paths.push(oldPath); }
        next[i] = card;
      } else { idx.set(card.id, next.length); next.push(card); }
      paths.push(newPath);
      leftRef.current.get(newPath)?.delete(card.id);
    }
    commitCards(next);
    markDirty(paths);
  };

  const removeCards = ids => {
    const idSet = new Set(ids);
    if (!idSet.size) return;
    const u = storeUidRef.current;
    const paths = [];
    const next = cardsRef.current.filter(c => {
      if (!idSet.has(c.id)) return true;
      const p = dateToDayPath(u, c.createdAt);
      paths.push(p);
      addLeft(p, c.id);
      return false;
    });
    commitCards(next);
    markDirty(paths);
  };

  // 落盘：所有脏文件合并成一个 /api/sync 请求，服务端在写锁内完成"读-合并-写"
  const doFlush = async () => {
    clearTimeout(flushTimerRef.current);
    const u = storeUidRef.current;
    if (!u || dirtyRef.current.size === 0) return;
    const paths = [...dirtyRef.current];
    dirtyRef.current.clear();
    firstDirtyAtRef.current = 0;
    const own = paths.filter(p => p.startsWith(`users/${u}/`));
    if (own.length !== paths.length) log("error", "dropping dirty paths of another user", { paths: paths.filter(p => !own.includes(p)) });
    if (!own.length) { setSyncState("idle"); return; }

    flushingRef.current = true;
    setSyncState(s => s === "error" ? s : "saving");
    const t0 = performance.now();
    const byPath = new Map(own.map(p => [p, []]));
    for (const c of cardsRef.current) byPath.get(dateToDayPath(u, c.createdAt))?.push(c);
    const items = own.map(p => ({ path: p, cards: byPath.get(p), dropIds: [...(leftRef.current.get(p) || [])] }));

    const failed = [], foreign = [], written = [], removed = [];
    for (let i = 0; i < items.length; i += SYNC_CHUNK) {
      const chunk = items.slice(i, i + SYNC_CHUNK);
      try {
        const r = await api.sync(u, chunk);
        noteRev(r);
        for (const it of chunk) {
          const set = leftRef.current.get(it.path);
          if (set) { it.dropIds.forEach(id => set.delete(id)); if (!set.size) leftRef.current.delete(it.path); }
          const res = r.results?.[it.path];
          if (!res) continue;
          (res.exists ? written : removed).push(it.path);
          if (res.foreign?.length) foreign.push(...res.foreign);
        }
      } catch (e) {
        chunk.forEach(it => failed.push(it.path));
        log("error", "sync failed", { files: chunk.length, error: e.message });
      }
    }
    flushingRef.current = false;

    // 服务端合并进来的、别的设备写入的卡片，加入内存（不标脏）
    if (foreign.length && storeUidRef.current === u) {
      const ids = new Set(cardsRef.current.map(c => c.id));
      const add = [];
      for (const c of foreign) if (typeof c.createdAt === "string" && !ids.has(c.id)) { ids.add(c.id); add.push(migrateCard(c) || c); }
      if (add.length) {
        cardsRef.current = [...cardsRef.current, ...add];
        setCards(cardsRef.current);
        log("info", "merged cards from other device", { count: add.length });
      }
    }
    if ((written.length || removed.length) && storeUidRef.current === u) {
      setDayFiles(prev => {
        const set = new Set(prev);
        written.forEach(p => set.add(p));
        removed.forEach(p => set.delete(p));
        return [...set].sort();
      });
    }

    if (failed.length) {
      failed.forEach(p => dirtyRef.current.add(p));
      if (retryDelayRef.current === 2000) showToast("保存失败，稍后自动重试");
      const delay = retryDelayRef.current;
      retryDelayRef.current = Math.min(delay * 2, 30000);
      setSyncState("error");
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => flushNow(), delay);
    } else {
      retryDelayRef.current = 2000;
      setSyncState(dirtyRef.current.size ? "pending" : "idle");
      if (remoteChangedRef.current && !hasUnsaved() && Date.now() - lastRefreshAtRef.current > REMOTE_REFRESH_MIN_GAP_MS) {
        log("info", "remote change detected after save, refreshing");
        refreshFromDisk();
      }
    }
    log("info", "flush", { files: own.length, failed: failed.length, ms: Math.round(performance.now() - t0) });
  };

  // 串行执行，返回的 promise 在本次落盘结束后 resolve
  const flushNow = () => {
    clearTimeout(flushTimerRef.current);
    const run = flushChainRef.current.then(doFlush).catch(e => log("error", "flush crashed", { error: e.message }));
    flushChainRef.current = run;
    return run;
  };

  const applyUserData = data => {
    storeUidRef.current = data.uid;
    revRef.current = data.rev;
    remoteChangedRef.current = false;
    leftRef.current = new Map(data.repairDrops || []);
    cardsRef.current = data.cards;
    mutationSeqRef.current++;
    setCards(data.cards);
    setMeta(data.meta);
    setDayFiles(data.dayFiles);
    if (data.repairPaths?.length) {
      log("info", "repairing day files", { paths: data.repairPaths.length });
      markDirty(data.repairPaths);
    }
    if (data.migrated) showToast(`已将 ${data.migrated} 张卡升级到新的复习算法`);
  };

  const boot = async () => {
    setLoading(true); setLoadError(null);
    try {
      const data = await loadSnapshot(null);
      setGlobalBoth(data.global);
      applyUserData(data);
    } catch (e) {
      log("error", "boot failed", { error: e.message });
      setLoadError(e.message);
    }
    setLoading(false);
  };

  // 重新拉取快照：只在没有本地未保存修改、且拉取期间没有新修改时才替换内存
  const refreshFromDisk = async () => {
    const u = storeUidRef.current;
    if (!u) return false;
    if (hasUnsaved()) { remoteChangedRef.current = true; return false; }
    lastRefreshAtRef.current = Date.now();
    const seq = mutationSeqRef.current;
    try {
      const data = await loadSnapshot(u);
      if (seq !== mutationSeqRef.current || u !== storeUidRef.current || hasUnsaved()) {
        remoteChangedRef.current = true;
        log("info", "refresh skipped: local changes during refresh");
        return false;
      }
      applyUserData(data);
      if (globalRef.current) setGlobalBoth({ ...data.global, activeUser: globalRef.current.activeUser });
      return true;
    } catch (e) {
      log("error", "refresh failed", { error: e.message });
      return false;
    }
  };

  useEffect(() => {
    if (bootedRef.current) return; // StrictMode 下 effect 会跑两次
    bootedRef.current = true;
    boot();
  }, []);

  useEffect(() => {
    let raf = 0;
    const check = () => { raf = 0; setCanScroll(document.documentElement.scrollHeight > window.innerHeight + 50); };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(check); };
    schedule();
    window.addEventListener("resize", schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", schedule); observer.disconnect(); };
  }, []);

  useEffect(() => {
    const onVisibility = async () => {
      if (document.visibilityState === "hidden") {
        todayAtHideRef.current = todayStr();
        flushNow();
        return;
      }
      const oldToday = todayAtHideRef.current, nowToday = todayStr();
      const rolled = oldToday !== nowToday;
      if (rolled) {
        const { reviewDate: rd, addDate: ad } = latestRef.current;
        if (rd === oldToday) setReviewDate(nowToday);
        if (ad === oldToday) setAddDate(nowToday);
      }
      // 切回来只查一个版本号，变了才重新拉快照
      const u = storeUidRef.current;
      if (u) {
        try {
          const { rev } = await api.rev(u);
          if (u === storeUidRef.current && rev !== revRef.current) {
            log("info", "remote change detected on focus", { local: revRef.current, remote: rev });
            await refreshFromDisk();
          }
        } catch (e) { log("error", "rev check failed", { error: e.message }); }
      }
      if (rolled) {
        const { view: v, reviewDate: rd, activeDeck: deck } = latestRef.current;
        if (v === "review" && (rd === oldToday || rd === nowToday)) startReviewSession(nowToday, deck);
      }
    };
    const onBeforeUnload = e => {
      if (hasUnsaved()) { flushNow(); e.preventDefault(); e.returnValue = ""; }
    };
    const onKey = e => keyHandlerRef.current?.(e);
    // 我们处理过的按键，对应的 keyup 也拦掉（防止按钮在 keyup 时被激活、防止扩展在 keyup 响应）
    const onKeyUp = e => {
      if (handledKeysRef.current.has(e.key)) { handledKeysRef.current.delete(e.key); e.preventDefault(); e.stopImmediatePropagation(); }
    };
    // 鼠标点按钮时不让按钮获得焦点，避免之后的空格/回车落到这个按钮上
    const onMouseDown = e => { if (e.button === 0 && e.target.closest?.("button")) e.preventDefault(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, []);

  const updateMeta = m => {
    setMeta(m);
    mutationSeqRef.current++;
    return saveUserMeta(uid(), m).then(noteRev).catch(e => { log("error", "saveUserMeta failed", { error: e.message }); showToast("设置保存失败"); });
  };

  // ─── Review session：按每日上限从内存挑卡，不发请求 ───
  const startReviewSession = (forDate, deckId = latestRef.current.activeDeck) => {
    const { revs, news } = pickSession(cardsRef.current, deckId, forDate);
    const q = mergeSession(revs, news).map(c => ({ id: c.id, retry: false }));
    log("info", "startReviewSession", { date: forDate, deck: deckId, reviews: revs.length, news: news.length });
    setReviewQueue(q);
    setReviewPos(0);
    setReviewRevealed(false);
    undoRef.current = [];
    setUndoCount(0);
  };

  const pushUndo = entry => {
    undoRef.current.push(entry);
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
    setUndoCount(undoRef.current.length);
  };

  // 评分：本轮重练的卡只练不改排期；"重来"的卡排到队尾再出现一次
  const answerReview = rating => {
    const item = reviewQueue[reviewPos];
    if (!item || !reviewRevealed) return;
    const card = getLatest(item.id);
    pushUndo({ before: !item.retry && card ? card : null, queue: reviewQueue, pos: reviewPos });
    if (card && !item.retry) upsertCards([schedule(card, rating, reviewDate)]);
    if (card && rating === 1 && SRS.relearnInSession) setReviewQueue([...reviewQueue, { id: item.id, retry: true }]);
    setReviewPos(reviewPos + 1);
    setReviewRevealed(false);
    log("info", "review", { id: item.id, rating, retry: item.retry, date: reviewDate });
  };

  const skipReview = () => {
    if (reviewPos >= reviewQueue.length) return;
    pushUndo({ before: null, queue: reviewQueue, pos: reviewPos });
    setReviewPos(reviewPos + 1);
    setReviewRevealed(false);
  };

  const undoReview = () => {
    const last = undoRef.current.pop();
    if (!last) return;
    setUndoCount(undoRef.current.length);
    if (last.before) upsertCards([last.before]);
    setReviewQueue(last.queue);
    setReviewPos(last.pos);
    setReviewRevealed(!!last.before || last.queue[last.pos]?.retry);
    showToast("已撤销");
  };

  // ─── Users ───
  const resetSessionUI = () => {
    setActiveDeck("default"); setSelected(new Set()); setView("home");
    setReviewQueue([]); setReviewPos(0); setReviewRevealed(false);
    undoRef.current = []; setUndoCount(0);
    setIntensiveQueue([]); setIntensivePos(0); setIntensiveRevealed(false);
  };

  const switchUser = async userId => {
    if (userId === storeUidRef.current) { setSelected(new Set()); setView("home"); return true; }
    await flushNow();
    if (dirtyRef.current.size) { showToast("有修改尚未保存成功，暂不能切换用户"); return false; }
    setLoading(true);
    try {
      const g = { ...globalRef.current, activeUser: userId };
      const [data] = await Promise.all([loadSnapshot(userId), saveGlobal(g)]);
      setGlobalBoth(g);
      applyUserData(data);
      resetSessionUI();
      log("info", "switchUser", { userId });
      setLoading(false);
      return true;
    } catch (e) {
      log("error", "switchUser failed", { error: e.message });
      showToast("切换用户失败");
      setLoading(false);
      return false;
    }
  };

  const createUser = async () => {
    const name = newUserName.trim();
    if (!name) return;
    const id = Date.now().toString(36);
    const g = { ...globalRef.current, users: [...globalRef.current.users, { id, name }] };
    setGlobalBoth(g);
    setNewUserName(""); setShowUserModal(false);
    try {
      await Promise.all([saveGlobal(g), saveUserMeta(id, defaultMeta())]);
      showToast(`User "${name}" created`);
    } catch (e) { log("error", "createUser failed", { error: e.message }); showToast("创建用户失败"); }
  };

  const deleteUser = async userId => {
    if (userId === "default") return;
    setDeleteUserConfirm(null);
    if (storeUidRef.current === userId) {
      const ok = await switchUser("default");
      if (!ok) return;
    }
    try {
      const files = await api.list();
      await mapPool(files.filter(f => f.startsWith(`users/${userId}/`)), WRITE_CONCURRENCY, f => api.del(f));
      const cur = globalRef.current;
      const g = { ...cur, users: cur.users.filter(u => u.id !== userId), activeUser: cur.activeUser === userId ? "default" : cur.activeUser };
      setGlobalBoth(g);
      await saveGlobal(g);
    } catch (e) { log("error", "deleteUser failed", { error: e.message }); showToast("删除用户失败"); }
  };

  // ─── Card ops ───
  // 回车后立刻入库、清空输入框、播放发音；翻译在后台完成后回填
  const addCard = () => {
    const word = newWord.trim();
    if (!word) return;
    const sl = meta.sourceLang, tl1 = meta.targetLang1, tl2 = meta.targetLang2;
    const card = {
      id: newId(),
      word, translation: "", translation2: "",
      deckId: activeDeck, createdAt: addDate,
      ...newCardFields(addDate),
      reviewHistory: [], rot: 0, tags: [...addTags],
    };
    upsertCards([card]);
    setNewWord("");
    if (autoPlay) speak(word, sl);
    inputRef.current?.focus();
    log("info", "addCard", { word, id: card.id });

    setTranslatingIds(s => new Set(s).add(card.id));
    Promise.all([gTranslate(word, sl, tl1), gTranslate(word, sl, tl2)]).then(([t1, t2]) => {
      const cur = getLatest(card.id);
      if (cur && (t1 || t2)) {
        // 只填空字段：翻译回来之前用户手动编辑过的内容不覆盖
        upsertCards([{ ...cur, translation: cur.translation || t1 || "", translation2: cur.translation2 || t2 || "" }]);
      }
      if (t1 && t2) showToast(`✓ ${word} → ${t1} / ${t2}`);
      else showToast(`翻译失败：${word}，可在词库中手动编辑`);
    }).finally(() => {
      setTranslatingIds(s => { const n = new Set(s); n.delete(card.id); return n; });
    });
  };

  const deleteCard = card => {
    removeCards([card.id]);
    setSelected(s => { const n = new Set(s); n.delete(card.id); return n; });
    log("info", "deleteCard", { id: card.id });
  };
  const batchDelete = () => {
    if (selected.size === 0) return;
    const n = selected.size;
    removeCards([...selected]);
    showToast(`Deleted ${n} cards`); setSelected(new Set());
  };
  // 清除复习记录 = 重置为新卡
  const clearReview = card => {
    const cur = getLatest(card.id); if (!cur) return;
    upsertCards([resetSrs(cur)]);
    showToast("已重置为新卡");
  };
  const batchClearTags = () => {
    if (selected.size === 0) return;
    const updated = cardsRef.current.filter(c => selected.has(c.id)).map(resetSrs);
    upsertCards(updated);
    showToast(`已将 ${updated.length} 张卡重置为新卡`); setSelected(new Set()); setClearTagConfirm(false);
    log("info", "batchClearTags", { count: updated.length });
  };
  // 改创建日期只影响文件位置；新卡的 due 跟着走，已学过的卡排期不变
  const withNewDate = (c, newDate) => ({ ...c, createdAt: newDate, ...(c.state !== "review" ? { due: newDate, nextReview: newDate } : {}) });
  const batchChangeDate = newDate => {
    if (selected.size === 0 || !newDate) return;
    const updated = cardsRef.current.filter(c => selected.has(c.id)).map(c => withNewDate(c, newDate));
    upsertCards(updated);
    showToast(`Changed date on ${updated.length} cards`); setSelected(new Set()); setBatchDateModal(false);
    log("info", "batchChangeDate", { count: updated.length, newDate });
  };
  const addTagToCard = (card, tag) => {
    const cur = getLatest(card.id); if (!cur) return;
    upsertCards([{ ...cur, tags: [...new Set([...(cur.tags || []), tag])] }]);
  };
  const removeTagFromCard = (card, tag) => {
    const cur = getLatest(card.id); if (!cur) return;
    upsertCards([{ ...cur, tags: (cur.tags || []).filter(t => t !== tag) }]);
  };
  const batchAddTag = tag => {
    const t = tag.trim();
    if (!t || selected.size === 0) return;
    const updated = cardsRef.current.filter(c => selected.has(c.id)).map(c => ({ ...c, tags: [...new Set([...(c.tags || []), t])] }));
    upsertCards(updated);
    showToast(`Added tag "${t}" to ${updated.length} cards`); setBatchTagModal(false); setBatchTagInput("");
  };
  const toggleSelect = id => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const updateCardTranslation = (card, t0, t1, t2) => {
    const cur = getLatest(card.id); if (!cur) return;
    const rot = (cur.rot || 0) % 3;
    const fields = ["word", "translation", "translation2"];
    const updated = { ...cur };
    updated[fields[rot]] = t0;
    updated[fields[(rot + 1) % 3]] = t1;
    updated[fields[(rot + 2) % 3]] = t2;
    upsertCards([updated]);
    setEditingCard(null); showToast("Updated");
    log("info", "updateCard", { id: card.id });
  };
  const updateCardDate = (card, newDate) => {
    const cur = getLatest(card.id); if (!cur) return;
    upsertCards([withNewDate(cur, newDate)]);
    log("info", "updateCardDate", { id: card.id, newDate });
  };
  const rotateCard = cardId => {
    const cur = getLatest(cardId); if (!cur) return;
    upsertCards([{ ...cur, rot: ((cur.rot || 0) + 1) % 3 }]);
    showToast("Rotated");
  };
  const batchRotate = () => {
    const updated = cardsRef.current.filter(c => selected.has(c.id)).map(c => ({ ...c, rot: ((c.rot || 0) + 1) % 3 }));
    upsertCards(updated);
    showToast(`Rotated ${updated.length} cards`);
  };

  // ─── Intensive：纯练习，不改排期；"已掌握"把历史中的红色记录改为绿色，移出高难度 ───
  const getIntensiveCards = (mode, deckId) => {
    const pool = cardsRef.current.filter(c => {
      if (c.deckId !== deckId) return false;
      if (mode === "hard") return redCountOf(c) > 0;
      if (mode.startsWith("tag:")) return (c.tags || []).includes(mode.slice(4));
      return false;
    });
    return pool.sort((a, b) => (redCountOf(b) - redCountOf(a)) || a.createdAt.localeCompare(b.createdAt));
  };

  const startIntensiveSession = (mode, deckId = latestRef.current.activeDeck) => {
    const m = mode || intensiveMode;
    setIntensiveMode(m);
    const ic = getIntensiveCards(m, deckId);
    setIntensiveQueue(ic.map(c => ({ id: c.id, retry: false })));
    setIntensivePos(0);
    setIntensiveRevealed(false);
    log("info", "startIntensiveSession", { mode: m, count: ic.length });
  };

  const intensiveAdvance = again => {
    const item = intensiveQueue[intensivePos];
    if (!item) return;
    if (again) setIntensiveQueue(q => [...q, { id: item.id, retry: true }]);
    setIntensivePos(p => p + 1);
    setIntensiveRevealed(false);
  };

  const masterCard = cardId => {
    const card = getLatest(cardId);
    if (!card) return;
    const updated = { ...card, reviewHistory: (card.reviewHistory || []).map(h => h.remembered ? h : { ...h, remembered: true, rating: 3 }) };
    upsertCards([updated]);
    intensiveAdvance(false);
    showToast("已掌握，移出高难度");
    log("info", "masterCard", { cardId });
  };

  const prevIntensiveCard = () => { setIntensiveRevealed(false); setIntensivePos(p => Math.max(p - 1, 0)); };
  const nextIntensiveCard = () => { setIntensiveRevealed(false); setIntensivePos(p => Math.min(p + 1, intensiveQueue.length)); };

  // ─── 快捷键 ───
  // 复习：空格/回车 显示答案（已显示时=良好）· 1-4 评分 · U/Ctrl+Z 撤销 · S/→ 跳过
  // 强化：空格/回车 显示答案（已显示时=下一个）· 1 再练 · 2-4 下一个 · M 已掌握 · ←/→ 切换
  keyHandlerRef.current = e => {
    const t = e.target;
    if (showHelp) { if (e.key === "Escape" || e.key === "?") { e.preventDefault(); setShowHelp(false); } return; }
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.altKey || (e.metaKey && e.key !== "z") || (e.ctrlKey && e.key !== "z")) return;
    const k = e.key;
    if (k === "?") { e.preventDefault(); setShowHelp(true); return; }
    const handled = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
      handledKeysRef.current.add(k);
      if (document.activeElement && document.activeElement.tagName === "BUTTON") document.activeElement.blur();
    };
    if (view === "review") {
      const item = reviewQueue[reviewPos];
      if ((k === "z" && (e.ctrlKey || e.metaKey)) || k === "u" || k === "U") { handled(); undoReview(); return; }
      if (!item) return;
      if (k === " " || k === "Enter") { handled(); reviewRevealed ? answerReview(3) : setReviewRevealed(true); return; }
      if (["1", "2", "3", "4"].includes(k) && reviewRevealed) { handled(); answerReview(+k); return; }
      if (k === "s" || k === "S" || k === "ArrowRight") { handled(); skipReview(); return; }
    }
    if (view === "intensive") {
      const item = intensiveQueue[intensivePos];
      if (k === "ArrowLeft") { handled(); prevIntensiveCard(); return; }
      if (!item) return;
      if (k === " " || k === "Enter") { handled(); intensiveRevealed ? intensiveAdvance(false) : setIntensiveRevealed(true); return; }
      if (k === "ArrowRight") { handled(); nextIntensiveCard(); return; }
      if (intensiveRevealed && k === "1") { handled(); intensiveAdvance(true); return; }
      if (intensiveRevealed && ["2", "3", "4"].includes(k)) { handled(); intensiveAdvance(false); return; }
      if (intensiveRevealed && (k === "m" || k === "M")) { handled(); masterCard(item.id); return; }
    }
  };

  // ─── Deck ops ───
  const createDeck = () => {
    if (!newDeckName.trim()) return;
    const deck = { id: Date.now().toString(36), name: newDeckName.trim(), createdAt: Date.now() };
    updateMeta({ ...meta, decks: [...meta.decks, deck] });
    setNewDeckName(""); setShowDeckModal(false); setActiveDeck(deck.id);
    showToast(`Deck "${deck.name}" created`);
  };
  const renameDeck = () => {
    if (!renameDeckVal.trim() || !renameDeckId) return;
    updateMeta({ ...meta, decks: meta.decks.map(d => d.id === renameDeckId ? { ...d, name: renameDeckVal.trim() } : d) });
    setRenameDeckId(null); setRenameDeckVal(""); showToast("Deck renamed");
  };
  const doDeleteDeck = () => {
    const deckId = deleteDeckConfirm;
    const dn = meta.decks.find(d => d.id === deckId)?.name;
    const toRemove = cardsRef.current.filter(c => c.deckId === deckId);
    removeCards(toRemove.map(c => c.id));
    updateMeta({ ...meta, decks: meta.decks.filter(d => d.id !== deckId) });
    if (activeDeck === deckId) setActiveDeck("default");
    setDeleteDeckConfirm(null);
    showToast(`Deleted "${dn}" (${toRemove.length} cards)`);
  };

  // ─── Computed（缓存，cards 变化时才重算）───
  const td = todayStr();
  const cardsById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);
  const deckCards = useMemo(() => cards.filter(c => c.deckId === activeDeck), [cards, activeDeck]);
  const dueIds = useMemo(() => { const s = new Set(); for (const c of cards) if (isDueReview(c, td)) s.add(c.id); return s; }, [cards, td]);
  // 今天本牌组还能学的数量（已扣除每日上限）
  const todayPlan = useMemo(() => {
    const p = pickSession(cards, activeDeck, td);
    return { rev: p.revs.length, nw: p.news.length, dueTotal: p.dueTotal, newTotal: p.newTotal, newDone: p.newDone, revDone: p.revDone };
  }, [cards, activeDeck, td]);
  const todayTotal = todayPlan.rev + todayPlan.nw;
  const deckStats = useMemo(() => {
    const m = {};
    for (const c of cards) { const s = m[c.deckId] || (m[c.deckId] = { count: 0, due: 0, nw: 0 }); s.count++; if (dueIds.has(c.id)) s.due++; if (c.state !== "review") s.nw++; }
    return m;
  }, [cards, dueIds]);
  const intensiveCount = useMemo(() => deckCards.filter(c => redCountOf(c) > 0).length, [deckCards]);
  const allTags = useMemo(() => [...new Set(deckCards.flatMap(c => c.tags || []))].sort(), [deckCards]);
  const tagCounts = useMemo(() => {
    const m = {};
    for (const c of deckCards) for (const t of c.tags || []) m[t] = (m[t] || 0) + 1;
    return m;
  }, [deckCards]);
  const homeFiltered = useMemo(() => {
    const kw = filterKeyword.toLowerCase();
    return deckCards.filter(c => {
      if (filterDate && c.createdAt !== filterDate) return false;
      if (kw && ![c.word, c.translation, c.translation2].some(s => (s || "").toLowerCase().includes(kw))) return false;
      return true;
    });
  }, [deckCards, filterDate, filterKeyword]);
  const homeSorted = useMemo(() => [...homeFiltered].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)), [homeFiltered]);

  const reviewItem = reviewQueue[reviewPos] || null;
  const reviewCurrentCard = reviewItem ? cardsById.get(reviewItem.id) || null : null;
  const reviewTotal = reviewQueue.length;
  const reviewDone = reviewPos >= reviewTotal && reviewTotal > 0;

  const intensiveItem = intensiveQueue[intensivePos] || null;
  const intensiveCurrentCard = intensiveItem ? cardsById.get(intensiveItem.id) || null : null;
  const intensiveTotal = intensiveQueue.length;
  const intensiveDone = intensivePos >= intensiveTotal && intensiveTotal > 0;

  // Auto-play TTS on review card change
  const lastPlayedRef = useRef(null);
  useEffect(() => {
    if (!meta) return;
    const getQuizQuestion = card => {
      const d = getCardDisplay(card, meta);
      return { text: [d.src, d.t1, d.t2][reviewQuizType], lang: [d.srcL, d.t1L, d.t2L][reviewQuizType] };
    };
    if (view === "review" && reviewAutoPlay && !reviewRevealed && reviewCurrentCard) {
      const key = "r-" + reviewCurrentCard.id + "-" + reviewPos + "-" + reviewQuizType;
      if (lastPlayedRef.current !== key) { lastPlayedRef.current = key; const q = getQuizQuestion(reviewCurrentCard); speak(q.text, q.lang); }
    }
    if (view === "intensive" && reviewAutoPlay && !intensiveRevealed && intensiveCurrentCard) {
      const key = "i-" + intensiveCurrentCard.id + "-" + intensivePos + "-" + reviewQuizType;
      if (lastPlayedRef.current !== key) { lastPlayedRef.current = key; const q = getQuizQuestion(intensiveCurrentCard); speak(q.text, q.lang); }
    }
  });

  // ─── Export / Import ───
  const exportAll = async () => {
    try {
      await flushNow();
      const usersToExport = exportUsers.size > 0 ? [...exportUsers] : [uid()];
      const snaps = await Promise.all(usersToExport.map(u => withRetry(() => api.snapshot(u))));
      const files = {};
      if (snaps[0]?.global) files[GLOBAL_KEY] = snaps[0].global;
      for (const sn of snaps) {
        if (sn.meta != null) files[userMetaPath(sn.uid)] = sn.meta;
        Object.assign(files, sn.files);
      }
      const targets = Object.keys(files);
      const blob = new Blob([JSON.stringify({ version: 5, exportedAt: new Date().toISOString(), files }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `vocabforge-${td}.json`; a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${targets.length} files`);
    } catch (e) { log("error", "export failed", { error: e.message }); showToast("导出失败"); }
  };

  const importAll = e => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const imp = JSON.parse(ev.target.result);
        await flushNow();
        if (dirtyRef.current.size) { showToast("有修改尚未保存成功，请稍后再导入"); return; }
        const prevUid = storeUidRef.current;
        if (imp.files) {
          await mapPool(Object.entries(imp.files), WRITE_CONCURRENCY, ([p, data]) => api.write(p, data));
        } else if (imp.decks && imp.cards) {
          await saveUserMeta(prevUid, { ...(await loadUserMeta(prevUid)), decks: imp.decks });
          const byPath = {};
          for (const c of imp.cards) { const p = dateToDayPath(prevUid, c.createdAt); (byPath[p] || (byPath[p] = [])).push(c); }
          await mapPool(Object.entries(byPath), WRITE_CONCURRENCY, async ([p, list]) => {
            let arr = await api.read(p);
            if (!Array.isArray(arr)) arr = [];
            for (const card of list) { const i = arr.findIndex(c => c.id === card.id); if (i >= 0) arr[i] = card; else arr.push(card); }
            await api.write(p, arr);
          });
        }
        const data = await loadSnapshot(null);
        setGlobalBoth(data.global);
        applyUserData(data);
        if (data.uid !== prevUid) resetSessionUI();
        showToast("Import complete");
      } catch (err) { log("error", "import failed", { error: err.message }); showToast("Import failed"); }
    };
    reader.readAsText(file); e.target.value = "";
  };

  const setSourceLang = v => updateMeta({ ...meta, sourceLang: v });
  const setTargetLang1 = v => updateMeta({ ...meta, targetLang1: v });
  const setTargetLang2 = v => updateMeta({ ...meta, targetLang2: v });

  if (loadError) return (
    <div style={S.loadingScreen}>
      <div style={{ fontSize: 48, color: accent }}>鍛</div>
      <p style={{ fontFamily: mono, fontSize: 13, color: "#f87171", margin: "16px 0", maxWidth: 560, padding: "0 16px", lineHeight: 1.7, textAlign: "center", wordBreak: "break-all" }}>加载失败：{loadError}</p>
      <button style={S.emptyBtn} onClick={boot}>重试</button>
    </div>
  );
  if (loading || !meta || !global) return <div style={S.loadingScreen}><div style={S.loadingPulse}>鍛</div></div>;

  const startEdit = card => {
    const rot = (card.rot || 0) % 3;
    const texts = [card.word, card.translation, card.translation2];
    setEditingCard(card.id);
    setEditT0(texts[rot] || "");
    setEditT1(texts[(rot + 1) % 3] || "");
    setEditT2(texts[(rot + 2) % 3] || "");
  };

  const activeUser = global.users.find(u => u.id === global.activeUser) || global.users[0];
  const NAV = [
    { id: "home", label: "词库", icon: <I.Book /> },
    { id: "add", label: "添加", icon: <I.PlusCircle /> },
    { id: "review", label: `复习${todayTotal ? ` (${todayPlan.rev}${todayPlan.nw ? `+${todayPlan.nw}新` : ""})` : ""}`, icon: <I.RefreshCw /> },
    { id: "intensive", label: `强化${intensiveCount ? ` (${intensiveCount})` : ""}`, icon: <I.Flame /> },
    { id: "decks", label: "牌组", icon: <I.Layers /> },
    { id: "export", label: "备份", icon: <I.Save /> },
    { id: "users", label: "用户", icon: <I.User /> },
  ];

  const toggleExportUser = id => setExportUsers(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // 复习/强化共用：题面与答案
  const quizParts = card => {
    const d = getCardDisplay(card, meta);
    const allFields = [d.src, d.t1, d.t2];
    const allLangs = [d.srcL, d.t1L, d.t2L];
    const qIdx = reviewQuizType;
    return {
      question: allFields[qIdx], questionLang: allLangs[qIdx],
      ans: allFields.filter((_, i) => i !== qIdx), ansL: allLangs.filter((_, i) => i !== qIdx),
    };
  };
  // 普通函数而非组件：组件定义在 App 内会在每次渲染时被卸载重建，动画会反复播放
  const renderAnswer = (ans, ansL) => (
    <div style={{ animation: "fadeUp 0.25s ease", marginBottom: 20, borderTop: `1px solid ${border}`, paddingTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <div style={S.reviewTrans}>{ans[0]}</div>
        <button className="spk" style={S.speakBtn} onClick={() => speak(ans[0], ansL[0])}><I.Speaker /></button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 6 }}>
        <div style={S.reviewTrans2}>{ans[1]}</div>
        <button className="spk" style={S.speakBtn} onClick={() => speak(ans[1], ansL[1])}><I.Speaker /></button>
      </div>
    </div>
  );

  return (
    <div style={S.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Noto+Sans+SC:wght@300;400;500;700&family=Crimson+Pro:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}body{background:#0a0a0b;margin:0}
        input:focus,select:focus,button:focus{outline:none}::selection{background:#e8440033;color:#fff}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
        @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
        @keyframes toast{0%{opacity:0;transform:translateY(20px)}10%{opacity:1;transform:translateY(0)}90%{opacity:1}100%{opacity:0;transform:translateY(-10px)}}
        .hi:hover{background:#161618!important}
        @media(hover:none){.hi:hover{background:inherit!important}}
        .card-due{border:1px solid #e8440088!important;box-shadow:0 0 8px #e8440022}
        .card-sel{background:#1a1410!important;border-left:3px solid #e84400!important}
        .nb{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:500;background:transparent;color:#777;border:1px solid transparent;padding:4px 11px;border-radius:6px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:4px}
        .nb:hover:not(.nav-active){background:#1a1a1e}
        .nb.nav-active{background:#1a1a1e;border-color:#e84400;color:#e8e6e3}
        .ab:hover{transform:translateY(-1px);filter:brightness(1.15)}.dk:hover{border-color:#e84400!important}
        .spk:hover{color:#e84400!important}.scb:hover{opacity:1!important;border-color:#e84400!important;color:#e84400!important}
        input::placeholder{color:#444}
        .cb{appearance:none;width:16px;height:16px;border:2px solid #333;border-radius:4px;cursor:pointer;flex-shrink:0;position:relative;background:transparent;outline:none}
        .cb:checked{border-color:#e84400;background:#e84400}.cb:checked::after{content:'✓';position:absolute;top:-2px;left:2px;font-size:11px;color:#fff;font-weight:700}
        .cb:focus{box-shadow:none}
        .pill{font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 10px;border-radius:20px;cursor:pointer;border:1px solid #333;background:transparent;color:#777;transition:all .15s;display:inline-flex;align-items:center;gap:4px}
        .pill:hover{border-color:#555;color:#e8e6e3}.pill.on{border-color:#e84400;background:#e8440022;color:#e84400}
        .pill:disabled{opacity:.35;cursor:default}
        .deck-tabs{display:flex;gap:0;overflow:hidden;flex:1;min-width:0}
        .deck-tabs.expanded{flex-wrap:wrap;overflow:visible}
        .dtab{font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer;border:1px solid #222226;background:transparent;color:#777;white-space:nowrap;transition:all .15s}
        .dtab:hover{background:#1a1a1e;color:#e8e6e3}.dtab.active{background:#e84400;color:#fff;border-color:#e84400}
        kbd{font-family:'JetBrains Mono',monospace;font-size:9px;padding:0 4px;border:1px solid #333;border-radius:3px;color:#666;margin:0 1px}
      `}</style>

      {toast && <div key={toast.key} style={S.toast}>{toast.msg}</div>}

      <header style={S.header}>
        <div style={S.logo} onClick={() => { setView("home"); setSelected(new Set()); }}>
          <span style={S.logoMark}>鍛</span><span style={S.logoText}>VocabForge</span>
        </div>
        <div style={S.headerRight}>
          {syncState !== "idle" && (
            <span style={{ fontFamily: mono, fontSize: 10, color: syncState === "error" ? "#f87171" : textDim, marginRight: 4 }}
              title={syncState === "error" ? "保存失败，正在自动重试" : "正在保存到磁盘"}>
              {syncState === "error" ? "● 保存失败·重试中" : "● 保存中"}
            </span>
          )}
          {todayTotal > 0 && <div style={S.dueBadge} title={`到期 ${todayPlan.rev} · 新卡 ${todayPlan.nw}`} onClick={() => { setView("review"); startReviewSession(reviewDate, activeDeck); }}>{todayTotal} 今日</div>}
          <LangSelect value={meta.sourceLang} onChange={setSourceLang} />
          <span style={{ color: accent, fontSize: 11, fontFamily: mono }}>→</span>
          <LangSelect value={meta.targetLang1} onChange={setTargetLang1} />
          <span style={{ color: "#555", fontSize: 10, fontFamily: mono }}>/</span>
          <LangSelect value={meta.targetLang2} onChange={setTargetLang2} />
          <button style={S.helpBtn} className="spk" onClick={() => setShowHelp(true)} title="说明 (?)">?</button>
        </div>
      </header>

      {showHelp && (
        <div style={S.modal} onClick={() => setShowHelp(false)}>
          <div style={{ ...S.modalContent, maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <h3 style={S.modalTitle}>说明</h3>
            {[
              ["卡片标签", [
                ["逾期155天 · 260429", "应该在 2026-04-29 复习，已经过了 155 天。未到期时显示“N天后”"],
                ["间隔 1天", "上次复习到这次复习之间隔多久。每次答对都会变长"],
                ["倍率 ×1.90", "答“良好”时，下次间隔 = 当前间隔 × 倍率。新卡 2.50，每次重来 −0.2、困难 −0.15、简单 +0.15，最低 1.30。越低说明这张卡越难记"],
                ["遗忘3次", "复习时点了“重来”的次数"],
                ["彩色小块", "最近 10 次评分：红=重来 橙=困难 绿=良好 蓝=简单"],
                ["新卡", "还没学过，按每日新卡上限逐步引入"],
              ]],
              ["评分按钮", [
                ["重来", "没想起来。本轮末尾再练一次，明天再复习，倍率下降"],
                ["困难", "想起来了但很吃力。间隔小幅增长，倍率略降"],
                ["良好", "正常想起。间隔 × 倍率"],
                ["简单", "毫不费力。间隔增长最多，倍率上升"],
                ["5月后 / 1.1年后", "选这个评分后，这张卡下次出现的时间"],
                ["逾期很久仍答对", "逾期天数会计入新间隔，所以间隔可能一下拉得很长。如果其实记得很勉强，请选“困难”或“重来”"],
              ]],
              ["数字与上限", [
                ["复习 (197+20新)", `今天还要复习 197 张到期卡 + 学 20 张新卡。每日上限：新卡 ${SRS.newPerDay}、复习 ${SRS.reviewsPerDay}（在 vite.config.js 修改）`],
                ["本轮重练", "点“重来”的卡在本轮末尾再出现，只是练习，不改排期"],
                ["强化", "按“记错过”或标签集中练习，不改排期。“已掌握”会把红色记录改为绿色"],
              ]],
              ["快捷键", [
                ["空格 / 回车", "显示答案；已显示时 = 良好"],
                ["1 – 4", "评分"],
                ["U / Ctrl+Z", "撤销上一次作答"],
                ["S / →", "跳过（留到下次）"],
                ["?", "打开 / 关闭本说明"],
              ]],
            ].map(([title, rows]) => (
              <div key={title} style={{ marginBottom: 16 }}>
                <h4 style={{ ...S.smallTitle, marginBottom: 6 }}>{title}</h4>
                {rows.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: 12, padding: "5px 0", borderBottom: `1px solid ${border}`, fontSize: 13, lineHeight: 1.5 }}>
                    <span style={{ fontFamily: mono, fontSize: 12, color: text, flex: "0 0 128px" }}>{k}</span>
                    <span style={{ color: textDim }}>{v}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={S.modalActions}><button className="ab" style={S.modalConfirm} onClick={() => setShowHelp(false)}>知道了</button></div>
          </div>
        </div>
      )}

      <nav style={S.nav}>
        {NAV.map(t => (
          <button key={t.id} className={`nb${view === t.id ? " nav-active" : ""}`}
            onClick={() => {
              setView(t.id); setSelected(new Set());
              if (t.id === "review") startReviewSession(reviewDate, activeDeck);
              if (t.id === "intensive") startIntensiveSession(undefined, activeDeck);
            }}>{t.icon} {t.label}</button>
        ))}
        <div style={{ marginLeft: "auto", fontFamily: mono, fontSize: 11, color: textDim, display: "flex", alignItems: "center", gap: 4 }}>
          <I.User /> {activeUser?.name}
        </div>
      </nav>

      {(view === "home" || view === "add" || view === "review" || view === "intensive") && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0", borderBottom: `1px solid ${border}` }}>
          <div className={`deck-tabs${deckExpanded ? " expanded" : ""}`}>
            {meta.decks.map(d => (
              <button key={d.id} className={`dtab${activeDeck === d.id ? " active" : ""}`}
                onClick={() => {
                  setActiveDeck(d.id); setSelected(new Set());
                  if (view === "review") startReviewSession(reviewDate, d.id);
                  if (view === "intensive") startIntensiveSession(undefined, d.id);
                }}>
                {d.name} ({deckStats[d.id]?.count || 0})
              </button>
            ))}
          </div>
          <button style={{ background: "transparent", border: "none", color: textDim, cursor: "pointer", padding: 4, flexShrink: 0, transform: deckExpanded ? "rotate(180deg)" : "none", transition: "transform .2s" }}
            onClick={() => setDeckExpanded(!deckExpanded)}><I.ChevronDown /></button>
        </div>
      )}

      <main style={S.main}>

        {/* ═══ HOME ═══ */}
        {view === "home" && (() => {
          const filtered = homeFiltered;
          const totalPages = Math.max(1, Math.ceil(homeSorted.length / pageSize));
          const safePage = Math.min(page, totalPages - 1);
          const paged = homeSorted.slice(safePage * pageSize, (safePage + 1) * pageSize);
          return (
            <div style={S.content}>
              {deckCards.length > 0 && (<>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <button className={`pill${selected.size === filtered.length && filtered.length > 0 ? " on" : ""}`} onClick={() => {
                      if (selected.size === filtered.length) setSelected(new Set());
                      else setSelected(new Set(filtered.map(c => c.id)));
                    }}>
                      {selected.size > 0 ? `${selected.size} selected` : "Select all"}
                    </button>
                    {selected.size > 0 && <button className="pill" onClick={() => setSelected(new Set())} style={{ fontSize: 10 }}>✕</button>}
                    <button className={`pill${showSrc ? " on" : ""}`} onClick={() => setShowSrc(!showSrc)}>目标</button>
                    <button className={`pill${showT1 ? " on" : ""}`} onClick={() => setShowT1(!showT1)}>翻译1</button>
                    <button className={`pill${showT2 ? " on" : ""}`} onClick={() => setShowT2(!showT2)}>翻译2</button>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {selected.size > 0 && <button className="pill on" style={{ borderColor: "#16a34a", color: "#4ade80", background: "#16a34a22" }} onClick={batchRotate}><I.Rotate /> Rotate</button>}
                    {selected.size > 0 && <button className="pill" style={{ borderColor: "#8b5cf6", color: "#a78bfa" }} onClick={() => setBatchTagModal(true)}><I.Tag /> 标签</button>}
                    {selected.size > 0 && <button className="pill" style={{ borderColor: "#eab308", color: "#facc15" }} onClick={() => setClearTagConfirm(true)}>重置为新卡</button>}
                    {selected.size > 0 && <button className="pill" style={{ borderColor: "#3b82f6", color: "#60a5fa" }} onClick={() => { setBatchDateVal(todayStr()); setBatchDateModal(true); }}>修改日期</button>}
                    {selected.size > 0 && <button className="pill" style={{ borderColor: "#dc2626", color: "#f87171" }} onClick={batchDelete}><I.Trash /> Delete</button>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: mono, fontSize: 11, color: textDim }}>日期筛选:</span>
                  <DateInput value={filterDate} onChange={d => { setFilterDate(d); setPage(0); }} />
                  {filterDate && <button className="pill" onClick={() => { setFilterDate(""); setPage(0); }} style={{ fontSize: 10 }}>✕</button>}
                  <span style={{ fontFamily: mono, fontSize: 11, color: textDim, marginLeft: 8 }}>关键字:</span>
                  <input style={{ fontFamily: mono, fontSize: 12, background: surface, color: text, border: `1px solid ${border}`, borderRadius: 6, padding: "4px 10px", width: 140 }}
                    placeholder="搜索..." value={filterKeyword} onChange={e => { setFilterKeyword(e.target.value); setPage(0); }} />
                  {filterKeyword && <button className="pill" onClick={() => { setFilterKeyword(""); setPage(0); }} style={{ fontSize: 10 }}>✕</button>}
                  {(filterDate || filterKeyword) && <span style={{ fontFamily: mono, fontSize: 11, color: textDim }}>{filtered.length} cards</span>}
                </div>
              </>)}
              {deckCards.length === 0 ? (
                <div style={S.empty}><p style={S.emptyText}>No cards yet</p><button className="ab" style={S.emptyBtn} onClick={() => setView("add")}><I.Plus /> Add word</button></div>
              ) : (<>
                <div style={S.cardList}>
                  {paged.map((card, i) => {
                    const isEditing = editingCard === card.id;
                    const isDue = dueIds.has(card.id);
                    const isSel = selected.has(card.id);
                    const d = getCardDisplay(card, meta);
                    return (
                      <div key={card.id} className={`hi${isSel ? " card-sel" : ""}${isDue && !isSel ? " card-due" : ""}`} style={{ ...S.cardItem, cursor: isEditing ? "default" : "pointer", animationDelay: `${Math.min(i, 20) * 25}ms` }}
                        onClick={e => {
                          // 点空白处切换选中；按钮、输入框、复选框等控件自己处理；拖选文字时不触发
                          if (isEditing || e.target.closest("button,input,textarea,select,a,label")) return;
                          if (window.getSelection()?.toString()) return;
                          toggleSelect(card.id);
                        }}>
                        <input type="checkbox" className="cb" checked={isSel} onChange={() => toggleSelect(card.id)} style={{ marginRight: 10, marginTop: 4 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {showSrc && (
                            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                              <span style={S.cardWord}>{d.src}</span>
                              <button className="spk" style={S.speakBtn} onClick={e => { e.stopPropagation(); speak(d.src, d.srcL); }} title={LN[d.srcL]}><I.Speaker /></button>
                            </div>
                          )}
                          {isEditing ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}
                              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); updateCardTranslation(card, editT0, editT1, editT2); } }}>
                              <textarea style={{ ...S.editInput, fontWeight: 600, width: "100%", minHeight: 28, maxHeight: 56, resize: "vertical" }} value={editT0} onChange={e => setEditT0(e.target.value)} placeholder={LN[d.srcL]} rows={1} />
                              <textarea style={{ ...S.editInput, width: "100%", minHeight: 28, maxHeight: 56, resize: "vertical" }} value={editT1} onChange={e => setEditT1(e.target.value)} placeholder={LN[d.t1L]} rows={1} />
                              <textarea style={{ ...S.editInput, width: "100%", minHeight: 28, maxHeight: 56, resize: "vertical" }} value={editT2} onChange={e => setEditT2(e.target.value)} placeholder={LN[d.t2L]} rows={1} />
                              <div style={{ display: "flex", gap: 6 }}>
                                <button style={S.editSave} onClick={() => updateCardTranslation(card, editT0, editT1, editT2)}>✓</button>
                                <button style={S.editCancel} onClick={() => setEditingCard(null)}>✕</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                              {showT1 && <><span style={S.cardTrans}>{d.t1}</span><button className="spk" style={S.speakBtn} onClick={e => { e.stopPropagation(); speak(d.t1, d.t1L); }} title={LN[d.t1L]}><I.Speaker /></button></>}
                              {showT1 && showT2 && <span style={{ color: "#444", fontSize: 11 }}>/</span>}
                              {showT2 && <><span style={S.cardTrans2}>{d.t2}</span><button className="spk" style={S.speakBtn} onClick={e => { e.stopPropagation(); speak(d.t2, d.t2L); }} title={LN[d.t2L]}><I.Speaker /></button></>}
                              {translatingIds.has(card.id) && <span style={{ fontFamily: mono, fontSize: 11, color: textDim, animation: "pulse 1s infinite" }}>翻译中…</span>}
                              <button style={S.editBtn} onClick={() => startEdit(card)}><I.Edit /></button>
                            </div>
                          )}
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                            <CardStats card={card} />
                            {(card.tags || []).length > 0 && <div style={{ marginLeft: "auto", display: "flex", gap: 3, flexWrap: "wrap", flexShrink: 0 }}>
                              {(card.tags || []).map(t => (
                                <span key={t} style={{ fontFamily: mono, fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "#8b5cf622", border: "1px solid #8b5cf644", color: "#a78bfa", cursor: "pointer" }}
                                  onClick={e => { e.stopPropagation(); removeTagFromCard(card, t); }} title={`Remove "${t}"`}>
                                  {t} ✕
                                </span>
                              ))}
                            </div>}
                          </div>
                        </div>
                        <div style={S.cardItemRight}>
                          <button className="spk" style={{ ...S.speakBtn, padding: 4 }} onClick={e => { e.stopPropagation(); rotateCard(card.id); }} title="Rotate"><I.Rotate /></button>
                          <button className="spk" style={{ ...S.speakBtn, padding: 4, color: "#a78bfa" }} onClick={e => {
                            e.stopPropagation();
                            setSingleTagCard(card.id); setBatchTagInput("");
                          }} title="Add tag"><I.Tag /></button>
                          {card.state === "review" && <button className="spk" style={{ ...S.speakBtn, padding: 4, color: "#facc15" }} onClick={e => { e.stopPropagation(); clearReview(card); }} title="重置为新卡">✕</button>}
                          <DateInput value={card.createdAt} onChange={dd => updateCardDate(card, dd)} />
                          <button style={S.deleteBtn} onClick={() => deleteCard(card)}><I.Trash /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", padding: "16px 0" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {PAGE_SIZES.map(s => (
                      <button key={s} className="nb" style={{ ...S.pageBtn, ...(pageSize === s ? S.pageBtnActive : {}) }}
                        onClick={() => { setPageSize(s); setPage(0); }}>{s}</button>
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
                      {safePage > 0 && <button style={S.pageLink} onClick={() => setPage(safePage - 1)}>‹ prev</button>}
                      {Array.from({ length: totalPages }, (_, i) => (
                        <button key={i} style={{ ...S.pageLink, ...(safePage === i ? { color: accent, fontWeight: 700 } : {}) }} onClick={() => setPage(i)}>{i + 1}</button>
                      ))}
                      {safePage < totalPages - 1 && <button style={S.pageLink} onClick={() => setPage(safePage + 1)}>next ›</button>}
                    </div>
                  )}
                </div>
              </>)}
              {clearTagConfirm && (
                <div style={S.modal} onClick={() => setClearTagConfirm(false)}><div style={S.modalContent} onClick={e => e.stopPropagation()}>
                  <h3 style={S.modalTitle}>确认重置</h3>
                  <p style={{ fontFamily: sans, fontSize: 14, color: textDim, lineHeight: 1.6, marginBottom: 8 }}>确定要把 <strong style={{ color: text }}>{selected.size}</strong> 张卡片重置为新卡吗？</p>
                  <p style={{ fontFamily: mono, fontSize: 12, color: "#facc15", marginBottom: 16 }}>复习记录、间隔、难度系数都会清空，不可撤销。</p>
                  <div style={S.modalActions}><button className="ab" style={S.modalCancel} onClick={() => setClearTagConfirm(false)}>取消</button><button className="ab" style={{ ...S.deleteConfirmBtn, background: "#ca8a04" }} onClick={batchClearTags}>确认重置</button></div>
                </div></div>
              )}
              {batchDateModal && (
                <div style={S.modal} onClick={() => setBatchDateModal(false)}><div style={S.modalContent} onClick={e => e.stopPropagation()}>
                  <h3 style={S.modalTitle}>修改日期</h3>
                  <p style={{ fontFamily: sans, fontSize: 14, color: textDim, lineHeight: 1.6, marginBottom: 12 }}>将 {selected.size} 张卡片的创建日期修改为：</p>
                  <DateInput value={batchDateVal} onChange={setBatchDateVal} style={{ width: "100%", marginBottom: 12 }} />
                  <div style={S.modalActions}><button className="ab" style={S.modalCancel} onClick={() => setBatchDateModal(false)}>取消</button><button className="ab" style={S.modalConfirm} onClick={() => batchChangeDate(batchDateVal)}>确认修改</button></div>
                </div></div>
              )}
              {batchTagModal && (
                <div style={S.modal} onClick={() => setBatchTagModal(false)}><div style={S.modalContent} onClick={e => e.stopPropagation()}>
                  <h3 style={S.modalTitle}>添加标签</h3>
                  <p style={{ fontFamily: sans, fontSize: 14, color: textDim, lineHeight: 1.6, marginBottom: 12 }}>为 {selected.size} 张卡片添加标签</p>
                  {allTags.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                      {allTags.map(t => <button key={t} className="pill" style={{ borderColor: "#8b5cf6", color: "#a78bfa" }} onClick={() => batchAddTag(t)}>{t}</button>)}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <input style={S.modalInput} placeholder="New tag..." value={batchTagInput} onChange={e => setBatchTagInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && batchAddTag(batchTagInput)} autoFocus />
                    <button className="ab" style={S.modalConfirm} onClick={() => batchAddTag(batchTagInput)}>添加</button>
                  </div>
                </div></div>
              )}
              {singleTagCard && (() => {
                const stc = cardsById.get(singleTagCard);
                if (!stc) return null;
                const addSingleTag = tag => {
                  if (!tag.trim()) return;
                  addTagToCard(stc, tag.trim());
                  setSingleTagCard(null); setBatchTagInput("");
                };
                const otherTags = allTags.filter(t => !(stc.tags || []).includes(t));
                return (
                  <div style={S.modal} onClick={() => setSingleTagCard(null)}><div style={S.modalContent} onClick={e => e.stopPropagation()}>
                    <h3 style={S.modalTitle}>添加标签</h3>
                    <p style={{ fontFamily: mono, fontSize: 12, color: textDim, marginBottom: 12 }}>{stc.word}</p>
                    {(stc.tags || []).length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>{(stc.tags || []).map(t => <span key={t} style={{ fontFamily: mono, fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#8b5cf622", border: "1px solid #8b5cf644", color: "#a78bfa" }}>{t}</span>)}</div>}
                    {otherTags.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                        {otherTags.map(t => <button key={t} className="pill" style={{ borderColor: "#8b5cf6", color: "#a78bfa" }} onClick={() => addSingleTag(t)}>{t}</button>)}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <input style={S.modalInput} placeholder="New tag..." value={batchTagInput} onChange={e => setBatchTagInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && addSingleTag(batchTagInput)} autoFocus />
                      <button className="ab" style={S.modalConfirm} onClick={() => addSingleTag(batchTagInput)}>添加</button>
                    </div>
                  </div></div>
                );
              })()}
            </div>
          );
        })()}

        {/* ═══ ADD ═══ */}
        {view === "add" && (
          <div style={S.content}>
            <div style={{ padding: "20px 0" }}>
              <h2 style={S.addTitle}>Add Word</h2>
              <p style={S.addSub}>{LN[meta.sourceLang]} → {LN[meta.targetLang1]} + {LN[meta.targetLang2]}</p>
              <div style={S.inputRow}>
                <input ref={inputRef} style={S.wordInput}
                  placeholder={`Enter a ${LN[meta.sourceLang] || meta.sourceLang} word...`}
                  value={newWord} onChange={e => setNewWord(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && addCard()} autoFocus />
                <DateInput value={addDate} onChange={setAddDate} />
                <button className="ab" style={{ ...S.addBtn, opacity: newWord.trim() ? 1 : .5 }}
                  onClick={addCard} disabled={!newWord.trim()}>
                  <I.Plus /> Add
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
                <button className={`pill${autoPlay ? " on" : ""}`} onClick={() => setAutoPlay(!autoPlay)}><I.Speaker size={12} /> 自动播放</button>
                {allTags.map(t => (
                  <button key={t} className={`pill${addTags.has(t) ? " on" : ""}`} style={addTags.has(t) ? { borderColor: "#8b5cf6", color: "#a78bfa", background: "#8b5cf622" } : {}}
                    onClick={() => setAddTags(s => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; })}><I.Tag /> {t}</button>
                ))}
                {[...addTags].filter(t => !allTags.includes(t)).map(t => (
                  <button key={t} className="pill on" style={{ borderColor: "#8b5cf6", color: "#a78bfa", background: "#8b5cf622" }}
                    onClick={() => setAddTags(s => { const n = new Set(s); n.delete(t); return n; })}><I.Tag /> {t}</button>
                ))}
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input style={{ fontFamily: mono, fontSize: 11, background: bg, color: text, border: `1px solid ${border}`, borderRadius: 16, padding: "4px 10px", width: 100 }}
                    placeholder="+ new tag" value={newTagInput} onChange={e => setNewTagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing && newTagInput.trim()) {
                        const t = newTagInput.trim();
                        setAddTags(s => new Set([...s, t]));
                        setNewTagInput("");
                      }
                    }} />
                </div>
                {translatingIds.size > 0 && <span style={{ fontFamily: mono, fontSize: 11, color: textDim, animation: "pulse 1s infinite" }}>翻译中 ({translatingIds.size})</span>}
              </div>
              <div style={{ marginBottom: 32 }}>
                <h3 style={S.smallTitle}>Recently Added</h3>
                {deckCards.slice(-5).reverse().map(c => {
                  const pending = translatingIds.has(c.id);
                  return (
                    <div key={c.id} style={S.recentItem}>
                      <span style={S.recentWord}>{c.word}</span>
                      <span style={{ color: accent, fontSize: 12 }}>→</span>
                      <span style={S.recentTrans}>{c.translation || (pending ? "…" : "")}</span>
                      <span style={{ color: "#555", fontSize: 12 }}>/</span>
                      <span style={S.recentTrans2}>{c.translation2 || (pending ? "…" : "")}</span>
                    </div>
                  );
                })}
              </div>
              <div>
                <h3 style={S.smallTitle}>复习设置（SM-2）</h3>
                <div style={S.intervals}>
                  <div style={S.intervalPill}>每日新卡 {SRS.newPerDay}</div>
                  <div style={S.intervalPill}>每日复习 {SRS.reviewsPerDay}</div>
                  <div style={S.intervalPill}>本牌组待学新卡 {deckStats[activeDeck]?.nw || 0}</div>
                </div>
                <p style={{ fontFamily: mono, fontSize: 10, color: "#555", marginTop: 8 }}>在 vite.config.js 中修改</p>
              </div>
            </div>
          </div>
        )}

        {/* ═══ REVIEW ═══ */}
        {view === "review" && (() => {
          const st = studiedOn(cards, activeDeck, reviewDate);
          const limitLine = `今日已学：新卡 ${st.newDone}/${SRS.newPerDay} · 复习 ${st.revDone}/${SRS.reviewsPerDay}`;
          return (
            <div style={S.content}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", flexWrap: "wrap" }}>
                <span style={{ fontFamily: mono, fontSize: 12, color: textDim }}>Review:</span>
                <DateInput value={reviewDate} onChange={d => { setReviewDate(d); startReviewSession(d, activeDeck); }} />
                {reviewDate !== td && <button className="pill" onClick={() => { setReviewDate(td); startReviewSession(td, activeDeck); }} style={{ fontSize: 10 }}>Today</button>}
                <button className={`pill${reviewQuizType === 0 ? " on" : ""}`} onClick={() => setReviewQuizType(0)}>目标</button>
                <button className={`pill${reviewQuizType === 1 ? " on" : ""}`} onClick={() => setReviewQuizType(1)}>翻译1</button>
                <button className={`pill${reviewQuizType === 2 ? " on" : ""}`} onClick={() => setReviewQuizType(2)}>翻译2</button>
                <div style={{ marginLeft: "auto" }}><button className={`pill${reviewAutoPlay ? " on" : ""}`} onClick={() => setReviewAutoPlay(!reviewAutoPlay)}><I.Speaker size={12} /> 自动播放</button></div>
              </div>
              {reviewTotal === 0 || reviewDone ? (
                <div style={S.empty}>
                  <div style={{ fontSize: 48, color: "#4ade80", marginBottom: 8 }}>✓</div>
                  <p style={S.emptyText}>{reviewDone ? `本轮完成，共 ${reviewTotal} 次作答` : `${reviewDate} 没有要学的卡片`}</p>
                  <p style={{ fontFamily: mono, fontSize: 11, color: textDim }}>{limitLine}</p>
                  {undoCount > 0 && <button className="pill" onClick={undoReview}><I.Undo /> 撤销上一次</button>}
                </div>
              ) : !reviewCurrentCard ? (
                <div style={S.empty}><p style={S.emptyText}>这张卡已被删除</p><button className="pill" onClick={skipReview}>跳过 ›</button></div>
              ) : (() => {
                const rc = reviewCurrentCard;
                const qp = quizParts(rc);
                const ivls = previewIntervals(rc, reviewDate);
                const retry = reviewItem.retry;
                return (
                  <div style={S.reviewArea}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 8 }}>
                      <button className="pill" onClick={undoReview} disabled={!undoCount} style={{ fontSize: 11 }} title="撤销 (U)"><I.Undo /> 撤销</button>
                      <span style={{ ...S.reviewProgress, marginBottom: 0 }}>{reviewPos + 1} / {reviewTotal}</span>
                      <button className="pill" onClick={skipReview} style={{ fontSize: 11 }} title="跳过，留到下次 (S)">跳过 ›</button>
                    </div>
                    <div style={S.reviewCard} key={rc.id + "-" + reviewPos}>
                      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 6, minHeight: 16 }}>
                        {rc.state !== "review" && <span style={{ ...S.badge, color: "#60a5fa", borderColor: "#2563eb55" }}>新卡</span>}
                        {retry && <span style={{ ...S.badge, color: "#fb923c", borderColor: "#ea580c55" }}>本轮重练 · 不影响排期</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
                        <div style={S.reviewWord}>{qp.question}</div>
                        <button className="spk" style={{ ...S.speakBtn, padding: 4 }} onClick={() => speak(qp.question, qp.questionLang)}><I.Speaker size={18} /></button>
                      </div>
                      <div style={{ marginTop: 8, marginBottom: 24 }}><CardStats card={rc} center /></div>
                      {!reviewRevealed ? (
                        <button className="ab" style={{ ...S.showBtn, width: "100%", justifyContent: "center" }} onClick={() => setReviewRevealed(true)}>显示答案 <kbd>空格</kbd></button>
                      ) : (<>
                        {renderAnswer(qp.ans, qp.ansL)}
                        <div style={S.gradeRow}>
                          {RATINGS.map(({ r, label, color, bg: b, bd }) => (
                            <button key={r} className="ab" style={{ ...S.gradeBtn, color, background: b, borderColor: bd }} onClick={() => answerReview(r)}>
                              <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
                              <span style={{ fontSize: 10, opacity: 0.8 }}>{retry ? (r === 1 ? "再来一次" : "本轮完成") : (r === 1 && SRS.relearnInSession ? "本轮再练·明天" : `${fmtIvl(ivls[r])}后`)}</span>
                              <kbd style={{ borderColor: bd, color }}>{r}</kbd>
                            </button>
                          ))}
                        </div>
                      </>)}
                    </div>
                    <p style={{ fontFamily: mono, fontSize: 10, color: "#555", marginTop: 14, textAlign: "center", lineHeight: 1.8 }}>
                      <kbd>空格</kbd> 显示答案 / 良好　<kbd>1</kbd>–<kbd>4</kbd> 评分　<kbd>U</kbd> 撤销　<kbd>S</kbd> 跳过<br />{limitLine}
                    </p>
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* ═══ INTENSIVE ═══ */}
        {view === "intensive" && (
          <div style={S.content}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", flexWrap: "wrap" }}>
              <span style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, color: text }}>强化</span>
              <button className={`pill${intensiveMode === "hard" ? " on" : ""}`} onClick={() => startIntensiveSession("hard", activeDeck)}>🔥 高难度 ({intensiveCount})</button>
              {allTags.map(t => {
                const m = "tag:" + t;
                return <button key={t} className={`pill${intensiveMode === m ? " on" : ""}`} style={intensiveMode === m ? { borderColor: "#8b5cf6", color: "#a78bfa", background: "#8b5cf622" } : {}} onClick={() => startIntensiveSession(m, activeDeck)}><I.Tag /> {t} ({tagCounts[t] || 0})</button>;
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8, flexWrap: "wrap" }}>
              <button className={`pill${reviewQuizType === 0 ? " on" : ""}`} onClick={() => setReviewQuizType(0)}>目标</button>
              <button className={`pill${reviewQuizType === 1 ? " on" : ""}`} onClick={() => setReviewQuizType(1)}>翻译1</button>
              <button className={`pill${reviewQuizType === 2 ? " on" : ""}`} onClick={() => setReviewQuizType(2)}>翻译2</button>
              <span style={{ fontFamily: mono, fontSize: 10, color: "#555" }}>练习模式，不影响复习排期</span>
              <div style={{ marginLeft: "auto" }}><button className={`pill${reviewAutoPlay ? " on" : ""}`} onClick={() => setReviewAutoPlay(!reviewAutoPlay)}><I.Speaker size={12} /> 自动播放</button></div>
            </div>
            {intensiveTotal === 0 ? (
              <div style={S.empty}><div style={{ fontSize: 48, color: "#4ade80", marginBottom: 8 }}>✓</div>
                <p style={S.emptyText}>{intensiveMode === "hard" ? "没有高难度词汇" : "该标签没有词汇"}</p></div>
            ) : intensiveDone ? (
              <div style={S.empty}><div style={{ fontSize: 48, color: "#4ade80", marginBottom: 8 }}>✓</div>
                <p style={S.emptyText}>强化练习完成！共 {intensiveTotal} 次</p></div>
            ) : !intensiveCurrentCard ? (
              <div style={S.empty}><p style={S.emptyText}>这张卡已被删除</p><button className="pill" onClick={nextIntensiveCard}>下一个 ›</button></div>
            ) : (() => {
              const rc = intensiveCurrentCard;
              const qp = quizParts(rc);
              const redCount = redCountOf(rc);
              return (
                <div style={S.reviewArea}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 8 }}>
                    {intensivePos > 0 && <button className="pill" onClick={prevIntensiveCard} style={{ fontSize: 11 }}>‹ 上一个</button>}
                    <span style={{ ...S.reviewProgress, marginBottom: 0 }}>{intensivePos + 1} / {intensiveTotal}</span>
                    {intensivePos < intensiveTotal - 1 && <button className="pill" onClick={nextIntensiveCard} style={{ fontSize: 11 }}>下一个 ›</button>}
                  </div>
                  <div style={S.reviewCard} key={rc.id + "-" + intensivePos}>
                    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 6, minHeight: 16 }}>
                      {redCount > 0 && <span style={{ ...S.badge, color: "#f87171", borderColor: "#dc262655" }}>{redCount} 次记错</span>}
                      {intensiveItem.retry && <span style={{ ...S.badge, color: "#fb923c", borderColor: "#ea580c55" }}>再练</span>}
                      {(rc.tags || []).map(t => <span key={t} style={{ ...S.badge, color: "#a78bfa", borderColor: "#8b5cf644" }}>{t}</span>)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
                      <div style={S.reviewWord}>{qp.question}</div>
                      <button className="spk" style={{ ...S.speakBtn, padding: 4 }} onClick={() => speak(qp.question, qp.questionLang)}><I.Speaker size={18} /></button>
                    </div>
                    <div style={{ marginTop: 8, marginBottom: 24 }}><CardStats card={rc} center /></div>
                    {!intensiveRevealed ? (
                      <button className="ab" style={{ ...S.showBtn, width: "100%", justifyContent: "center" }} onClick={() => setIntensiveRevealed(true)}>显示答案 <kbd>空格</kbd></button>
                    ) : (<>
                      {renderAnswer(qp.ans, qp.ansL)}
                      <div style={S.gradeRow}>
                        <button className="ab" style={{ ...S.gradeBtn, color: "#f87171", background: "#dc262622", borderColor: "#dc262655" }} onClick={() => intensiveAdvance(true)}>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>再练</span><span style={{ fontSize: 10, opacity: .8 }}>排到队尾</span><kbd>1</kbd>
                        </button>
                        <button className="ab" style={{ ...S.gradeBtn, color: text, background: surface2, borderColor: border }} onClick={() => intensiveAdvance(false)}>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>下一个</span><span style={{ fontSize: 10, opacity: .8 }}>记住了</span><kbd>空格</kbd>
                        </button>
                        {redCount > 0 && <button className="ab" style={{ ...S.gradeBtn, color: "#4ade80", background: "#16a34a22", borderColor: "#16a34a55" }} onClick={() => masterCard(rc.id)}>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>已掌握</span><span style={{ fontSize: 10, opacity: .8 }}>移出高难度</span><kbd>M</kbd>
                        </button>}
                      </div>
                    </>)}
                  </div>
                  <p style={{ fontFamily: mono, fontSize: 10, color: "#555", marginTop: 14, textAlign: "center" }}>
                    <kbd>空格</kbd> 显示答案 / 下一个　<kbd>1</kbd> 再练　<kbd>M</kbd> 已掌握　<kbd>←</kbd><kbd>→</kbd> 切换
                  </p>
                </div>
              );
            })()}
          </div>
        )}

        {/* ═══ DECKS ═══ */}
        {view === "decks" && (
          <div style={S.content}>
            <div style={S.sectionHeader}>
              <h2 style={S.sectionTitle}>Decks</h2>
              <button className="ab" style={S.newDeckBtn} onClick={() => setShowDeckModal(true)}><I.Plus /> New Deck</button>
            </div>
            <div style={S.deckGrid}>
              {meta.decks.map(deck => {
                const st = deckStats[deck.id] || { count: 0, due: 0, nw: 0 };
                return (
                  <div key={deck.id} className="dk" style={{ ...S.deckCard, ...(activeDeck === deck.id ? { borderColor: accent } : {}) }}
                    onClick={() => { setActiveDeck(deck.id); setView("home"); }}>
                    <div style={S.deckName}>{deck.name}</div>
                    <div style={S.deckStats}>
                      <span>{st.count} cards</span>
                      {st.due > 0 && <span style={{ color: accent, fontWeight: 600 }}>{st.due} 到期</span>}
                      {st.nw > 0 && <span style={{ color: "#60a5fa" }}>{st.nw} 新</span>}
                    </div>
                    <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }}>
                      <button style={S.deckActionBtn} onClick={e => { e.stopPropagation(); setRenameDeckId(deck.id); setRenameDeckVal(deck.name); }}><I.Edit /></button>
                      {deck.id !== "default" && <button style={S.deckActionBtn} onClick={e => { e.stopPropagation(); setDeleteDeckConfirm(deck.id); }}><I.Trash /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
            {showDeckModal && <div style={S.modal} onClick={() => setShowDeckModal(false)}><div style={S.modalContent} onClick={e => e.stopPropagation()}>
              <h3 style={S.modalTitle}>New Deck</h3>
              <input style={S.modalInput} placeholder="Deck name..." value={newDeckName} onChange={e => setNewDeckName(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && createDeck()} autoFocus />
              <div style={S.modalActions}><button className="ab" style={S.modalCancel} onClick={() => setShowDeckModal(false)}>Cancel</button><button className="ab" style={S.modalConfirm} onClick={createDeck}>Create</button></div>
            </div></div>}
            {renameDeckId && <div style={S.modal} onClick={() => setRenameDeckId(null)}><div style={S.modalContent} onClick={e => e.stopPropagation()}>
              <h3 style={S.modalTitle}>Rename Deck</h3>
              <input style={S.modalInput} value={renameDeckVal} onChange={e => setRenameDeckVal(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && renameDeck()} autoFocus />
              <div style={S.modalActions}><button className="ab" style={S.modalCancel} onClick={() => setRenameDeckId(null)}>Cancel</button><button className="ab" style={S.modalConfirm} onClick={renameDeck}>Rename</button></div>
            </div></div>}
            {deleteDeckConfirm && <div style={S.modal} onClick={() => setDeleteDeckConfirm(null)}><div style={S.modalContent} onClick={e => e.stopPropagation()}>
              <h3 style={S.modalTitle}>确认删除</h3>
              <p style={{ fontFamily: sans, fontSize: 14, color: textDim, lineHeight: 1.6, marginBottom: 8 }}>确定要删除 <strong style={{ color: text }}>"{meta.decks.find(d => d.id === deleteDeckConfirm)?.name}"</strong> 吗？</p>
              <p style={{ fontFamily: mono, fontSize: 12, color: "#f87171", marginBottom: 16 }}>将删除 {deckStats[deleteDeckConfirm]?.count || 0} 张卡片，不可撤销。</p>
              <div style={S.modalActions}><button className="ab" style={S.modalCancel} onClick={() => setDeleteDeckConfirm(null)}>取消</button><button className="ab" style={S.deleteConfirmBtn} onClick={doDeleteDeck}>确认删除</button></div>
            </div></div>}
          </div>
        )}

        {/* ═══ USERS ═══ */}
        {view === "users" && (
          <div style={S.content}>
            <div style={S.sectionHeader}>
              <h2 style={S.sectionTitle}>Users</h2>
              <button className="ab" style={S.newDeckBtn} onClick={() => setShowUserModal(true)}><I.Plus /> New User</button>
            </div>
            <div style={S.deckGrid}>
              {global.users.map(user => (
                <div key={user.id} className="dk" style={{ ...S.deckCard, ...(global.activeUser === user.id ? { borderColor: accent } : {}) }}
                  onClick={() => switchUser(user.id)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}><I.User /> <span style={S.deckName}>{user.name}</span></div>
                  {global.activeUser === user.id && <span style={{ fontFamily: mono, fontSize: 10, color: accent }}>ACTIVE</span>}
                  {user.id !== "default" && <button style={{ ...S.deckActionBtn, position: "absolute", top: 8, right: 8 }} onClick={e => { e.stopPropagation(); setDeleteUserConfirm(user.id); }}><I.Trash /></button>}
                </div>
              ))}
            </div>
            {showUserModal && <div style={S.modal} onClick={() => setShowUserModal(false)}><div style={S.modalContent} onClick={e => e.stopPropagation()}>
              <h3 style={S.modalTitle}>New User</h3>
              <input style={S.modalInput} placeholder="User name..." value={newUserName} onChange={e => setNewUserName(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.nativeEvent.isComposing && createUser()} autoFocus />
              <div style={S.modalActions}><button className="ab" style={S.modalCancel} onClick={() => setShowUserModal(false)}>Cancel</button><button className="ab" style={S.modalConfirm} onClick={createUser}>Create</button></div>
            </div></div>}
            {deleteUserConfirm && <div style={S.modal} onClick={() => setDeleteUserConfirm(null)}><div style={S.modalContent} onClick={e => e.stopPropagation()}>
              <h3 style={S.modalTitle}>确认删除用户</h3>
              <p style={{ fontFamily: sans, fontSize: 14, color: textDim, lineHeight: 1.6, marginBottom: 8 }}>确定要删除用户 <strong style={{ color: text }}>"{global.users.find(u => u.id === deleteUserConfirm)?.name}"</strong> 吗？</p>
              <p style={{ fontFamily: mono, fontSize: 12, color: "#f87171", marginBottom: 16 }}>将删除该用户的所有数据，不可撤销。</p>
              <div style={S.modalActions}><button className="ab" style={S.modalCancel} onClick={() => setDeleteUserConfirm(null)}>取消</button><button className="ab" style={S.deleteConfirmBtn} onClick={() => deleteUser(deleteUserConfirm)}>确认删除</button></div>
            </div></div>}
          </div>
        )}

        {/* ═══ EXPORT ═══ */}
        {view === "export" && (
          <div style={S.content}>
            <div style={{ padding: "20px 0" }}>
              <h2 style={S.sectionTitle}>Backup & Sync</h2>
              <p style={{ fontFamily: mono, fontSize: 12, color: textDim, marginTop: 4, marginBottom: 16 }}>data/users/{uid()}/YYMM/MMDD.json</p>
              <div style={{ marginBottom: 20 }}>
                <h3 style={S.smallTitle}>Export users</h3>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {global.users.map(u => (
                    <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontFamily: mono, fontSize: 12, color: exportUsers.has(u.id) ? text : textDim }}>
                      <input type="checkbox" className="cb" checked={exportUsers.has(u.id)} onChange={() => toggleExportUser(u.id)} />{u.name}
                    </label>
                  ))}
                </div>
                <p style={{ fontFamily: mono, fontSize: 10, color: "#555", marginTop: 6 }}>{exportUsers.size === 0 ? "No selection = current user only" : `${exportUsers.size} user(s)`}</p>
              </div>
              <div style={S.exportCards}>
                <div style={S.exportCard} onClick={exportAll}><I.Download /><span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>Export</span><span style={{ fontFamily: mono, fontSize: 11, color: textDim }}>{dayFiles.length} files</span></div>
                <label style={S.exportCard}><input type="file" accept=".json" onChange={importAll} style={{ display: "none" }} /><I.Plus /><span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600 }}>Import</span><span style={{ fontFamily: mono, fontSize: 11, color: textDim }}>Restore</span></label>
              </div>
              <div style={{ marginBottom: 24 }}><h3 style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: text, marginBottom: 12 }}>Data Files</h3>
                <div style={S.codeBlock}><code style={S.code}>{dayFiles.length > 0 ? dayFiles.join("\n") : "(empty)"}</code></div></div>
              <div style={{ marginBottom: 24 }}>
                <button className="pill" onClick={exportLogs} style={{ fontSize: 12 }}><I.Download /> Export debug logs</button>
              </div>
              <div style={S.statsGrid}>
                {[
                  { n: cards.length, l: "Total" },
                  { n: cards.filter(c => c.state !== "review").length, l: "新卡" },
                  { n: dueIds.size, l: "到期" },
                  { n: cards.filter(c => c.state === "review" && (c.interval || 0) >= 21).length, l: "成熟 ≥21天" },
                ].map((s, i) => (
                  <div key={i} style={S.statCard}><div style={S.statNum}>{s.n}</div><div style={{ fontFamily: mono, fontSize: 11, color: textDim, marginTop: 4 }}>{s.l}</div></div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {canScroll && (
        <div style={{ position: "fixed", bottom: 24, right: 20, display: "flex", flexDirection: "column", gap: 6, zIndex: 90 }}>
          <button className="scb" style={S.scrollBtn} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><I.ArrowUp /></button>
          <button className="scb" style={S.scrollBtn} onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })}><I.ArrowDown /></button>
        </div>
      )}
    </div>
  );
}

const accent = "#e84400", accentDim = "#e8440033", bg = "#0a0a0b", surface = "#111113", surface2 = "#1a1a1e", border = "#222226", text = "#e8e6e3", textDim = "#777";
const mono = "'JetBrains Mono',monospace", serif = "'Crimson Pro',serif", sans = "'Noto Sans SC',system-ui,sans-serif";
const S = {
  root: { background: bg, minHeight: "100vh", color: text, fontFamily: sans, maxWidth: 720, margin: "0 auto", padding: "0 16px", paddingBottom: 60 },
  loadingScreen: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: bg },
  loadingPulse: { fontSize: 48, color: accent, animation: "pulse 1.5s infinite" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0 10px", borderBottom: `1px solid ${border}`, flexWrap: "wrap", gap: 6 },
  headerRight: { display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" },
  logo: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" },
  logoMark: { fontSize: 22, fontWeight: 700, color: accent },
  logoText: { fontFamily: mono, fontSize: 15, fontWeight: 600, color: text, letterSpacing: "-0.5px" },
  helpBtn: { width: 22, height: 22, marginLeft: 4, borderRadius: "50%", border: `1px solid ${border}`, background: surface, color: textDim, fontFamily: mono, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
  dueBadge: { fontFamily: mono, fontSize: 11, fontWeight: 600, background: accentDim, color: accent, padding: "3px 9px", borderRadius: 20, cursor: "pointer" },
  langSel: { fontFamily: mono, fontSize: 11, background: surface, color: text, border: `1px solid ${border}`, borderRadius: 4, padding: "3px 4px", cursor: "pointer" },
  nav: { display: "flex", gap: 2, padding: "10px 0", borderBottom: `1px solid ${border}`, alignItems: "center", flexWrap: "wrap" },
  main: { paddingTop: 6 },
  content: { animation: "fadeUp 0.3s ease" },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" },
  sectionTitle: { fontFamily: serif, fontSize: 22, fontWeight: 600, color: text },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 16 },
  emptyText: { fontFamily: serif, fontSize: 18, color: textDim },
  emptyBtn: { display: "flex", alignItems: "center", gap: 8, fontFamily: mono, fontSize: 13, fontWeight: 500, background: accent, color: "#fff", border: "none", padding: "10px 20px", borderRadius: 8, cursor: "pointer" },
  cardList: { display: "flex", flexDirection: "column", gap: 3 },
  cardItem: { display: "flex", alignItems: "flex-start", padding: "10px 12px", borderRadius: 8, background: surface, transition: "all .15s", animation: "fadeUp 0.3s ease both", borderLeft: "3px solid transparent" },
  cardWord: { fontFamily: serif, fontSize: 16, fontWeight: 600, color: text },
  cardTrans: { fontFamily: sans, fontSize: 13, color: textDim },
  cardTrans2: { fontFamily: mono, fontSize: 12, color: "#666" },
  cardItemRight: { display: "flex", alignItems: "center", gap: 6, marginLeft: 8, flexShrink: 0, paddingTop: 2 },
  deleteBtn: { background: "transparent", border: "none", color: "#444", cursor: "pointer", padding: 4, display: "flex" },
  editBtn: { background: "transparent", border: "none", color: "#555", cursor: "pointer", padding: 2, display: "flex", marginLeft: 4 },
  speakBtn: { background: "transparent", border: "none", color: "#666", cursor: "pointer", padding: 2, display: "flex", transition: "color .15s" },
  editInput: { fontFamily: sans, fontSize: 13, background: bg, color: text, border: `1px solid ${border}`, borderRadius: 6, padding: "6px 8px", lineHeight: 1.4 },
  editSave: { fontFamily: mono, fontSize: 14, background: "#16a34a33", color: "#4ade80", border: "none", borderRadius: 4, padding: "4px 8px", cursor: "pointer" },
  editCancel: { fontFamily: mono, fontSize: 14, background: "#dc262622", color: "#f87171", border: "none", borderRadius: 4, padding: "4px 8px", cursor: "pointer" },
  dateInput: { fontFamily: mono, fontSize: 12, background: surface, color: text, border: `1px solid ${border}`, borderRadius: 6, padding: "4px 8px", cursor: "pointer", width: 130 },
  addTitle: { fontFamily: serif, fontSize: 26, fontWeight: 700, color: text, marginBottom: 4 },
  addSub: { fontFamily: mono, fontSize: 12, color: textDim, marginBottom: 20 },
  inputRow: { display: "flex", gap: 8, marginBottom: 28, alignItems: "center", flexWrap: "wrap" },
  wordInput: { flex: 1, minWidth: 200, fontFamily: sans, fontSize: 15, background: surface, color: text, border: `2px solid ${border}`, borderRadius: 10, padding: "12px 14px" },
  addBtn: { display: "flex", alignItems: "center", gap: 6, fontFamily: mono, fontSize: 13, fontWeight: 600, background: accent, color: "#fff", border: "none", padding: "12px 20px", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap" },
  smallTitle: { fontFamily: mono, fontSize: 11, fontWeight: 600, color: textDim, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 10 },
  recentItem: { display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${border}`, animation: "slideIn 0.3s ease", flexWrap: "wrap" },
  recentWord: { fontFamily: serif, fontSize: 15, fontWeight: 600, color: text },
  recentTrans: { fontFamily: sans, fontSize: 14, color: textDim },
  recentTrans2: { fontFamily: mono, fontSize: 13, color: "#666" },
  intervals: { display: "flex", flexWrap: "wrap", gap: 5 },
  intervalPill: { fontFamily: mono, fontSize: 11, color: textDim, background: surface2, padding: "3px 9px", borderRadius: 20, border: `1px solid ${border}` },
  reviewArea: { display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0" },
  reviewProgress: { fontFamily: mono, fontSize: 12, color: textDim, marginBottom: 16 },
  reviewCard: { width: "100%", maxWidth: 520, background: surface, borderRadius: 16, padding: "24px 20px 28px", textAlign: "center", border: `1px solid ${border}` },
  reviewWord: { fontFamily: serif, fontSize: 32, fontWeight: 700, color: text },
  reviewTrans: { fontFamily: sans, fontSize: 20, fontWeight: 500, color: text },
  reviewTrans2: { fontFamily: mono, fontSize: 14, color: "#888" },
  showBtn: { display: "inline-flex", alignItems: "center", gap: 8, fontFamily: mono, fontSize: 13, background: surface2, color: text, border: `1px solid ${border}`, padding: "12px 24px", borderRadius: 10, cursor: "pointer" },
  badge: { fontFamily: mono, fontSize: 10, padding: "1px 8px", borderRadius: 10, border: "1px solid", lineHeight: 1.5 },
  gradeRow: { display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" },
  gradeBtn: { flex: "1 1 0", minWidth: 92, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontFamily: mono, padding: "10px 6px", borderRadius: 10, border: "1px solid", cursor: "pointer" },
  deckGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 12, paddingTop: 8 },
  deckCard: { background: surface, borderRadius: 12, padding: "18px 14px", border: `1px solid ${border}`, cursor: "pointer", transition: "all .2s", position: "relative" },
  deckName: { fontFamily: serif, fontSize: 16, fontWeight: 600, color: text, marginBottom: 6 },
  deckStats: { fontFamily: mono, fontSize: 11, color: textDim, display: "flex", gap: 8, flexWrap: "wrap" },
  deckActionBtn: { background: "transparent", border: "none", color: "#555", cursor: "pointer", padding: 3, display: "flex" },
  newDeckBtn: { display: "flex", alignItems: "center", gap: 6, fontFamily: mono, fontSize: 12, fontWeight: 500, background: surface2, color: text, border: `1px solid ${border}`, padding: "5px 12px", borderRadius: 8, cursor: "pointer" },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modalContent: { background: surface, borderRadius: 16, padding: 24, width: "90%", maxWidth: 360, border: `1px solid ${border}` },
  modalTitle: { fontFamily: serif, fontSize: 20, fontWeight: 600, color: text, marginBottom: 14 },
  modalInput: { width: "100%", fontFamily: mono, fontSize: 14, background: bg, color: text, border: `2px solid ${border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 10 },
  modalActions: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 },
  modalCancel: { fontFamily: mono, fontSize: 12, background: "transparent", color: textDim, border: `1px solid ${border}`, padding: "7px 14px", borderRadius: 8, cursor: "pointer" },
  modalConfirm: { fontFamily: mono, fontSize: 12, background: accent, color: "#fff", border: "none", padding: "7px 14px", borderRadius: 8, cursor: "pointer" },
  deleteConfirmBtn: { fontFamily: mono, fontSize: 12, background: "#dc2626", color: "#fff", border: "none", padding: "7px 14px", borderRadius: 8, cursor: "pointer" },
  exportCards: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 },
  exportCard: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "24px 14px", background: surface, borderRadius: 12, border: `1px solid ${border}`, cursor: "pointer", color: text },
  codeBlock: { background: surface, borderRadius: 10, padding: 14, border: `1px solid ${border}`, overflowX: "auto" },
  code: { fontFamily: mono, fontSize: 11, color: "#a8b1c0", lineHeight: 1.7, whiteSpace: "pre" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 },
  statCard: { background: surface, borderRadius: 10, padding: "14px 10px", border: `1px solid ${border}`, textAlign: "center" },
  statNum: { fontFamily: mono, fontSize: 22, fontWeight: 700, color: accent },
  toast: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", fontFamily: mono, fontSize: 13, background: surface2, color: text, padding: "8px 18px", borderRadius: 10, border: `1px solid ${border}`, zIndex: 200, animation: "toast 2.2s ease both", whiteSpace: "nowrap" },
  pageBtn: { fontFamily: mono, fontSize: 11, background: "transparent", color: textDim, border: `1px solid ${border}`, padding: "4px 12px", borderRadius: 6, cursor: "pointer" },
  pageBtnActive: { background: accent, color: "#fff", borderColor: accent },
  pageLink: { fontFamily: mono, fontSize: 12, background: "transparent", border: "none", color: textDim, cursor: "pointer", padding: "2px 8px" },
  scrollBtn: { width: 36, height: 36, borderRadius: "50%", background: `${surface}cc`, border: `1px solid ${border}`, color: textDim, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)", transition: "all .15s", opacity: 0.6 },
};