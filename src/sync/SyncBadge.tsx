import { useEffect } from 'react';
import { getSyncConfig, syncNow, useChangeTick, usePendingFiles, useSyncConfig, useSyncState, useSyncStatus } from './engine';
import { fromIso } from '../lib/time';

/** 侧边栏底部的同步状态 */
export function SyncBadge() {
  const cfg = useSyncConfig();
  const status = useSyncStatus();
  const pending = usePendingFiles();
  const state = useSyncState();
  if (cfg === undefined) return null;
  if (!cfg) {
    return (
      <a className="sync-badge is-off" href="#/settings">
        未连接同步
      </a>
    );
  }
  if (status.phase === 'syncing') return <span className="sync-badge is-busy">正在同步…</span>;
  if (status.phase === 'error')
    return (
      <a className="sync-badge is-error" href="#/settings" title={status.message}>
        同步失败，查看原因
      </a>
    );
  if (pending)
    return (
      <button type="button" className="sync-badge is-pending" onClick={() => void syncNow().catch(() => undefined)}>
        {pending} 个文件待同步
      </button>
    );
  const t = state?.lastSyncAt ? new Date(fromIso(state.lastSyncAt)) : null;
  return (
    <button type="button" className="sync-badge is-ok" onClick={() => void syncNow().catch(() => undefined)} title="点击立即同步">
      {t ? `${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 已同步` : '尚未同步'}
    </button>
  );
}

const STALE_MS = 5 * 60_000;
const IDLE_MS = 3 * 60_000;

/** 自动同步：启动时、本地停止改动 3 分钟后、切到后台时、回到前台且超过 5 分钟未同步时；一轮复习结束时由复习页触发 */
export function AutoSync() {
  const cfg = useSyncConfig();
  const pending = usePendingFiles();
  const changeTick = useChangeTick();
  const auto = !!cfg?.autoSync;
  const quiet = () => void syncNow().catch(() => undefined);

  useEffect(() => {
    if (!auto) return;
    const t = window.setTimeout(quiet, 1500);
    return () => window.clearTimeout(t);
  }, [auto]);

  useEffect(() => {
    if (!auto || !pending) return;
    const t = window.setTimeout(quiet, IDLE_MS);
    return () => window.clearTimeout(t);
  }, [auto, pending, changeTick]);

  useEffect(() => {
    if (!auto) return;
    let lastRun = Date.now();
    const on = async () => {
      if (document.visibilityState === 'hidden') {
        lastRun = Date.now();
        quiet();
      } else if (Date.now() - lastRun > STALE_MS && (await getSyncConfig())) {
        lastRun = Date.now();
        quiet();
      }
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [auto]);

  return null;
}
