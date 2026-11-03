// 法语名词阴阳性：按词尾的记忆规则 + 同形异义词表。
// 思路（Lyster 2006 等对词尾预测性别的研究）：法语名词的性大部分能从词尾看出来，背规则 + 背每条规则最常见的几个例外，
// 比一个个死记高效得多。每条规则的可靠度和例外由 scripts/build-fr-dict.mjs 用 Lexique 的真实词频算出（stats.gen.ts），不是凭印象写的。
// 注意：只能写纯数据和纯函数，构建脚本（node）也要导入这个文件。

export type G = 'm' | 'f';
export interface GenderRule {
  suffix: string;
  gender: G;
  /** 一个最常见的例词（带冠词） */
  example: string;
  /** 记忆提示（可选） */
  tip?: string;
}

/** 词尾规则。匹配时取最长的词尾（-tion 优先于 -on）。顺序无关 */
export const GENDER_RULES: GenderRule[] = ([
  // ---- 阴性 ----
  { suffix: 'tion', gender: 'f', example: 'la nation', tip: '-tion / -sion / -xion 几乎全是阴性' },
  { suffix: 'sion', gender: 'f', example: 'la décision' },
  { suffix: 'xion', gender: 'f', example: 'la réflexion' },
  { suffix: 'aison', gender: 'f', example: 'la maison' },
  { suffix: 'té', gender: 'f', example: 'la liberté', tip: '抽象名词 -té / -ité 阴性；例外多是具体东西（le côté, l\'été, le comité）' },
  { suffix: 'tié', gender: 'f', example: 'la moitié' },
  { suffix: 'ette', gender: 'f', example: 'la cigarette', tip: '-ette 是阴性小称后缀' },
  { suffix: 'ure', gender: 'f', example: 'la culture' },
  { suffix: 'ance', gender: 'f', example: 'la chance' },
  { suffix: 'ence', gender: 'f', example: 'la science', tip: '-ance / -ence 阴性；最大的例外是 le silence' },
  { suffix: 'ade', gender: 'f', example: 'la promenade' },
  { suffix: 'ude', gender: 'f', example: "l'habitude" },
  { suffix: 'ie', gender: 'f', example: 'la vie', tip: '-ie 阴性（学科名 -logie / -graphie 都是）；例外：le génie, l\'incendie, le parapluie' },
  { suffix: 'ée', gender: 'f', example: "l'idée", tip: '-ée 阴性；例外：le musée, le lycée, le trophée' },
  { suffix: 'elle', gender: 'f', example: 'la poubelle' },
  { suffix: 'esse', gender: 'f', example: 'la jeunesse' },
  { suffix: 'ise', gender: 'f', example: 'la crise' },
  { suffix: 'ine', gender: 'f', example: 'la cuisine' },
  { suffix: 'ière', gender: 'f', example: 'la lumière' },
  { suffix: 'euse', gender: 'f', example: 'la chanteuse' },
  { suffix: 'trice', gender: 'f', example: "l'actrice" },
  { suffix: 'ille', gender: 'f', example: 'la famille' },
  { suffix: 'aille', gender: 'f', example: 'la bataille' },
  { suffix: 'eille', gender: 'f', example: 'la bouteille' },
  { suffix: 'ouille', gender: 'f', example: 'la grenouille' },
  { suffix: 'ive', gender: 'f', example: "l'initiative" },
  { suffix: 'aine', gender: 'f', example: 'la semaine' },
  { suffix: 'onne', gender: 'f', example: 'la personne' },
  { suffix: 'ole', gender: 'f', example: "l'école" },
  { suffix: 'ue', gender: 'f', example: 'la rue', tip: '-ue / -ique 多为阴性（la musique, la politique）；但 -sque 多是阳性（le risque, le disque, le masque）' },
  { suffix: 'ace', gender: 'f', example: 'la place', tip: '例外：l\'espace' },
  { suffix: 'ose', gender: 'f', example: 'la chose' },
  { suffix: 'eur', gender: 'm', example: 'le moteur', tip: '-eur 两性都多：指人、指机器的阳性（le chauffeur, l\'ordinateur）；表示感觉、性质的抽象名词阴性（la peur, la chaleur, la valeur, la couleur）；例外 le bonheur, le malheur, l\'honneur' },
  { suffix: 'ité', gender: 'f', example: 'la réalité' },
  // ---- 阳性 ----
  { suffix: 'age', gender: 'm', example: 'le voyage', tip: '-age 阳性；例外：la page, l\'image, la plage, la cage, la rage, la nage' },
  { suffix: 'isme', gender: 'm', example: 'le tourisme' },
  { suffix: 'ment', gender: 'm', example: 'le moment', tip: '-ment 阳性；唯一常见例外：la jument' },
  { suffix: 'eau', gender: 'm', example: 'le bateau', tip: '-eau 阳性；例外：l\'eau, la peau' },
  { suffix: 'et', gender: 'm', example: 'le projet' },
  { suffix: 'oir', gender: 'm', example: 'le soir' },
  { suffix: 'ier', gender: 'm', example: 'le papier' },
  { suffix: 'er', gender: 'm', example: 'le dîner', tip: '例外：la mer, la cuiller' },
  { suffix: 'ail', gender: 'm', example: 'le travail' },
  { suffix: 'eil', gender: 'm', example: 'le soleil' },
  { suffix: 'euil', gender: 'm', example: 'le fauteuil' },
  { suffix: 'at', gender: 'm', example: 'le résultat' },
  { suffix: 'as', gender: 'm', example: 'le cas' },
  { suffix: 'ou', gender: 'm', example: 'le genou' },
  { suffix: 'o', gender: 'm', example: 'le vélo', tip: '-o 阳性；例外是缩写：la photo(graphie), la radio, la moto' },
  { suffix: 'in', gender: 'm', example: 'le matin', tip: '例外：la fin, la main' },
  { suffix: 'ain', gender: 'm', example: 'le pain', tip: '例外：la main' },
  { suffix: 'an', gender: 'm', example: 'le plan' },
  { suffix: 'on', gender: 'm', example: 'le son', tip: '-on 阳性，但 -tion / -sion / -aison 阴性；例外：la façon, la leçon, la chanson' },
  { suffix: 'ard', gender: 'm', example: 'le retard' },
  { suffix: 'al', gender: 'm', example: 'le journal' },
  { suffix: 'is', gender: 'm', example: 'le pays', tip: '例外：la souris, la fois' },
  { suffix: 'ent', gender: 'm', example: "l'argent", tip: '例外：la dent, la jument' },
  { suffix: 'teur', gender: 'm', example: "l'ordinateur", tip: '-teur 多指人 / 机器，阳性（阴性形式 -trice）' },
  { suffix: 'ème', gender: 'm', example: 'le problème', tip: '希腊来源的 -ème / -gramme 阳性：le système, le thème' },
  { suffix: 'gramme', gender: 'm', example: 'le programme' },
  { suffix: 'scope', gender: 'm', example: 'le microscope' },
  { suffix: 'phone', gender: 'm', example: 'le téléphone' },
  { suffix: 'acle', gender: 'm', example: 'le spectacle' },
  { suffix: 'ège', gender: 'm', example: 'le collège' },
  { suffix: 'i', gender: 'm', example: 'le parti', tip: '例外：la fourmi, la loi' },
  { suffix: 'u', gender: 'm', example: 'le feu', tip: '例外：l\'eau 不算（-eau），la vertu, la tribu' },
  { suffix: 'ème', gender: 'm', example: 'le problème' },
  { suffix: 'ou', gender: 'm', example: 'le cou' },
  { suffix: 'é', gender: 'm', example: 'le café', tip: '-é 阳性，但 -té / -tié 阴性' },
  { suffix: 'c', gender: 'm', example: 'le parc' },
  { suffix: 'd', gender: 'm', example: 'le bord' },
  { suffix: 'g', gender: 'm', example: 'le sang' },
  { suffix: 'k', gender: 'm', example: 'le stock' },
  { suffix: 'l', gender: 'm', example: 'le ciel' },
  { suffix: 'p', gender: 'm', example: 'le coup' },
  { suffix: 'r', gender: 'm', example: 'le jour' },
  { suffix: 's', gender: 'm', example: 'le temps' },
  { suffix: 't', gender: 'm', example: 'le droit', tip: '例外：la nuit, la mort, la part, la forêt' },
  { suffix: 'x', gender: 'm', example: 'le prix', tip: '例外：la voix, la paix, la croix, la noix, la toux' },
  { suffix: 'z', gender: 'm', example: 'le nez' },
] as GenderRule[]).filter((r, i, all) => all.findIndex((x) => x.suffix === r.suffix) === i);

/** 同形异义：同一个词，阳性和阴性意思不同。冠词能定性时只显示对应的那个意思 */
export const HOMOGRAPHS: Array<{ word: string; m: string; f: string }> = [
  { word: 'tour', m: '圈；轮次；把戏（faire le tour, à mon tour）', f: '塔（la tour Eiffel）' },
  { word: 'livre', m: '书', f: '磅；英镑' },
  { word: 'poste', m: '职位；岗位；电视机 / 收音机', f: '邮局；邮政' },
  { word: 'mode', m: '方式；模式；（语法）式', f: '时尚（à la mode）' },
  { word: 'somme', m: '小睡（faire un somme）', f: '金额；总和（en somme）' },
  { word: 'manche', m: '柄；把手', f: '袖子；（比赛的）一局；la Manche 英吉利海峡' },
  { word: 'mémoire', m: '学位论文；备忘录', f: '记忆；记忆力' },
  { word: 'page', m: '（中世纪）侍从', f: '页' },
  { word: 'voile', m: '面纱；幕', f: '帆；帆船运动' },
  { word: 'vase', m: '花瓶', f: '淤泥' },
  { word: 'moule', m: '模具', f: '贻贝' },
  { word: 'critique', m: '评论家', f: '批评；评论' },
  { word: 'physique', m: '体格；外貌', f: '物理学' },
  { word: 'solde', m: '余额；（复数）打折商品', f: '军饷' },
  { word: 'mousse', m: '见习水手', f: '泡沫；苔藓；慕斯' },
  { word: 'pendule', m: '钟摆', f: '座钟' },
  { word: 'crêpe', m: '绉纱', f: '可丽饼' },
  { word: 'aide', m: '（男）助手', f: '帮助；（女）助手' },
  { word: 'garde', m: '看守；警卫（人）', f: '看管；警卫队；值班（de garde）' },
  { word: 'guide', m: '导游；指南（书）', f: '女导游；女童子军' },
  { word: 'greffe', m: '（法院）书记室', f: '移植；嫁接' },
  { word: 'ombre', m: '茴鱼（鱼名）', f: '阴影；影子' },
  { word: 'manoeuvre', m: '小工；粗工', f: '操作；演习；手段' },
  { word: 'faux', m: '赝品；虚假', f: '镰刀' },
  { word: 'mort', m: '死者', f: '死亡' },
  { word: 'foudre', m: '大酒桶；（un foudre de guerre）', f: '雷电' },
  { word: 'poêle', m: '炉子；火炉', f: '平底锅' },
  { word: 'vapeur', m: '汽船', f: '蒸汽' },
  { word: 'espace', m: '空间；场所', f: '（印刷）空格' },
  { word: 'office', m: '办公室；职责；（office de tourisme）', f: '（旧）配餐室' },
  { word: 'champagne', m: '香槟酒', f: '香槟地区（la Champagne）' },
  { word: 'oeuvre', m: '（艺术家的）全部作品；le gros œuvre 主体工程', f: '作品；工作（une œuvre）' },
  { word: 'radio', m: '报务员', f: '收音机；电台；X 光片' },
  { word: 'politique', m: '政治家；政治领域（le politique）', f: '政治；政策' },
  { word: 'rose', m: '粉红色', f: '玫瑰' },
  { word: 'orange', m: '橙色', f: '橙子' },
  { word: 'basket', m: '篮球（运动）', f: '运动鞋（des baskets）' },
  { word: 'crème', m: '奶咖（un crème）', f: '奶油；面霜' },
  { word: 'pique', m: '（扑克）黑桃', f: '长矛；挖苦话' },
  { word: 'vague', m: '模糊；空虚（le vague à l\'âme）', f: '浪；浪潮' },
];

/** 两个词典都没标性别、但性别确定的常用名词（人工核对） */
export const GENDER_OVERRIDES: Record<string, 'm' | 'f' | 'b'> = {
  fin: 'f', cours: 'm', geste: 'm', poche: 'f', i: 'm', barbe: 'f', litre: 'm', malaise: 'm', ordonnance: 'f',
  plastique: 'm', pub: 'f', claque: 'f', trompette: 'f', casse: 'f', hymne: 'm', coca: 'm', coco: 'm', cartouche: 'f',
  gauche: 'f', inverse: 'm', aigle: 'm', rouge: 'm', jaune: 'm', bourre: 'f', prof: 'b', psy: 'b', malaises: 'm',
};

/** 特殊的词：单复数性别不同，或者形容词放前放后性别不同 */
export const SPECIAL: Record<string, string> = {
  amour: '单数阳性（un grand amour）；文学里复数常作阴性（de folles amours）',
  amours: '文学里复数常作阴性（de folles amours）；单数阳性',
  'délice': '单数阳性（un délice）；复数阴性（des délices infinies）',
  'délices': '复数阴性（des délices infinies）；单数阳性',
  orgue: '单数阳性（un orgue）；指一台管风琴的复数用阴性（les grandes orgues）',
  orgues: '指一台管风琴时复数阴性（les grandes orgues）',
  gens: '阳性复数，但紧挨在前面的形容词用阴性：de bonnes gens / les vieilles gens；后面的形容词用阳性：des gens heureux',
  'pâques': '复活节：Pâques 阳性单数（Pâques est tombé tôt）；joyeuses Pâques 阴性复数',
  'apres-midi': '阴阳两性都可以（un / une après-midi），常用阳性',
};

/** 统一写法：小写、œ → oe、æ → ae、弯撇号 → 直撇号、去掉重音（只用于匹配） */
export const norm = (s: string) => s.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/’/g, "'");
export const fold = (s: string) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

/** 最长匹配的词尾规则 */
export function matchRule(word: string): GenderRule | null {
  const w = norm(word);
  let best: GenderRule | null = null;
  for (const r of GENDER_RULES) if (w.endsWith(r.suffix) && w.length > r.suffix.length && (!best || r.suffix.length > best.suffix.length)) best = r;
  return best;
}
