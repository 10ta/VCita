// 写作语块库：论证透镜、套用卡的主题池（来自写作手册 LENTILLES 的「主题 × 透镜速配」）。
import type { Note } from '../schema';

export const LENSES: Record<string, string> = {
  '①': '反事实', '②': '自愿 vs 被迫', '③': '谁付代价', '④': '短期 vs 长期',
  '⑤': '个人 vs 集体', '⑥': '可补救 vs 不可逆', '⑦': '手段 vs 目的', '⑧': '程度',
};

export interface Topic { theme: string; fr: string; zh: string }
/** 主题 → 常见的讨论对象 X；lenses = 拿到这个主题时先试的透镜 */
const THEMES: Array<{ theme: string; lenses: string; topics: Array<[string, string]> }> = [
  { theme: 'TRAVAIL', lenses: '②③⑤', topics: [['le télétravail', '远程办公'], ['la semaine de quatre jours', '四天工作制'], ['les animaux au bureau', '带宠物上班'], ['la livraison de repas à domicile', '外卖送餐'], ['les petits boulots étudiants', '学生兼职']] },
  { theme: 'SOCIÉTÉ', lenses: '⑤③①', topics: [['les relations de voisinage', '邻里关系'], ['la cohabitation entre générations', '代际同住'], ["l'usage de l'espace public", '公共空间的使用'], ['le bénévolat', '志愿服务']] },
  { theme: 'TECHNOLOGIE', lenses: '⑧④⑦', topics: [["le téléphone portable à l'école", '学校里的手机'], ["l'intelligence artificielle", '人工智能'], ['les réseaux sociaux', '社交网络'], ['les objets connectés', '智能设备']] },
  { theme: 'ENVIRONNEMENT', lenses: '①④③', topics: [['les voitures en centre-ville', '市中心禁车'], ['le tri des déchets', '垃圾分类'], ['la végétalisation des villes', '城市绿化'], ["les voyages en avion", '坐飞机旅行']] },
  { theme: 'MÉDIAS', lenses: '⑧⑦④', topics: [['la télévision', '电视'], ['les influenceurs', '网红'], ['le cinéma en salle', '去电影院看电影'], ["l'information en continu", '24 小时新闻']] },
  { theme: 'ÉDUCATION', lenses: '②⑥⑦', topics: [['les devoirs à la maison', '家庭作业'], ["l'uniforme scolaire", '校服'], ['les cours en ligne', '网课'], ["l'apprentissage en alternance", '学徒制']] },
  { theme: 'SANTÉ', lenses: '⑧④②', topics: [['le sport obligatoire', '强制运动'], ["l'alimentation industrielle", '工业化食品'], ['le manque de sommeil', '睡眠不足'], ["l'automédication", '自行用药']] },
  { theme: 'GÉNÉRAL', lenses: '⑤⑦③', topics: [['la vie à la campagne', '乡村生活'], ['la consommation de seconde main', '二手消费'], ['le tourisme de masse', '大众旅游']] },
];

/** T1 信件、T2 博客的套用场景（不是议论题） */
const SCENES: Record<string, Array<[string, string]>> = {
  T1: [["inviter des amis à dîner chez soi", '邀请朋友来家里吃饭'], ['recommander un restaurant à un collègue', '向同事推荐一家餐厅'], ['organiser un week-end de camping', '组织周末露营'], ['annoncer un déménagement', '告诉朋友你搬家了'], ['proposer une sortie au cinéma', '约朋友看电影'], ['accueillir un ami qui visite ta ville', '接待来你城市玩的朋友']],
  T2: [['une exposition', '一次展览'], ['un concert', '一场音乐会'], ['un voyage court', '一次短途旅行'], ['une fête de quartier', '一次街区节日'], ['une journée de bénévolat', '一天志愿活动'], ['un nouveau café', '一家新开的咖啡馆']],
};

export const isFrame = (n: Pick<Note, 'frame'> | undefined | null): boolean => !!n?.frame;
/** 句框里有没有要填的位置（⬚ 或 …）：没有的是固定表达，不出套用卡 */
export const hasSlots = (frame: string) => /⬚|…/.test(frame);
export const lensOf = (n: Pick<Note, 'frame'>) => [...(n.frame?.lens ?? '')].find((c) => c in LENSES) ?? null;

/** 套用卡这次用的主题：优先这个透镜推荐的主题，每次复习换一个（同一张卡的顺序固定） */
export function pickTopic(note: Pick<Note, 'id' | 'frame'>, variant: number): Topic {
  const seed = [...note.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const scenes = SCENES[note.frame?.task ?? ''];
  if (scenes) { const [fr, zh] = scenes[(seed + variant) % scenes.length]; return { theme: note.frame!.task, fr, zh }; }
  const lens = lensOf(note);
  const themes = lens ? THEMES.filter((t) => t.lenses.includes(lens)) : THEMES;
  const pool = (themes.length ? themes : THEMES).flatMap((t) => t.topics.map(([fr, zh]) => ({ theme: t.theme, fr, zh })));
  return pool[(seed + variant) % pool.length];
}

/** 卡片上的一行：T3 · ⑤ · ① 反事实 · 高 */
export function frameMeta(n: Pick<Note, 'frame'>): string {
  const f = n.frame;
  if (!f) return '';
  const lens = lensOf(n);
  return [f.task, f.slot, lens && `${lens} ${LENSES[lens]}`, f.register].filter(Boolean).join(' · ');
}

const TASK_ORDER = ['T3', '口语', 'T1', 'T2'];
const CIRCLED = '①②③④⑤⑥⑦⑧⑨';
/** 排序：任务（T3 → 口语 → T1 → T2 → 其他），槽位（标题 → ①…⑨ → 其他按文字），同槽按创建时间 */
export function frameSortKey(n: Pick<Note, 'frame' | 'createdAt'>): string {
  const t = TASK_ORDER.indexOf(n.frame?.task ?? '');
  const slot = n.frame?.slot ?? '';
  const c = CIRCLED.indexOf(slot[0] ?? '');
  const s = slot === '标题' ? '0' : c >= 0 ? `1${c}` : `2${slot}`;
  return `${t < 0 ? 9 : t}|${s}|${n.createdAt}`;
}
