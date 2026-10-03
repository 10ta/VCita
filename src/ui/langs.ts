export const LANGS = [
  { code: 'fr', label: 'Français' }, { code: 'zh-CN', label: '中文' }, { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' }, { code: 'ko', label: '한국어' }, { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' }, { code: 'pt', label: 'Português' }, { code: 'ru', label: 'Русский' },
  { code: 'ar', label: 'العربية' }, { code: 'it', label: 'Italiano' }, { code: 'nl', label: 'Nederlands' },
];
export const langLabel = (code: string) => LANGS.find((l) => l.code === code)?.label ?? code;
