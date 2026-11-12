// 词条的第一个实词：易混检测比拼写、Wiktionnaire 索引查词都用它（纯函数）。
import { fold, norm } from './gender/rules';

const FUNC = new Set('le la les l un une des de du d a au aux en et ou se s ne pas y que qu qui ce sa son ses leur leurs mon ma mes ton ta tes etre avoir faire qqch qqn pour par sur dans avec il elle est'.split(' '));

/** 词条的第一个实词，保留重音（prendre qqn dans le sens du poil → prendre；s'occuper de → occuper；une amende → amende） */
export const headWord = (lemma: string): string =>
  norm(lemma.normalize('NFC')).replace(/\([^)]*\)/g, ' ').split(/[^a-zß-ɏ-]+/).find((w) => w.length > 1 && !FUNC.has(fold(w))) ?? '';

/** 同上，去掉重音（比拼写用） */
export const head = (lemma: string): string => fold(headWord(lemma));
