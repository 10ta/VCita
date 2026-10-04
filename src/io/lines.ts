// 批量导入：每行一条笔记，字段用 | 分隔
//   句子（含 {{…}}）| 中文意思 | 英语 | 出处 | 主题
// 后四项可以省略；主题可以写多个（逗号或空格分隔），写不全时按名称猜。以 # 开头的行是注释。
import { THEMES, type Theme } from '../schema';
import { clozeTarget, hasCloze } from '../schema/validate';
import { guessTheme } from './legacy';

export interface ParsedLine {
  line: number;
  sentence: string;
  lemma: string;
  meaningZh: string;
  meaningEn: string;
  source: string | null;
  tags: Theme[];
  error: string | null;
}

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

export function parseTheme(raw: string): Theme[] {
  const out = new Set<Theme>();
  for (const part of raw.split(/[,，、/\s]+/).filter(Boolean)) {
    out.add(THEMES.find((t) => fold(t) === fold(part)) ?? guessTheme(part));
  }
  return [...out];
}

export function parseImportLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [sentence = '', zh = '', en = '', source = '', theme = ''] = line.split('|').map((x) => x.trim());
    const ok = hasCloze(sentence);
    out.push({
      line: i + 1, sentence, lemma: ok ? clozeTarget(sentence) : '', meaningZh: zh, meaningEn: en,
      source: source || null, tags: theme ? parseTheme(theme) : [],
      error: !sentence ? '缺少句子' : ok ? null : '句子里要用 {{…}} 标出考查的部分',
    });
  });
  return out;
}
