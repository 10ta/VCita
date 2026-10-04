// 同步引擎：拉取远端有变化的文件 → 按 LWW 合并进本地 → 把与远端不同的本地文件打成一个提交推上去。
// 只读写数据目录（默认 VCita/）下的文件；其他 app 在同一仓库里的文件原样保留。
// 推送时如果远端被别人抢先更新（非快进，422），重新拉取合并后重试。
import { useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { GitHub, GitHubError, parseRepo } from './github';
import { applyRemoteFile, buildLocalFiles, gitBlobSha, isOurFile } from './files';
import { toIso } from '../lib/time';

export interface SyncConfig {
  /** "owner/repo" */
  repo: string;
  branch: string;
  /** 仓库内的数据目录，默认 VCita */
  dir: string;
  token: string;
  autoSync: boolean;
}

export interface SyncState {
  /** 上次同步时双方一致的各文件 blob SHA（路径相对于数据目录） */
  fileShas: Record<string, string>;
  lastSyncAt?: string;
  lastCommit?: string;
}

const CONFIG_KEY = 'syncConfig';
const STATE_KEY = 'syncState';
export const DEFAULT_DIR = 'VCita';
/** 拉取时同时下载的文件数 */
const PULL_CONCURRENCY = 8;

async function mapPool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function getSyncConfig(): Promise<SyncConfig | null> {
  return ((await db.meta.get(CONFIG_KEY))?.value as SyncConfig | undefined) ?? null;
}

export async function saveSyncConfig(cfg: SyncConfig) {
  const prev = await getSyncConfig();
  const target = (c: SyncConfig | null) => (c ? `${c.repo.toLowerCase()}#${c.branch}:${normDir(c.dir)}` : '');
  await db.transaction('rw', db.meta, async () => {
    // 换了仓库、分支或目录，旧的同步状态就不再适用
    if (target(prev) !== target(cfg)) await db.meta.delete(STATE_KEY);
    await db.meta.put({ key: CONFIG_KEY, value: cfg });
  });
}

export async function disconnectSync() {
  await db.meta.bulkDelete([CONFIG_KEY, STATE_KEY]);
}

async function getSyncState(): Promise<SyncState> {
  return ((await db.meta.get(STATE_KEY))?.value as SyncState | undefined) ?? { fileShas: {} };
}

const setSyncState = (s: SyncState) => db.meta.put({ key: STATE_KEY, value: s });

const normDir = (d: string) => d.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_DIR;

export function githubFor(cfg: Pick<SyncConfig, 'repo' | 'token'>): GitHub {
  const r = parseRepo(cfg.repo);
  if (!r) throw new Error('仓库格式应为 owner/repo');
  return new GitHub(r.owner, r.repo, cfg.token);
}

// ---------- 状态（供界面订阅） ----------

export type SyncPhase = 'idle' | 'syncing' | 'ok' | 'error';
export interface SyncStatus {
  phase: SyncPhase;
  message?: string;
}

let status: SyncStatus = { phase: 'idle' };
const listeners = new Set<() => void>();
function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((l) => l());
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

// ---------- 同步 ----------

export interface SyncResult {
  pulled: number;
  pushed: number;
  commit: string | null;
}

const MAX_ATTEMPTS = 4;
let inflight: Promise<SyncResult> | null = null;

/** 同一时间只跑一个同步；重复调用拿到同一个结果 */
export function syncNow(): Promise<SyncResult> {
  inflight ??= runSync().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runSync(): Promise<SyncResult> {
  const cfg = await getSyncConfig();
  if (!cfg) throw new Error('还没有配置同步');
  setStatus({ phase: 'syncing' });
  try {
    const gh = githubFor(cfg);
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const r = await attempt(gh, cfg);
      if (r !== 'retry') {
        setStatus({
          phase: 'ok',
          message: r.pushed || r.pulled ? `拉取 ${r.pulled} 个文件，推送 ${r.pushed} 个文件` : '已是最新',
        });
        return r;
      }
    }
    throw new Error('同步期间仓库被反复更新，请稍后再试');
  } catch (e) {
    setStatus({ phase: 'error', message: (e as Error).message });
    throw e;
  }
}

async function attempt(gh: GitHub, cfg: SyncConfig): Promise<SyncResult | 'retry'> {
  const dir = normDir(cfg.dir);
  const prefix = `${dir}/`;
  const state = await getSyncState();

  // 1. 读远端：当前分支头、数据目录下各文件的 blob SHA
  const head = await gh.getHead(cfg.branch);
  const remote = new Map<string, string>();
  let rootTree: string | null = null;
  if (head) {
    rootTree = await gh.getCommitTree(head);
    const tree = await gh.getTreeRecursive(rootTree);
    if (tree.truncated) throw new Error('仓库文件太多，GitHub 返回的目录列表被截断，暂不支持');
    for (const e of tree.tree) {
      if (e.type !== 'blob' || !e.path.startsWith(prefix)) continue;
      const rel = e.path.slice(prefix.length);
      if (isOurFile(rel)) remote.set(rel, e.sha);
    }
  }

  // 2. 拉取：自上次同步以来远端变过的文件。并发下载（每个请求约 0.5–1 秒，逐个下载时 50 个文件要将近一分钟），
  //    全部下载完再按顺序合并进本地
  const toPull = [...remote].filter(([rel, sha]) => state.fileShas[rel] !== sha);
  const texts = await mapPool(toPull, PULL_CONCURRENCY, ([, sha]) => gh.getBlobText(sha));
  for (let i = 0; i < toPull.length; i++) await applyRemoteFile(toPull[i][0], texts[i]);
  const pulled = toPull.length;

  // 3. 对比：合并后的本地文件 vs 远端
  const local = await buildLocalFiles();
  const localShas = new Map<string, string>();
  for (const [rel, text] of local) localShas.set(rel, await gitBlobSha(text));
  const changed = [...local].filter(([rel]) => localShas.get(rel) !== remote.get(rel));

  const finish = async (commit: string | null, pushed: number): Promise<SyncResult> => {
    await setSyncState({
      fileShas: { ...Object.fromEntries(remote), ...Object.fromEntries(localShas) },
      lastSyncAt: toIso(Date.now()),
      lastCommit: commit ?? state.lastCommit,
    });
    return { pulled, pushed, commit };
  };

  if (changed.length === 0) return finish(head, 0);

  // 4. 推送
  if (!head || !rootTree) {
    // 空仓库 / 分支不存在：先用 Contents API 建第一个文件，下一轮再走正常流程
    const first = changed.find(([rel]) => rel === 'profile.json') ?? changed[0];
    await gh.putFile(prefix + first[0], first[1], `${dir}: 初始化`, cfg.branch);
    // 记下刚推上去的版本，下一轮不会把它当成“远端变化”再拉一次
    await setSyncState({ ...state, fileShas: { ...state.fileShas, [first[0]]: localShas.get(first[0])! } });
    return 'retry';
  }
  const tree = await gh.createTree(
    rootTree,
    changed.map(([rel, content]) => ({ path: prefix + rel, content })),
  );
  const names = [...new Set(changed.map(([rel]) => rel.replace(/\.json$/, '').replace(/^logs\/(\d{4}-\d{2})\/(\d{2})$/, 'logs/$1-$2')))];
  const commit = await gh.createCommit(`${dir}: 更新 ${names.length > 6 ? `${names.slice(0, 6).join(', ')} 等 ${names.length} 个文件` : names.join(', ')}`, tree.sha, [head]);
  try {
    await gh.updateRef(cfg.branch, commit.sha);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 422) return 'retry';
    throw e;
  }
  return finish(commit.sha, changed.length);
}

// ---------- 待同步计数 ----------

/** 自上次同步以来本地改动过的文件数；未配置同步时为 null */
export async function pendingFiles(): Promise<number | null> {
  // 先完成所有数据库读取，再做哈希计算（liveQuery 依赖读取来追踪变化）
  const [cfg, state, local] = await Promise.all([getSyncConfig(), getSyncState(), buildLocalFiles()]);
  if (!cfg) return null;
  let n = 0;
  for (const [rel, text] of local) if ((await gitBlobSha(text)) !== state.fileShas[rel]) n++;
  return n;
}

export const usePendingFiles = () => useLiveQuery(pendingFiles, []);
/** 本地数据每变一次就变一次的值（用于"停手一段时间后再同步"） */
export const useChangeTick = () =>
  useLiveQuery(async () => {
    const [n, c, l, d] = await Promise.all([db.notes.toArray(), db.cards.toArray(), db.logs.count(), db.decks.toArray()]);
    let m = 0;
    for (const x of [...n, ...c, ...d]) { const t = Date.parse(x.updatedAt); if (t > m) m = t; }
    return `${m}:${l}`;
  }, []);

/** 自动同步打开时立即同步一次（复习一轮结束时调用） */
export async function syncIfAuto() {
  if ((await getSyncConfig())?.autoSync) await syncNow().catch(() => undefined);
}
export const useSyncConfig = () => useLiveQuery(getSyncConfig, []);
export const useSyncState = () => useLiveQuery(getSyncState, []);
