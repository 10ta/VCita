// 卡片的展示：认读卡正面是句子（{{…}} 加粗）或旧卡的单词；背面是意思 + 线索。
// 题面 = (卡片旋转 + 当前题面设置) 对应的那个字段，另外两个字段作为答案。
import type { ReactNode } from 'react';
import type { Card, Note, Settings } from '../schema';
import { dayStartMs, daysBetween, fmtDays, fromIso, studyDay } from '../lib/time';
import { speak } from '../lib/speech';
import { hasCloze, hasInlineHint } from '../schema/validate';

/** "survoler la Sibérie" → "s _ _ _ _ _ _ _   l _" ：每个词的首字母 + 其余字母数，标点和省音号原样 */
export function letterPattern(t: string): string {
  return t.split(/(\s+)/).map((w) => (/^\s+$/.test(w) ? '   ' : w.replace(/\p{L}/gu, (ch, i) => (i === 0 || !/\p{L}/u.test(w.slice(0, i)) ? ch : ' _')).replace(/^ /, ''))).join('');
}

/** "a {{b}} c" → a <b>b</b> c；挖空模式下横线处显示提示 / 首字母。{{答案::提示}} 的提示只在挖空时显示，优先于笔记的挖空提示。
 *  可以有多处 {{…}}（分开的表达：{{avoir}} ces idées {{en tête}}）：笔记的挖空提示只显示在第一处，其余只有横线 / 首字母。
 *  横线后紧跟的标点和横线粘在一起，不会单独折到下一行 */
export function renderSentence(s: string, mode: 'bold' | 'blank' = 'bold', blank?: { hint?: string | null; letters?: boolean }): ReactNode[] {
  const parts = s.split(/(\{\{.*?\}\})/g);
  const out: ReactNode[] = [];
  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const m = /^\{\{(.*)\}\}$/.exec(part);
    if (!m) { if (part) out.push(part); continue; }
    const [ans, inline] = m[1].split('::');
    if (mode === 'bold') { out.push(<b key={i} className="cloze">{ans}</b>); continue; }
    const hint = inline?.trim() || (n === 0 ? blank?.hint?.trim() : '') || '';
    n++;
    const label = [hint ? `[${hint}]` : '', blank?.letters ? letterPattern(ans) : ''].filter(Boolean).join(' ');
    const el = label ? <span key={i} className="blank has-hint">{label}</span> : <span key={i} className="blank">___</span>;
    // 下一段以标点开头（含法语标点前的空格）：把标点并进来，一起不换行
    const punct = /^[\s\u00a0\u202f]?[.,;:!?…»)]+/.exec(parts[i + 1] ?? '')?.[0];
    if (punct) { out.push(<span key={`${i}p`} className="nowrap">{el}{punct}</span>); parts[i + 1] = parts[i + 1].slice(punct.length); }
    else out.push(el);
  }
  return out;
}
export const plainSentence = (s: string) => s.replace(/\{\{(.*?)\}\}/g, (_, x: string) => x.split('::')[0]);

export interface Face { text: ReactNode; speakText: string; lang: string; label: string }

/** 第 variant 个版本（按复习次数轮换）：主句 / 主挖空句之后接备用例句 */
export function pickSentence(note: Note, kind: 'recognition' | 'cloze', variant = 0): string {
  const main = kind === 'cloze' && note.clozeSentence?.trim() && hasCloze(note.clozeSentence) ? note.clozeSentence : note.sentence;
  if (!main) return main;
  const pool = [main, ...(note.altSentences ?? []).filter((x) => hasCloze(x))];
  return pool[variant % pool.length];
}
export interface Intent { promptFr: string | null; intentZh: string; answerFr: string; hint: string | null }
const usable = (x: { promptFr?: string | null; intentZh?: string | null; answerFr?: string | null }) => !!(x.answerFr?.trim() && (x.promptFr?.trim() || x.intentZh?.trim()));
export function pickIntent(note: Note, variant = 0): Intent {
  const main: Intent = { promptFr: note.promptFr?.trim() || null, intentZh: note.intentZh ?? '', answerFr: note.answerFr ?? '', hint: note.hint };
  const pool = [main, ...(note.altIntents ?? []).filter(usable).map((x) => ({ promptFr: x.promptFr?.trim() || null, intentZh: x.intentZh ?? '', answerFr: x.answerFr, hint: x.hint ?? null }))];
  return pool[variant % pool.length];
}
/** 这条笔记有几个轮换版本（认读 / 挖空 / 产出） */
export const variantCount = (note: Note) => ({
  sentences: 1 + (note.altSentences ?? []).filter((x) => hasCloze(x)).length,
  intents: 1 + (note.altIntents ?? []).filter(usable).length,
});

export function faces(note: Note, s: Settings, labels: [string, string, string], variant = 0): Face[] {
  const sentence = pickSentence(note, 'recognition', variant);
  const front: Face = sentence
    ? { text: renderSentence(sentence), speakText: plainSentence(sentence), lang: s.sourceLang, label: labels[0] }
    : { text: note.lemma, speakText: note.lemma, lang: s.sourceLang, label: labels[0] };
  return [
    front,
    { text: note.meaningZh, speakText: note.meaningZh, lang: s.targetLang1, label: labels[1] },
    { text: note.meaningEn, speakText: note.meaningEn, lang: s.targetLang2, label: labels[2] },
  ];
}

export function quizSplit(note: Note, s: Settings, quizType: number, labels: [string, string, string], variant = 0) {
  const f = faces(note, s, labels, variant);
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
  /** 听力认读：题面不显示文字 */
  listen?: boolean;
}

/** 三种卡的正反面。旋转和题面切换只作用于认读卡 */
/** variant：第几个版本，复习时传卡片的复习次数，每次复习轮换一个句子 / 场景 */
export function cardView(type: Card['type'], note: Note, s: Settings, quizType: number, labels: [string, string, string], variant = 0, listen = false): CardView {
  // 听力认读：正面只有声音，翻面显示句子和两个翻译
  if (listen && type === 'recognition' && note.sentence) {
    const f = faces(note, s, labels, variant);
    return { question: { ...f[0], text: '', label: '听' }, hint: null, cues: 'all', answers: f, listen: true };
  }
  if (type === 'production') {
    // 正面：法语题面（高亮的是要换掉的简单说法）；没有法语题面的旧题退回中文意图（也可以 {{…}} 高亮考点）
    // 背面：法语答案（{{…}} 高亮目标表达），有法语题面时中文意图作为注释
    const it = pickIntent(note, variant);
    const a = it.answerFr;
    const answer: Face = { text: hasCloze(a) ? renderSentence(a) : a, speakText: plainSentence(a), lang: s.sourceLang, label: labels[0] };
    if (it.promptFr) {
      return {
        question: { text: renderSentence(it.promptFr), speakText: plainSentence(it.promptFr), lang: s.sourceLang, label: '法语题面' },
        hint: it.hint, cues: 'extra',
        answers: it.intentZh.trim() ? [answer, { text: plainSentence(it.intentZh), speakText: plainSentence(it.intentZh), lang: s.targetLang1, label: labels[1] }] : [answer],
      };
    }
    const q = it.intentZh;
    return {
      question: { text: hasCloze(q) ? renderSentence(q) : q, speakText: plainSentence(q), lang: s.targetLang1, label: '中文意图' },
      hint: it.hint, cues: 'extra',
      answers: [answer],
    };
  }
  if (type === 'cloze') {
    // 有挖空专用例句就用它（和认读卡的句子不同），否则用主例句
    const sent = pickSentence(note, 'cloze', variant);
    const plain = plainSentence(sent);
    // 横线处有专门的挖空提示时就不再另给；没有时用中文意思当提示，避免横线处有多种填法
    const hint = note.clozeHint?.trim() || hasInlineHint(sent) ? null : note.meaningZh.trim() || null;
    return {
      question: { text: renderSentence(sent, 'blank', { hint: note.clozeHint, letters: s.clozeLetters }), speakText: '', lang: s.sourceLang, label: labels[0] },
      hint, cues: 'all',
      answers: [
        { text: renderSentence(sent), speakText: plain, lang: s.sourceLang, label: labels[0] },
        { text: note.meaningZh, speakText: note.meaningZh, lang: s.targetLang1, label: labels[1] },
      ],
    };
  }
  return { ...quizSplit(note, s, quizType, labels, variant), hint: null, cues: 'all' };
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
      {!only && note.etymology && <div className="cue etym" title="词源">⌁ {note.etymology}</div>}
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
