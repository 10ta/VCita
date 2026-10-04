import { useEffect, useMemo, useState } from 'react';
import { useCards, useDecks, useOnboarded, useSettings, useTodayLogs } from './db/hooks';
import { ensureDeck } from './db/actions';
import { useSyncConfig } from './sync/engine';
import { buildQueue } from './srs/queue';
import { usePrefs, setPrefs } from './ui/prefs';
import { useHotkeys, useNow } from './ui/hooks';
import { Toaster } from './ui/toast';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { AutoSync, SyncBadge } from './sync/SyncBadge';
import { ReviewPage } from './features/review/ReviewPage';
import { LibraryPage } from './features/library/LibraryPage';
import { AddPage } from './features/add/AddPage';
import { DecksPage } from './features/decks/DecksPage';
import { StatsPage } from './features/stats/StatsPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { Onboarding } from './features/Onboarding';
import { Help } from './features/Help';

const NAV = [
  { key: 'review', label: '复习' },
  { key: 'library', label: '词库' },
  { key: 'add', label: '添加' },
  { key: 'stats', label: '统计' },
  { key: 'decks', label: '牌组' },
  { key: 'settings', label: '设置' },
] as const;
type RouteKey = (typeof NAV)[number]['key'];

function readRoute(): RouteKey {
  const key = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return (NAV.find((n) => n.key === key)?.key ?? 'review') as RouteKey;
}
function useRoute(): RouteKey {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const onboarded = useOnboarded();
  const decks = useDecks();
  const prefs = usePrefs();
  const s = useSettings();
  const cards = useCards();
  const [now] = useNow(60_000);
  const logs = useTodayLogs(s?.dayStartHour, now);
  const [help, setHelp] = useState(false);

  const deckId = decks?.find((d) => d.id === prefs.deckId)?.id ?? decks?.[0]?.id ?? null;

  const counts = useMemo(
    () => (s && cards && logs && deckId ? buildQueue({ cards, todayLogs: logs, deckId, now: Date.now(), settings: s }).counts : null),
    [s, cards, logs, deckId, now],
  );

  useEffect(() => {
    document.title = `${NAV.find((n) => n.key === route)?.label ?? ''} · VCita`;
  }, [route]);

  // 鼠标点按钮时不让按钮拿到焦点，之后按空格就不会误触这个按钮
  useEffect(() => {
    const md = (e: MouseEvent) => { if (e.button === 0 && (e.target as HTMLElement).closest?.('button')) e.preventDefault(); };
    window.addEventListener('mousedown', md, true);
    return () => window.removeEventListener('mousedown', md, true);
  }, []);

  useHotkeys((k) => (k === '?' ? void setHelp(true) : false));

  if (onboarded === undefined) return null;
  if (!onboarded && route !== 'settings') return <><Onboarding /><Toaster /></>;

  const todo = counts ? counts.learning + counts.review + counts.new : 0;
  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="#/review"><span className="mark">鍛</span>VCita</a>
        {decks && decks.length > 0 && (
          <select className="deck-select" value={deckId ?? ''} onChange={(e) => setPrefs({ deckId: e.target.value })} aria-label="当前牌组">
            {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <span className="grow" />
        <ErrorBoundary area="同步状态"><SyncBadge /></ErrorBoundary>
        <button type="button" className="help-btn" onClick={() => setHelp(true)} title="说明 (?)">?</button>
      </header>
      <nav className="nav" aria-label="主导航">
        {NAV.map((n) => (
          <a key={n.key} href={`#/${n.key}`} aria-current={route === n.key ? 'page' : undefined}>
            {n.label}
            {n.key === 'review' && todo > 0 && <span className="nav-count">{todo}</span>}
          </a>
        ))}
      </nav>
      <ErrorBoundary area="自动同步"><AutoSync /></ErrorBoundary>
      <main>
        <ErrorBoundary key={route} area="页面">
          {route === 'settings' ? <SettingsPage /> : !deckId ? <NoDeck />
            : route === 'review' ? <ReviewPage deckId={deckId} />
            : route === 'library' ? <LibraryPage deckId={deckId} />
            : route === 'add' ? <AddPage deckId={deckId} />
            : route === 'stats' ? <StatsPage deckId={deckId} />
            : <DecksPage deckId={deckId} />}
        </ErrorBoundary>
      </main>
      {help && <Help onClose={() => setHelp(false)} />}
      <Toaster />
    </div>
  );
}

/** 还没有牌组：多半是刚连上 GitHub、第一次同步还没完成 */
function NoDeck() {
  const cfg = useSyncConfig();
  return (
    <div className="empty">
      <p>还没有牌组</p>
      {cfg ? <p className="muted small">已连接 GitHub：同步完成后牌组会出现在这里。也可以在设置里点"立即同步"。</p>
        : <p className="muted small">在设置里连接 GitHub 数据仓库并同步，或者新建一个牌组。</p>}
      <div className="row" style={{ justifyContent: 'center' }}>
        <a className="btn" href="#/settings">去设置</a>
        <button type="button" className="btn" onClick={() => void ensureDeck()}>新建牌组</button>
      </div>
    </div>
  );
}
