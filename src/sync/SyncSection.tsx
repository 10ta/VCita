import { useState } from 'react';
import {
  DEFAULT_DIR,
  disconnectSync,
  githubFor,
  saveSyncConfig,
  syncNow,
  usePendingFiles,
  useSyncConfig,
  useSyncState,
  useSyncStatus,
  type SyncConfig,
} from './engine';
import { parseRepo } from './github';
import { fromIso } from '../lib/time';

export function SyncSection() {
  const cfg = useSyncConfig();
  const [editing, setEditing] = useState(false);
  if (cfg === undefined) return null;
  return (
    <section id="sync">
      <h2>GitHub 同步</h2>
      {!cfg || editing ? (
        <SyncForm initial={cfg} onDone={() => setEditing(false)} onCancel={cfg ? () => setEditing(false) : undefined} />
      ) : (
        <SyncPanel cfg={cfg} onEdit={() => setEditing(true)} />
      )}
    </section>
  );
}

function SyncForm({
  initial,
  onDone,
  onCancel,
}: {
  initial: SyncConfig | null;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [repo, setRepo] = useState(initial?.repo ?? '');
  const [dir, setDir] = useState(initial?.dir ?? DEFAULT_DIR);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const parsed = parseRepo(repo);
    if (!parsed) return setError('仓库格式应为 owner/repo，例如 yourname/data');
    const tok = token.trim() || initial?.token || '';
    if (!tok) return setError('请填写令牌');
    setBusy(true);
    try {
      const info = await githubFor({ repo, token: tok }).getRepo();
      if (!info.private) {
        setError('这是一个公开仓库。词库和复习记录属于私人数据，VocabForge 拒绝同步到公开仓库，请换成私有仓库。');
        return;
      }
      await saveSyncConfig({
        repo: `${parsed.owner}/${parsed.repo}`,
        branch: info.default_branch,
        dir: dir.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_DIR,
        token: tok,
        autoSync: initial?.autoSync ?? false,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="hint">
        数据会以 JSON 文件写入私有仓库的数据目录，每次同步是一个提交。只会改动这个目录，仓库里的其他文件不受影响。
      </p>
      <label className="field">
        <span className="field-label">私有数据仓库</span>
        <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" autoComplete="off" spellCheck={false} />
      </label>
      <label className="field">
        <span className="field-label">数据目录</span>
        <input value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} />
      </label>
      <label className="field">
        <span className="field-label">Fine-grained 令牌</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={initial ? '已保存，留空则不修改' : 'github_pat_…'}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="hint">
        令牌只授权这一个仓库、只开 Contents: Read and write。它保存在这台设备的浏览器里，不会随备份导出。
        注意它能读写整个仓库，不只是数据目录（和 TimeEncre 共用仓库时，两边的令牌都能读写对方的数据）。
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn is-primary" disabled={busy} onClick={save}>
          {busy ? '正在检查…' : '检查并保存'}
        </button>
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>取消</button>
        )}
      </div>
    </>
  );
}

function SyncPanel({ cfg, onEdit }: { cfg: SyncConfig; onEdit: () => void }) {
  const status = useSyncStatus();
  const state = useSyncState();
  const pending = usePendingFiles();
  const [confirmOff, setConfirmOff] = useState(false);
  const repoUrl = `https://github.com/${cfg.repo}`;

  return (
    <>
      <dl className="kv">
        <dt>仓库</dt>
        <dd>
          <a href={`${repoUrl}/tree/${encodeURIComponent(cfg.branch)}/${cfg.dir}`} target="_blank" rel="noreferrer">
            {cfg.repo}/{cfg.dir}
          </a>
          （分支 {cfg.branch}）
        </dd>
        <dt>上次同步</dt>
        <dd>
          {state?.lastSyncAt ? new Date(fromIso(state.lastSyncAt)).toLocaleString() : '尚未同步'}
          {state?.lastCommit && (
            <>
              {'，'}
              <a href={`${repoUrl}/commit/${state.lastCommit}`} target="_blank" rel="noreferrer">
                查看提交
              </a>
            </>
          )}
        </dd>
        <dt>待同步</dt>
        <dd>{pending == null ? '…' : pending === 0 ? '没有' : `${pending} 个文件`}</dd>
      </dl>
      {status.phase === 'error' && <p className="form-error" role="alert">{status.message}</p>}
      {status.phase === 'ok' && <p className="notice" role="status">{status.message}</p>}
      <div className="row">
        <button type="button" className="btn is-primary" disabled={status.phase === 'syncing'} onClick={() => void syncNow().catch(() => undefined)}>
          {status.phase === 'syncing' ? '正在同步…' : '立即同步'}
        </button>
        <button type="button" className="btn" onClick={onEdit}>修改设置</button>
        {confirmOff ? (
          <button type="button" className="btn is-danger" onClick={() => void disconnectSync()}>确认断开</button>
        ) : (
          <button type="button" className="btn is-ghost-danger" onClick={() => setConfirmOff(true)}>断开</button>
        )}
      </div>
      {confirmOff && <p className="hint">断开只删除这台设备上的仓库设置和令牌，本地数据和仓库里的数据都保留。</p>}
      <label className="toggle" style={{ marginTop: '1.25rem' }}>
        <input type="checkbox" checked={cfg.autoSync} onChange={(e) => void saveSyncConfig({ ...cfg, autoSync: e.target.checked })} />
        <span>
          自动同步
          <small>打开 app 时、有改动后约一分钟、切到后台时各同步一次</small>
        </span>
      </label>
    </>
  );
}
