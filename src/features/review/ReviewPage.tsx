import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCards, useDeckSettings, useMemories, useNotes, useTodayLogs } from '../../db/hooks';
import { addClip, answerCard, bumpUsed, setSuspended, undoAnswer, updateNote, type AnswerResult } from '../../db/actions';
import { buildQueue, newInfoText } from '../../srs/queue';
import { useDeckQueue } from './useDeckQueue';
import { fmtNextIn, isDue, paramsFor, preview, type Rating } from '../../srs/scheduler';
import { fmtDays, fmtLocalMoment, fmtMinutes, nextDayStartMs } from '../../lib/time';
import { answerCustom, endCustom, nextQueue, pickCustom, restoreCustom, useCustom, type CustomSession } from '../../srs/custom';
import { preloadSpeech, speak, stopSpeech } from '../../lib/speech';
import { clozeTargets } from '../../schema/validate';
import { prefetchLookup } from '../Lookup';
import { usePrefs, setPrefs } from '../../ui/prefs';
import { useHotkeys, useNow } from '../../ui/hooks';
import { toast } from '../../ui/toast';
import { langLabel } from '../../ui/langs';
import { syncIfAuto } from '../../sync/engine';
import { CardStats, cardView, SpeakBtn, TYPE_LABEL } from '../CardFace';
import { BackZones, zoneHeadsOf } from '../BackZones';
import { NoteEditor } from '../NoteEditor';
import { ClusterStrip, undoClusterLeave } from './ClusterStrip';
import { Related } from './Related';
import { Fr, useFrDictCtx, useNoteFreqs } from '../FrText';
import { diffWords, pickReference, summarize, type DiffOp } from '../../lib/diff';
import type { Card, Note } from '../../schema';

const RATINGS: Array<{ r: Rating; label: string; cls: string }> = [
  { r: 1, label: '忘了', cls: 'r1' }, { r: 2, label: '困难', cls: 'r2' }, { r: 3, label: '良好', cls: 'r3' }, { r: 4, label: '容易', cls: 'r4' },
];

/** 跳到词库，只显示这条笔记并打开编辑；词库里有"返回复习" */
const openInLibrary = (noteId: string) => { location.hash = `#/library?note=${encodeURIComponent(noteId)}&edit=1`; };

/** 复习页发音开关：点一下换一档，从轻到重 */
const LISTEN_LABEL = { off: '关', core: '核心词', all: '全部' } as const;
const LISTEN_NEXT = { off: 'core', core: 'all', all: 'off' } as const;


export function ReviewPage({ deckId }: { deckId: string }) {
  const s = useDeckSettings(deckId);
  const cards = useCards();
  const notes = useNotes();
  const prefs = usePrefs();
  const [now, refreshNow] = useNow(15_000);
  const logs = useTodayLogs(s?.dayStartHour, now);
  const memories = useMemories(s);
  const freq = useNoteFreqs();
  const [currentId, setCurrentId] = useState<string | null>(null);
  /** 刚作答、等数据库更新完再出下一张：这段时间显示空卡片，不闪"这一轮完成了" */
  const [pending, setPending] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [skipped, setSkipped] = useState(() => new Set<string>());
  const [learnAheadAll, setLearnAheadAll] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  /** 撤销栈：正常调度的作答有 res；自定义学习另存作答前的队列 */
  const undo = useRef<Array<{ cardId: string; res: AnswerResult | null; custom: CustomSession | null; recKey: string }>>([]);
  /** 这一次显示的标识（表达群撤销用）：换卡时换新的；撤销回来时沿用当时那次的 */
  const recSeq = useRef(0);
  const rec = useRef<{ id: string | null; key: string; restore: string | null }>({ id: null, key: '', restore: null });
  if (rec.current.id !== currentId) rec.current = { id: currentId, key: rec.current.restore ?? `${currentId}#${++recSeq.current}`, restore: null };
  const custom = useCustom();
  const shownAt = useRef(Date.now());
  const answeredThisSession = useRef(0);
  /** 刚答过的卡：等数据库更新到这个版本后再选下一张，避免读到旧数据又选中它 */
  const waitFor = useRef<{ id: string; updatedAt: string; logId: string; at: number } | null>(null);
  /** 自定义学习里最近作答的笔记，用来把兄弟卡隔开 */
  const recentNotes = useRef<string[]>([]);

  const noteMap = useMemo(() => new Map((notes ?? []).map((n) => [n.id, n])), [notes]);
  const q = useDeckQueue(deckId, { now, skipped, learnAheadAll });
  const card = currentId ? cards?.find((c) => c.id === currentId) ?? null : null;
  const cardById = useMemo(() => new Map((cards ?? []).map((c) => [c.id, c])), [cards]);
  const customNext = custom ? pickCustom(custom.queue, cardById, recentNotes.current) : null;
  const nextId = custom ? customNext : q?.next?.id ?? null;
  const note = card ? noteMap.get(card.noteId) ?? null : null;

  // 选下一张：当前没有卡、或当前卡已失效（被删除、暂停、换了牌组）
  useEffect(() => {
    if (!q || !cards) return;
    const w = waitFor.current;
    if (w) {
      const c = cards.find((x) => x.id === w.id);
      if (c && c.updatedAt === w.updatedAt) return; // 数据库里还是作答前的版本，继续等
      // 卡片和日志是两个独立的实时查询，可能一先一后更新：日志还没到时出题会漏掉"同笔记当天只出一张"，
      // 刚答完产出卡紧接着就出同一条笔记的挖空卡。等日志也到了再选（最多等 3 秒）
      if (!logs?.some((l) => l.id === w.logId) && Date.now() - w.at < 3000) return;
      waitFor.current = null;
      setPending(false);
    }
    // 还没翻面的卡要仍在可出的范围里：导入 / 同步可能把它改成明天才到期，或今天已答过它的兄弟卡，
    // 不检查的话它会一直挂着（计数 0 0 0 却还有卡）。翻面后（含撤销）不换，免得作答到一半被抽走
    // 正在看的卡刚被标了待修：留在屏幕上做完，之后不再出
    const flaggedNow = !!(card && noteMap.get(card.noteId)?.fixme?.trim());
    const valid = card && !card.suspended && (custom ? custom.queue.includes(card.id) : card.deckId === deckId && (revealed || flaggedNow || q.servable.has(card.id)));
    if (!valid) {
      setCurrentId(nextId);
      setRevealed(false);
      shownAt.current = Date.now();
    }
  }, [q, cards, logs, card, deckId, custom, nextId, revealed]);

  // 一轮结束：自动同步打开时立即同步一次
  useEffect(() => {
    if (q && !q.next && !currentId && answeredThisSession.current > 0) {
      answeredThisSession.current = 0;
      void syncIfAuto();
    }
  }, [q, currentId]);

  const labels: [string, string, string] = s ? [langLabel(s.sourceLang), langLabel(s.targetLang1), langLabel(s.targetLang2)] : ['', '', ''];
  const autoRead = prefs.autoRead ?? true;
  const listenCards = prefs.listenCards ?? 'core';
  const listen = !!note && (listenCards === 'all' || (listenCards === 'core' && note.layer === 'core'));
  const group = useMemo(() => (note?.contrastGroup ? (notes ?? []).filter((n) => n.contrastGroup === note.contrastGroup && n.id !== note.id) : []), [note, notes]);
  const split = note && s && card ? cardView(card.type, note, s, labels, card.reps, listen, group) : null;
  // 产出卡提示有几级：中文意思（有就算一级）+ 首字母
  const hintSteps = (split?.meaningHint ? 1 : 0) + (split?.hint ? 1 : 0);
  // 产出卡可以先写出答案，揭示后和标准答案并排对照（不自动判对错）
  const [typed, setTyped] = useState('');
  // 产出卡的提示分两级，默认收起：第一下（H）中文意思——看不懂题面的换说法时用；第二下首字母
  const [hintLevel, setHintLevel] = useState(0);
  const [promptSaved, setPromptSaved] = useState(false);
  // 听力卡偷看文字：0 没看；1 看了上下文（悬停）；2 连要听的部分也看了（点一下 / H）
  const [peek, setPeek] = useState<0 | 1 | 2>(0);
  const peekTimer = useRef<number | undefined>(undefined);
  useEffect(() => { setTyped(''); setHintLevel(0); setPromptSaved(false); setPeek(0); }, [currentId]);

  // 自动发音只读学习语言（法语）：题面是法语就出题时读；题面是中文 / 英文 / 挖空，就翻面后读法语答案
  const frontIsSource = !!split && !!s && split.question.lang === s.sourceLang && !!split.question.speakText;
  const sourceAnswer = split && s ? split.answers.find((a) => a.lang === s.sourceLang && a.speakText) : undefined;
  const lastSpoken = useRef<string | null>(null);
  /** 撤销回来的卡：把它的法语再读一遍（听力卡没声音就没法答；回到背面也该能重听） */
  const replay = useRef<string | null>(null);
  const frDict = useFrDictCtx();
  // 换卡（作答、跳过、撤销）时先停掉上一张还在读的；必须写在下面的自动发音之前，同一次渲染里先停、再读本卡
  // 同时清掉「这张已读过」的记号：答错的卡几分钟后（只剩它时立刻）又出现，id 和正反面都一样，以前会被当成已读过而不出声
  useEffect(() => { stopSpeech(); lastSpoken.current = null; }, [currentId]);
  useEffect(() => () => stopSpeech(), []);

  // ---- 提前准备：让翻面、换卡时不用等网络 ----
  // 1) 这张卡题面和背面每一个能读的面：正面时就下载好
  // 2) 下一张卡（按"这张已答"重排队列预测）的题面和背面：现在就下载好。不管设置会不会自动读——手动点喇叭也不用等
  // 3) 这张卡的目标表达：现在就查好划词结果，翻面后悬停目标立即弹出
  // 都只是预热缓存，预测错了也只是照旧现读、现查
  useEffect(() => {
    if (!split || !card || !s || !note) return;
    for (const t of speakables(split)) preloadSpeech(t.text, t.lang);
    const lookAhead = (v: ReturnType<typeof cardView>) => {
      const faces = [v.question, ...v.answers].filter((f) => f.raw && f.lang === s.sourceLang);
      const targets = new Map<string, string>();
      for (const f of faces) for (const t of clozeTargets(f.raw!)) if (!targets.has(t)) targets.set(t, plainOf(f.raw!));
      for (const [t, ctx] of [...targets].slice(0, 4)) prefetchLookup(t, ctx, frDict, s.sourceLang, s.targetLang1);
    };
    lookAhead(split);
    if (custom || !cards || !logs) return;
    const sameNote = new Set(cards.filter((c) => c.noteId === card.noteId).map((c) => c.id));
    const nq = buildQueue({ cards, todayLogs: logs, deckId, now, settings: s, skipped: new Set([...skipped, ...sameNote]), learnAheadAll, notes: noteMap, freq, newPlan: q?.newPlan });
    const nc = nq.next;
    const nn = nc ? noteMap.get(nc.noteId) : undefined;
    if (!nc || !nn) return;
    const nListen = listenCards === 'all' || (listenCards === 'core' && nn.layer === 'core');
    const nGroup = nn.contrastGroup ? (notes ?? []).filter((x) => x.contrastGroup === nn.contrastGroup && x.id !== nn.id) : [];
    const ns = cardView(nc.type, nn, s, labels, nc.reps, nListen, nGroup);
    for (const t of speakables(ns)) preloadSpeech(t.text, t.lang);
    // 下一张卡的目标表达也提前一张查好：到它的时候早就查完了
    lookAhead(ns);
  }, [currentId, split?.question.speakText]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!split || !card) return;
    if (replay.current === card.id) {
      replay.current = null;
      const t = split.listen || frontIsSource ? split.question : sourceAnswer;
      if ((autoRead || split.listen) && t?.speakText) { lastSpoken.current = `${card.id}:${split.listen ? 'l' : ''}:${revealed ? 'b' : 'f'}`; void speak(t.speakText, t.lang); }
      return;
    }
    // 听力卡出题时总要读（不读就没法答）；其他情况看「自动读」
    if (!autoRead && !(split.listen && !revealed)) return;
    const target = !revealed ? (frontIsSource ? split.question : null) : (frontIsSource ? null : sourceAnswer ?? null);
    if (!target) return;
    const key = `${card.id}:${split.listen ? 'l' : ''}:${revealed ? 'b' : 'f'}`;
    if (lastSpoken.current === key) return;
    lastSpoken.current = key;
    void speak(target.speakText, target.lang);
  });

  // 必须在提前 return 之前注册；按键时才调用下面定义的函数
  useHotkeys((k) => {
    if (!s || !q) return false;
    if (k === 'u' || k === 'U') return void doUndo();
    if (!card) return false;
    if (k === ' ' || k === 'Enter') return void (revealed ? answer(3) : setRevealed(true));
    if (['1', '2', '3', '4'].includes(k)) return revealed ? void answer(Number(k) as Rating) : false;
    if (k === 's' || k === 'S') return skip();
    if (k === 'p' || k === 'P') return void suspend();
    if (k === 'e' || k === 'E') return setEditing(true);
    if ((k === 'h' || k === 'H') && card.type === 'production' && !revealed) return setHintLevel((l) => Math.min(l + 1, hintSteps));
    if ((k === 'h' || k === 'H') && split?.listen && !revealed) return setPeek(2);
    if (k === 'l' || k === 'L') return openInLibrary(card.noteId);
    // R：重听法语。题面不是法语时，翻面后读答案；没翻面就读题面（手动按的，读什么都行）
    if (k === 'r' || k === 'R') {
      const t = revealed && !frontIsSource && sourceAnswer ? sourceAnswer : split?.question;
      return t?.speakText ? void speak(t.speakText, t.lang) : false;
    }
    return false;
  });

  // 待修笔记（本牌组、有在用的卡）：改好前不出，底部提示一下数量
  const flaggedCount = useMemo(() => {
    const ids = new Set((notes ?? []).filter((n) => !n.deleted && n.fixme?.trim()).map((n) => n.id));
    return new Set((cards ?? []).filter((c) => ids.has(c.noteId) && c.deckId === deckId && !c.deleted && !c.suspended).map((c) => c.noteId)).size;
  }, [notes, cards, deckId]);
  // 产出卡输入框自动聚焦：只在有鼠标 / 触控板的设备上（手机上自动弹键盘太打扰）
  const finePointer = useMemo(() => { try { return window.matchMedia('(pointer: fine)').matches; } catch { return true; } }, []);
  if (!s || !q) return null;

  // 自定义学习里，没到期的卡只练习不调度
  const scheduled = !custom || (!!card && card.state !== 'new' && isDue(card, Date.now(), s.dayStartHour));
  const answer = async (r: Rating) => {
    if (!card || !revealed) return;
    setLearnAheadAll(false);
    const res = scheduled ? await answerCard(card.id, r, { elapsedMs: Date.now() - shownAt.current }) : null;
    undo.current.push({ cardId: card.id, res, custom, recKey: rec.current.key });
    if (undo.current.length > 30) undo.current.shift();
    setUndoCount(undo.current.length);
    if (custom) {
      answerCustom(card.id, r);
      recentNotes.current = [...recentNotes.current.slice(-9), card.noteId];
    }
    if (res) {
      answeredThisSession.current++;
      if (res.leechNow) toast(`遗忘达到 ${s.leechThreshold} 次，已自动暂停，放进"待改造"`, true);
      waitFor.current = { id: card.id, updatedAt: card.updatedAt, logId: res.logId, at: Date.now() };
      setPending(true);
    }
    setCurrentId(null);
    setRevealed(false);
    refreshNow();
  };
  const doUndo = async () => {
    const last = undo.current.pop();
    if (!last) return;
    setUndoCount(undo.current.length);
    if (last.res) await undoAnswer(last.res);
    // 表达群：翻页时按「没想起来」生效的撤回，回到翻页前的状态
    await undoClusterLeave(last.recKey);
    if (currentId === last.cardId) rec.current.key = last.recKey; else rec.current.restore = last.recKey;
    if (last.custom) restoreCustom(last.custom);
    setSkipped((x) => { const n = new Set(x); n.delete(last.cardId); return n; });
    replay.current = last.cardId;
    setCurrentId(last.cardId);
    setRevealed(true);
    toast('已撤销');
  };
  const skip = () => {
    if (!card) return;
    if (custom) restoreCustom({ ...nextQueue(custom, card.id, 2), done: custom.done });
    else setSkipped((x) => new Set(x).add(card.id));
    setCurrentId(null);
  };
  const suspend = async () => {
    if (!card) return;
    await setSuspended([card.noteId], true);
    toast('已暂停这张卡，可在词库"已暂停"里恢复');
  };

  const mem = card ? memories?.get(card.id) ?? null : null;
  const pv = card ? preview(card, paramsFor(card.type, s), now, mem) : null;
  const PRACTICE: Record<Rating, string> = { 1: '稍后再练', 2: '本轮最后', 3: '本轮完成', 4: '本轮完成' };
  const btnNote = (r: Rating) => (!scheduled ? PRACTICE[r] : pv ? `${fmtNextIn(pv[r], fmtMinutes, fmtDays)}后` : '');
  // 评分标准直接写在按钮上（以前在按钮上面单独一行）
  const task = TASKS[split?.listen ? 'listen' : card?.type ?? 'recognition'] ?? TASKS.recognition;
  const gradeCrit = (r: Rating) => (card && split ? gradeCriterion(split.listen ? 'listen' : card.type, r, peek) || GRADE_GENERIC[r] : '');
  // 下一次换天，用本地时间说（设置里的切换时间 + 时区换算过来）
  const rollover = fmtLocalMoment(nextDayStartMs(now, s.dayStartHour), now);
  const limitLine = `今日已学：新卡 ${q.done.newDone}/${s.newPerDay} · 复习 ${q.done.reviewDone}${s.reviewsPerDay ? `/${s.reviewsPerDay}` : ''}`
    + (q.reviewBacklog > 0 ? ` · 超出上限 ${q.reviewBacklog}` : '') + (flaggedCount ? ` · ⚑ 待修 ${flaggedCount} 条暂不出` : '') + ` · ${rollover} 换天`;

  return (
    <div className="page review">
      <div className="toolbar">
        <span className="grow" />
        <span className="audio-ctl">
          <button type="button" className={autoRead ? 'is-on' : ''} onClick={() => setPrefs({ autoRead: !autoRead })}
            title="自动读法语：法语题面出题时读，中文题面 / 挖空翻面后读答案。中文、英文不自动读">
            自动读：{autoRead ? '开' : '关'}
          </button>
          <button type="button" className={listenCards !== 'off' ? 'is-on' : ''} onClick={() => setPrefs({ listenCards: LISTEN_NEXT[listenCards] })}
            title="听力卡：认读卡正面只放声音，闭眼听懂再翻面。核心词 → 全部 → 关。听力卡出题时总会读，和自动读无关">
            听力卡：{LISTEN_LABEL[listenCards]}
          </button>
        </span>
      </div>
      {custom ? (
        <div className="custom-bar">
          <b>自定义学习</b><span>{custom.label}</span>
          <span className="muted small">完成 {custom.done}/{custom.total} · 剩 {custom.queue.length}</span>
          <span className="grow" />
          <span className="muted small" title="到期的卡照常调度并记录；没到期的卡和新卡只练习，不影响复习安排">到期的卡照常调度，其余只练习</span>
          <button type="button" className="pill" onClick={() => { endCustom(); setCurrentId(null); undo.current = []; setUndoCount(0); }}>结束</button>
        </div>
      ) : (
        <div className="counts">
          <span className="c-learn" title={`学习中 / 重学：${rollover} 换天之前到期的（之后到期的算下一个学习日）`}>{q.counts.learning}</span>
          <span className="c-review" title={`今天到期的复习（${rollover} 换天）`}>{q.counts.review}</span>
          <button type="button" className="c-new" title={`${newInfoText(q.newInfo).join('\n')}\n（点一下看说明）`} onClick={() => setShowWhy((v) => !v)}>{q.counts.new}</button>
        </div>
      )}
      {!custom && showWhy && <NewWhy lines={newInfoText(q.newInfo)} onClose={() => setShowWhy(false)} />}

      {custom && !customNext ? (
        <div className="empty">
          <div className="big-check">✓</div>
          <p>自定义学习完成：{custom.label}，{custom.done} 张</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            {undoCount > 0 && <button type="button" className="pill" onClick={() => void doUndo()}>撤销上一次</button>}
            <button type="button" className="btn is-primary" onClick={() => { endCustom(); setCurrentId(null); undo.current = []; setUndoCount(0); }}>回到正常复习</button>
          </div>
        </div>
      ) : (!card && (pending || nextId)) ? (
        // 作答后到下一张出现之间（等数据库，通常不到半秒）：空卡片占位，不闪"这一轮完成了"
        <div className="review-card is-wait" aria-busy="true" />
      ) : !card || !note || !split ? (
        <div className="empty">
          <div className="big-check">✓</div>
          <p>{answeredThisSession.current || undoCount ? '这一轮完成了' : '现在没有要学的卡片'}</p>
          {q.nextLearningAt && <p className="muted">还有学习中的卡，{new Date(q.nextLearningAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 到期</p>}
          {q.canLearnAhead && <button type="button" className="pill" onClick={() => setLearnAheadAll(true)}>现在就提前复习</button>}
          <p className="muted small">{limitLine}</p>
          {q.newInfo.left === 0 && q.newInfo.done < q.newInfo.limit && Object.values(q.newInfo.waiting).some(Boolean) && (
            <details className="new-why-inline"><summary className="muted small">新卡为什么没到上限？</summary>
              {newInfoText(q.newInfo).slice(1).map((l) => <p key={l} className="muted small">{l}</p>)}
            </details>
          )}
          {q.reviewBacklog > 0 && <p className="muted small">还有 {q.reviewBacklog} 张到期的复习卡被每日复习上限挡住，拖到明天会更难记、越积越多。建议把复习上限设为 0（不限），觉得量大就减少每日新卡。</p>}
          {undoCount > 0 && <button type="button" className="pill" onClick={() => void doUndo()}>撤销上一次</button>}
        </div>
      ) : (
        <>
          <div className="review-nav">
            <button type="button" className="pill" disabled={!undoCount} onClick={() => void doUndo()} title="撤销 (U)">↶ 撤销</button>
            <button type="button" className="pill" onClick={skip} title="跳过 (S)">跳过</button>
            <button type="button" className="pill" onClick={() => void suspend()} title="暂停 (P)">暂停</button>
            <button type="button" className="pill" onClick={() => setEditing(true)} title="编辑 (E)">编辑</button>
            <FixButton note={note} cardType={split.listen ? 'listen' : card.type} />
          </div>
          <div className={`review-card k-${task.key}`} key={card.id} data-lookup-source={note.lemma || undefined} data-no-lookup={revealed ? undefined : ''}>
            <TaskBand t={task}>
              {card.type === 'recognition' && !note.sentence && <span className="badge">待补句子</span>}
              {note.tags.map((t) => <span key={t} className="badge is-theme">{t}</span>)}
            </TaskBand>
            <div className="question">
              {split.listen
                ? <span className="muted">（只有声音）</span>
                : <span>{!split.question.text ? <i className="muted">（{split.question.label}为空）</i> : split.question.lang === s.sourceLang ? <Fr>{split.question.text}</Fr> : split.question.text}</span>}
              <SpeakBtn text={split.question.speakText} lang={split.question.lang} size={20} />
            </div>
            {split.choices && <div className="cx-choices">{split.choices.map((c) => <span key={c} className="cx-choice">{c}</span>)}</div>}
            {card.type === 'production' ? (
              <>
                {split.sceneIntent && <div className="scene-intent" title="情境题：句子给情境，这行中文指路，写出空格处的法语表达">{split.sceneIntent}</div>}
                {!revealed && hintLevel >= 1 && split.meaningHint && <div className="cue">意思：{split.meaningHint}</div>}
                {split.hint && (revealed || hintLevel >= hintSteps) && <div className="cue">提示：<Fr>{split.hint}</Fr></div>}
                {!revealed && hintLevel < hintSteps && (
                  <button type="button" className="pill hint-btn" onClick={() => setHintLevel((l) => l + 1)}
                    title={hintLevel === 0 && split.meaningHint ? '先看中文意思（看不懂题面的说法时用），再按一次给首字母 (H)' : '首字母提示 (H)'}>
                    {hintLevel === 0 && split.meaningHint ? '提示' : '首字母'} <kbd>H</kbd>
                  </button>
                )}
              </>
            ) : split.hint && <div className="cue">提示：{split.hint}</div>}
            {card.type === 'production' && !revealed && (
              <div className="type-in-wrap">
                <label htmlFor="prod-in">你的说法（只写替换高亮的那部分也行）</label>
                <input id="prod-in" className="type-in is-prod" value={typed} lang="fr" autoFocus={finePointer} autoComplete="off" spellCheck={false} placeholder="…"
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    const reveal = e.key === 'Enter' || (e.key === ' ' && !typed);
                    if (reveal) { e.preventDefault(); setRevealed(true); (e.target as HTMLInputElement).blur(); }
                    else if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
                  }} />
                <span className="type-in-tip">Enter 对答案 · 空着按空格或 Enter 也行 · Esc 离开输入框后可用快捷键（H 提示）</span>
              </div>
            )}
            <CardStats card={card} s={s} center mem={mem} />
            {(card.type === 'frame' || card.type === 'paraphrase') && !revealed && (
              <input className="type-in" value={typed} placeholder={card.type === 'frame' ? '先写出句框（可选，要填的位置写 ⬚ 或随便填），回车显示答案' : '先写出作者断言什么（可选，中文法语都行），回车显示答案'} onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); setRevealed(true); (e.target as HTMLInputElement).blur(); } }} />
            )}
            {!revealed && split.listen && split.answers[0]?.text && (
              // 听力卡：遮住的就是翻面后那行答案本身（同样的字号和样式），悬停露出上下文、点一下全部露出；翻面后原地揭开
              <div className={`answer listen-mask peek-${peek}`}>
                <div className="a1" role="button" tabIndex={0} aria-label="遮住的答案：悬停看上下文，点一下或按 H 全部显示"
                  onMouseEnter={() => { window.clearTimeout(peekTimer.current); peekTimer.current = window.setTimeout(() => setPeek((p) => (p === 0 ? 1 : p)), 250); }}
                  onMouseLeave={() => window.clearTimeout(peekTimer.current)}
                  onClick={() => setPeek((p) => (p === 2 ? 2 : ((p + 1) as 1 | 2)))}>
                  <span><Fr>{split.answers[0].text}</Fr></span>
                </div>
                <div className="listen-peek">{peek === 0 ? '听不出来时：悬停看上下文，点一下（H）看全部' : peek === 1 ? '看了上下文 · 要听的部分还遮着' : '已看全部文字'}</div>
              </div>
            )}
            {!revealed ? (
              <button type="button" className="show-btn" onClick={() => setRevealed(true)}>{task.show} <kbd>{card.type === 'production' ? 'Enter' : '空格'}</kbd></button>
            ) : (
              <>
                <div className="answer">
                  {(card.type === 'production' || card.type === 'frame') && typed.trim() && split.answerFr && <TypedDiff typed={typed} answerFr={split.answerFr} note={note} />}
                  {card.type === 'production' && note && <StuckButton note={note} />}
                  {card.type === 'paraphrase' && typed.trim() && <div className="cue para-typed">你写的：{typed.trim()}</div>}
                  {split.answers.map((a, i) => (
                    <div key={i} className={i === 0 ? 'a1' : 'a2'}>
                      <span>{a.text ? (a.lang === s.sourceLang ? <Fr>{a.text}</Fr> : a.text) : <i className="muted">（{a.label}为空）</i>}</span>
                      <SpeakBtn text={a.speakText} lang={a.lang} />
                    </div>
                  ))}
                  {(note.sense || freq?.get(note.id) != null) && (
                    <div className="back-tags">
                      {note.sense && <span className="sense-tag" title="义项：这张卡考的是这个词的哪一个意思">义项 · {note.sense}</span>}
                      {freq?.get(note.id) != null && frDict && <FreqTag f={freq.get(note.id)!} rank={frDict.rankOf(freq.get(note.id)!)} />}
                    </div>
                  )}
                  <MineBox note={note} />
                  {split.promptPhrase && split.promptFr && (
                    <div className="prompt-phrase small">
                      <span className="muted" title="题面的说法和答案的关系：下位 = 更朴素、更弱、更泛；平替 = 意思等价、更简单">题面说法{note.promptKind && split.promptFr === note.promptFr ? ` · ${note.promptKind}` : ''} </span><b>{split.promptPhrase}</b>
                      <button type="button" className={`pill${promptSaved ? ' is-on' : ''}`} disabled={promptSaved}
                        title="题面这个说法也值得学：连同题面句子放进摘句篮，之后做成它自己的卡"
                        onClick={() => void addClip({ kind: 'expr', text: split.promptPhrase!, context: split.promptFr!, source: `产出卡题面（${note.lemma}）` })
                          .then((r) => { setPromptSaved(true); toast(r.existed ? '摘句篮里已经有这一条了' : '已放进摘句篮（添加 → 摘句篮）'); })}>
                        {promptSaved ? '已放进摘句篮 ✓' : '也学这个'}
                      </button>
                    </div>
                  )}
                  {(card.type === 'production' || card.type === 'frame' || card.type === 'apply') && (
                    <button type="button" className="pill" title="这个表达在写作或口语里用上了一次" onClick={() => void bumpUsed(note.id).then(() => toast(`已记录，累计用上 ${note.usedCount + 1} 次`))}>
                      用上了 +1（{note.usedCount}）
                    </button>
                  )}
                  <BackZones note={note} heads={zoneHeadsOf(s)} plain={card.type !== 'production'} />
                  {notes && cards && <ClusterStrip note={note} notes={notes} cards={cards} shown={split.question.speakText || split.promptFr || ''} recKey={rec.current.key} />}
                  {notes && <Related note={note} notes={notes} onEdit={() => setEditing(true)} />}
                </div>
                <div className="grades">
                  {RATINGS.map(({ r, label, cls }) => (
                    <GradeButton key={r} cls={cls} label={label} r={r}
                      when={!scheduled || s?.gradeIntervals ? btnNote(r) : ''}
                      tip={[gradeCrit(r), scheduled && !s?.gradeIntervals && btnNote(r) ? `下次：${btnNote(r)}` : ''].filter(Boolean).join(' · ')}
                      onPick={() => void answer(r)} />
                  ))}
                </div>
              </>
            )}
          </div>
          <p className="keys muted small">
            <kbd>空格</kbd> 显示答案 / 良好　<kbd>1</kbd>–<kbd>4</kbd> 评分　<kbd>U</kbd> 撤销　<kbd>S</kbd> 跳过　<kbd>P</kbd> 暂停　<kbd>E</kbd> 编辑　<kbd>L</kbd> 词库　<kbd>H</kbd> 提示　<kbd>R</kbd> 重听<br />{limitLine}
          </p>
        </>
      )}
      {editing && note && <NoteEditor note={note} onClose={() => setEditing(false)} />}
    </div>
  );
}

const GRADE_GENERIC: Record<Rating, string> = { 1: '没想起来', 2: '想起来但很吃力', 3: '正常想起', 4: '毫不费力' };

/**
 * 评分按钮：鼠标停 0.35 秒才显示评分标准，离开或按下立即消失。提示不接收鼠标事件，不会挡住第一次点击；
 * 手指点按不显示（标准在 ? 说明 → 复习 → 评分里）
 */
function GradeButton({ cls, label, r, when, tip, onPick }: { cls: string; label: string; r: Rating; when: string; tip: string; onPick: () => void }) {
  const [show, setShow] = useState(false);
  const timer = useRef(0);
  const hide = () => { window.clearTimeout(timer.current); setShow(false); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button type="button" className={`grade ${cls}`} onClick={onPick}
      onPointerEnter={(e) => { if (e.pointerType !== 'mouse' || !tip) return; window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setShow(true), 350); }}
      onPointerLeave={hide} onPointerDown={hide}>
      <b>{label}</b>
      {when && <small>{when}</small>}
      <kbd>{r}</kbd>
      {show && <span className="grade-tip" role="tooltip">{tip}</span>}
    </button>
  );
}

/** 评分按钮上的标准：哪种情况按哪个键。听力卡看了上下文 / 文字以后标准跟着变 */
export function gradeCriterion(kind: Card['type'] | 'listen', r: Rating, peek: 0 | 1 | 2 = 0): string {
  const T: Partial<Record<Card['type'] | 'listen', Partial<Record<Rating, string>>>> = {
    listen: { 1: peek === 2 ? '看了文字才懂' : '听不出来', 2: peek === 1 ? '看了上下文才懂' : '2–3 秒才听懂' },
    production: { 1: '看了答案觉得陌生', 2: '形式错，或答了别的对说法（再点 ⚑ 题面不唯一）' },
    contrast: { 1: '选错', 2: '选对但靠猜', 3: '选对、说得出为什么' },
    frame: { 1: '想不起句框', 2: '只错小词或配合' },
    apply: { 1: '写不出来', 2: '语法锁有错', 3: '句框和语法锁都对' },
    paraphrase: { 1: '说反或说不出', 2: '漏了否定 / 情态', 3: '和正确选项一致' },
  };
  return T[kind]?.[r] ?? '';
}

const opText = (o: DiffOp) => (o.op === 'same' ? o.text : o.op === 'extra' ? o.typed : o.expected);

/** 自己写的和标准答案逐词对照：绿 = 一样；删除线 = 你写的；下划线 = 答案；重音、阴阳性单独标出 */
function TypedDiff({ typed, answerFr, note }: { typed: string; answerFr: string; note?: Note | null }) {
  const { ref, whole } = pickReference(typed, answerFr);
  const ops = diffWords(typed, ref);
  const sum = summarize(ops);
  const KIND = { accent: '重音', gender: '阴阳性', small: '小词', word: '' } as const;
  const smallLine = sum.small ? `介词错（产出：${sum.smallPairs.join('，')}）` : '';
  const flagged = !!note && fixItems(note.fixme).includes(smallLine);
  return (
    <div className="typed">
      <div className="typed-line">
        <span className="muted small">你写的{whole ? '' : '（对照高亮部分）'}：</span>
        {ops.map((o, i) => {
          // 句号、逗号前和 d' / l' 后不空格
          const sp = i === 0 || /^[.,)…]$/.test(opText(o)) || /['(]$/.test(opText(ops[i - 1])) ? '' : ' ';
          if (o.op === 'same') return <span key={i}>{sp}<span className="d-same">{o.text}</span></span>;
          if (o.op === 'extra') return <span key={i}>{sp}<del className="d-del" title="多写的">{o.typed}</del></span>;
          if (o.op === 'missing') return <span key={i}>{sp}<ins className="d-ins" title="漏写的">{o.expected}</ins></span>;
          return (
            <span key={i}>{sp}<span className={`d-sub is-${o.kind}`}><del>{o.typed}</del><ins>{o.expected}</ins>{KIND[o.kind] && <sup>{KIND[o.kind]}</sup>}</span></span>
          );
        })}
      </div>
      <div className={`small ${sum.total ? 'muted' : 'green'}`}>
        {sum.total === 0 ? '✓ 和答案一样' : `${sum.total} 处不同${sum.accent ? ` · 重音 ${sum.accent}` : ''}${sum.gender ? ` · 阴阳性 ${sum.gender}` : ''}${sum.small ? ` · 介词 / 小词 ${sum.small}` : ''}${sum.total === sum.accent ? '（只差重音 → 一般评"困难"）' : ''}`}
        {note && sum.small > 0 && (
          <button type="button" className={`pill d-flag${flagged ? ' is-on' : ''}`} title="记进 ⚑ 待修：这条的用法 / 注意区要把这个介词讲清楚（不另做卡）"
            onClick={() => void updateNote(note.id, { fixme: (flagged ? fixItems(note.fixme).filter((x) => x !== smallLine) : [...fixItems(note.fixme), smallLine]).join('；') || undefined }).then(() => toast(flagged ? '已取消' : '已记下：介词错（词库 → 待修）'))}>
            {flagged ? '✓ 已记下介词错' : '⚑ 记下介词错'}
          </button>
        )}
      </div>
    </div>
  );
}

/** 一张卡所有能读出来的面（题面 + 背面每一个答案），提前下载用；去重 */
export function speakables(v: { question: { speakText: string; lang: string }; answers: Array<{ speakText: string; lang: string }> }): Array<{ text: string; lang: string }> {
  const seen = new Set<string>();
  return [v.question, ...v.answers].filter((f) => f.speakText?.trim()).map((f) => ({ text: f.speakText, lang: f.lang }))
    .filter((t) => { const k = `${t.lang}|${t.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const plainOf = (raw: string) => raw.replace(/\{\{(.*?)\}\}/g, (_, x: string) => x.split('::')[0]);

/** 词频档：Lexique 每百万词出现次数 + 在所有原形里大约排第几。短语取最不常用的那个实词 */
function FreqTag({ f, rank }: { f: number; rank: number }) {
  const band = rank <= 2000 ? '核心' : rank <= 5000 ? '常用' : rank <= 10000 ? '中频' : '低频';
  const r = rank >= 1000 ? `${Math.round(rank / 100) / 10}k` : String(rank);
  return (
    <span className={`freq-tag is-${band === '核心' ? 'a' : band === '常用' ? 'b' : band === '中频' ? 'c' : 'd'}`}
      title={`Lexique 词频：每百万词 ${f >= 10 ? Math.round(f) : f.toFixed(1)} 次，在所有原形里约排第 ${rank}（短语取最不常用的实词）`}>
      词频 · {band} · 前 {r}
    </span>
  );
}

/** 我写过：作文、回译里用上这个表达的句子（批改后由 Claude 填进来），背面显示，复习时看到自己用过它的样子 */
function MineBox({ note }: { note: Note }) {
  if (!note.mine?.trim()) return null;
  return (
    <div className="mine-box" title="我写过（作文 / 回译里用上的句子）">
      {note.mine.split('\n').filter(Boolean).slice(-2).map((x, i) => <div key={i}><span className="muted small">我写过 · </span><Fr><span lang="fr">{x}</span></Fr></div>)}
    </div>
  );
}

/** 产出卡翻面后：题面推不出答案时一键记进 ⚑ 待修（和 ⚑ 菜单里的「题面推不出」是同一条） */
function StuckButton({ note }: { note: Note }) {
  const line = `题面推不出（${TYPE_LABEL.production}）`;
  const on = fixItems(note.fixme).includes(line);
  return (
    <button type="button" className={`pill stuck-btn${on ? ' is-on' : ''}`} title="从题面推不出这个答案：记进 ⚑ 待修，下批改题面"
      onClick={() => void updateNote(note.id, { fixme: (on ? fixItems(note.fixme).filter((x) => x !== line) : [...fixItems(note.fixme), line]).join('；') || undefined }).then(() => toast(on ? '已取消' : '已记下：题面推不出（词库 → 待修）'))}>
      {on ? '✓ 已记下题面推不出' : '题面推不出？'}
    </button>
  );
}

const FIX_REASONS = ['题面推不出', '题面不唯一', '题面看不懂', '题面比答案难', '答案不值得考', '考错了部分', '介词错', '例句看不懂', '关联不对', '少了讲解'];
const fixItems = (s: string | null | undefined) => (s ?? '').split('；').map((x) => x.trim()).filter(Boolean);
/** ⚑ 待修：一键记下这张卡的问题（不评分、不打断复习），词库「待修」里集中处理。打开时列出已经记下的，点 × 删一条，再点原因也能取消 */
function FixButton({ note, cardType }: { note: Note; cardType: string }) {
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState('');
  useEffect(() => { setOpen(false); setOther(''); }, [note.id]);
  // 点菜单外面关掉
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', down);
    return () => window.removeEventListener('pointerdown', down);
  }, [open]);
  const items = fixItems(note.fixme);
  const typeLabel = TYPE_LABEL[cardType as Card['type']] ?? (cardType === 'listen' ? '听认' : cardType);
  const save = async (next: string[], msg: string) => {
    await updateNote(note.id, { fixme: next.length ? next.join('；') : undefined });
    toast(msg);
  };
  const lineOf = (r: string) => `${r}（${typeLabel}）`;
  const toggle = (reason: string) => {
    const r = reason.trim();
    if (!r) return;
    const line = lineOf(r);
    if (items.includes(line)) return void save(items.filter((x) => x !== line), `已取消：${r}`);
    void save([...items, line], `已标为待修：${r}（词库 → 待修）`);
    setOther('');
  };
  return (
    <span className="fix-wrap" ref={wrap}>
      <button type="button" className={`pill${items.length ? ' is-on' : ''}`} onClick={() => setOpen((o) => !o)}
        title={items.length ? `待修：${items.join('；')}` : '这张卡有问题：一键记下，词库「待修」里集中改'}>⚑ {items.length ? `待修 ${items.length}` : '待修'}</button>
      {open && (
        <div className="fix-menu" role="menu">
          {items.length > 0 && (
            <ul className="fix-list">
              {items.map((x) => (
                <li key={x}>{x}<button type="button" className="icon" aria-label={`删除：${x}`} title="删掉这一条" onClick={() => void save(items.filter((y) => y !== x), '已删除一条')}>×</button></li>
              ))}
            </ul>
          )}
          {FIX_REASONS.map((r) => {
            const on = items.includes(lineOf(r));
            return <button key={r} type="button" className={`pill${on ? ' is-on' : ''}`} role="menuitemcheckbox" aria-checked={on} onClick={() => toggle(r)}>{on ? '✓ ' : ''}{r}</button>;
          })}
          <input value={other} placeholder="其他（写具体些），回车" onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); toggle(other); } if (e.key === 'Escape') setOpen(false); }} />
        </div>
      )}
    </span>
  );
}

/** 卡片顶部的任务条：一眼看出这张卡要你做什么（颜色 + 图标 + 动词 + 一句问题），按钮文字也跟着变 */
interface Task { key: string; tone: 'blue' | 'orange' | 'green' | 'purple' | 'grey'; icon: keyof typeof TASK_ICON; verb: string; ask: string; show: string }
const TASKS: Record<string, Task> = {
  recognition: { key: 'recognition', tone: 'blue', icon: 'eye', verb: '看懂', ask: '高亮部分是什么意思？', show: '显示意思' },
  listen: { key: 'listen', tone: 'blue', icon: 'ear', verb: '听懂', ask: '只听声音，听懂了再翻面', show: '显示原文' },
  production: { key: 'production', tone: 'orange', icon: 'pen', verb: '说出来', ask: '用更地道的说法换掉高亮部分', show: '对答案' },
  cloze: { key: 'cloze', tone: 'green', icon: 'blank', verb: '填空', ask: '横线处填什么？', show: '显示答案' },
  contrast: { key: 'contrast', tone: 'purple', icon: 'split', verb: '选词', ask: '组里哪个词放进横线才对？', show: '显示答案' },
  frame: { key: 'frame', tone: 'grey', icon: 'pen', verb: '写句框', ask: '按功能写出整句骨架', show: '显示答案' },
  apply: { key: 'apply', tone: 'grey', icon: 'pen', verb: '套用', ask: '用这个句框在脑中写一句', show: '显示答案' },
  paraphrase: { key: 'paraphrase', tone: 'grey', icon: 'eye', verb: '改写', ask: '作者实际断言了什么？', show: '显示答案' },
};
const TASK_ICON = {
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  ear: <><path d="M3 14v-2a9 9 0 0 1 18 0v2" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></>,
  pen: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  blank: <><path d="M4 17h16" /><path d="M8 13h8" strokeDasharray="2 2" /></>,
  split: <><path d="M12 3v6" /><path d="M12 9l-6 6v6" /><path d="M12 9l6 6v6" /></>,
};
/** 右侧放主题标签（GÉNÉRAL 等），不再单独占一行 */
function TaskBand({ t, children }: { t: Task; children?: ReactNode }) {
  return (
    <div className={`task-band tone-${t.tone}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TASK_ICON[t.icon]}</svg>
      <span className="task-text"><b>{t.verb}</b><span className="ask"> · {t.ask}</span></span>
      <span className="task-tags">{children}</span>
    </div>
  );
}

/** 点蓝色新卡数弹出的说明：今天新卡为什么是这个数 */
function NewWhy({ lines, onClose }: { lines: string[]; onClose: () => void }) {
  return (
    <div className="new-why" role="note">
      <button type="button" className="icon" aria-label="关闭" onClick={onClose}>×</button>
      {lines.map((l, i) => <p key={l} className={i ? 'muted small' : 'small'}>{l}</p>)}
      <p className="muted small">今天的新卡在第一次出题时就定好了，当天不会再冒出新的（之后新加 / 导入的笔记除外）；改新卡相关设置会重排。</p>
    </div>
  );
}
