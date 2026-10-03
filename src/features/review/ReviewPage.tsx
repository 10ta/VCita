import { useEffect, useMemo, useRef, useState } from 'react';
import { useCards, useNotes, useSettings, useTodayLogs } from '../../db/hooks';
import { answerCard, setSuspended, undoAnswer, type AnswerResult } from '../../db/actions';
import { buildQueue } from '../../srs/queue';
import { fmtNextIn, preview, type Rating } from '../../srs/scheduler';
import { fmtDays, fmtMinutes } from '../../lib/time';
import { speak } from '../../lib/speech';
import { usePrefs, setPrefs } from '../../ui/prefs';
import { useHotkeys, useNow } from '../../ui/hooks';
import { toast } from '../../ui/toast';
import { langLabel } from '../../ui/langs';
import { syncIfAuto } from '../../sync/engine';
import { CardStats, Cues, quizSplit, SpeakBtn } from '../CardFace';
import { NoteEditor } from '../NoteEditor';

const RATINGS: Array<{ r: Rating; label: string; cls: string }> = [
  { r: 1, label: '忘了', cls: 'r1' }, { r: 2, label: '困难', cls: 'r2' }, { r: 3, label: '良好', cls: 'r3' }, { r: 4, label: '容易', cls: 'r4' },
];

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
  const [undoCount, setUndoCount] = useState(0);
  const undo = useRef<AnswerResult[]>([]);
  const shownAt = useRef(Date.now());
  const answeredThisSession = useRef(0);
  /** 刚答过的卡：等数据库更新到这个版本后再选下一张，避免读到旧数据又选中它 */
  const waitFor = useRef<{ id: string; updatedAt: string } | null>(null);

  const noteMap = useMemo(() => new Map((notes ?? []).map((n) => [n.id, n])), [notes]);
  const q = useMemo(
    () => (s && cards && logs ? buildQueue({ cards, todayLogs: logs, deckId, now, settings: s, skipped }) : null),
    [s, cards, logs, deckId, now, skipped],
  );
  const card = currentId ? cards?.find((c) => c.id === currentId) ?? null : null;
  const note = card ? noteMap.get(card.noteId) ?? null : null;

  // 选下一张：当前没有卡、或当前卡已失效（被删除、暂停、换了牌组）
  useEffect(() => {
    if (!q || !cards) return;
    const w = waitFor.current;
    if (w) {
      const c = cards.find((x) => x.id === w.id);
      if (c && c.updatedAt === w.updatedAt) return; // 数据库里还是作答前的版本，继续等
      waitFor.current = null;
    }
    const valid = card && !card.suspended && card.deckId === deckId;
    if (!valid) {
      setCurrentId(q.next?.id ?? null);
      setRevealed(false);
      shownAt.current = Date.now();
    }
  }, [q, cards, card, deckId]);

  // 一轮结束：自动同步打开时立即同步一次
  useEffect(() => {
    if (q && !q.next && !currentId && answeredThisSession.current > 0) {
      answeredThisSession.current = 0;
      void syncIfAuto();
    }
  }, [q, currentId]);

  const labels: [string, string, string] = s ? [langLabel(s.sourceLang), langLabel(s.targetLang1), langLabel(s.targetLang2)] : ['', '', ''];
  const split = note && s ? quizSplit(note, s, prefs.quizType, labels) : null;

  // 自动发音：新卡出现时读题面
  const lastSpoken = useRef<string | null>(null);
  useEffect(() => {
    if (!prefs.autoPlay || !split || revealed || !card) return;
    const key = `${card.id}:${prefs.quizType}`;
    if (lastSpoken.current === key) return;
    lastSpoken.current = key;
    void speak(split.question.speakText, split.question.lang);
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
    return false;
  });

  if (!s || !q) return null;

  const answer = async (r: Rating) => {
    if (!card || !revealed) return;
    const res = await answerCard(card.id, r, { elapsedMs: Date.now() - shownAt.current });
    undo.current.push(res);
    if (undo.current.length > 30) undo.current.shift();
    setUndoCount(undo.current.length);
    answeredThisSession.current++;
    if (res.leechNow) toast(`遗忘达到 ${s.leechThreshold} 次，已自动暂停，放进"待改造"`, true);
    waitFor.current = { id: card.id, updatedAt: card.updatedAt };
    setCurrentId(null);
    setRevealed(false);
    refreshNow();
  };
  const doUndo = async () => {
    const last = undo.current.pop();
    if (!last) return;
    setUndoCount(undo.current.length);
    await undoAnswer(last);
    setSkipped((x) => { const n = new Set(x); n.delete(last.before.id); return n; });
    setCurrentId(last.before.id);
    setRevealed(true);
    toast('已撤销');
  };
  const skip = () => {
    if (!card) return;
    setSkipped((x) => new Set(x).add(card.id));
    setCurrentId(null);
  };
  const suspend = async () => {
    if (!card) return;
    await setSuspended([card.noteId], true);
    toast('已暂停这张卡，可在词库"已暂停"里恢复');
  };

  const pv = card ? preview(card, s) : null;
  const limitLine = `今日已学：新卡 ${q.done.newDone}/${s.newPerDay} · 复习 ${q.done.reviewDone}${s.reviewsPerDay ? `/${s.reviewsPerDay}` : ''}`;

  return (
    <div className="page review">
      <div className="toolbar">
        <span className="muted">题面</span>
        {labels.map((l, i) => (
          <button key={i} type="button" className={`pill${prefs.quizType === i ? ' is-on' : ''}`} onClick={() => setPrefs({ quizType: i as 0 | 1 | 2 })}>{l}</button>
        ))}
        <span className="grow" />
        <button type="button" className={`pill${prefs.autoPlay ? ' is-on' : ''}`} onClick={() => setPrefs({ autoPlay: !prefs.autoPlay })}>自动发音</button>
      </div>
      <div className="counts">
        <span className="c-learn" title="学习中 / 重学（今天内到期）">{q.counts.learning}</span>
        <span className="c-review" title="到期复习">{q.counts.review}</span>
        <span className="c-new" title="今天还能学的新卡">{q.counts.new}</span>
      </div>

      {!card || !note || !split ? (
        <div className="empty">
          <div className="big-check">✓</div>
          <p>{answeredThisSession.current || undoCount ? '这一轮完成了' : '现在没有要学的卡片'}</p>
          {q.nextLearningAt && <p className="muted">还有学习中的卡，{new Date(q.nextLearningAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 到期</p>}
          <p className="muted small">{limitLine}</p>
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
              {!note.sentence && <span className="badge">待补句子</span>}
              {note.tags.map((t) => <span key={t} className="badge is-theme">{t}</span>)}
            </div>
            <div className="question">
              <span>{split.question.text || <i className="muted">（{split.question.label}为空）</i>}</span>
              <SpeakBtn text={split.question.speakText} lang={split.question.lang} size={20} />
            </div>
            <CardStats card={card} s={s} center />
            {!revealed ? (
              <button type="button" className="show-btn" onClick={() => setRevealed(true)}>显示答案 <kbd>空格</kbd></button>
            ) : (
              <>
                <div className="answer">
                  {split.answers.map((a, i) => (
                    <div key={i} className={i === 0 ? 'a1' : 'a2'}>
                      <span>{a.text || <i className="muted">（{a.label}为空）</i>}</span>
                      <SpeakBtn text={a.speakText} lang={a.lang} />
                    </div>
                  ))}
                  <Cues note={note} />
                </div>
                <div className="grades">
                  {RATINGS.map(({ r, label, cls }) => (
                    <button key={r} type="button" className={`grade ${cls}`} onClick={() => void answer(r)}>
                      <b>{label}</b>
                      <small>{pv ? `${fmtNextIn(pv[r], fmtMinutes, fmtDays)}后` : ''}</small>
                      <kbd>{r}</kbd>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <p className="keys muted small">
            <kbd>空格</kbd> 显示答案 / 良好　<kbd>1</kbd>–<kbd>4</kbd> 评分　<kbd>U</kbd> 撤销　<kbd>S</kbd> 跳过　<kbd>P</kbd> 暂停　<kbd>E</kbd> 编辑<br />{limitLine}
          </p>
        </>
      )}
      {editing && note && <NoteEditor note={note} onClose={() => setEditing(false)} />}
    </div>
  );
}
