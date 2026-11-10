import { useEffect, useMemo, useRef, useState } from 'react';
import { useAllLogs, useCards, useDecks, useMemories, useNotes, useSettings } from '../../db/hooks';
import { validWeights } from '../../srs/fsrs';
import { simulate, stepCounts } from '../../srs/simulate';
import { clearAllLocalData, spreadBacklog } from '../../db/actions';
import { exportBundle, importBundle } from '../../io/bundle';
import { downloadBlob, readJsonFile } from '../../io/download';
import { bundleText, canGzip, gzip } from '../../io/pack';
import { dayStartMs, deviceTimeZone, fileStamp, fromIso, localClockOf, studyDay } from '../../lib/time';
import { SyncSection } from '../../sync/SyncSection';
import { toast } from '../../ui/toast';
import { THEMES, noteOrigin } from '../../schema';
import type { Settings } from '../../schema';
import { DeckSection } from './DeckSection';
import { Modal } from '../../ui/Modal';
import { DEFAULTS, Field, FuzzField, ResetDefaults, SectionHead, SetRow, WeightsField, save } from './fields';

/** 设置页的分类，顺序即页面顺序。「同步」卡跟在「数据」下面，「危险操作」放在页面最底下 */
const SECTIONS = [
  { id: 'data', label: '数据' },
  { id: 'decks', label: '牌组' },
  { id: 'daily', label: '每日' },
  { id: 'order', label: '出卡顺序' },
  { id: 'algo', label: '记忆算法' },
  { id: 'ui', label: '界面' },
] as const;
/** 旧链接里的分类名 → 现在的 */
const OLD_IDS: Record<string, string> = { srs: 'daily' };

/** #/settings?s=decks → 打开后滚动到对应分类 */
const targetFromHash = () => {
  const t = new URLSearchParams(location.hash.split('?')[1] ?? '').get('s');
  return t ? OLD_IDS[t] ?? t : null;
};

export function SettingsPage() {
  const s = useSettings();
  const active = useActiveSection();
  const ready = !!s;
  useEffect(() => {
    if (!ready) return;
    const go = () => {
      const t = targetFromHash();
      if (t) requestAnimationFrame(() => document.getElementById(t)?.scrollIntoView());
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [ready]);
  if (!s) return null;
  return (
    <div className="page settings">
      <nav className="set-nav" aria-label="设置分类">
        {SECTIONS.map((x) => (
          <button key={x.id} type="button" className={`set-tab${active === x.id ? ' is-on' : ''}`}
            onClick={() => document.getElementById(x.id)?.scrollIntoView({ behavior: 'smooth' })}>{x.label}</button>
        ))}
      </nav>
      <DataSection />
      <SyncSection />
      <DeckSection />
      <DailySection s={s} />
      <OrderSection s={s} />
      <AlgoSection s={s} />
      <UiSection s={s} />
      <DangerSection />
      <p className="muted small set-foot">改了立刻生效，并随同步应用到其他设备。</p>
    </div>
  );
}

/** 当前滚动到的分类：最后一个顶部越过导航条的分类 */
function useActiveSection() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    const on = () => {
      let cur: string = SECTIONS[0].id;
      for (const x of SECTIONS) {
        const el = document.getElementById(x.id);
        if (el && el.getBoundingClientRect().top < 120) cur = x.id;
      }
      // 滚到底时最后一节高度不够，直接点亮最后一个
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1].id;
      setActive(cur);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return active;
}

/* ---------------- 数据 ---------------- */

const importedMsg = (r: Awaited<ReturnType<typeof importBundle>>) => `导入完成：笔记新增 ${r.notes.added}、更新 ${r.notes.updated}`;

/** 导入一段备份 JSON 文本：不是 JSON、不是备份时只给一条简短提示。成功返回 true */
async function importText(text: string): Promise<boolean> {
  let raw: unknown;
  try { raw = JSON.parse(text.trim()); } catch { toast('剪贴板里没有备份 JSON', true); return false; }
  try {
    toast(importedMsg(await importBundle(raw)));
    return true;
  } catch { toast('剪贴板里的内容不是 VCita 备份', true); return false; }
}

// Firefox 的 clipboard.readText() 不走网站授权，而是在鼠标处弹一个"粘贴"小按钮，点别处就失败。
// 所以 Firefox 直接用粘贴框（Ctrl+V 触发 paste 事件，不需要任何授权）；其他浏览器先试 readText，读不到也退回粘贴框
const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

/** 从剪贴板导入：能直接读就直接导入，否则打开粘贴框。返回 true 表示需要粘贴框 */
async function importFromClipboard(): Promise<boolean> {
  if (isFirefox || !navigator.clipboard?.readText) return true;
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { return true; }
  await importText(text);
  return false;
}

/** 粘贴框：在这里按 Ctrl+V（手机上长按 → 粘贴），粘进来就导入 */
function PasteBox({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="从剪贴板导入" onClose={onClose}>
      <p className="muted small">按 <kbd>Ctrl</kbd>+<kbd>V</kbd>（Mac 上 <kbd>⌘</kbd>+<kbd>V</kbd>，手机上长按 → 粘贴），粘进来就自动导入。</p>
      <textarea className="bulk" rows={4} autoFocus placeholder="在这里粘贴备份 JSON" value=""
        onChange={() => undefined}
        onPaste={(e) => {
          e.preventDefault();
          void importText(e.clipboardData.getData('text')).then((ok) => { if (ok) onClose(); });
        }} />
    </Modal>
  );
}

const fmtSize = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
/** 导出备份：精简字段（默认值不写）、不缩进；gz = true 时再 gzip 压缩 */
async function exportBackup(gz: boolean) {
  const text = bundleText(await exportBundle());
  const name = `vcita-${fileStamp(Date.now())}.json`;
  const blob = gz ? await gzip(text) : new Blob([text], { type: 'application/json' });
  downloadBlob(blob, gz ? `${name}.gz` : name);
  toast(`已导出 ${fmtSize(blob.size)}`);
}

async function importFile(file: File) {
  try {
    toast(importedMsg(await importBundle(await readJsonFile(file))));
  } catch (err) { toast((err as Error).message, true); }
}

function DataSection() {
  const bundleRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pasting, setPasting] = useState(false);
  const decks = useDecks();
  const notes = useNotes();
  const cards = useCards();
  return (
    <section id="data">
      <h2>数据</h2>
      <div className={`dropzone${over ? ' is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void importFile(file);
        }}>
        <div className="drop-actions">
          <button type="button" className="btn is-primary" onClick={() => bundleRef.current?.click()}>导入备份</button>
          <button type="button" className="btn is-primary" title="复制了备份 JSON 后点这里直接导入" onClick={() => void importFromClipboard().then((box) => box && setPasting(true))}>从剪贴板导入</button>
        </div>
        <small>也可以把备份文件（.json 或 .json.gz）拖到这里。导入按"较新者胜出"逐条合并，可以重复导入。</small>
      </div>
      <SetRow label="导出备份" hint={decks && notes && cards ? `本机：${decks.length} 个牌组 · ${notes.length} 条笔记 · ${cards.length} 张卡` : '数据保存在这台设备的浏览器里'}>
        {canGzip() && <button type="button" className="btn" title="压缩包，体积约为 JSON 的八分之一；导入时直接选这个文件" onClick={() => void exportBackup(true)}>导出备份（.json.gz）</button>}
        <button type="button" className="btn" title="不压缩，可以用文本编辑器打开" onClick={() => void exportBackup(false)}>导出 JSON</button>
      </SetRow>
      <input ref={bundleRef} type="file" accept=".json,.gz,application/json,application/gzip" hidden onChange={(e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) void importFile(file);
      }} />
      {pasting && <PasteBox onClose={() => setPasting(false)} />}
    </section>
  );
}


/* ---------------- 每日 ---------------- */

/** 时区列表：常用的放前面，其余按字母 */
const COMMON_ZONES = ['Asia/Shanghai', 'Europe/Paris', 'America/Toronto', 'America/Montreal', 'America/New_York', 'America/Vancouver', 'UTC'];
/** 「每日切换时间」的说明：时区不是设备时区时，换算成本地时间 */
function switchHint(hour: number, tz: string | null): string {
  const hh = `${String(hour).padStart(2, '0')}:00`;
  const local = localClockOf(hour, tz);
  return `到这个时间换成新的一天，在这之前学习仍算前一天。`
    + (local ? `${tz} ${hh} 现在相当于本地 ${local}` : `按${tz ? ` ${tz}` : '设备'}时间 ${hh} 换天`);
}
function zoneOptions(): string[] {
  let all: string[] = [];
  try { all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { /* 旧浏览器 */ }
  return [...COMMON_ZONES, ...all.filter((z) => !COMMON_ZONES.includes(z))];
}

function DailySection({ s }: { s: Settings }) {
  return (
    <section id="daily">
      <SectionHead title="每日">
        <ResetDefaults s={s} keys={['newPerDay', 'frameNewPerDay', 'reviewsPerDay']} note="每日切换时间和时区跟你住在哪里有关，不会被恢复。" />
      </SectionHead>
      <Field k="newPerDay" s={s} />
      <Field k="frameNewPerDay" s={s} />
      <Field k="reviewsPerDay" s={s} />
      <SetRow label="每日切换时间" hint={switchHint(s.dayStartHour, s.timeZone)} def={`${String(DEFAULTS.dayStartHour).padStart(2, '0')}:00，跟随设备时区`}>
        <span className="row">
          <select aria-label="每日切换时间" value={s.dayStartHour} onChange={(e) => void save({ dayStartHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
          <select aria-label="时区" value={s.timeZone ?? ''} onChange={(e) => void save({ timeZone: e.target.value || null })} style={{ maxWidth: 230 }}>
            <option value="">跟随设备（{deviceTimeZone()}）</option>
            {zoneOptions().map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </span>
      </SetRow>
      <Forecast s={s} />
      <Backlog s={s} />
    </section>
  );
}

/* ---------------- 出卡顺序 ---------------- */

function OrderSection({ s }: { s: Settings }) {
  return (
    <section id="order">
      <SectionHead title="出卡顺序">
        <ResetDefaults s={s} keys={['newReviewOrder', 'newSort', 'focusTags', 'newSplit', 'freshShare', 'freshDays', 'reviewSort', 'productionAfterRecognition']} />
      </SectionHead>
      <h3 className="set-sub">新卡</h3>
      <Field k="newReviewOrder" s={s} />
      <Field k="newSort" s={s} />
      {s.newSort !== 'created' && (
        <SetRow stack label="重点主题" hint="这些主题的新卡最先出，例如考试写作里容易卡住的主题" def="不选（不区分主题）">
          <div className="chips">
            {THEMES.map((t) => {
              const on = s.focusTags.includes(t);
              return <button key={t} type="button" className={`chip${on ? ' is-on' : ''}`} aria-pressed={on}
                onClick={() => void save({ focusTags: on ? s.focusTags.filter((x) => x !== t) : [...s.focusTags, t] })}>{t}</button>;
            })}
          </div>
        </SetRow>
      )}
      <Field k="newSplit" s={s} />
      {s.newSplit !== 'off' && <SplitRows s={s} />}
      <Field k="productionAfterRecognition" s={s} />
      <h3 className="set-sub">复习卡</h3>
      <Field k="reviewSort" s={s} />
    </section>
  );
}

/* ---------------- 记忆算法 ---------------- */

const SM2_KEYS = ['graduatingInterval', 'easyInterval', 'startingEase', 'hardFactor', 'easyBonus', 'lapseFactor', 'overdueBonusMaxDays'] as const;

function AlgoSection({ s }: { s: Settings }) {
  const fsrs = s.scheduler === 'fsrs';
  return (
    <section id="algo">
      <SectionHead title="记忆算法">
        <ResetDefaults s={s} keys={['scheduler', 'desiredRetention', 'retentionRecognition', 'implicitRecognitionCredit', 'learningSteps', 'relearnSteps', 'fuzz', 'fuzzPercent', 'leechThreshold', ...SM2_KEYS]}
          note="FSRS 参数不会被恢复：那是用你自己的复习记录优化出来的。要用默认参数，清空那个输入框就行。" />
      </SectionHead>
      <Field k="scheduler" s={s} />
      {fsrs && (
        <>
          <Field k="desiredRetention" s={s} />
          <Field k="retentionRecognition" s={s} />
          <WeightsField s={s} />
        </>
      )}
      <Field k="implicitRecognitionCredit" s={s} />
      <h3 className="set-sub">步骤与间隔</h3>
      <Field k="learningSteps" s={s} />
      <Field k="relearnSteps" s={s} />
      <FuzzField s={s} />
      <Field k="leechThreshold" s={s} />
      {fsrs
        ? <p className="hint">FSRS 下天级间隔由记忆模型算（逾期多久也会算进去），毕业间隔、倍率、逾期加成这些 SM-2 参数不用，切到 SM-2 才显示。记忆状态每次从复习记录重放，切换算法不改任何已有数据。</p>
        : (
          <>
            <h3 className="set-sub">SM-2 参数</h3>
            {SM2_KEYS.map((k) => <Field key={k} k={k} s={s} />)}
          </>
        )}
    </section>
  );
}

/** 负荷预测：按 FSRS 模拟未来 30 天，比较不同的每日新卡数 */
function Forecast({ s }: { s: Settings }) {
  const cards = useCards();
  const logs = useAllLogs();
  const memories = useMemories(s.scheduler === 'fsrs' ? s : { ...s, scheduler: 'fsrs' });
  const [open, setOpen] = useState(false);
  const cur = s.newPerDay;
  const rows = useMemo(() => {
    if (!open || !cards || !memories) return null;
    const w = validWeights(s.fsrsWeights);
    const steps = stepCounts(s.learningSteps);
    const newAvailable = new Set(cards.filter((c) => c.state === 'new' && !c.suspended).map((c) => c.noteId)).size;
    const today = studyDay(Date.now(), s.dayStartHour);
    const options = [...new Set([0, 10, 20, 30, 50, cur])].sort((a, b) => a - b);
    return {
      newAvailable,
      list: options.map((n) => ({ n, ...simulate({ cards, memories, weights: w, retention: s.desiredRetention, ...steps, maxInterval: s.maxInterval, today, dayStartHour: s.dayStartHour, days: 30, newPerDay: n, newAvailable }) })),
    };
  }, [open, cards, memories, s.fsrsWeights, s.desiredRetention, s.learningSteps, cur, s.maxInterval, s.dayStartHour]);
  // 每张卡的用时：最近的作答用时中位数（超过 3 分钟的不算）
  const sec = useMemo(() => {
    const xs = (logs ?? []).map((l) => l.elapsedMs ?? 0).filter((x) => x > 0 && x < 180_000).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] / 1000 : 10;
  }, [logs]);
  return (
    <SetRow stack label="负荷预测" hint={`按 FSRS 模拟未来 30 天每天要复习多少次（含学习步骤和重学），用时按你的作答中位数 ${sec.toFixed(1)} 秒 / 次估算。只用来比较量级`}>
      {!open ? <button type="button" className="pill" onClick={() => setOpen(true)}>计算</button> : !rows ? <span className="muted small">计算中…</span> : (
        <div className="forecast-box">
          <table className="stat-table">
            <thead><tr><th>每天新卡</th><th>平均每天复习</th><th>最多的一天</th><th>每天约用时</th><th>新卡学完</th></tr></thead>
            <tbody>
              {rows.list.map((r) => (
                <tr key={r.n} className={r.n === cur ? 'is-cur' : ''}>
                  <td>{r.n}{r.n === cur ? '（当前）' : ''}</td>
                  <td>{r.avg}</td>
                  <td>{r.peak}</td>
                  <td>{Math.round((r.avg * sec) / 60)} 分钟</td>
                  <td>{r.n ? `约 ${Math.ceil(rows.newAvailable / r.n)} 天` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="muted small">待学新卡 {rows.newAvailable} 条笔记。改了目标保持率、FSRS 参数、学习步骤，表会跟着变</span>
        </div>
      )}
    </SetRow>
  );
}

/** 拆分比例、最近天数，以及按当前设置每天大约怎么分 */
function SplitRows({ s }: { s: Settings }) {
  const notes = useNotes();
  const cards = useCards();
  const per = s.newPerDay;
  const fresh = Math.round((per * s.freshShare) / 100);
  const label = s.newSplit === 'source' ? ['挖矿卡', '词表卡'] : ['最近添加', '更早添加'];
  // 待学新卡里各有多少条笔记（同一条笔记一天只出一张，所以按笔记算）
  let counts: [number, number] | null = null;
  if (notes && cards) {
    const newNotes = new Set(cards.filter((c) => c.state === 'new' && !c.deleted && !c.suspended).map((c) => c.noteId));
    const from = Date.now() - Math.max(1, s.freshDays) * 86_400_000;
    counts = [0, 0];
    for (const n of notes) {
      if (n.deleted || !newNotes.has(n.id)) continue;
      const isFresh = s.newSplit === 'source' ? noteOrigin(n) === 'mined' : fromIso(n.createdAt) >= from;
      counts[isFresh ? 0 : 1]++;
    }
  }
  return (
    <>
      <Field k="freshShare" s={s} label={`${label[0]}占比`} hint={`每天约 ${fresh} 张${label[0]} + ${per - fresh} 张${label[1]}${counts ? `；待学：${label[0]} ${counts[0]} 条 · ${label[1]} ${counts[1]} 条` : ''}`} />
      {s.newSplit === 'recent' && <Field k="freshDays" s={s} />}
    </>
  );
}

/** 分散积压：把今天之前就到期的复习卡摊到未来 N 天 */
function Backlog({ s }: { s: Settings }) {
  const cards = useCards();
  const [days, setDays] = useState('10');
  const todayStart = dayStartMs(studyDay(Date.now(), s.dayStartHour), s.dayStartHour);
  const n = cards?.filter((c) => c.state === 'review' && !c.suspended && fromIso(c.due) < todayStart).length ?? 0;
  const d = Math.floor(Number(days));
  const run = async () => {
    if (!(d >= 1)) return toast('天数至少 1', true);
    if (!window.confirm(`把 ${n} 张积压的复习卡分散到今天起 ${d} 天内（每天约 ${Math.ceil(n / d)} 张）？间隔和倍率不变。`)) return;
    toast(`已分散 ${await spreadBacklog(d)} 张`);
  };
  return (
    <SetRow label={<>分散积压 · 积压的复习卡 <b className="accent">{n}</b> 张</>}
      hint="把今天之前就到期、还没复习的卡均匀改到未来几天到期，遗忘次数多、倍率低的排在前面。只改到期日，不改间隔和倍率">
      <span className="num-unit">
        <input type="number" min={1} aria-label="分散到几天" value={days} onChange={(e) => setDays(e.target.value)} /><em>天</em>
      </span>
      <button type="button" className="btn" disabled={!n} onClick={() => void run()}>分散</button>
    </SetRow>
  );
}

/* ---------------- 界面 ---------------- */

function UiSection({ s }: { s: Settings }) {
  return (
    <section id="ui">
      <SectionHead title="界面">
        <ResetDefaults s={s} keys={['genderDisplay', 'clozeLetters', 'addShowMore', 'knownTop']} />
      </SectionHead>
      <h3 className="set-sub">卡片</h3>
      <Field k="genderDisplay" s={s} />
      <Field k="clozeLetters" s={s} />
      <h3 className="set-sub">添加与挖词</h3>
      <Field k="addShowMore" s={s} />
      <Field k="knownTop" s={s} />
    </section>
  );
}

/* ---------------- 危险操作 ---------------- */

function DangerSection() {
  const [clearText, setClearText] = useState('');
  return (
    <section id="danger" className="is-danger">
      <h2>危险操作</h2>
      <SetRow label="清空本地数据" hint={'删除这台设备上的所有笔记、卡片、日志和设置；GitHub 同步设置和仓库里的数据保留。输入"清空"确认'}>
        <input value={clearText} onChange={(e) => setClearText(e.target.value)} placeholder="清空" aria-label="输入清空确认" style={{ width: '6rem' }} />
        <button type="button" className="btn is-danger" disabled={clearText !== '清空'} onClick={() => void clearAllLocalData().then(() => { setClearText(''); toast('本地数据已清空'); })}>清空</button>
      </SetRow>
    </section>
  );
}
