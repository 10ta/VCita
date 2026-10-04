// 笔记的校验规则（编辑器、批量导入共用）
import type { Note } from './index';

export const hasCloze = (s: string) => /\{\{.+?\}\}/.test(s);
/** 句子里第一个 {{…}} 的内容 */
export const clozeTarget = (s: string) => /\{\{(.+?)\}\}/.exec(s)?.[1].trim() ?? '';

export const defaultCardTypes = (layer: Note['layer']): Note['cardTypes'] =>
  layer === 'core' ? ['recognition', 'production'] : ['recognition'];

type Fields = Pick<Note, 'lemma' | 'sentence' | 'cardTypes' | 'intentZh' | 'answerFr'>;

export function noteErrors(n: Fields): string[] {
  const errs: string[] = [];
  const cloze = hasCloze(n.sentence);
  if (!n.cardTypes.length) errs.push('至少选一种卡');
  if (n.sentence.trim() && !cloze) errs.push('例句里要用 {{…}} 标出考查的部分');
  if (n.cardTypes.includes('cloze') && !cloze) errs.push('挖空卡需要带 {{…}} 的例句');
  // 迁移来的旧卡没有例句，允许只有单词
  if (n.cardTypes.includes('recognition') && !cloze && !n.lemma.trim()) errs.push('认读卡需要例句或单词');
  if (n.cardTypes.includes('production') && (!n.intentZh?.trim() || !n.answerFr?.trim())) errs.push('产出卡需要填写"中文意图"和"法语答案"');
  return errs;
}
