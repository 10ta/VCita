// 替代说法卡的静态数据（见 scripts/build-alts-data.mjs），第一次显示替代说法区时才下载：
//   rl-alts.txt：RL-fr 按义项分开的同义关系（下位 / 平替 / 近义 / 上位）+ 每个义项的例句关键词
//   flelex.txt ：每个原形的 CEFR 级别（FLELex）
import rlUrl from './rl-alts.txt?url';
import lvlUrl from './flelex.txt?url';
import { lazy } from '../wikt';

export type RlKind = '下位' | '平替' | '近义' | '上位';
export interface RlSense { num: string; kw: Set<string>; alts: Record<RlKind, string[]> }
export type RlIndex = Map<string, RlSense[]>;
export type Levels = Map<string, string>;

const list = (s: string | undefined) => (s ? s.split('|').filter(Boolean) : []);
export function parseRl(text: string): RlIndex {
  const m: RlIndex = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [name, num, kw, down, eq, near, up] = line.split('\t');
    if (!name) continue;
    const s: RlSense = { num: num ?? '', kw: new Set((kw ?? '').split(' ').filter(Boolean)), alts: { 下位: list(down), 平替: list(eq), 近义: list(near), 上位: list(up) } };
    const arr = m.get(name);
    if (arr) arr.push(s); else m.set(name, [s]);
  }
  return m;
}
export function parseLevels(text: string): Levels {
  const m: Levels = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [w, l] = line.split('\t');
    if (w && l) m.set(w, l);
  }
  return m;
}

const rl = lazy(rlUrl, parseRl, '替代说法数据（RL-fr）');
const lv = lazy(lvlUrl, parseLevels, 'CEFR 级别（FLELex）');
export const useRlAlts = rl.use;
export const useLevels = lv.use;
