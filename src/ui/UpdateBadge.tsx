// 新版本提示：部署了新版本后，右上角出现「有新版本 · 更新」，点一下刷新页面。
// 页面打开时、每 30 分钟、切回这个标签页时（最多 5 分钟一次）取一次 version.json（不走缓存），和页面自己的构建编号对比。
// 开发模式（没有 version.json）什么也不做。复习进度都在本机数据库里，刷新不会丢
import { useEffect, useState } from 'react';

const EVERY = 30 * 60_000;
const MIN_GAP = 5 * 60_000;

/** 取部署出去的构建编号；取不到（离线、开发模式）返回 null */
export async function deployedBuild(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await fetcher(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: unknown };
    return typeof j.build === 'string' ? j.build : null;
  } catch { return null; }
}

export function UpdateBadge() {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let last = 0;
    let stop = false;
    const check = async () => {
      if (stop || Date.now() - last < MIN_GAP) return;
      last = Date.now();
      const b = await deployedBuild();
      if (!stop && b && b !== __BUILD_ID__) setFresh(true);
    };
    void check();
    const timer = window.setInterval(() => { last = 0; void check(); }, EVERY);
    const onVis = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  if (!fresh) return null;
  return (
    <button type="button" className="update-badge" title="已经部署了新版本，点一下刷新（复习进度不会丢）" onClick={() => location.reload()}>
      有新版本 · 更新
    </button>
  );
}
