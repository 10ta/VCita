// 写作手册里的句框（T3 九句模板 + 进阶 / 变体、LENTILLES 八个透镜、T1 / T2 套式、口语 T3）。
// 语块页「导入手册句框」把它们加进当前牌组，已有的（句框文字相同）跳过。之后各自独立，和手册不联动。
// 每行：[任务, 槽位, 透镜, 语域, 句框, 功能（正面）, 例句, 语法锁]
type Row = [string, string | null, string | null, string | null, string, string, string, string];

const T3: Row[] = [
  ['T3', '标题', null, null, '⬚ : ⬚ ou ⬚ ?', '标题：话题 + 两个音节呼应的对立词', 'Le télétravail : liberté ou isolement ?', '冒号前加空格；书面写 ou non ?，不写 ou pas ?'],
  ['T3', '①', null, null, "⬚ suscite aujourd'hui des avis partagés.", '开题：中性地引出争议（P1 零观点）', "Le développement du télétravail dans les entreprises suscite aujourd'hui des avis partagés.", '现在时陈述句；主题不足 10 词时从材料里扩'],
  ['T3', '①', null, null, "⬚ divise aujourd'hui l'opinion.", '开题（替换）：这件事让舆论分裂', "Le recours à l'intelligence artificielle à l'école divise aujourd'hui l'opinion.", '现在时；P1 不出现 je 和评价词'],
  ['T3', '①', null, null, "⬚ fait l'objet de positions opposées.", '开题（替换）：这件事引来对立的立场', 'La semaine de quatre jours fait l’objet de positions opposées.', "faire l'objet de + 名词"],
  ['T3', '①', null, '高', 'Le débat sur ⬚ oppose deux lectures difficilement conciliables.', '开题进阶：点出争论本身的结构（两种难以调和的解读）', 'Le débat sur le travail des étudiants oppose deux lectures difficilement conciliables.', 'conciliables 和 lectures（阴性复数）配合；比默认句多 3 词'],
  ['T3', '②', null, null, 'Le premier document met en exergue ⬚ : ⬚, ⬚ et ⬚.', '转述 doc 1（讲好处）：名词化 + 冒号三元并列', 'Le premier document met en exergue ses vertus formatrices : le sens du collectif, une autonomie financière et un avantage à l’embauche.', 'met en exergue = met en avant；动词句改成名词组，不照抄材料'],
  ['T3', '②', null, null, 'Le premier document met en garde contre ⬚ : ⬚, ⬚ et ⬚.', '转述 doc 1（讲风险）：警告它的危害', 'Le premier document met en garde contre ses revers : la fatigue, l’enfermement dans une routine et une vie privée négligée.', 'mettre en garde contre 自带负面；名词化，三项语法形式对齐'],
  ['T3', '③', null, null, "Le second, à l'inverse, souligne ⬚ et ⬚ pourtant ⬚ à ⬚.", '转述 doc 2，同时点出和 doc 1 的对立（并列式）', "Le second, à l'inverse, souligne l'isolement de salariés privés de contacts et l'effacement d'une frontière pourtant essentielle à leur équilibre.", '一句只能有一个对立标记（à l’inverse）；pourtant + 形容词插入，性数配合'],
  ['T3', '③', null, null, "Le second, à l'inverse, met en avant ⬚ : ⬚ et ⬚.", '转述 doc 2（讲好处）+ 点出对立（冒号式）', "Le second, à l'inverse, met en avant son rôle identitaire : des liens tissés au quotidien et le sentiment d'être utile.", '插入语管对立，动词管褒贬；介词后不能直接接冒号'],
  ['T3', '③', null, '高', 'Le second relève au contraire ⬚ : ⬚ et ⬚.', '转述 doc 2（换口味）：对立放进动词短语', 'Le second relève au contraire le temps gagné par les enseignants : moins de corrections et un suivi plus fin.', '用了 au contraire 就去掉 à l’inverse'],
  ['T3', '④', '②', null, "Quant à moi, il me paraît essentiel que ⬚ puisse(nt) ⬚, sans pour autant y être contraint(s).", '亮出立场（中立）：接受这件事，反对它被强加', "Quant à moi, il me paraît essentiel que les jeunes puissent travailler, sans pour autant y être contraints.", '虚拟式 puisse(nt)；sans pour autant + 不定式（不加 de），后半要有对手'],
  ['T3', '④', '②', null, "Quant à moi, il me paraît essentiel que ⬚ soi(en)t encouragé(s), sans pour autant devenir une norme imposée.", '亮出立场（支持）：鼓励它，但不让它变成强制', "Quant à moi, il me paraît essentiel que ces outils soient encouragés, sans pour autant devenir une norme imposée.", '④ 用了 être → ⑧ 换 avoir（ait）或 aller（aille）'],
  ['T3', '④', '②', null, "Quant à moi, il me paraît essentiel que ⬚ fasse l'objet d'un encadrement, sans pour autant être interdit(e).", '亮出立场（反对）：要加以约束，但不至于禁止', "Quant à moi, il me paraît essentiel que la livraison de repas fasse l'objet d'un encadrement, sans pour autant être interdite.", '虚拟式 fasse；interdit(e) 和主语配合'],
  ['T3', '④', '②', null, '⬚ doit rester possible, sans pour autant devenir la norme.', '保留这个选项，但不让它变成常规', 'Le télétravail doit rester possible, sans pour autant devenir la norme.', 'rester 预设有人想取消，立场才有张力；不能和 essentiel 叠用'],
  ['T3', '⑤', '⑧', null, "D'abord, ⬚ ne tient qu'une partie de ses promesses.", '论据一的判断：只否定程度，不全盘否定', "D'abord, un télétravail imposé ne tient qu'une partie de ses promesses.", '攻击对象必须带限定词（subi / imposé / envahissant / de principe）；ses 不受性数影响'],
  ['T3', '⑤', '⑧', '高', "D'abord, ce ⬚ tant vanté n'est que partiel.", '判断进阶：被吹捧的好处其实只是部分的', "D'abord, cette liberté tant vantée n'est que partielle.", 'vanté / partiel 和名词性数配合；比默认句短'],
  ['T3', '⑤', '⑧', '高', "D'abord, nombre de ⬚ ⬚, au point de ⬚.", '判断进阶：许多……，甚至到了……的地步', "D'abord, nombre de restaurants rapides cuisinent de façon inappropriée, au point de causer chez certains des maladies à leur insu.", 'nombre de 后不加冠词；au point 单数；多 7–10 词，要删 ⑦ 的三元展开'],
  ['T3', '⑤', '⑧', null, '⬚ ne pèse(nt) guère face à ce qu’il(s) coûte(nt).', '承认它的好处，但论分量：比不上它的代价', 'Le temps gagné ne pèse guère face à ce qu’il coûte.', 'ne … guère；只打折，不否认材料里的事实'],
  ['T3', '⑤', '②', null, "Ce qui pose problème, ce n'est pas ⬚ en soi, mais son caractère obligatoire.", '问题不在这件事本身，而在它是强制的', "Ce qui pose problème, ce n'est pas le bénévolat en soi, mais son caractère obligatoire.", 'ce qui …, ce n’est pas … mais …'],
  ['T3', '⑤', '①', null, "Loin de supprimer ⬚, l'interdiction ⬚.", '反事实：禁止非但没消除问题，反而……', "Loin de supprimer la distraction, l'interdiction la renforce.", 'loin de + 不定式；后半的代词指回前面的名词'],
  ['T3', '⑤', '①', '口语', 'Interdire ⬚ ne ferait que déplacer le problème.', '反事实：禁止只会把问题挪到别处', 'Interdire les téléphones au collège ne ferait que déplacer le problème.', '条件式 ferait；ne faire que + 不定式'],
  ['T3', '⑤', '⑧', '口语', "Ce n'est pas ⬚ qui pose problème, mais son excès.", '程度：问题不在它本身，在于过度', "Ce n'est pas le jeu vidéo qui pose problème, mais son excès.", 'c’est … qui 强调；mais 后接名词'],
  ['T3', '⑤', '⑧', null, 'À petite dose, ⬚ ; au-delà, ⬚.', '程度：适量时是好事，过了就变坏', 'À petite dose, les réseaux sociaux divertissent ; au-delà, ils isolent.', '分号前加空格；两半句式对称'],
  ['T3', '⑤', '②', null, "Un ⬚ choisi n'a pas la même valeur qu'un ⬚ subi.", '自愿 vs 被迫：自己选的和被迫的，价值不同', "Un engagement choisi n'a pas la même valeur qu'un engagement subi.", 'choisi ↔ subi（或 négocié ↔ imposé），同一个名词重复'],
  ['T3', '⑤', '③', null, "Ce sont d'ailleurs ⬚ où l'on ⬚ et qui ⬚ plus longtemps que les autres.", '谁获益：举出受益的一方，用两个关系从句展开', "Ce sont d'ailleurs des entreprises où l'on vit mieux et qui durent plus longtemps que les autres.", 'ce sont + 复数；où l’on（书面加 l’）；plus longtemps 一个词'],
  ['T3', '⑤', '⑤', null, 'Pour certains, ⬚ est même la condition de ⬚.', '个人：对一部分人来说，它甚至是……的前提', 'Pour certains, le télétravail est même la condition de leur équilibre.', 'même 放在 être 后面加强'],
  ['T3', '⑥', null, null, "En ⬚-ant ⬚, ⬚ n'y gagne guère que ⬚, au détriment de ⬚.", '论据一具象：一个具体动作 + 数字，只换来……，还损害了……', "En empilant des cartons huit heures durant, l'adolescent n'y gagne guère que de la fatigue, au détriment du repos estival.", '副动词的主语 = 主句主语；ne … guère que 后保留部分冠词（que de la fatigue）；必须有具象名词 + 数量 / 时长'],
  ['T3', '⑥', null, '高', "En ⬚-ant ⬚, ⬚ y perd plus qu'il n'y gagne, au détriment de ⬚.", '具象（变体 B）：得不偿失，避开和 ⑤ 重复 ne … que', "En enchaînant six visioconférences par jour, le salarié y perd plus qu'il n'y gagne, au détriment du lien collectif.", 'plus que 比较从句里的赘词 ne（不表否定）'],
  ['T3', '⑥', '①', null, "C'est précisément en l'absence de ⬚ que ⬚.", '反事实：正是没有它的时候，问题才出现', "C'est précisément en l'absence de règles claires que les abus se multiplient.", 'c’est … que 强调状语'],
  ['T3', '⑥', '①', '口语', 'Sans ⬚, ⬚ risquerait de ⬚.', '反事实：要是没有它，……就可能……', 'Sans ce dialogue, l’adolescent risquerait de jouer en cachette.', '条件式 risquerait；sans + 名词作假设'],
  ['T3', '⑦', '⑥', null, '⬚ se rattrape toujours, alors que ⬚ ne se rattrape jamais.', '形状 A（我反对时）：对方的好处补得回，我看重的补不回', 'Une tâche reportée se rattrape toujours, alors qu’une soirée sacrifiée ne se rattrape jamais.', 'alors que 对比；两半都用代动词，后半否定式'],
  ['T3', '⑦', '⑥', null, "⬚ s'acquiert à tout âge, alors que ⬚ ne se refait pas.", '形状 A：对方的好处什么时候都能得到，我看重的错过就没了', "De telles compétences s'acquièrent à tout âge, alors que l'adolescence ne se refait pas.", '主语复数时 s’acquièrent；后半 ne se + V + pas'],
  ['T3', '⑦', '⑥', null, '⬚ se prévoit aisément, alors que ⬚ ne se décrète pas.', '形状 B（我支持时）：对方担心的风险可以安排，我看重的东西不能强求', 'Un espace sans animaux se prévoit aisément, alors qu’un lien entre collègues ne se décrète pas.', 'ne se décrète pas = 不能靠命令产生'],
  ['T3', '⑦', '⑥', null, "⬚ se limite aisément, alors que ⬚ ne s'improvise pas.", '形状 B：风险容易限制，我看重的东西临时造不出来', "Le temps d'écran se limite aisément, alors qu'une habitude de lecture ne s'improvise pas.", '代动词表被动；后半否定式'],
  ['T3', '⑦', '⑥', null, '⬚ se régule à tout moment, alors que ⬚ ne se rattrape pas.', '形状 B：工具随时可以调节，一代人错过了补不回', 'Un outil se régule à tout moment, alors qu’une génération ne se rattrape pas.', '代动词表被动；alors que 对比'],
  ['T3', '⑦', '⑥', null, '⬚ s’obtient autrement, alors que ⬚ ne se décrète pas.', '形状 A：对方的好处有别的办法得到，我看重的东西不能强求', 'La souplesse s’obtient autrement, alors que la confiance ne se décrète pas.', '后半统一 ne se + V + pas'],
  ['T3', '⑦', null, null, 'On songe notamment à ⬚, à ⬚ et à ⬚.', '论据二的三元展开：三个同类的抽象名词', "On songe notamment à la curiosité, à l'amitié et à la créativité.", 'songer à：每一项都带 à（au / aux / à la / à l’）'],
  ['T3', '⑦', null, null, 'On songe notamment au fait de ⬚, de ⬚ et de ⬚.', '三元展开（没有领域词汇时）：把三个简单动作名词化', "On songe notamment au fait d'observer, d'attendre et de protéger.", '一个 fait 管三个不定式：au 只写一次，后面是 de'],
  ['T3', '⑦', '④', '高', 'Plus préoccupant encore, à mesure que ⬚, ⬚ nous échappe insensiblement.', '论据二进阶：随着……，某样东西不知不觉地从我们手里溜走', 'Plus préoccupant encore, à mesure que les caméras se multiplient dans les écoles, la vie privée des élèves leur échappe insensiblement.', 'à mesure que + 直陈式；句首是 ce qui est plus préoccupant encore 的省略；丢掉对称句式'],
  ['T3', '⑦', '⑤', null, "Ce qui soulage l'individu peut peser sur le collectif.", '个人 vs 集体：对个人是解脱，对集体可能是负担', "Ce qui soulage l'individu peut peser sur le collectif.", 'ce qui + 直陈式；peser sur'],
  ['T3', '⑦', '⑤', null, "⬚ relève d'un choix personnel, alors que ⬚ engage toute l'équipe.", '个人 vs 集体：一边是个人选择，一边牵动整个团队', "Venir avec son chien relève d'un choix personnel, alors que l'ambiance du bureau engage toute l'équipe.", 'relever de = 属于……的范畴'],
  ['T3', '⑦', '④', null, 'Si ⬚ offre un gain immédiat, il se paie à long terme.', '短期 vs 长期：眼前的好处，长远要付代价', 'Si la livraison au bureau offre un gain immédiat, il se paie à long terme.', 'si 表让步对比（= 虽然）；se payer = 要付出代价'],
  ['T3', '⑦', '④', null, '⬚ procure un soulagement à court terme, mais ⬚ à long terme.', '短期 vs 长期：短期让人轻松，长期却……', "L'intelligence artificielle procure un soulagement à court terme, mais appauvrit la réflexion à long terme.", 'à court terme ↔ à long terme 对称'],
  ['T3', '⑦', '④', '口语', 'À terme, ⬚ risque de ⬚.', '长期：久而久之，它可能会……', "À terme, cet usage risque d'affaiblir la mémoire des élèves.", 'risquer de + 不定式'],
  ['T3', '⑦', '④', null, 'Les effets de ⬚ ne se mesurent qu’avec le temps.', '长期：它的影响要过很久才看得出来', 'Les effets des réseaux sociaux sur le sommeil ne se mesurent qu’avec le temps.', 'ne … que 限制；代动词表被动'],
  ['T3', '⑦', '③', null, '⬚ profite surtout à ⬚, au détriment de ⬚.', '谁付代价：好处归谁，代价落在谁身上', 'La semaine de quatre jours profite surtout aux cadres, au détriment des équipes en horaires décalés.', 'profiter à qqn；au détriment de'],
  ['T3', '⑦', '③', '口语', 'Le coût de ⬚ retombe sur ⬚.', '谁付代价：成本最后压在谁身上', 'Le coût de ces livraisons rapides retombe sur les livreurs.', 'retomber sur qqn'],
  ['T3', '⑦', '⑦', null, "⬚ devrait servir ⬚, et non l'inverse.", '手段 vs 目的：工具应该为人服务，而不是反过来', "La technologie devrait servir l'enseignant, et non l'inverse.", '条件式 devrait 表应该；servir qqn 直接宾语'],
  ['T3', '⑦', '⑦', '口语', 'On aurait tort de confondre ⬚ et ⬚.', '手段 vs 目的：把两样东西混为一谈是错的', 'On aurait tort de confondre un diplôme et une compétence.', '条件式 aurait；avoir tort de + 不定式'],
  ['T3', '⑦', '⑦', null, "C'est confondre ⬚ et ⬚.", '手段 vs 目的：这样做等于把两样东西混淆了', "Interdire les écrans, c'est confondre l'outil et son usage.", '不定式 + c’est + 不定式'],
  ['T3', '⑦', '②', '口语', 'Tout dépend de savoir si ⬚ est choisi ou subi.', '自愿 vs 被迫：关键在于是自己选的还是被迫的', 'Tout dépend de savoir si le télétravail est choisi ou subi.', 'choisi / subi 和主语配合'],
  ['T3', '⑧', '③', null, 'Bien que ⬚ ne soit pas ⬚, je reste convaincu(e) que ⬚.', '自我代价：承认我的立场有代价或有边界，但立场不变', "Bien que ce choix ne soit pas offert à tous, je reste convaincu qu'il doit demeurer la règle.", 'Bien que + 虚拟式；je reste convaincu(e) que + 直陈式；虚拟式动词不能和 ④ 相同'],
  ['T3', '⑧', '③', null, 'Bien que ⬚ ait un prix, je reste convaincu(e) que ⬚.', '自我代价（④ 用了 être 时）：承认这份退让有代价', 'Bien que prendre ce recul ait un prix, je reste convaincu que le travail est un moyen, non une fin en soi.', '虚拟式 ait（avoir），避开 ④ 的 soit'],
  ['T3', '⑧', '③', null, "Bien que ⬚ n'aille pas de soi, je reste convaincu(e) que ⬚.", '自我代价（④ 用了 être 时）：承认这并非理所当然', "Bien que cet encouragement n'aille pas de soi, je reste convaincu qu'un encadrement lucide vaut mieux qu'une interdiction.", '虚拟式 aille（aller）；aller de soi = 理所当然'],
  ['T3', '⑧', null, '高', "Certes, ⬚, mais il n'en demeure pas moins que ⬚.", '让对方一步，再推进新的一层', "Certes, le télétravail isole certains salariés, mais il n'en demeure pas moins qu'il libère du temps pour la famille.", '+ 直陈式；Certes 后不能漏 mais；mais 后不能复述 ④'],
  ['T3', '⑧', null, '高', "Certes, ⬚, mais c'est précisément pourquoi ⬚.", '让一步，再把对方的点变成自己的理由', "Certes, les écrans fascinent les enfants, mais c'est précisément pourquoi il faut les accompagner.", 'pourquoi 后不加 que'],
  ['T3', '⑧', null, '高', 'rares sont ceux qui ⬚', '很少有人……（表语前置倒装）', 'Certes, le télétravail se généralise, mais rares sont ceux qui décident de leur charge de travail.', '表语前置，主谓倒装；可嵌进 ⑧ 的后半'],
  ['T3', '⑧', '③', '口语', 'Ce sont souvent les plus modestes qui en paient le prix.', '谁付代价：往往是最弱势的人在买单', 'Ce sont souvent les plus modestes qui en paient le prix.', 'en 指代前面的那件事；paient'],
  ['T3', '⑧', '⑦', null, '⬚ est un moyen, non une fin en soi.', '手段 vs 目的：它只是手段，不是目的本身', 'Le travail est un moyen, non une fin en soi.', '「不是 A 而是 B」用 A, non B，不用 pourtant'],
  ['T3', '⑧', null, null, '⬚ vaut mieux que ⬚.', '两害相权：这一种比那一种好', "Un encadrement lucide vaut mieux qu'une interdiction.", 'valoir mieux que；que 遇元音省音'],
  ['T3', '⑨', null, null, "En somme, l'idéal serait que chacun sache trouver ⬚.", '收束：给出和解的出路，与 ④ 闭环', "En somme, l'idéal serait que chacun sache trouver le rythme qui lui convient.", '条件式 serait + 虚拟式 sache；chacun 可换成 chaque entreprise / chaque famille'],
  ['T3', '⑨', '⑦', null, "l'idéal serait que chacun sache distinguer ⬚ de ⬚.", '收束（手段 vs 目的）：分清这两样东西', "En somme, l'idéal serait que chacun sache distinguer ce qu'il fait de ce qu'il est.", 'distinguer A de B'],
  ['T3', '⑨', '⑤', null, "l'idéal serait que chacun sache concilier ⬚ et ⬚.", '收束（个人 vs 集体）：兼顾两边', "En somme, l'idéal serait que chacun sache concilier sa liberté et le confort des autres.", 'concilier A et B'],
  ['T3', '⑨', '⑦', null, "l'idéal serait que chacun puisse choisir ⬚, non ⬚.", '收束：自己选，而不是被安排', "En somme, l'idéal serait que chacun puisse choisir ses horaires, non les subir.", '虚拟式 puisse；A, non B'],
  ['T3', '⑨', null, '高', "Aussi convient-il, sans renoncer à ⬚, de rester vigilant quant aux dérives qu'il induit.", '收束进阶：不放弃它，但对它的偏差保持警惕', "Aussi convient-il, sans renoncer au numérique, de rester vigilant quant aux dérives qu'il induit.", '句首 Aussi（= 因此）主谓倒装；丢掉条件式和虚拟式'],
  ['T3', '⑨', '⑤', null, '⬚ doit se décider au sein de chaque équipe.', '收束（个人 vs 集体）：交给每个团队自己决定', 'Le télétravail doit se décider au sein de chaque équipe.', 'se décider 表被动；au sein de'],
  ['T3', '⑨', '⑧', '口语', 'Tout est affaire de mesure.', '程度：一切都在于分寸（口语收束：Au fond, …）', 'Au fond, tout est affaire de mesure.', 'affaire 不加冠词'],
  ['T3', '⑨', '⑤', '口语', 'La liberté des uns s’arrête là où commence celle des autres.', '个人 vs 集体：一个人的自由止于他人自由的开始（谚语）', 'La liberté des uns s’arrête là où commence celle des autres.', 'là où + 主谓倒装 commence celle'],
];

const ORAL: Row[] = [
  ['口语', '复述', null, '口语', "Si je comprends bien, il s'agit de savoir si ⬚.", '口语 T3 开头：复述题目，争取几秒', "Si je comprends bien, il s'agit de savoir si le télétravail doit devenir la règle.", 'il s’agit de savoir si + 直陈式'],
  ['口语', '立场', '②', '口语', 'Pour moi, ⬚ oui, mais à condition que ⬚.', '口语 T3：亮出带条件的立场', "Pour moi, le télétravail oui, mais à condition qu'il soit choisi.", 'à condition que + 虚拟式'],
  ['口语', '例子', null, '口语', "Prenons l'exemple de ⬚.", '口语 T3：引出一个例子', "Prenons l'exemple de mon ancien collègue.", '命令式 nous'],
  ['口语', '让步', '③', '口语', 'Bien sûr, je reconnais que ⬚.', '口语 T3：承认代价（比 Bien que 自然）', 'Bien sûr, je reconnais que ce choix n’est pas offert à tous.', 'reconnaître que 肯定式 + 直陈式'],
];

const T1: Row[] = [
  ['T1', 'T1-02', null, '高', 'Quelle joie de ⬚ !', '信件开场：表达喜悦', 'Quelle joie de vous accueillir !', '感叹句；de + 不定式'],
  ['T1', 'T1-03', null, '保', "Tout d'abord … Ensuite … Enfin …", '信件正事：分点展开', "Tout d'abord, l'appartement est lumineux. Ensuite, le quartier est calme. Enfin, le loyer reste raisonnable.", '每个连接词后加逗号'],
  ['T1', 'T1-03', null, '高', "D'abord … De plus … Surtout …", '信件正事：分点展开，最后一点最重要', "D'abord, la salle est spacieuse. De plus, elle est facile d'accès. Surtout, elle est gratuite le dimanche.", 'Par ailleurs 只有带 s 的形式'],
  ['T1', 'T1-04', null, '保', 'Je te conseille de ⬚ dès que possible.', '信件：给建议', 'Je te conseille de le réserver dès que possible.', 'conseiller à qqn de faire'],
  ['T1', 'T1-04', null, '保', 'Je vous propose de profiter de ⬚ pour ⬚.', '信件：提议趁机做某事', 'Je vous propose de profiter du beau temps pour pique-niquer au bord du lac.', 'profiter de qqch pour + 不定式'],
  ['T1', 'T1-04', null, '保', 'Pense à prévoir ⬚.', '信件：提醒对方准备某物', 'Pense à prévoir une tenue confortable.', 'penser à + 不定式；tu 和 vous 全篇一致'],
  ['T1', 'T1-04', null, '高', 'Vous pourriez envisager de ⬚.', '信件：委婉地建议', 'Vous pourriez envisager de venir en train plutôt qu’en voiture.', '条件式 pourriez；envisager de + 不定式'],
  ['T1', 'T1-04', null, '高', '⬚ mérite(nt) vraiment le détour.', '信件：推荐一个地方值得专程去', 'Les collections du musée méritent vraiment le détour.', 'mériter 和主语配合'],
  ['T1', 'T1-04', null, '高', 'Je vous le recommande vivement.', '信件：强烈推荐', 'Ce restaurant ? Je vous le recommande vivement.', 'le 在 vous 后面'],
  ['T1', 'T1-04', null, '高', 'Mieux vaut ⬚.', '信件：最好……（简洁的无人称建议）', 'Mieux vaut le faire au salon.', 'mieux vaut + 不定式，比 il vaut mieux 简洁'],
  ['T1', 'T1-05', null, '保', 'Je suis convaincu(e) que ce sera ⬚.', '信件收尾：展望', 'Je suis convaincu que ce sera une expérience inoubliable.', 'convaincu(e) 按写信人性别'],
  ['T1', 'T1-05', null, '高', 'Non seulement nous ⬚, mais aussi nous ⬚.', '信件收尾：不仅……而且……', 'Non seulement nous passerions un excellent moment ensemble, mais aussi nous élargirions nos horizons cinématographiques.', '两个分句时态一致（条件式）；excellent 无重音'],
  ['T1', 'T1-05', null, '高', 'un moment dont on se souviendra', '信件收尾：一个会被记住的时刻', 'Ce sera un très bon moment dont on se souviendra.', 'se souvenir de → dont'],
];

const T2: Row[] = [
  ['T2', 'T2-02', null, '保', "Chers internautes, j'espère que vous allez bien !", '博客开场：问候读者', "Chers internautes, j'espère que vous allez bien !", 'Chers internautes 两处复数；感叹号前加空格'],
  ['T2', 'T2-02', null, '保', 'Je voulais vous parler de ⬚.', '博客开场：引出要讲的事', "Je voulais vous parler de l'exposition que j'ai vue samedi.", '未完成过去时 voulais 表委婉'],
  ['T2', 'T2-03', null, '保', "Ce qui m'a le plus touché, c'est ⬚.", '博客：最触动我的点', "Ce qui m'a le plus touché, c'est la générosité des bénévoles.", 'c’est 用现在时，即使前半是复合过去时'],
  ['T2', 'T2-03', null, '高', "Ce qui m'a le plus marqué, c'est que ⬚.", '博客：印象最深的是……（接一个句子）', "Ce qui m'a le plus marqué, c'est que personne ne regardait son téléphone.", 'c’est que + 直陈式'],
  ['T2', 'T2-03', null, '高', 'Ce qui force mon admiration, c’est ⬚.', '博客：让我由衷佩服的是……', 'Ce qui force mon admiration, c’est sa générosité.', 'forcer l’admiration'],
  ['T2', 'T2-04', null, '保', 'Dites-moi votre avis sur ⬚. À très bientôt !', '博客收尾：请读者留言', 'Dites-moi votre avis sur ce film. À très bientôt !', 'avis sur，不是 de'],
  ['T2', 'T2-04', null, '高', "Et vous, qu'est-ce qui vous retiendrait le plus si vous deviez ⬚ ?", '博客收尾：抛给读者一个问题', "Et vous, qu'est-ce qui vous retiendrait le plus si vous deviez quitter votre ville ?", 'si + 未完成过去时，主句条件式'],
  ['T2', 'T2-04', null, '高', "Merci de m'avoir lu. À très bientôt !", '博客收尾：感谢阅读', "Merci de m'avoir lu. À très bientôt !", 'merci de + 不定式完成式'],
];

export interface SeedFrame {
  lemma: string; meaningZh: string; sentence: string; extra: string; source: string;
  frame: { task: string; slot: string | null; lens: string | null; register: string | null };
}

export const SEED_FRAMES: SeedFrame[] = [...T3, ...ORAL, ...T1, ...T2].map(([task, slot, lens, register, frame, fn, ex, locks]) => ({
  lemma: frame, meaningZh: fn, sentence: ex, extra: `语法锁：${locks}`,
  source: task === 'T3' ? `写作手册 · ${lens ? 'LENTILLES / ' : ''}九句模板` : `写作手册 · ${task}`,
  frame: { task, slot, lens, register },
}));
