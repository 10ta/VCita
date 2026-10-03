// 导入旧版（服务器版）备份：选用户 → 把旧标签映射到主题 → 导入
import { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { THEMES, type Theme } from '../../schema';
import { guessTheme, importLegacy, type LegacyBackup } from '../../io/legacy';

export function LegacyImport({ backup, onClose, onDone }: { backup: LegacyBackup; onClose: () => void; onDone: (msg: string) => void }) {
  const [uid, setUid] = useState(backup.users.length === 1 ? backup.users[0].uid : backup.users.find((u) => u.cards.length)?.uid ?? '');
  const user = backup.users.find((u) => u.uid === uid);
  const [map, setMap] = useState<Record<string, Theme>>({});
  const themeOf = (t: string) => map[t] ?? guessTheme(t);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const full = Object.fromEntries(user.tags.map((t) => [t.name, themeOf(t.name)]));
      const r = await importLegacy(backup, uid, full);
      onDone(`导入完成：笔记新增 ${r.notes.added}、更新 ${r.notes.updated}；卡片 ${r.cards.added + r.cards.updated}；复习日志 ${r.logs.added}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="导入旧版备份" onClose={onClose} footer={<>
      <button type="button" className="btn" onClick={onClose}>取消</button>
      <button type="button" className="btn is-primary" disabled={!user || busy} onClick={() => void run()}>{busy ? '正在导入…' : '导入'}</button>
    </>}>
      <p className="hint">每张旧卡会变成一条笔记 + 一张认读卡，复习进度原样保留，复习历史转成复习日志。同一份备份重复导入不会产生变化。</p>
      {backup.users.length > 1 && (
        <label className="field"><span className="field-label">导入哪个用户（新版是单用户）</span>
          <select value={uid} onChange={(e) => setUid(e.target.value)}>
            {backup.users.map((u) => <option key={u.uid} value={u.uid}>{u.name}（{u.cards.length} 张）</option>)}
          </select>
        </label>
      )}
      {user && user.tags.length > 0 && (
        <div className="field">
          <span className="field-label">旧标签 → 主题</span>
          {user.tags.map((t) => (
            <div key={t.name} className="map-row">
              <span>{t.name} <span className="muted small">（{t.count}）</span></span>
              <select value={themeOf(t.name)} onChange={(e) => setMap({ ...map, [t.name]: e.target.value as Theme })}>
                {THEMES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
