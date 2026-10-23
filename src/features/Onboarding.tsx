import { ensureDeck, markOnboarded } from '../db/actions';

/** 第一次打开：二选一 */
export function Onboarding() {
  return (
    <div className="page onboarding">
      <h1>VCita</h1>
      <p className="muted">数据只保存在这台设备的浏览器和你自己的私有 GitHub 仓库里。先选一种开始方式：</p>
      <div className="choices">
        <button type="button" className="choice" onClick={() => void markOnboarded().then(() => { location.hash = '#/settings'; })}>
          <b>从 GitHub 数据仓库恢复</b>
          <span>已经在别的设备上用过。连接同一个仓库后点"立即同步"。<br />不要先导入备份，否则同一批词会变成两份。</span>
        </button>
        <button type="button" className="choice" onClick={() => void ensureDeck().then(markOnboarded)}>
          <b>从空白开始</b>
          <span>建一个空牌组，直接开始添加单词。也可以之后在"设置 → 数据"里导入 JSON 备份。</span>
        </button>
      </div>
    </div>
  );
}
