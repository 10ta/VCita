import { useState, useEffect, useRef, useMemo } from "react";

const INIT_SRC = __SOURCE_LANG__;
const INIT_T1 = __TARGET_LANG_1__;
const INIT_T2 = __TARGET_LANG_2__;
const EBB = __EBBINGHAUS_DAYS__;
const INIT_SHOW_SRC = __SHOW_SOURCE__;
const INIT_SHOW_T1 = __SHOW_TARGET_1__;
const INIT_SHOW_T2 = __SHOW_TARGET_2__;
const PAGE_SIZES = __PAGE_SIZES__;
const DEFAULT_PAGE_SIZE = __DEFAULT_PAGE_SIZE__;
const INIT_AUTO_ADD = __AUTO_PLAY_ADD__;
const INIT_AUTO_REVIEW = __AUTO_PLAY_REVIEW__;

// ─── 性能参数 ───
const WRITE_CONCURRENCY = 8;           // 导入、删除用户时的并发请求数
const SYNC_CHUNK = 100;                // 一次 sync 请求最多携带的日文件数
const SAVE_DEBOUNCE_MS = 400;          // 修改后合并落盘的等待时间
const SAVE_MAX_WAIT_MS = 2000;         // 连续修改时最长等待，避免一直不落盘
const REMOTE_REFRESH_MIN_GAP_MS = 30000; // 保存后发现远端有改动时，自动刷新的最小间隔
const TRANSLATE_TIMEOUT_MS = 8000;

const LANGS = [
  { code: "zh-CN", label: "中文" }, { code: "ja", label: "日本語" }, { code: "ko", label: "한국어" },
  { code: "en", label: "English" }, { code: "fr", label: "Français" }, { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" }, { code: "pt", label: "Português" }, { code: "ru", label: "Русский" },
  { code: "ar", label: "العربية" }, { code: "it", label: "Italiano" }, { code: "nl", label: "Nederlands" },
];
const LN = Object.fromEntries(LANGS.map(l => [l.code, l.label]));

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const addDays = (ds, n) => { const d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtShort = ds => ds.slice(2).replace(/-/g, "");
const dateToDayPath = (userId, ds) => { const [y, m, d] = ds.split("-"); return `users/${userId}/${y.slice(2)}${m}/${m}${d}.json`; };
const userMetaPath = uid => `users/${uid}/meta.json`;
const dayDiff = (dateStr) => { const t = new Date(todayStr() + "T00:00:00"), d = new Date(dateStr + "T00:00:00"); return Math.round((d - t) / 86400000); };

// 同一个 createdAt 的复习日程只算一次
const schedCache = new Map();
const getScheduleDates = card => {
  let s = schedCache.get(card.createdAt);
  if (!s) { s = EBB.map(d => addDays(card.createdAt, d)); schedCache.set(card.createdAt, s); }
  return s;
};
const isDueOn = (card, date) => {
  const history = card.reviewHistory || [];
  return getScheduleDates(card).some(sd => sd <= date && !history.some(h => h.date === sd));
};
const redCountOf = card => (card.reviewHistory || []).filter(h => !h.remembered).length;
const applyReview = (card, remembered, rd) => {
  const newHistory = [...(card.reviewHistory || [])];
  for (const sd of getScheduleDates(card))
    if (sd <= rd && !newHistory.some(h => h.date === sd)) newHistory.push({ date: sd, remembered });
  const stage = card.reviewStage || 0;
  const ns = remembered ? Math.min(stage + 1, EBB.length - 1) : Math.max(0, stage - 1);
  return { ...card, reviewStage: ns, nextReview: addDays(rd, EBB[ns]), reviewHistory: newHistory };
};
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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
const speak = (text, lang) => {
  if (!text) return;
  const audio = new Audio(`${BASE}api/tts?q=${encodeURIComponent(text)}&tl=${lang}`);
  audio.play().catch(e => log("error", "TTS failed", { text, lang, error: e.message }));
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
// 顺带检测"卡片所在文件与 createdAt 不符"或"同一 id 出现在多处"，
// 返回需要重写的路径和各文件需要剔除的 id，交给 sync 自动修复。
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
  const cards = [...byId.values()].map(v => v.card);
  log("info", "loadSnapshot", { uid, files: dayFiles.length, cards: cards.length, repair: repair.size, ms: Math.round(performance.now() - t0) });
  return { uid, global, rev: snap.rev, meta, cards, dayFiles, repairPaths: [...repair], repairDrops: drops };
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
};

// Rotation display helper
const getCardDisplay = (card, meta) => {
  const rot = (card.rot || 0) % 3;
  const texts = [card.word, card.translation, card.translation2];
  const langs = [meta.sourceLang, meta.targetLang1, meta.targetLang2];
  return { src: texts[rot], t1: texts[(rot + 1) % 3], t2: texts[(rot + 2) % 3], srcL: langs[rot], t1L: langs[(rot + 1) % 3], t2L: langs[(rot + 2) % 3] };
};

// ─── 小组件放在 App 外部：否则每次渲染都是新组件类型，会被卸载重建（日期选择器被打断的原因）───
const LangSelect = ({ value, onChange }) => <select style={S.langSel} value={value} onChange={e => onChange(e.target.value)}>{LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select>;
const DateInput = ({ value, onChange, style: sx }) => <input type="date" value={value} onChange={e => e.target.value && onChange(e.target.value)} style={{ ...S.dateInput, ...sx }} />;

const ScheduleDots = ({ card, today, onToggle }) => {
  const sched = getScheduleDates(card);
  return (
    <div style={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}>
      {sched.map((schDate, i) => {
        const rh = (card.reviewHistory || []).find(h => h.date === schDate);
        const isToday = schDate === today, isPast = schDate < today;
        const diff = dayDiff(schDate);
        let bg = "#333", clr = "#666";
        if (rh) { bg = rh.remembered ? "#16a34a" : "#dc2626"; clr = "#fff"; }
        else if (isToday) { bg = accent; clr = "#fff"; }
        else if (isPast) { bg = "#555"; clr = "#aaa"; }
        const diffLabel = isToday ? "" : diff > 0 ? `+${diff}` : `${diff}`;
        const clickable = !!rh;
        return (
          <span key={i} title={`Day ${EBB[i]} → ${schDate}${clickable ? " (click to toggle)" : ""}`}
            onClick={clickable ? e => { e.stopPropagation(); onToggle(card, schDate); } : undefined}
            style={{ fontFamily: mono, fontSize: 9, padding: "2px 5px", borderRadius: 3, background: bg, color: clr, lineHeight: 1.2, display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 0, cursor: clickable ? "pointer" : "default" }}>
            {diffLabel && <span style={{ fontSize: 7, opacity: 0.7, lineHeight: 1 }}>{diffLabel}</span>}
            {fmtShort(schDate)}
          </span>
        );
      })}
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
  // Review state — frozen queue approach
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewPos, setReviewPos] = useState(0);
  const [reviewRevealed, setReviewRevealed] = useState(false);
  const [reviewSnapshot, setReviewSnapshot] = useState(null);
  const [reviewDate, setReviewDate] = useState(todayStr());
  const [reviewAutoPlay, setReviewAutoPlay] = useState(INIT_AUTO_REVIEW);
  const [reviewQuizType, setReviewQuizType] = useState(0);
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
  // Intensive review
  const [intensiveQueue, setIntensiveQueue] = useState([]);
  const [intensivePos, setIntensivePos] = useState(0);
  const [intensiveRevealed, setIntensiveRevealed] = useState(false);
  const [intensiveSnapshot, setIntensiveSnapshot] = useState(null);
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
      for (const c of foreign) if (typeof c.createdAt === "string" && !ids.has(c.id)) { ids.add(c.id); add.push(c); }
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
      log("info", "repairing day files", { paths: data.repairPaths });
      markDirty(data.repairPaths);
    }
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
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  const updateMeta = m => {
    setMeta(m);
    mutationSeqRef.current++;
    return saveUserMeta(uid(), m).then(noteRev).catch(e => { log("error", "saveUserMeta failed", { error: e.message }); showToast("设置保存失败"); });
  };

  // ─── Review session：直接从内存过滤，不发请求 ───
  const startReviewSession = (forDate, deckId = latestRef.current.activeDeck) => {
    const due = cardsRef.current.filter(c => c.deckId === deckId && isDueOn(c, forDate));
    log("info", "startReviewSession", { date: forDate, deck: deckId, count: due.length });
    setReviewQueue(due.map(c => ({ ...c })));
    setReviewPos(0);
    setReviewRevealed(false);
    setReviewSnapshot(null);
  };

  // ─── Users ───
  const resetSessionUI = () => {
    setActiveDeck("default"); setSelected(new Set()); setView("home");
    setReviewQueue([]); setReviewPos(0); setReviewRevealed(false); setReviewSnapshot(null);
    setIntensiveQueue([]); setIntensivePos(0); setIntensiveRevealed(false); setIntensiveSnapshot(null);
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
      reviewStage: 0, nextReview: addDays(addDate, EBB[0]),
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
  const clearReview = card => {
    const cur = getLatest(card.id); if (!cur) return;
    upsertCards([{ ...cur, reviewHistory: [], reviewStage: 0, nextReview: addDays(cur.createdAt, EBB[0]) }]);
    showToast("Tags cleared");
  };
  const batchClearTags = () => {
    if (selected.size === 0) return;
    const updated = cardsRef.current.filter(c => selected.has(c.id)).map(c => ({
      ...c, reviewHistory: [], reviewStage: 0, nextReview: addDays(c.createdAt, EBB[0])
    }));
    upsertCards(updated);
    showToast(`Cleared tags on ${updated.length} cards`); setSelected(new Set()); setClearTagConfirm(false);
    log("info", "batchClearTags", { count: updated.length });
  };
  const batchChangeDate = newDate => {
    if (selected.size === 0 || !newDate) return;
    const updated = cardsRef.current.filter(c => selected.has(c.id))
      .map(c => ({ ...c, createdAt: newDate, nextReview: addDays(newDate, EBB[c.reviewStage || 0]) }));
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
    upsertCards([{ ...cur, createdAt: newDate, nextReview: addDays(newDate, EBB[cur.reviewStage || 0]) }]);
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

  // ─── Review ───
  const doReview = (cardId, remembered) => {
    const card = getLatest(cardId);
    if (!card) { log("error", "doReview: card not found", { cardId }); return; }
    const updated = applyReview(card, remembered, reviewDate);
    setReviewQueue(q => q.map(c => c.id === cardId ? updated : c));
    setReviewSnapshot(updated);
    setReviewRevealed(true);
    upsertCards([updated]);
    log("info", "doReview", { cardId, remembered, stage: updated.reviewStage, date: reviewDate });
  };

  const nextReviewCard = () => { setReviewRevealed(false); setReviewSnapshot(null); setReviewPos(p => Math.min(p + 1, reviewQueue.length)); };
  const prevReviewCard = () => { setReviewRevealed(false); setReviewSnapshot(null); setReviewPos(p => Math.max(p - 1, 0)); };

  const toggleReviewDot = (cardArg, schDate) => {
    const latest = getLatest(cardArg.id);
    if (!latest) return;
    const rh = (latest.reviewHistory || []).find(h => h.date === schDate);
    if (!rh) return;
    const updated = { ...latest, reviewHistory: latest.reviewHistory.map(h => h.date === schDate ? { ...h, remembered: !h.remembered } : h) };
    setReviewQueue(q => q.map(c => c.id === latest.id ? updated : c));
    setIntensiveQueue(q => q.map(c => c.id === latest.id ? updated : c));
    setReviewSnapshot(s => s?.id === latest.id ? updated : s);
    setIntensiveSnapshot(s => s?.id === latest.id ? updated : s);
    upsertCards([updated]);
    log("info", "toggleReviewDot", { cardId: latest.id, date: schDate, newRemembered: !rh.remembered });
  };

  // ─── Intensive ───
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
    setIntensiveQueue(ic.map(c => ({ ...c })));
    setIntensivePos(0);
    setIntensiveRevealed(false);
    setIntensiveSnapshot(null);
    log("info", "startIntensiveSession", { mode: m, count: ic.length });
  };

  const doIntensiveReview = (cardId, remembered) => {
    const card = getLatest(cardId);
    if (!card) return;
    const updated = applyReview(card, remembered, todayStr());
    setIntensiveQueue(q => q.map(c => c.id === cardId ? updated : c));
    setIntensiveSnapshot(updated);
    setIntensiveRevealed(true);
    upsertCards([updated]);
  };

  const masterCard = cardId => {
    const card = getLatest(cardId);
    if (!card) return;
    const today = todayStr();
    const pastDates = getScheduleDates(card).filter(sd => sd <= today);
    const futureEntries = (card.reviewHistory || []).filter(h => h.date > today);
    const updated = { ...card, reviewHistory: [...pastDates.map(sd => ({ date: sd, remembered: true })), ...futureEntries] };
    setIntensiveQueue(q => q.map(c => c.id === cardId ? updated : c));
    setIntensiveRevealed(false);
    setIntensiveSnapshot(null);
    setIntensivePos(p => p + 1);
    upsertCards([updated]);
    showToast("Mastered!");
    log("info", "masterCard", { cardId, greenDates: pastDates.length });
  };

  const nextIntensiveCard = () => { setIntensiveRevealed(false); setIntensiveSnapshot(null); setIntensivePos(p => Math.min(p + 1, intensiveQueue.length)); };
  const prevIntensiveCard = () => { setIntensiveRevealed(false); setIntensiveSnapshot(null); setIntensivePos(p => Math.max(p - 1, 0)); };

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
  const deckCards = useMemo(() => cards.filter(c => c.deckId === activeDeck), [cards, activeDeck]);
  const dueIds = useMemo(() => { const s = new Set(); for (const c of cards) if (isDueOn(c, td)) s.add(c.id); return s; }, [cards, td]);
  const allDueCount = dueIds.size;
  const deckStats = useMemo(() => {
    const m = {};
    for (const c of cards) { const s = m[c.deckId] || (m[c.deckId] = { count: 0, due: 0 }); s.count++; if (dueIds.has(c.id)) s.due++; }
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

  const reviewCurrentCard = (() => {
    if (reviewRevealed && reviewSnapshot) return reviewSnapshot;
    if (reviewPos < reviewQueue.length) return reviewQueue[reviewPos];
    return null;
  })();
  const reviewTotal = reviewQueue.length;
  const reviewDone = reviewPos >= reviewTotal && reviewTotal > 0;

  const intensiveCurrentCard = (() => {
    if (intensiveRevealed && intensiveSnapshot) return intensiveSnapshot;
    if (intensivePos < intensiveQueue.length) return intensiveQueue[intensivePos];
    return null;
  })();
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
      const blob = new Blob([JSON.stringify({ version: 4, exportedAt: new Date().toISOString(), files }, null, 2)], { type: "application/json" });
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
    { id: "review", label: `复习${allDueCount ? ` (${allDueCount})` : ""}`, icon: <I.RefreshCw /> },
    { id: "intensive", label: `强化${intensiveCount ? ` (${intensiveCount})` : ""}`, icon: <I.Flame /> },
    { id: "decks", label: "牌组", icon: <I.Layers /> },
    { id: "export", label: "备份", icon: <I.Save /> },
    { id: "users", label: "用户", icon: <I.User /> },
  ];

  const toggleExportUser = id => setExportUsers(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

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
        @keyframes cardFlip{from{transform:rotateX(90deg);opacity:0}to{transform:rotateX(0);opacity:1}}
        .hi:hover{background:#161618!important}
        @media(hover:none){.hi:hover{background:inherit!important}}
        .card-due{border:1px solid #e8440088!important;box-shadow:0 0 8px #e8440022}
        .card-sel{background:#1a1410!important;border-left:3px solid #e84400!important}
        .nb{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:500;background:transparent;color:#777;border:1px solid transparent;padding:4px 11px;border-radius:6px;cursor:pointer;transition:all .15s;display:flex;align-items:center;gap:4px}
        .nb:hover:not(.nav-active){background:#1a1a1e}
        .nb.nav-active{background:#1a1a1e;border-color:#e84400;color:#e8e6e3}
        .ab:hover{transform:translateY(-1px);filter:brightness(1.1)}.dk:hover{border-color:#e84400!important}
        .spk:hover{color:#e84400!important}.scb:hover{opacity:1!important;border-color:#e84400!important;color:#e84400!important}
        input::placeholder{color:#444}
        .cb{appearance:none;width:16px;height:16px;border:2px solid #333;border-radius:4px;cursor:pointer;flex-shrink:0;position:relative;background:transparent;outline:none}
        .cb:checked{border-color:#e84400;background:#e84400}.cb:checked::after{content:'✓';position:absolute;top:-2px;left:2px;font-size:11px;color:#fff;font-weight:700}
        .cb:focus{box-shadow:none}
        .pill{font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 10px;border-radius:20px;cursor:pointer;border:1px solid #333;background:transparent;color:#777;transition:all .15s;display:inline-flex;align-items:center;gap:4px}
        .pill:hover{border-color:#555;color:#e8e6e3}.pill.on{border-color:#e84400;background:#e8440022;color:#e84400}
        .deck-tabs{display:flex;gap:0;overflow:hidden;flex:1;min-width:0}
        .deck-tabs.expanded{flex-wrap:wrap;overflow:visible}
        .dtab{font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer;border:1px solid #222226;background:transparent;color:#777;white-space:nowrap;transition:all .15s}
        .dtab:hover{background:#1a1a1e;color:#e8e6e3}.dtab.active{background:#e84400;color:#fff;border-color:#e84400}
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
          {allDueCount > 0 && <div style={S.dueBadge} onClick={() => { setView("review"); startReviewSession(reviewDate, activeDeck); }}>{allDueCount} due</div>}
          <LangSelect value={meta.sourceLang} onChange={setSourceLang} />
          <span style={{ color: accent, fontSize: 11, fontFamily: mono }}>→</span>
          <LangSelect value={meta.targetLang1} onChange={setTargetLang1} />
          <span style={{ color: "#555", fontSize: 10, fontFamily: mono }}>/</span>
          <LangSelect value={meta.targetLang2} onChange={setTargetLang2} />
        </div>
      </header>

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
                    {selected.size > 0 && <button className="pill" style={{ borderColor: "#eab308", color: "#facc15" }} onClick={() => setClearTagConfirm(true)}>清除tag</button>}
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
                      <div key={card.id} className={`hi${isSel ? " card-sel" : ""}${isDue && !isSel ? " card-due" : ""}`} style={{ ...S.cardItem, animationDelay: `${Math.min(i, 20) * 25}ms` }}>
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
                            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}><ScheduleDots card={card} today={td} onToggle={toggleReviewDot} /></div>
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
                          {(card.reviewHistory || []).length > 0 && <button className="spk" style={{ ...S.speakBtn, padding: 4, color: "#facc15" }} onClick={e => { e.stopPropagation(); clearReview(card); }} title="Clear review">✕</button>}
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
                  <h3 style={S.modalTitle}>确认清除</h3>
                  <p style={{ fontFamily: sans, fontSize: 14, color: textDim, lineHeight: 1.6, marginBottom: 8 }}>确定要清除 <strong style={{ color: text }}>{selected.size}</strong> 张卡片的所有复习记录吗？</p>
                  <p style={{ fontFamily: mono, fontSize: 12, color: "#facc15", marginBottom: 16 }}>复习进度将重置为初始状态，不可撤销。</p>
                  <div style={S.modalActions}><button className="ab" style={S.modalCancel} onClick={() => setClearTagConfirm(false)}>取消</button><button className="ab" style={{ ...S.deleteConfirmBtn, background: "#ca8a04" }} onClick={batchClearTags}>确认清除</button></div>
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
                const stc = cards.find(c => c.id === singleTagCard);
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
              <div><h3 style={S.smallTitle}>Ebbinghaus Schedule</h3><div style={S.intervals}>{EBB.map((d, i) => <div key={i} style={S.intervalPill}>Day {d}</div>)}</div></div>
            </div>
          </div>
        )}

        {/* ═══ REVIEW ═══ */}
        {view === "review" && (
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
            {reviewTotal === 0 ? (
              <div style={S.empty}><div style={{ fontSize: 48, color: "#4ade80", marginBottom: 8 }}>✓</div>
                <p style={S.emptyText}>No cards due on {reviewDate}</p></div>
            ) : reviewDone ? (
              <div style={S.empty}><div style={{ fontSize: 48, color: "#4ade80", marginBottom: 8 }}>✓</div>
                <p style={S.emptyText}>All {reviewTotal} cards reviewed!</p></div>
            ) : (() => {
              const rc = reviewCurrentCard;
              if (!rc) return <div style={S.empty}><p style={S.emptyText}>Loading...</p></div>;
              const d = getCardDisplay(rc, meta);
              const allFields = [d.src, d.t1, d.t2];
              const allLangs = [d.srcL, d.t1L, d.t2L];
              const qIdx = reviewQuizType;
              const question = allFields[qIdx];
              const questionLang = allLangs[qIdx];
              const ans = allFields.filter((_, i) => i !== qIdx);
              const ansL = allLangs.filter((_, i) => i !== qIdx);
              return (
                <div style={S.reviewArea}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 8 }}>
                    {reviewPos > 0 && <button className="pill" onClick={prevReviewCard} style={{ fontSize: 11 }}>‹ 上一个</button>}
                    <span style={S.reviewProgress}>{reviewPos + 1} / {reviewTotal}</span>
                    {reviewPos < reviewTotal - 1 && <button className="pill" onClick={nextReviewCard} style={{ fontSize: 11 }}>下一个 ›</button>}
                  </div>
                  <div style={S.reviewCard} key={rc.id + reviewPos}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
                      <div style={S.reviewWord}>{question}</div>
                      <button className="spk" style={{ ...S.speakBtn, padding: 4 }} onClick={() => speak(question, questionLang)}><I.Speaker size={18} /></button>
                    </div>
                    <div style={{ marginTop: 8, marginBottom: 24 }}><ScheduleDots card={rc} today={td} onToggle={toggleReviewDot} /></div>
                    <div style={{ minHeight: 52 }}>
                      {!reviewRevealed ? (
                        <div style={S.reviewActions}>
                          <button className="ab" style={S.forgotBtn} onClick={() => doReview(rc.id, false)}><I.X /> 不记得</button>
                          <button className="ab" style={S.knewBtn} onClick={() => doReview(rc.id, true)}><I.Check /> 记得</button>
                        </div>
                      ) : (
                        <button className="ab" style={{ ...S.showBtn, width: "100%", justifyContent: "center" }} onClick={nextReviewCard}>Next →</button>
                      )}
                    </div>
                    {reviewRevealed && (
                      <div style={{ animation: "fadeUp 0.3s ease", marginTop: 20, borderTop: `1px solid ${border}`, paddingTop: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                          <div style={S.reviewTrans}>{ans[0]}</div>
                          <button className="spk" style={S.speakBtn} onClick={() => speak(ans[0], ansL[0])}><I.Speaker /></button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 6 }}>
                          <div style={S.reviewTrans2}>{ans[1]}</div>
                          <button className="spk" style={S.speakBtn} onClick={() => speak(ans[1], ansL[1])}><I.Speaker /></button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

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
              <div style={{ marginLeft: "auto" }}><button className={`pill${reviewAutoPlay ? " on" : ""}`} onClick={() => setReviewAutoPlay(!reviewAutoPlay)}><I.Speaker size={12} /> 自动播放</button></div>
            </div>
            {intensiveTotal === 0 ? (
              <div style={S.empty}><div style={{ fontSize: 48, color: "#4ade80", marginBottom: 8 }}>✓</div>
                <p style={S.emptyText}>{intensiveMode === "hard" ? "没有高难度词汇" : "该标签没有词汇"}</p></div>
            ) : intensiveDone ? (
              <div style={S.empty}><div style={{ fontSize: 48, color: "#4ade80", marginBottom: 8 }}>✓</div>
                <p style={S.emptyText}>强化复习完成！共 {intensiveTotal} 个</p></div>
            ) : (() => {
              const rc = intensiveCurrentCard;
              if (!rc) return <div style={S.empty}><p style={S.emptyText}>Loading...</p></div>;
              const d = getCardDisplay(rc, meta);
              const redCount = redCountOf(rc);
              const allFields = [d.src, d.t1, d.t2];
              const allLangs = [d.srcL, d.t1L, d.t2L];
              const qIdx = reviewQuizType;
              const question = allFields[qIdx], questionLang = allLangs[qIdx];
              const ans = allFields.filter((_, i) => i !== qIdx);
              const ansL = allLangs.filter((_, i) => i !== qIdx);
              return (
                <div style={S.reviewArea}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 8 }}>
                    {intensivePos > 0 && <button className="pill" onClick={prevIntensiveCard} style={{ fontSize: 11 }}>‹ 上一个</button>}
                    <span style={S.reviewProgress}>{intensivePos + 1} / {intensiveTotal}</span>
                    {intensivePos < intensiveTotal - 1 && <button className="pill" onClick={nextIntensiveCard} style={{ fontSize: 11 }}>下一个 ›</button>}
                  </div>
                  <div style={S.reviewCard} key={rc.id + intensivePos}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 4 }}>
                      <div style={S.reviewWord}>{question}</div>
                      <button className="spk" style={{ ...S.speakBtn, padding: 4 }} onClick={() => speak(question, questionLang)}><I.Speaker size={18} /></button>
                    </div>
                    {redCount > 0 && <div style={{ fontFamily: mono, fontSize: 11, color: "#f87171", marginBottom: 8 }}>{redCount} failed</div>}
                    {(rc.tags || []).length > 0 && <div style={{ display: "flex", gap: 3, justifyContent: "center", marginBottom: 4 }}>{(rc.tags || []).map(t => <span key={t} style={{ fontFamily: mono, fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "#8b5cf622", border: "1px solid #8b5cf644", color: "#a78bfa" }}>{t}</span>)}</div>}
                    <div style={{ marginTop: 4, marginBottom: 20 }}><ScheduleDots card={rc} today={td} onToggle={toggleReviewDot} /></div>
                    <div style={{ minHeight: 52 }}>
                      {!intensiveRevealed ? (
                        <div style={S.reviewActions}>
                          <button className="ab" style={S.forgotBtn} onClick={() => doIntensiveReview(rc.id, false)}><I.X /> 不记得</button>
                          <button className="ab" style={S.knewBtn} onClick={() => doIntensiveReview(rc.id, true)}><I.Check /> 记得</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="ab" style={{ ...S.showBtn, flex: 1, justifyContent: "center" }} onClick={nextIntensiveCard}>Next →</button>
                          <button className="ab" style={{ ...S.showBtn, justifyContent: "center", background: "#16a34a22", borderColor: "#16a34a44", color: "#4ade80" }} onClick={() => masterCard(rc.id)}>✓ 已掌握</button>
                        </div>
                      )}
                    </div>
                    {intensiveRevealed && (
                      <div style={{ animation: "fadeUp 0.3s ease", marginTop: 20, borderTop: `1px solid ${border}`, paddingTop: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                          <div style={S.reviewTrans}>{ans[0]}</div>
                          <button className="spk" style={S.speakBtn} onClick={() => speak(ans[0], ansL[0])}><I.Speaker /></button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 6 }}>
                          <div style={S.reviewTrans2}>{ans[1]}</div>
                          <button className="spk" style={S.speakBtn} onClick={() => speak(ans[1], ansL[1])}><I.Speaker /></button>
                        </div>
                      </div>
                    )}
                  </div>
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
                const count = deckStats[deck.id]?.count || 0;
                const due = deckStats[deck.id]?.due || 0;
                return (
                  <div key={deck.id} className="dk" style={{ ...S.deckCard, ...(activeDeck === deck.id ? { borderColor: accent } : {}) }}
                    onClick={() => { setActiveDeck(deck.id); setView("home"); }}>
                    <div style={S.deckName}>{deck.name}</div>
                    <div style={S.deckStats}><span>{count} cards</span>{due > 0 && <span style={{ color: accent, fontWeight: 600 }}>{due} due</span>}</div>
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
                {[{ n: cards.length, l: "Total" }, { n: meta.decks.length, l: "Decks" }, { n: allDueCount, l: "Due" }, { n: cards.filter(c => c.reviewStage >= EBB.length - 1).length, l: "Done" }].map((s, i) => (
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
  reviewCard: { width: "100%", maxWidth: 480, background: surface, borderRadius: 16, padding: "32px 24px", textAlign: "center", border: `1px solid ${border}` },
  reviewWord: { fontFamily: serif, fontSize: 32, fontWeight: 700, color: text },
  reviewTrans: { fontFamily: sans, fontSize: 20, fontWeight: 500, color: text },
  reviewTrans2: { fontFamily: mono, fontSize: 14, color: "#888" },
  showBtn: { display: "inline-flex", alignItems: "center", gap: 8, fontFamily: mono, fontSize: 13, background: surface2, color: text, border: `1px solid ${border}`, padding: "10px 24px", borderRadius: 10, cursor: "pointer" },
  reviewActions: { display: "flex", gap: 12, justifyContent: "center" },
  forgotBtn: { display: "flex", alignItems: "center", gap: 6, fontFamily: mono, fontSize: 13, fontWeight: 600, background: "#dc262622", color: "#f87171", border: "1px solid #dc262644", padding: "12px 28px", borderRadius: 10, cursor: "pointer" },
  knewBtn: { display: "flex", alignItems: "center", gap: 6, fontFamily: mono, fontSize: 13, fontWeight: 600, background: "#16a34a22", color: "#4ade80", border: "1px solid #16a34a44", padding: "12px 28px", borderRadius: 10, cursor: "pointer" },
  deckGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", gap: 12, paddingTop: 8 },
  deckCard: { background: surface, borderRadius: 12, padding: "18px 14px", border: `1px solid ${border}`, cursor: "pointer", transition: "all .2s", position: "relative" },
  deckName: { fontFamily: serif, fontSize: 16, fontWeight: 600, color: text, marginBottom: 6 },
  deckStats: { fontFamily: mono, fontSize: 11, color: textDim, display: "flex", gap: 8 },
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
