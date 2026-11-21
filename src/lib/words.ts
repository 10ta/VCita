// 虚词表，以及「遇见」记录的过滤。阅读页、查词、摘句篮共用；不依赖数据库，db/actions 也能引用。
export const FUNC = new Set('le la les l un une des de du d à au aux en et ou se s ne pas y que qu qui ce cet cette ces sa son ses leur leurs mon ma mes ton ta tes nous vous il ils elle elles on je j me m te t lui eux pour par sur dans avec sans être avoir faire mais donc car si'.split(' '));

/** 虚词（冠词、介词、代词、连词等） */
export const isFunctionWord = (w: string) => FUNC.has(w.toLowerCase().trim());

/** 值得记成「遇见」的键：2–60 个字符、有拉丁字母、没有汉字（多半是选中了界面文字）、不是虚词。
 *  手册的「第二次遇见再做卡」靠这些记录计数，混进 de、提示、一样 这类键，摘句篮的「遇见两次以上」就不准了 */
export function isEncounterKey(key: string): boolean {
  const k = key.toLowerCase().trim();
  return k.length >= 2 && k.length <= 60 && /\p{Script=Latin}/u.test(k) && !/\p{Script=Han}/u.test(k) && !FUNC.has(k);
}
