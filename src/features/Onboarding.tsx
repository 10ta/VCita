import { useRef, useState } from 'react';
import { ensureDeck, markOnboarded } from '../db/actions';
import { readLegacyBackup, type LegacyBackup } from '../io/legacy';
import { readJsonFile } from '../io/download';
import { toast } from '../ui/toast';
import { LegacyImport } from './settings/LegacyImport';

/** 第一次打开：三选一 */
export function Onboarding() {
  const ref = useRef<HTMLInputElement>(null);
  const [legacy, setLegacy] = useState<LegacyBackup | null>(null);
  return (
    <div className="page onboarding">
      <h1>VCita</h1>
      <p className="muted">数据只保存在这台设备的浏览器和你自己的私有 GitHub 仓库里。先选一种开始方式：</p>
      <div className="choices">
        <button type="button" className="choice" onClick={() => void markOnboarded().then(() => { location.hash = '#/settings'; })}>
          <b>从 GitHub 数据仓库恢复</b>
          <span>已经在别的设备上用过。连接同一个仓库后点"立即同步"。<br />不要先导入备份，否则同一批词会变成两份。</span>
        </button>
        <button type="button" className="choice" onClick={() => ref.current?.click()}>
          <b>导入旧版备份</b>
          <span>旧的服务器版在"备份"页导出的 vocabforge-日期.json。复习进度完整保留。</span>
        </button>
        <button type="button" className="choice" onClick={() => void ensureDeck().then(markOnboarded)}>
          <b>从空白开始</b>
          <span>建一个空牌组，直接开始添加单词。</span>
        </button>
      </div>
      <input ref={ref} type="file" accept=".json,application/json" hidden onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file) return;
        try { setLegacy(readLegacyBackup(await readJsonFile(file))); } catch (err) { toast((err as Error).message, true); }
      }} />
      {legacy && <LegacyImport backup={legacy} onClose={() => setLegacy(null)} onDone={(m) => { setLegacy(null); toast(m); void markOnboarded(); location.hash = '#/review'; }} />}
    </div>
  );
}
