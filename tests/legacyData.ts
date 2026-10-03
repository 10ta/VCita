// 模拟旧版服务器的导出文件：641 张卡分布在 160 个天文件里，带 SM-2 字段和复习历史，两个旧标签
const pad = (n: number) => String(n).padStart(2, '0');
const ds = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const add = (s: string, n: number) => { const [y, m, d] = s.split('-').map(Number); return ds(new Date(y, m - 1, d + n)); };

export function makeLegacyBackup(total = 667) {
  const files: Record<string, unknown> = {
    'global.json': { users: [{ id: 'default', name: 'Default' }, { id: 'zzz', name: 'ZZZ' }], activeUser: 'zzz' },
    'users/zzz/meta.json': { decks: [{ id: 'default', name: 'B1' }, { id: 'a2', name: 'A2' }], sourceLang: 'fr', targetLang1: 'zh-CN', targetLang2: 'en' },
  };
  const start = '2026-04-01';
  let n = 0;
  for (let day = 0; n < total; day++) {
    const createdAt = add(start, day);
    const arr = [];
    for (let j = 0; j < 5 && n < total; j++, n++) {
      const reviewed = n % 3 !== 0;
      const hist = reviewed ? [0, 1, 3].map((o, k) => ({ date: add(createdAt, o), rating: k === 1 && n % 5 === 0 ? 1 : 3, remembered: !(k === 1 && n % 5 === 0), interval: [1, 3, 8][k], ...(k === 0 ? { wasNew: true } : {}) })) : [];
      arr.push({
        id: `old${n}`, word: `mot${n}`, translation: `词${n}`, translation2: `word${n}`, deckId: 'default', createdAt,
        tags: n % 4 === 0 ? ['Police et Justice'] : n % 9 === 0 ? ['médecine'] : [], rot: n % 3,
        ...(reviewed
          ? { state: 'review', interval: 8 + (n % 20), ease: n % 5 === 0 ? 2.3 : 2.5, due: add(createdAt, 11), lapses: n % 5 === 0 ? 1 : 0, reps: 3, lastReview: add(createdAt, 3) }
          : { state: 'new', interval: 0, ease: 2.5, due: createdAt, lapses: 0, reps: 0, lastReview: null }),
        reviewHistory: hist,
      });
    }
    const [y, m, d] = createdAt.split('-');
    files[`users/zzz/${y.slice(2)}${m}/${m}${d}.json`] = arr;
  }
  return { version: 5, exportedAt: '2026-10-01T10:00:00.000Z', files };
}
