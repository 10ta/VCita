export const LANGS = [
  { code: 'fr', label: 'Français' }, { code: 'zh-CN', label: '中文' }, { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' }, { code: 'ko', label: '한국어' }, { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' }, { code: 'pt', label: 'Português' }, { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' }, { code: 'it', label: 'Italiano' }, { code: 'nl', label: 'Nederlands' },
];
export const langLabel = (code: string) => LANGS.find((l) => l.code === code)?.label ?? code;

import type { Deck, Settings } from '../schema';
type Langs = Pick<Settings, 'sourceLang' | 'targetLang1' | 'targetLang2'>;
/** 牌组的语言（没设的跟设置里的默认）合进设置：用到语言的地方都拿这个 */
export function withDeckLangs<S extends Langs>(s: S, deck: Partial<Pick<Deck, 'sourceLang' | 'targetLang1' | 'targetLang2'>> | null | undefined): S {
  if (!deck) return s;
  return { ...s, sourceLang: deck.sourceLang || s.sourceLang, targetLang1: deck.targetLang1 || s.targetLang1, targetLang2: deck.targetLang2 || s.targetLang2 };
}
/** 法语专用的功能（阴阳性、Lexique 词频和原形、Wiktionnaire、短文挖词）只在学习语言是法语时打开 */
export const isFrench = (lang: string | undefined | null) => !lang || lang.toLowerCase().startsWith('fr');
