import { useState, useEffect, useCallback, useRef } from "react";

const INIT_SRC = __SOURCE_LANG__;
const INIT_T1 = __TARGET_LANG_1__;
const INIT_T2 = __TARGET_LANG_2__;
const EBB = __EBBINGHAUS_DAYS__;

const LANGS = [
  { code: "zh-CN", label: "中文" }, { code: "ja", label: "日本語" }, { code: "ko", label: "한국어" },
  { code: "en", label: "English" }, { code: "fr", label: "Français" }, { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" }, { code: "pt", label: "Português" }, { code: "ru", label: "Русский" },
  { code: "ar", label: "العربية" }, { code: "it", label: "Italiano" }, { code: "nl", label: "Nederlands" },
];
const LN = Object.fromEntries(LANGS.map(l => [l.code, l.label]));

// ─── Date ───
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const addDays = (ds, n) => { const d = new Date(ds+"T00:00:00"); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const fmtShort = ds => ds.slice(2).replace(/-/g,""); // "2026-04-12" → "260412"
// "2026-04-12" → "2604/0412"
const dateToDayPath = ds => {
  const [y, m, d] = ds.split("-");
  return `${y.slice(2)}${m}/${m}${d}.json`;
};

// ─── File API helpers ───
const api = {
  async write(p, data) {
    await fetch("/api/write", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p, data: typeof data === "string" ? data : JSON.stringify(data, null, 2) }) });
  },
  async read(p) {
    const r = await fetch("/api/read", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p }) });
    const j = await r.json();
    if (!j.exists) return null;
    try { return JSON.parse(j.data); } catch { return j.data; }
  },
  async del(p) {
    await fetch("/api/delete", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p }) });
  },
  async list() {
    const r = await fetch("/api/list");
    const j = await r.json();
    return j.files || [];
  },
};

// Meta (decks + lang settings) stored in data/meta.json
const loadMeta = async () => (await api.read("meta.json")) || { decks: [{ id: "default", name: "Default", createdAt: Date.now() }], sourceLang: INIT_SRC, targetLang1: INIT_T1, targetLang2: INIT_T2 };
const saveMeta = m => api.write("meta.json", m);

// Load all cards from all daily files
const loadAllCards = async () => {
  const files = await api.list();
  const dayFiles = files.filter(f => f !== "meta.json");
  const cards = [];
  for (const f of dayFiles) {
    const arr = await api.read(f);
    if (Array.isArray(arr)) cards.push(...arr);
  }
  return cards;
};

// Save card to its daily file
const saveCardToDay = async (card) => {
  const p = dateToDayPath(card.createdAt);
  let arr = (await api.read(p)) || [];
  if (!Array.isArray(arr)) arr = [];
  const idx = arr.findIndex(c => c.id === card.id);
  if (idx >= 0) arr[idx] = card; else arr.push(card);
  await api.write(p, arr);
};

// Remove card from its daily file
const removeCardFromDay = async (card) => {
  const p = dateToDayPath(card.createdAt);
  let arr = (await api.read(p)) || [];
  arr = arr.filter(c => c.id !== card.id);
  if (arr.length === 0) await api.del(p);
  else await api.write(p, arr);
};

// ─── Google Translate ───
const gTranslate = async (word, sl, tl) => {
  try {
    const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&dj=1&q=${encodeURIComponent(word)}`);
    const d = await r.json();
    return d.sentences?.map(s => s.trans).filter(Boolean).join("") || "";
  } catch { return "翻译失败"; }
};

// ─── Ebbinghaus schedule dates for a card ───
const getScheduleDates = card => EBB.map(d => addDays(card.createdAt, d));

// ─── Icons ───
const I = {
  Plus: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Check: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>,
  X: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Download: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Trash: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>,
  Folder: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>,
  Edit: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
};

// ═══ MAIN ═══
export default function App() {
  const [meta, setMeta] = useState(null);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("home");
  const [activeDeck, setActiveDeck] = useState("default");
  const [newWord, setNewWord] = useState("");
  const [addDate, setAddDate] = useState(todayStr());
  const [translating, setTranslating] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewRevealed, setReviewRevealed] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [showDeckModal, setShowDeckModal] = useState(false);
  const [deleteDeckConfirm, setDeleteDeckConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [editingCard, setEditingCard] = useState(null);
  const [editT1, setEditT1] = useState("");
  const [editT2, setEditT2] = useState("");
  const [dayFiles, setDayFiles] = useState([]);
  const inputRef = useRef(null);

  const reload = async () => {
    const [m, c, f] = await Promise.all([loadMeta(), loadAllCards(), api.list()]);
    if (!m.sourceLang) m.sourceLang = INIT_SRC;
    if (!m.targetLang1) m.targetLang1 = INIT_T1;
    if (!m.targetLang2) m.targetLang2 = INIT_T2;
    setMeta(m); setCards(c); setDayFiles(f.filter(x => x !== "meta.json"));
  };

  useEffect(() => { reload().then(() => setLoading(false)); }, []);

  const updateMeta = async (m) => { setMeta(m); await saveMeta(m); };
  const showToast = msg => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  // ─── Card ops ───
  const addCard = async () => {
    if (!newWord.trim() || translating) return;
    setTranslating(true);
    const [t1, t2] = await Promise.all([
      gTranslate(newWord.trim(), meta.sourceLang, meta.targetLang1),
      gTranslate(newWord.trim(), meta.sourceLang, meta.targetLang2),
    ]);
    const card = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      word: newWord.trim(), translation: t1, translation2: t2,
      deckId: activeDeck, createdAt: addDate,
      reviewStage: 0, nextReview: addDays(addDate, EBB[0]),
      reviewHistory: [], // { date, remembered }
    };
    await saveCardToDay(card);
    await reload();
    setNewWord(""); setTranslating(false);
    showToast(`✓ ${card.word} → ${t1} / ${t2}`);
    inputRef.current?.focus();
  };

  const deleteCard = async (card) => {
    await removeCardFromDay(card); await reload();
    setSelected(s => { const n = new Set(s); n.delete(card.id); return n; });
  };

  const batchDelete = async () => {
    if (selected.size === 0) return;
    const toDelete = cards.filter(c => selected.has(c.id));
    for (const c of toDelete) await removeCardFromDay(c);
    await reload(); showToast(`Deleted ${selected.size} cards`); setSelected(new Set());
  };

  const toggleSelect = id => setSelected(s => { const n = new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });

  const updateCardTranslation = async (card, t1, t2) => {
    await saveCardToDay({ ...card, translation: t1, translation2: t2 });
    await reload(); setEditingCard(null); showToast("Updated");
  };

  const updateCardDate = async (card, newDate) => {
    await removeCardFromDay(card);
    // Recalculate entire schedule based on new date
    // Keep reviewHistory as-is, but recalc nextReview based on current stage
    const updated = { ...card, createdAt: newDate, nextReview: addDays(newDate, EBB[card.reviewStage]) };
    await saveCardToDay(updated);
    await reload();
  };

  // ─── Review logic ───
  // When user reviews: mark ALL past-due schedule dates as reviewed
  const doReview = async (cardId, remembered) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    const td = todayStr();
    const sched = getScheduleDates(card);

    // Find all schedule dates that are <= today and haven't been reviewed yet
    const newHistory = [...card.reviewHistory];
    sched.forEach(schDate => {
      if (schDate <= td && !newHistory.find(h => h.date === schDate)) {
        newHistory.push({ date: schDate, remembered });
      }
    });

    // Advance/regress stage
    let ns = remembered
      ? Math.min(card.reviewStage + 1, EBB.length - 1)
      : Math.max(0, card.reviewStage - 1);

    const updated = { ...card, reviewStage: ns, nextReview: addDays(td, EBB[ns]), reviewHistory: newHistory };
    await saveCardToDay(updated);
    await reload();
    setReviewRevealed(true);
  };

  const nextReviewCard = () => { setReviewRevealed(false); setReviewIndex(i => i + 1); };

  // ─── Deck ops ───
  const createDeck = async () => {
    if (!newDeckName.trim()) return;
    const deck = { id: Date.now().toString(36), name: newDeckName.trim(), createdAt: Date.now() };
    await updateMeta({ ...meta, decks: [...meta.decks, deck] });
    setNewDeckName(""); setShowDeckModal(false); setActiveDeck(deck.id);
    showToast(`Deck "${deck.name}" created`);
  };
  const doDeleteDeck = async () => {
    const deckId = deleteDeckConfirm;
    const dn = meta.decks.find(d => d.id === deckId)?.name;
    const toRemove = cards.filter(c => c.deckId === deckId);
    for (const c of toRemove) await removeCardFromDay(c);
    await updateMeta({ ...meta, decks: meta.decks.filter(d => d.id !== deckId) });
    await reload();
    if (activeDeck === deckId) setActiveDeck("default");
    setDeleteDeckConfirm(null);
    showToast(`Deleted "${dn}" (${toRemove.length} cards)`);
  };

  // ─── Computed ───
  const td = todayStr();
  const deckCards = cards.filter(c => c.deckId === activeDeck);
  const dueCards = cards.filter(c => c.deckId === activeDeck && c.nextReview <= td);
  const allDueCount = cards.filter(c => c.nextReview <= td).length;
  const currentDeck = meta?.decks.find(d => d.id === activeDeck);
  const toggleSelectAll = () => {
    if (selected.size === deckCards.length) setSelected(new Set());
    else setSelected(new Set(deckCards.map(c => c.id)));
  };

  // ─── Export / Import ───
  const exportAll = async () => {
    const files = {};
    const allFiles = await api.list();
    for (const f of allFiles) {
      const data = await api.read(f);
      files[f] = data;
    }
    const blob = new Blob([JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), files }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `vocabforge-${td}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${allFiles.length} files`);
  };

  const importAll = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const imp = JSON.parse(ev.target.result);
        if (imp.version === 3 && imp.files) {
          for (const [path, data] of Object.entries(imp.files)) {
            await api.write(path, typeof data === "string" ? data : JSON.stringify(data, null, 2));
          }
        } else if (imp.decks && imp.cards) {
          // Legacy v1/v2
          await saveMeta({ ...(await loadMeta()), decks: imp.decks });
          for (const c of imp.cards) await saveCardToDay(c);
        }
        await reload();
        showToast("Import complete");
      } catch { showToast("Import failed"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const setSourceLang = v => updateMeta({ ...meta, sourceLang: v });
  const setTargetLang1 = v => updateMeta({ ...meta, targetLang1: v });
  const setTargetLang2 = v => updateMeta({ ...meta, targetLang2: v });

  if (loading || !meta) return <div style={S.loadingScreen}><div style={S.loadingPulse}>鍛</div></div>;

  // ─── Schedule dots ───
  const ScheduleDots = ({ card }) => {
    const sched = getScheduleDates(card);
    return (
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
        {sched.map((schDate, i) => {
          const rh = card.reviewHistory.find(h => h.date === schDate);
          const isToday = schDate === td;
          const isPast = schDate < td;
          let bg = "#333", clr = "#666"; // future
          if (rh) {
            bg = rh.remembered ? "#16a34a" : "#dc2626"; clr = "#fff";
          } else if (isToday) {
            bg = accent; clr = "#fff";
          } else if (isPast) {
            bg = "#555"; clr = "#aaa"; // missed
          }
          return (
            <span key={i} title={`Day ${EBB[i]} → ${schDate}`}
              style={{ fontFamily: mono, fontSize: 9, padding: "2px 5px", borderRadius: 3,
                background: bg, color: clr, lineHeight: 1.2 }}>
              {fmtShort(schDate)}
            </span>
          );
        })}
      </div>
    );
  };

  const startEdit = card => { setEditingCard(card.id); setEditT1(card.translation); setEditT2(card.translation2 || ""); };

  const LangSelect = ({ value, onChange }) => (
    <select style={S.langSel} value={value} onChange={e => onChange(e.target.value)}>
      {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
    </select>
  );

  // Date input formatted as YYYY/MM/DD via text display
  const DateInput = ({ value, onChange, style: sx }) => (
    <input type="date" value={value} onChange={e => e.target.value && onChange(e.target.value)}
      style={{ ...S.dateInput, ...sx }} />
  );

  return (
    <div style={S.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Noto+Sans+SC:wght@300;400;500;700&family=Crimson+Pro:wght@400;500;600;700&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        body { background:#0a0a0b; margin:0; }
        input:focus,select:focus,button:focus { outline:none; }
        ::selection { background:#e8440033; color:#fff; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideIn { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
        @keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
        @keyframes toast { 0%{opacity:0;transform:translateY(20px)} 10%{opacity:1;transform:translateY(0)} 90%{opacity:1} 100%{opacity:0;transform:translateY(-10px)} }
        @keyframes cardFlip { from{transform:rotateX(90deg);opacity:0} to{transform:rotateX(0);opacity:1} }
        .hi:hover { background:#161618 !important; }
        .nb:hover { background:#1a1a1e !important; }
        .ab:hover { transform:translateY(-1px); filter:brightness(1.1); }
        .dk:hover { border-color:#e84400 !important; }
        input::placeholder { color:#444; }
        .cb { appearance:none;width:16px;height:16px;border:2px solid #333;border-radius:4px;cursor:pointer;flex-shrink:0;position:relative;background:transparent; }
        .cb:checked { border-color:#e84400;background:#e84400; }
        .cb:checked::after { content:'✓';position:absolute;top:-2px;left:2px;font-size:11px;color:#fff;font-weight:700; }
      `}</style>

      {toast && <div style={S.toast}>{toast}</div>}

      {/* Header */}
      <header style={S.header}>
        <div style={S.logo} onClick={() => { setView("home"); setSelected(new Set()); }}>
          <span style={S.logoMark}>鍛</span>
          <span style={S.logoText}>VocabForge</span>
        </div>
        <div style={S.headerRight}>
          {allDueCount > 0 && <div style={S.dueBadge} onClick={() => setView("review")}>{allDueCount} due</div>}
          <div style={S.langDisplay}>
            <LangSelect value={meta.sourceLang} onChange={setSourceLang}/>
            <span style={{ color: accent, fontSize: 11, fontFamily: mono }}>→</span>
            <LangSelect value={meta.targetLang1} onChange={setTargetLang1}/>
            <span style={{ color: "#555", fontSize: 10, fontFamily: mono }}>/</span>
            <LangSelect value={meta.targetLang2} onChange={setTargetLang2}/>
          </div>
        </div>
      </header>

      {/* Nav */}
      <nav style={S.nav}>
        {[
          { id: "home", label: "词库" }, { id: "add", label: "添加" },
          { id: "review", label: `复习${dueCards.length?` (${dueCards.length})`:""}` },
          { id: "decks", label: "牌组" }, { id: "export", label: "备份" },
        ].map(t => (
          <button key={t.id} className="nb" style={{ ...S.navBtn, ...(view===t.id?S.navBtnActive:{}) }}
            onClick={() => { setView(t.id); setSelected(new Set()); if(t.id==="review"){setReviewIndex(0);setReviewRevealed(false);} }}>{t.label}</button>
        ))}
      </nav>

      {/* Deck selector */}
      <div style={S.deckSelector}>
        <I.Folder/>
        <select style={S.deckSelect} value={activeDeck} onChange={e => { setActiveDeck(e.target.value); setSelected(new Set()); }}>
          {meta.decks.map(d => <option key={d.id} value={d.id}>{d.name} ({cards.filter(c=>c.deckId===d.id).length})</option>)}
        </select>
      </div>

      <main style={S.main}>

        {/* ═══ HOME ═══ */}
        {view === "home" && (
          <div style={S.content}>
            <div style={S.sectionHeader}>
              <h2 style={S.sectionTitle}>{currentDeck?.name||"Default"}</h2>
              <span style={S.cardCount}>{deckCards.length} cards</span>
            </div>
            {deckCards.length > 0 && (
              <div style={S.batchBar}>
                <label style={S.batchCheck}>
                  <input type="checkbox" className="cb" checked={selected.size===deckCards.length&&deckCards.length>0} onChange={toggleSelectAll}/>
                  <span style={S.batchLabel}>{selected.size>0?`${selected.size} selected`:"Select all"}</span>
                </label>
                {selected.size > 0 && <button className="ab" style={S.batchDeleteBtn} onClick={batchDelete}><I.Trash/> Delete</button>}
              </div>
            )}
            {deckCards.length === 0 ? (
              <div style={S.empty}>
                <p style={S.emptyText}>No cards yet</p>
                <button className="ab" style={S.emptyBtn} onClick={() => setView("add")}><I.Plus/> Add word</button>
              </div>
            ) : (
              <div style={S.cardList}>
                {[...deckCards].sort((a,b) => a.nextReview<=td?-1:1).map((card, i) => {
                  const isEditing = editingCard === card.id;
                  return (
                    <div key={card.id} className="hi" style={{ ...S.cardItem, animationDelay: `${i*30}ms`,
                      ...(selected.has(card.id)?{background:"#1a1410",borderLeft:`3px solid ${accent}`}:{}) }}>
                      <input type="checkbox" className="cb" checked={selected.has(card.id)}
                        onChange={() => toggleSelect(card.id)} style={{ marginRight: 10, marginTop: 4 }}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                          <span style={S.cardWord}>{card.word}</span>
                        </div>
                        {isEditing ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                            <input style={S.editInput} value={editT1} onChange={e => setEditT1(e.target.value)} placeholder={LN[meta.targetLang1]}/>
                            <input style={S.editInput} value={editT2} onChange={e => setEditT2(e.target.value)} placeholder={LN[meta.targetLang2]}/>
                            <button style={S.editSave} onClick={() => updateCardTranslation(card,editT1,editT2)}>✓</button>
                            <button style={S.editCancel} onClick={() => setEditingCard(null)}>✕</button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                            <span style={S.cardTrans}>{card.translation}</span>
                            <span style={{ color: "#444", fontSize: 11 }}>/</span>
                            <span style={S.cardTrans2}>{card.translation2}</span>
                            <button style={S.editBtn} onClick={() => startEdit(card)}><I.Edit/></button>
                          </div>
                        )}
                        <ScheduleDots card={card}/>
                      </div>
                      <div style={S.cardItemRight}>
                        <DateInput value={card.createdAt} onChange={d => updateCardDate(card, d)}/>
                        <button style={S.deleteBtn} onClick={() => deleteCard(card)}><I.Trash/></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ ADD ═══ */}
        {view === "add" && (
          <div style={S.content}>
            <div style={{ padding: "20px 0" }}>
              <h2 style={S.addTitle}>Add Word</h2>
              <p style={S.addSub}>{LN[meta.sourceLang]} → {LN[meta.targetLang1]} + {LN[meta.targetLang2]}</p>
              <div style={S.inputRow}>
                <input ref={inputRef} style={S.wordInput}
                  placeholder={`Enter a ${LN[meta.sourceLang]||meta.sourceLang} word...`}
                  value={newWord} onChange={e => setNewWord(e.target.value)}
                  onKeyDown={e => e.key==="Enter"&&addCard()} autoFocus disabled={translating}/>
                <DateInput value={addDate} onChange={setAddDate}/>
                <button className="ab" style={{ ...S.addBtn, opacity:translating?.5:1 }}
                  onClick={addCard} disabled={translating||!newWord.trim()}>
                  {translating?<span style={{animation:"pulse 1s infinite"}}>翻译中...</span>:<><I.Plus/> Add</>}
                </button>
              </div>
              <div style={{ marginBottom: 32 }}>
                <h3 style={S.smallTitle}>Recently Added</h3>
                {deckCards.slice(-5).reverse().map(c => (
                  <div key={c.id} style={S.recentItem}>
                    <span style={S.recentWord}>{c.word}</span>
                    <span style={{ color: accent, fontSize: 12 }}>→</span>
                    <span style={S.recentTrans}>{c.translation}</span>
                    <span style={{ color: "#555", fontSize: 12 }}>/</span>
                    <span style={S.recentTrans2}>{c.translation2}</span>
                    <button style={S.editBtn} onClick={() => { startEdit(c); setView("home"); }}><I.Edit/></button>
                  </div>
                ))}
              </div>
              <div>
                <h3 style={S.smallTitle}>Ebbinghaus Schedule</h3>
                <div style={S.intervals}>{EBB.map((d,i) => <div key={i} style={S.intervalPill}>Day {d}</div>)}</div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ REVIEW ═══ */}
        {view === "review" && (
          <div style={S.content}>
            {dueCards.length===0||reviewIndex>=dueCards.length ? (
              <div style={S.empty}>
                <div style={{ fontSize: 48, color: "#4ade80", marginBottom: 8 }}>✓</div>
                <p style={S.emptyText}>{dueCards.length===0?"No cards due today":"All done!"}</p>
              </div>
            ) : (() => {
              const rc = dueCards[reviewIndex];
              return (
                <div style={S.reviewArea}>
                  <div style={S.reviewProgress}>{reviewIndex+1} / {dueCards.length}</div>
                  <div style={S.reviewCard} key={rc.id+String(reviewRevealed)}>
                    <div style={S.reviewWord}>{rc.word}</div>
                    <div style={{ marginTop: 8 }}><ScheduleDots card={rc}/></div>
                    {!reviewRevealed ? (
                      <div>
                        <p style={{ fontFamily: mono, fontSize: 12, color: textDim, marginTop: 24, marginBottom: 20 }}>
                          Do you know this word?
                        </p>
                        <div style={S.reviewActions}>
                          <button className="ab" style={S.forgotBtn} onClick={() => doReview(rc.id,false)}>
                            <I.X/> Wrong
                          </button>
                          <button className="ab" style={S.knewBtn} onClick={() => doReview(rc.id,true)}>
                            <I.Check/> Correct
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ animation: "fadeUp 0.3s ease" }}>
                        <div style={S.reviewTrans}>{rc.translation}</div>
                        <div style={S.reviewTrans2}>{rc.translation2}</div>
                        <div style={{ fontFamily: mono, fontSize: 11, color: "#555", marginTop: 16 }}>
                          Stage {rc.reviewStage+1}/{EBB.length}
                        </div>
                        <button className="ab" style={{ ...S.showBtn, marginTop: 20 }} onClick={nextReviewCard}>
                          Next →
                        </button>
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
              <button className="ab" style={S.newDeckBtn} onClick={() => setShowDeckModal(true)}><I.Plus/> New Deck</button>
            </div>
            <div style={S.deckGrid}>
              {meta.decks.map(deck => {
                const count = cards.filter(c=>c.deckId===deck.id).length;
                const due = cards.filter(c=>c.deckId===deck.id&&c.nextReview<=td).length;
                return (
                  <div key={deck.id} className="dk" style={{ ...S.deckCard, ...(activeDeck===deck.id?{borderColor:accent}:{}) }}
                    onClick={() => { setActiveDeck(deck.id); setView("home"); }}>
                    <div style={S.deckName}>{deck.name}</div>
                    <div style={S.deckStats}>
                      <span>{count} cards</span>
                      {due>0&&<span style={{color:accent,fontWeight:600}}>{due} due</span>}
                    </div>
                    {deck.id!=="default"&&<button style={S.deckDeleteBtn} onClick={e=>{e.stopPropagation();setDeleteDeckConfirm(deck.id);}}><I.Trash/></button>}
                  </div>
                );
              })}
            </div>
            {showDeckModal&&(
              <div style={S.modal} onClick={()=>setShowDeckModal(false)}>
                <div style={S.modalContent} onClick={e=>e.stopPropagation()}>
                  <h3 style={S.modalTitle}>New Deck</h3>
                  <input style={S.modalInput} placeholder="Deck name..." value={newDeckName}
                    onChange={e=>setNewDeckName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createDeck()} autoFocus/>
                  <div style={S.modalActions}>
                    <button className="ab" style={S.modalCancel} onClick={()=>setShowDeckModal(false)}>Cancel</button>
                    <button className="ab" style={S.modalConfirm} onClick={createDeck}>Create</button>
                  </div>
                </div>
              </div>
            )}
            {deleteDeckConfirm&&(
              <div style={S.modal} onClick={()=>setDeleteDeckConfirm(null)}>
                <div style={S.modalContent} onClick={e=>e.stopPropagation()}>
                  <h3 style={S.modalTitle}>确认删除</h3>
                  <p style={{fontFamily:sans,fontSize:14,color:textDim,lineHeight:1.6,marginBottom:8}}>
                    确定要删除 <strong style={{color:text}}>"{meta.decks.find(d=>d.id===deleteDeckConfirm)?.name}"</strong> 吗？
                  </p>
                  <p style={{fontFamily:mono,fontSize:12,color:"#f87171",marginBottom:16}}>
                    将删除 {cards.filter(c=>c.deckId===deleteDeckConfirm).length} 张卡片，不可撤销。
                  </p>
                  <div style={S.modalActions}>
                    <button className="ab" style={S.modalCancel} onClick={()=>setDeleteDeckConfirm(null)}>取消</button>
                    <button className="ab" style={S.deleteConfirmBtn} onClick={doDeleteDeck}>确认删除</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ EXPORT ═══ */}
        {view === "export" && (
          <div style={S.content}>
            <div style={{ padding: "20px 0" }}>
              <h2 style={S.sectionTitle}>Backup & Sync</h2>
              <p style={{fontFamily:mono,fontSize:12,color:textDim,marginTop:4,marginBottom:24}}>
                Data stored as data/YYMM/MMDD.json — git add & push to backup
              </p>
              <div style={S.exportCards}>
                <div style={S.exportCard} onClick={exportAll}>
                  <I.Download/>
                  <span style={{fontFamily:mono,fontSize:13,fontWeight:600}}>Export All</span>
                  <span style={{fontFamily:mono,fontSize:11,color:textDim}}>{dayFiles.length} daily files</span>
                </div>
                <label style={S.exportCard}>
                  <input type="file" accept=".json" onChange={importAll} style={{display:"none"}}/>
                  <I.Plus/>
                  <span style={{fontFamily:mono,fontSize:13,fontWeight:600}}>Import</span>
                  <span style={{fontFamily:mono,fontSize:11,color:textDim}}>Restore backup</span>
                </label>
              </div>
              <div style={{ marginBottom: 24 }}>
                <h3 style={{fontFamily:mono,fontSize:13,fontWeight:600,color:text,marginBottom:12}}>Data Files</h3>
                <div style={S.codeBlock}>
                  <code style={S.code}>{dayFiles.length>0?dayFiles.join("\n"):"(no daily files yet)"}</code>
                </div>
              </div>
              <div style={{ marginBottom: 32 }}>
                <h3 style={{fontFamily:mono,fontSize:13,fontWeight:600,color:text,marginBottom:12}}>Git Workflow</h3>
                <div style={S.codeBlock}>
                  <code style={S.code}>{`# data/ 目录会自动生成文件
# 直接 git add & push 即可

cd ~/vocab-forge
git add data/
git commit -m "vocab $(date +%F)"
git push`}</code>
                </div>
              </div>
              <div style={S.statsGrid}>
                {[
                  {n:cards.length,l:"Total"},{n:meta.decks.length,l:"Decks"},
                  {n:allDueCount,l:"Due"},{n:cards.filter(c=>c.reviewStage>=EBB.length-1).length,l:"Mastered"},
                ].map((s,i) => (
                  <div key={i} style={S.statCard}><div style={S.statNum}>{s.n}</div>
                    <div style={{fontFamily:mono,fontSize:11,color:textDim,marginTop:4}}>{s.l}</div></div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const accent="#e84400",accentDim="#e8440033",bg="#0a0a0b",surface="#111113",surface2="#1a1a1e",border="#222226",text="#e8e6e3",textDim="#777";
const mono="'JetBrains Mono',monospace",serif="'Crimson Pro',serif",sans="'Noto Sans SC',system-ui,sans-serif";

const S = {
  root:{background:bg,minHeight:"100vh",color:text,fontFamily:sans,maxWidth:720,margin:"0 auto",padding:"0 16px",paddingBottom:60},
  loadingScreen:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100vh",background:bg},
  loadingPulse:{fontSize:48,color:accent,animation:"pulse 1.5s infinite"},
  header:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 0 10px",borderBottom:`1px solid ${border}`,flexWrap:"wrap",gap:8},
  headerRight:{display:"flex",alignItems:"center",gap:8},
  logo:{display:"flex",alignItems:"center",gap:8,cursor:"pointer"},
  logoMark:{fontSize:22,fontWeight:700,color:accent},
  logoText:{fontFamily:mono,fontSize:15,fontWeight:600,color:text,letterSpacing:"-0.5px"},
  dueBadge:{fontFamily:mono,fontSize:11,fontWeight:600,background:accentDim,color:accent,padding:"3px 9px",borderRadius:20,cursor:"pointer"},
  langDisplay:{display:"flex",alignItems:"center",gap:4},
  langSel:{fontFamily:mono,fontSize:11,background:surface,color:text,border:`1px solid ${border}`,borderRadius:4,padding:"3px 4px",cursor:"pointer"},
  nav:{display:"flex",gap:2,padding:"10px 0",borderBottom:`1px solid ${border}`},
  navBtn:{fontFamily:mono,fontSize:12,fontWeight:500,background:"transparent",color:textDim,border:"none",padding:"5px 12px",borderRadius:6,cursor:"pointer",transition:"all 0.2s"},
  navBtnActive:{background:surface2,color:text},
  deckSelector:{display:"flex",alignItems:"center",gap:8,padding:"8px 0",color:textDim},
  deckSelect:{fontFamily:mono,fontSize:12,background:"transparent",color:text,border:"none",cursor:"pointer",flex:1},
  main:{paddingTop:6},
  content:{animation:"fadeUp 0.3s ease"},
  sectionHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0"},
  sectionTitle:{fontFamily:serif,fontSize:22,fontWeight:600,color:text},
  cardCount:{fontFamily:mono,fontSize:12,color:textDim},
  batchBar:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",marginBottom:4},
  batchCheck:{display:"flex",alignItems:"center",gap:8,cursor:"pointer"},
  batchLabel:{fontFamily:mono,fontSize:12,color:textDim},
  batchDeleteBtn:{display:"flex",alignItems:"center",gap:6,fontFamily:mono,fontSize:12,fontWeight:600,background:"#dc262622",color:"#f87171",border:"1px solid #dc262644",padding:"5px 12px",borderRadius:8,cursor:"pointer"},
  empty:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 0",gap:16},
  emptyText:{fontFamily:serif,fontSize:18,color:textDim},
  emptyBtn:{display:"flex",alignItems:"center",gap:8,fontFamily:mono,fontSize:13,fontWeight:500,background:accent,color:"#fff",border:"none",padding:"10px 20px",borderRadius:8,cursor:"pointer"},
  cardList:{display:"flex",flexDirection:"column",gap:3},
  cardItem:{display:"flex",alignItems:"flex-start",padding:"10px 12px",borderRadius:8,background:surface,transition:"all 0.15s",animation:"fadeUp 0.3s ease both",borderLeft:"3px solid transparent"},
  cardWord:{fontFamily:serif,fontSize:16,fontWeight:600,color:text},
  cardTrans:{fontFamily:sans,fontSize:13,color:textDim},
  cardTrans2:{fontFamily:mono,fontSize:12,color:"#666"},
  cardItemRight:{display:"flex",alignItems:"center",gap:6,marginLeft:8,flexShrink:0,paddingTop:2},
  deleteBtn:{background:"transparent",border:"none",color:"#444",cursor:"pointer",padding:4,display:"flex"},
  editBtn:{background:"transparent",border:"none",color:"#555",cursor:"pointer",padding:2,display:"flex",marginLeft:4},
  editInput:{fontFamily:sans,fontSize:13,background:bg,color:text,border:`1px solid ${border}`,borderRadius:6,padding:"4px 8px",width:120},
  editSave:{fontFamily:mono,fontSize:14,background:"#16a34a33",color:"#4ade80",border:"none",borderRadius:4,padding:"4px 8px",cursor:"pointer"},
  editCancel:{fontFamily:mono,fontSize:14,background:"#dc262622",color:"#f87171",border:"none",borderRadius:4,padding:"4px 8px",cursor:"pointer"},
  dateInput:{fontFamily:mono,fontSize:12,background:surface,color:text,border:`1px solid ${border}`,borderRadius:6,padding:"4px 8px",cursor:"pointer",width:130},
  addTitle:{fontFamily:serif,fontSize:26,fontWeight:700,color:text,marginBottom:4},
  addSub:{fontFamily:mono,fontSize:12,color:textDim,marginBottom:20},
  inputRow:{display:"flex",gap:8,marginBottom:28,alignItems:"center",flexWrap:"wrap"},
  wordInput:{flex:1,minWidth:200,fontFamily:sans,fontSize:15,background:surface,color:text,border:`2px solid ${border}`,borderRadius:10,padding:"12px 14px"},
  addBtn:{display:"flex",alignItems:"center",gap:6,fontFamily:mono,fontSize:13,fontWeight:600,background:accent,color:"#fff",border:"none",padding:"12px 20px",borderRadius:10,cursor:"pointer",whiteSpace:"nowrap"},
  smallTitle:{fontFamily:mono,fontSize:11,fontWeight:600,color:textDim,textTransform:"uppercase",letterSpacing:"1px",marginBottom:10},
  recentItem:{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:`1px solid ${border}`,animation:"slideIn 0.3s ease",flexWrap:"wrap"},
  recentWord:{fontFamily:serif,fontSize:15,fontWeight:600,color:text},
  recentTrans:{fontFamily:sans,fontSize:14,color:textDim},
  recentTrans2:{fontFamily:mono,fontSize:13,color:"#666"},
  intervals:{display:"flex",flexWrap:"wrap",gap:5},
  intervalPill:{fontFamily:mono,fontSize:11,color:textDim,background:surface2,padding:"3px 9px",borderRadius:20,border:`1px solid ${border}`},
  reviewArea:{display:"flex",flexDirection:"column",alignItems:"center",padding:"30px 0"},
  reviewProgress:{fontFamily:mono,fontSize:12,color:textDim,marginBottom:20},
  reviewCard:{width:"100%",maxWidth:480,background:surface,borderRadius:16,padding:"36px 28px",textAlign:"center",border:`1px solid ${border}`,animation:"cardFlip 0.4s ease"},
  reviewWord:{fontFamily:serif,fontSize:34,fontWeight:700,color:text,marginBottom:4},
  reviewTrans:{fontFamily:sans,fontSize:22,fontWeight:500,color:text,marginTop:20},
  reviewTrans2:{fontFamily:mono,fontSize:15,color:"#888",marginTop:6},
  showBtn:{display:"inline-flex",alignItems:"center",gap:8,fontFamily:mono,fontSize:13,background:surface2,color:text,border:`1px solid ${border}`,padding:"10px 24px",borderRadius:10,cursor:"pointer"},
  reviewActions:{display:"flex",gap:12,marginTop:20,justifyContent:"center"},
  forgotBtn:{display:"flex",alignItems:"center",gap:6,fontFamily:mono,fontSize:13,fontWeight:600,background:"#dc262622",color:"#f87171",border:"1px solid #dc262644",padding:"12px 28px",borderRadius:10,cursor:"pointer"},
  knewBtn:{display:"flex",alignItems:"center",gap:6,fontFamily:mono,fontSize:13,fontWeight:600,background:"#16a34a22",color:"#4ade80",border:"1px solid #16a34a44",padding:"12px 28px",borderRadius:10,cursor:"pointer"},
  deckGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:12,paddingTop:8},
  deckCard:{background:surface,borderRadius:12,padding:"18px 14px",border:`1px solid ${border}`,cursor:"pointer",transition:"all 0.2s",position:"relative"},
  deckName:{fontFamily:serif,fontSize:16,fontWeight:600,color:text,marginBottom:6},
  deckStats:{fontFamily:mono,fontSize:11,color:textDim,display:"flex",gap:8},
  deckDeleteBtn:{position:"absolute",top:8,right:8,background:"transparent",border:"none",color:"#444",cursor:"pointer",padding:4,display:"flex"},
  newDeckBtn:{display:"flex",alignItems:"center",gap:6,fontFamily:mono,fontSize:12,fontWeight:500,background:surface2,color:text,border:`1px solid ${border}`,padding:"5px 12px",borderRadius:8,cursor:"pointer"},
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100},
  modalContent:{background:surface,borderRadius:16,padding:24,width:"90%",maxWidth:360,border:`1px solid ${border}`},
  modalTitle:{fontFamily:serif,fontSize:20,fontWeight:600,color:text,marginBottom:14},
  modalInput:{width:"100%",fontFamily:mono,fontSize:14,background:bg,color:text,border:`2px solid ${border}`,borderRadius:8,padding:"10px 12px",marginBottom:10},
  modalActions:{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8},
  modalCancel:{fontFamily:mono,fontSize:12,background:"transparent",color:textDim,border:`1px solid ${border}`,padding:"7px 14px",borderRadius:8,cursor:"pointer"},
  modalConfirm:{fontFamily:mono,fontSize:12,background:accent,color:"#fff",border:"none",padding:"7px 14px",borderRadius:8,cursor:"pointer"},
  deleteConfirmBtn:{fontFamily:mono,fontSize:12,background:"#dc2626",color:"#fff",border:"none",padding:"7px 14px",borderRadius:8,cursor:"pointer"},
  exportCards:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:28},
  exportCard:{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"24px 14px",background:surface,borderRadius:12,border:`1px solid ${border}`,cursor:"pointer",color:text},
  codeBlock:{background:surface,borderRadius:10,padding:14,border:`1px solid ${border}`,overflowX:"auto"},
  code:{fontFamily:mono,fontSize:11,color:"#a8b1c0",lineHeight:1.7,whiteSpace:"pre"},
  statsGrid:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10},
  statCard:{background:surface,borderRadius:10,padding:"14px 10px",border:`1px solid ${border}`,textAlign:"center"},
  statNum:{fontFamily:mono,fontSize:22,fontWeight:700,color:accent},
  toast:{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",fontFamily:mono,fontSize:13,background:surface2,color:text,padding:"8px 18px",borderRadius:10,border:`1px solid ${border}`,zIndex:200,animation:"toast 2.2s ease both",whiteSpace:"nowrap"},
};
