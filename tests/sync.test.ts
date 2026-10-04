import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import { answerCard, clearAllLocalData, undoAnswer, updateNote } from '../src/db/actions';
import { disconnectSync, pendingFiles, saveSyncConfig, syncNow } from '../src/sync/engine';
import { gitBlobSha } from '../src/sync/files';
import { importLegacy, readLegacyBackup } from '../src/io/legacy';
import { makeLegacyBackup } from './legacyData';
import { FakeGitHub } from './fakeGithub';

let gh: FakeGitHub;
const CFG = { repo: 'me/data', branch: 'main', dir: 'VCita', token: 't', autoSync: false };

/** 换一台"设备"：清空本地库，连接同一个仓库 */
async function newDevice() {
  await disconnectSync();
  await clearAllLocalData();
  await saveSyncConfig(CFG);
}

beforeEach(async () => {
  gh = new FakeGitHub();
  globalThis.fetch = gh.fetch as typeof fetch;
  await newDevice();
});

const seed = async () => importLegacy(readLegacyBackup(makeLegacyBackup(40)), 'zzz', {});

describe('git blob sha', () => {
  it('与 git hash-object 一致', async () => {
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('GitHub 同步', () => {
  it('空仓库：推送全部文件，布局为 profile / notes / cards / logs', async () => {
    await seed();
    const r = await syncNow();
    expect(r.pushed).toBeGreaterThan(0);
    const paths = Object.keys(gh.files());
    expect(paths).toContain('VCita/profile.json');
    expect(paths.some((p) => /^VCita\/notes\/\d{4}-\d{2}\.json$/.test(p))).toBe(true);
    expect(paths.some((p) => /^VCita\/cards\/\d{4}-\d{2}\.json$/.test(p))).toBe(true);
    expect(paths.some((p) => /^VCita\/logs\/\d{4}-\d{2}\/\d{2}\.json$/.test(p))).toBe(true);
    expect(await pendingFiles()).toBe(0);
    const head = gh.head;
    expect((await syncNow()).pushed).toBe(0);
    expect(gh.head).toBe(head); // 没有变化不产生提交
  });

  it('新设备从仓库恢复，数据完整一致', async () => {
    await seed();
    await syncNow();
    const before = { notes: await db.notes.count(), cards: await db.cards.count(), logs: await db.logs.count() };
    await newDevice();
    expect(await db.cards.count()).toBe(0);
    await syncNow();
    expect({ notes: await db.notes.count(), cards: await db.cards.count(), logs: await db.logs.count() }).toEqual(before);
  });

  it('复习一张卡：只改动这张卡所在的卡片文件和当天的日志文件', async () => {
    await seed();
    await syncNow();
    await answerCard('c_old1', 3);
    expect(await pendingFiles()).toBe(2);
    await syncNow();
    const files = gh.files();
    const today = Object.keys(files).filter((p) => p.startsWith('VCita/logs/'));
    expect(today.length).toBeGreaterThan(0);
  });

  it('撤销通过墓碑传播：另一台设备不会把撤销掉的日志带回来', async () => {
    await seed();
    await syncNow();
    const res = await answerCard('c_old1', 1);
    await syncNow();
    await undoAnswer(res);
    await syncNow();
    await newDevice();
    await syncNow();
    const log = await db.logs.get(res.logId);
    expect(log?.deleted).toBe(true);
    const c = await db.cards.get('c_old1');
    expect([c!.state, c!.interval, c!.lapses]).toEqual([res.before.state, res.before.interval, res.before.lapses]);
  });

  it('同步期间远端被别的设备抢先提交：重新合并后重试，两边的修改都保留', async () => {
    await seed();
    await syncNow();
    // 设备 B 改了 note old2（直接写远端）
    const notesPath = Object.keys(gh.files()).find((p) => p.includes('/notes/'))!;
    const remote = JSON.parse(gh.files()[notesPath]);
    const n2 = remote.notes.find((n: { id: string }) => n.id === 'n_old2');
    n2.meaningZh = '远端修改';
    n2.updatedAt = new Date(Date.now() + 1000).toISOString();
    await updateNote('n_old3', { meaningZh: '本地修改' });
    gh.beforeNextUpdateRef = async () => { await gh.commitFiles({ [notesPath]: JSON.stringify(remote, null, 2) + '\n' }); };
    await syncNow();
    expect((await db.notes.get('n_old2'))!.meaningZh).toBe('远端修改');
    const final = JSON.parse(gh.files()[notesPath]);
    expect(final.notes.find((n: { id: string }) => n.id === 'n_old3').meaningZh).toBe('本地修改');
    expect(final.notes.find((n: { id: string }) => n.id === 'n_old2').meaningZh).toBe('远端修改');
  });

  it('新设备首次同步：并发下载（最多 8 个同时），不产生任何新提交', async () => {
    await seed();
    await syncNow();
    const head = gh.head;
    await newDevice();
    let inFlight = 0, maxInFlight = 0, blobs = 0;
    const inner = gh.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!String(url).includes('/git/blobs/')) return inner(url, init);
      blobs++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      try { return await inner(url, init); } finally { inFlight--; }
    }) as typeof fetch;
    const r = await syncNow();
    expect(blobs).toBe(r.pulled);
    expect(r.pulled).toBeGreaterThan(8);
    expect(maxInFlight).toBe(8);
    expect(r.pushed).toBe(0);
    expect(gh.head).toBe(head);
    expect((await db.decks.toArray()).map((d) => d.name).sort()).toEqual(['A2', 'B1']);
  });

  it('只改数据目录：仓库里其他 app 的文件原样保留', async () => {
    await gh.commitFiles({ 'TimeEncre/profile.json': '{"x":1}\n' });
    await seed();
    await syncNow();
    expect(gh.files()['TimeEncre/profile.json']).toBe('{"x":1}\n');
  });
});
