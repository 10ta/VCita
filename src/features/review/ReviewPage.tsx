import { useEffect, useMemo, useRef, useState } from 'react';
import { useCards, useNotes, useSettings, useTodayLogs } from '../../db/hooks';
import { answerCard, bumpUsed, setSuspended, undoAnswer, type AnswerResult } from '../../db/actions';
import { buildQueue } from '../../srs/queue';
import { fmtNextIn, preview, type Rating } from '../../srs/scheduler';
import { fmtDays, fmtMinutes, fromIso } from '../../lib/time';
import { answerCustom, endCustom, nextQueue, pickCustom, restoreCustom, useCustom, type CustomSession } from '../../srs/custom';
import { speak } from '../../lib/speech';
import { usePrefs, setPrefs } from '../../ui/prefs';
import { useHotkeys, useNow } from '../../ui/hooks';
import { toast } from '../../ui/toast';
import { langLabel } from '../../ui/langs';
import { syncIfAuto } from '../../sync/engine';
import { CardStats, cardView, Cues, SpeakBtn, TYPE_LABEL } from '../CardFace';
import { NoteEditor } from '../NoteEditor';

const RATINGS: Array<{ r: Rating; label: string; cls: string }> = [
  { r: 1, label: '忘了', cls: 'r1' }, { r: 2, label: '困难', cls: 'r2' }, { r: 3, label: '良好', cls: 'r3' }, { r: 4, label: '容易', cls: 'r4' },
];

/** 跳到词库，只显示这条笔记并打开编辑；词库里有"返回复习" */
const openInLibrary = (noteId: string) => { location.hash = `#/library?note=${encodeURIComponent(noteId)}&edit=1`; };

/** 复习页发音开关：点一下换一档，从轻到重 */
const AUDIO_LABEL = { off: '关', read: '自动读', core: '听·核心词', all: '听·全部' } as const;
const AUDIO_NEXT = { off: 'read', read: 'core', core: 'all', all: 'off' } as const;
const AUDIO_TITLE = '关 → 自动读（只读法语：法语题面出题时读，中文题面 / 挖空翻面后读答案）→ 听·核心词 / 听·全部（再加上认读卡正面只放声音，闭眼听懂再翻面）';

export function ReviewPage({ deckId }: { deckId: string }) {
  const s = useSettings();
  const cards = useCards();
  const notes = useNotes();
  const prefs = usePrefs();
  const [now, refreshNow] = useNow(15_000);
  const logs = useTodayLogs(s?.dayStartHour, now);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [skipped, setSkipped] = useState(() => new Set<string>());
  const [learnAheadAll, setLearnAheadAll] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  /** 撤销栈：正常调度的作答有 res；自定义学习另存作答前的队列 */
  const undo = useRef<Array<{ cardId: string; res: AnswerResult | null; custom: CustomSession | null }>>([]);
  const custom = useCustom();
  const shownAt = useRef(Date.now());
  const answeredThisSession = useRef(0);
  /** 刚答过的卡：等数据库更新到这个版本后再选下一张，避免读到旧数据又选中它 */
  const waitFor = useRef<{ id: string; updatedAt: string; logId: string; at: number } | null>(null);
  /** 自定义学习里最近作答的笔记，用来把兄弟卡隔开 */
  const recentNotes = useRef<string[]>([]);

  const noteMap = useMemo(() => new Map((notes ?? []).map((n) => [n.id, n])), [notes]);
  const q = useMemo(
    () => (s && cards && logs ? buildQueue({ cards, todayLogs: logs, deckId, now, settings: s, skipped, learnAheadAll, notes: noteMap }) : null),
    [s, cards, logs, deckId, now, skipped, learnAheadAll, noteMap],
  );
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
    }
    const valid = card && !card.suspended && (custom ? custom.queue.includes(card.id) : card.deckId === deckId);
    if (!valid) {
      setCurrentId(nextId);
      setRevealed(false);
      shownAt.current = Date.now();
    }
  }, [q, cards, logs, card, deckId, custom, nextId]);

  // 一轮结束：自动同步打开时立即同步一次
  useEffect(() => {
    if (q && !q.next && !currentId && answeredThisSession.current > 0) {
      answeredThisSession.current = 0;
      void syncIfAuto();
    }
  }, [q, currentId]);

  const labels: [string, string, string] = s ? [langLabel(s.sourceLang), langLabel(s.targetLang1), langLabel(s.targetLang2)] : ['', '', ''];
  const audio = prefs.audio ?? 'core';
  const listen = !!note && (audio === 'all' || (audio === 'core' && note.layer === 'core'));
  const split = note && s && card ? cardView(card.type, note, s, prefs.quizType, labels, card.reps, listen) : null;
  // 产出卡可以先写出答案，揭示后和标准答案并排对照（不自动判对错）
  const [typed, setTyped] = useState('');
  // 产出卡的首字母提示默认收起，想不出来时再点开（H），否则一眼看到就失去了回忆的意义
  const [showHint, setShowHint] = useState(false);
  useEffect(() => { setTyped(''); setShowHint(false); }, [currentId]);

  // 自动发音只读学习语言（法语）：题面是法语就出题时读；题面是中文 / 英文 / 挖空，就翻面后读法语答案
  const frontIsSource = !!split && !!s && split.question.lang === s.sourceLang && !!split.question.speakText;
  const sourceAnswer = split && s ? split.answers.find((a) => a.lang === s.sourceLang && a.speakText) : undefined;
  const lastSpoken = useRef<string | null>(null);
  useEffect(() => {
    if (!split || !card || audio === 'off') return;
    const target = !revealed ? (frontIsSource ? split.question : null) : (frontIsSource ? null : sourceAnswer ?? null);
    if (!target) return;
    const key = `${card.id}:${prefs.quizType}:${split.listen ? 'l' : ''}:${revealed ? 'b' : 'f'}`;
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
    if ((k === 'h' || k === 'H') && card.type === 'production' && !revealed) return setShowHint(true);
    if (k === 'l' || k === 'L') return openInLibrary(card.noteId);
    // R：重听法语。题面不是法语时，翻面后读答案；没翻面就读题面（手动按的，读什么都行）
    if (k === 'r' || k === 'R') {
      const t = revealed && !frontIsSource && sourceAnswer ? sourceAnswer : split?.question;
      return t?.speakText ? void speak(t.speakText, t.lang) : false;
    }
    return false;
  });

  if (!s || !q) return null;

  // 自定义学习里，没到期的卡只练习不调度
  const scheduled = !custom || (!!card && card.state !== 'new' && fromIso(card.due) <= Date.now());
  const answer = async (r: Rating) => {
    if (!card || !revealed) return;
    setLearnAheadAll(false);
    const res = scheduled ? await answerCard(card.id, r, { elapsedMs: Date.now() - shownAt.current }) : null;
    undo.current.push({ cardId: card.id, res, custom });
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
    if (last.custom) restoreCustom(last.custom);
    setSkipped((x) => { const n = new Set(x); n.delete(last.cardId); return n; });
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

  const pv = card ? preview(card, s, now) : null;
  const PRACTICE: Record<Rating, string> = { 1: '稍后再练', 2: '本轮最后', 3: '本轮完成', 4: '本轮完成' };
  const btnNote = (r: Rating) => (!scheduled ? PRACTICE[r] : pv ? `${fmtNextIn(pv[r], fmtMinutes, fmtDays)}后` : '');
  const limitLine = `今日已学：新卡 ${q.done.newDone}/${s.newPerDay} · 复习 ${q.done.reviewDone}${s.reviewsPerDay ? `/${s.reviewsPerDay}` : ''}`
    + (q.reviewBacklog > 0 ? ` · 超出上限 ${q.reviewBacklog}` : '');

  return (
    <div className="page review">
      <div className="toolbar">
        <span className="muted">题面</span>
        {labels.map((l, i) => (
          <button key={i} type="button" className={`pill${prefs.quizType === i ? ' is-on' : ''}`} onClick={() => setPrefs({ quizType: i as 0 | 1 | 2 })}>{l}</button>
        ))}
        <span className="grow" />
        <button type="button" className={`pill${audio !== 'off' ? ' is-on' : ''}`} title={AUDIO_TITLE}
          onClick={() => setPrefs({ audio: AUDIO_NEXT[audio] })}>
          发音：{AUDIO_LABEL[audio]}
        </button>
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
          <span className="c-learn" title="学习中 / 重学（本学习日内到期，默认到凌晨 4 点）">{q.counts.learning}</span>
          <span className="c-review" title="到期复习">{q.counts.review}</span>
          <span className="c-new" title="今天还能学的新卡">{q.counts.new}</span>
        </div>
      )}

      {custom && !customNext ? (
        <div className="empty">
          <div className="big-check">✓</div>
          <p>自定义学习完成：{custom.label}，{custom.done} 张</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            {undoCount > 0 && <button type="button" className="pill" onClick={() => void doUndo()}>撤销上一次</button>}
            <button type="button" className="btn is-primary" onClick={() => { endCustom(); setCurrentId(null); undo.current = []; setUndoCount(0); }}>回到正常复习</button>
          </div>
        </div>
      ) : !card || !note || !split ? (
        <div className="empty">
          <div className="big-check">✓</div>
          <p>{answeredThisSession.current || undoCount ? '这一轮完成了' : '现在没有要学的卡片'}</p>
          {q.nextLearningAt && <p className="muted">还有学习中的卡，{new Date(q.nextLearningAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 到期</p>}
          {q.canLearnAhead && <button type="button" className="pill" onClick={() => setLearnAheadAll(true)}>现在就提前复习</button>}
          <p className="muted small">{limitLine}</p>
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
          </div>
          <div className="review-card" key={card.id}>
            <div className="badges">
              <span className={`badge is-type t-${card.type}`}>{TYPE_LABEL[card.type]}</span>
              {card.type === 'recognition' && !note.sentence && <span className="badge">待补句子</span>}
              {note.tags.map((t) => <span key={t} className="badge is-theme">{t}</span>)}
            </div>
            <div className="question">
              {split.listen
                ? <span className="muted">闭眼听，听懂了再翻面</span>
                : <span>{split.question.text || <i className="muted">（{split.question.label}为空）</i>}</span>}
              <SpeakBtn text={split.question.speakText} lang={split.question.lang} size={20} />
            </div>
            {split.hint && (card.type !== 'production' || showHint || revealed
              ? <div className="cue">提示：{split.hint}</div>
              : <button type="button" className="pill hint-btn" onClick={() => setShowHint(true)} title="首字母提示 (H)">提示 <kbd>H</kbd></button>)}
            <CardStats card={card} s={s} center />
            {card.type === 'production' && !revealed && (
              <input className="type-in" value={typed} placeholder="先写出法语（可选），回车显示答案" onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); setRevealed(true); (e.target as HTMLInputElement).blur(); } }} />
            )}
            {!revealed ? (
              <button type="button" className="show-btn" onClick={() => setRevealed(true)}>显示答案 <kbd>空格</kbd></button>
            ) : (
              <>
                <div className="answer">
                  {card.type === 'production' && typed.trim() && <div className="typed">你写的：{typed}</div>}
                  {split.answers.map((a, i) => (
                    <div key={i} className={i === 0 ? 'a1' : 'a2'}>
                      <span>{a.text || <i className="muted">（{a.label}为空）</i>}</span>
                      <SpeakBtn text={a.speakText} lang={a.lang} />
                    </div>
                  ))}
                  <Cues note={note} only={split.cues === 'extra' ? 'extra' : undefined} />
                  {card.type === 'production' && (
                    <button type="button" className="pill" title="这个表达在写作或口语里用上了一次" onClick={() => void bumpUsed(note.id).then(() => toast(`已记录，累计用上 ${note.usedCount + 1} 次`))}>
                      用上了 +1（{note.usedCount}）
                    </button>
                  )}
                </div>
                {(card.type !== 'recognition' || split.listen) && (
                  <p className="muted small grade-guide">
                    {split.listen ? '2–3 秒内没听懂 → 困难；听不出来 → 忘了' : '表达想出来了、只是形式错 → 困难；表达想不出来 → 忘了'}
                  </p>
                )}
                <div className="grades">
                  {RATINGS.map(({ r, label, cls }) => (
                    <button key={r} type="button" className={`grade ${cls}`} onClick={() => void answer(r)}>
                      <b>{label}</b>
                      <small>{btnNote(r)}</small>
                      <kbd>{r}</kbd>
                    </button>
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
