// 卡片的展示：认读卡正面是句子（{{…}} 加粗）或旧卡的单词；背面是意思 + 线索。
// 题面 = (卡片旋转 + 当前题面设置) 对应的那个字段，另外两个字段作为答案。
import type { ReactNode } from 'react';
import type { Card, Note, Settings } from '../schema';
import { dayStartMs, daysBetween, fmtDays, fromIso, studyDay } from '../lib/time';
import { speak } from '../lib/speech';

/** "a {{b}} c" → a <b>b</b> c */
export function renderSentence(s: string, mode: 'bold' | 'blank' = 'bold'): ReactNode[] {
  return s.split(/(\{\{.*?\}\})/g).map((part, i) => {
    const m = /^\{\{(.*)\}\}$/.exec(part);
    if (!m) return part;
    return mode === 'bold' ? <b key={i} className="cloze">{m[1]}</b> : <span key={i} className="blank">___</span>;
  });
}
export const plainSentence = (s: string) => s.replace(/\{\{(.*?)\}\}/g, '$1');

export interface Face { text: ReactNode; speakText: string; lang: string; label: string }

export function faces(note: Note, s: Settings, labels: [string, string, string]): Face[] {
  const front: Face = note.sentence
    ? { text: renderSentence(note.sentence), speakText: plainSentence(note.sentence), lang: s.sourceLang, label: labels[0] }
    : { text: note.lemma, speakText: note.lemma, lang: s.sourceLang, label: labels[0] };
  return [
    front,
    { text: note.meaningZh, speakText: note.meaningZh, lang: s.targetLang1, label: labels[1] },
    { text: note.meaningEn, speakText: note.meaningEn, lang: s.targetLang2, label: labels[2] },
  ];
}

export function quizSplit(note: Note, s: Settings, quizType: number, labels: [string, string, string]) {
  const f = faces(note, s, labels);
  const q = (note.rot + quizType) % 3;
  return { question: f[q], answers: f.filter((_, i) => i !== q) };
}

export const TYPE_LABEL: Record<Card['type'], string> = { recognition: '认读', production: '产出', cloze: '挖空' };

export interface CardView {
  question: Face;
  hint: string | null;
  answers: Face[];
  /** 背面的线索：认读、挖空显示词族 / 出处 / 补充；产出只显示补充 */
  cues: 'all' | 'extra';
}

/** 三种卡的正反面。旋转和题面切换只作用于认读卡 */
export function cardView(type: Card['type'], note: Note, s: Settings, quizType: number, labels: [string, string, string]): CardView {
  if (type === 'production') {
    const q = note.intentZh ?? '';
    const a = note.answerFr ?? '';
    return {
      question: { text: q, speakText: q, lang: s.targetLang1, label: '中文意图' },
      hint: note.hint, cues: 'extra',
      answers: [{ text: a, speakText: a, lang: s.sourceLang, label: labels[0] }],
    };
  }
  if (type === 'cloze') {
    const plain = plainSentence(note.sentence);
    return {
      question: { text: renderSentence(note.sentence, 'blank'), speakText: '', lang: s.sourceLang, label: labels[0] },
      hint: null, cues: 'all',
      answers: [
        { text: renderSentence(note.sentence), speakText: plain, lang: s.sourceLang, label: labels[0] },
        { text: note.meaningZh, speakText: note.meaningZh, lang: s.targetLang1, label: labels[1] },
      ],
    };
  }
  return { ...quizSplit(note, s, quizType, labels), hint: null, cues: 'all' };
}

export function SpeakBtn({ text, lang, size = 14 }: { text: string; lang: string; size?: number }) {
  if (!text) return null;
  return (
    <button type="button" className="spk" title="发音" onClick={(e) => { e.stopPropagation(); void speak(text, lang); }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 010 14.14" /><path d="M15.54 8.46a5 5 0 010 7.07" /></svg>
    </button>
  );
}

/** 线索行：词族 · 出处 / 补充 */
export function Cues({ note, only }: { note: Note; only?: 'extra' }) {
  const line1 = only ? '' : [note.cueFamily, note.source].filter(Boolean).join(' · ');
  return (
    <>
      {line1 && <div className="cue">{line1}</div>}
      {note.extra && <div className="cue">{note.extra}</div>}
    </>
  );
}

const STATE_LABEL: Record<Card['state'], string> = { new: '新卡', learning: '学习中', relearning: '重学', review: '' };

/** 调度状态的小标签：到期、间隔、倍率、遗忘次数 */
export function CardStats({ card, s, center }: { card: Card; s: Settings; center?: boolean }) {
  const chips: Array<[string, string, string?]> = [];
  if (card.state !== 'review') chips.push([STATE_LABEL[card.state], 'is-blue']);
  else {
    const today = studyDay(Date.now(), s.dayStartHour);
    const dueDay = studyDay(fromIso(card.due), s.dayStartHour);
    const d = daysBetween(today, dueDay);
    chips.push([d < 0 ? `逾期${-d}天` : d === 0 ? '今天到期' : `${d}天后`, d <= 0 ? 'is-accent' : '', `下次复习 ${new Date(dayStartMs(dueDay, 0)).toLocaleDateString()}`]);
    chips.push([`间隔 ${fmtDays(card.interval)}`, '', '上次复习到下次复习之间隔多久']);
  }
  chips.push([`倍率 ×${card.ease.toFixed(2)}`, card.ease < 2 ? 'is-warn' : '', '答"良好"时：新间隔 = 当前间隔 × 倍率。越低说明越难记']);
  if (card.lapses > 0) chips.push([`遗忘${card.lapses}次`, 'is-red', '复习时点"忘了"的次数']);
  if (card.isLeech) chips.push(['待改造', 'is-red', `遗忘达到 ${s.leechThreshold} 次：补句子、加线索后解除暂停`]);
  if (card.suspended) chips.push(['已暂停', 'is-warn']);
  return (
    <div className={`stats${center ? ' is-center' : ''}`}>
      {chips.map(([t, cls, title]) => <span key={t} className={`stat ${cls}`} title={title}>{t}</span>)}
    </div>
  );
}
