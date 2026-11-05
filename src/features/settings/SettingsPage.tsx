import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAllLogs, useCards, useDecks, useMemories, useNotes, useSettings } from '../../db/hooks';
import { FSRS6_DEFAULT, validWeights } from '../../srs/fsrs';
import { simulate, stepCounts } from '../../srs/simulate';
import { clearAllLocalData, spreadBacklog, updateSettings } from '../../db/actions';
import { exportBundle, importBundle } from '../../io/bundle';
import { downloadJson, readJsonFile } from '../../io/download';
import { dayStartMs, deviceTimeZone, fileStamp, fromIso, studyDay } from '../../lib/time';
import { SyncSection } from '../../sync/SyncSection';
import { LANGS } from '../../ui/langs';
import { toast } from '../../ui/toast';
import { THEMES, noteOrigin } from '../../schema';
import type { Settings } from '../../schema';
import { DeckSection } from './DeckSection';
import { genderDisplayOf, type GenderDisplay } from '../FrText';
import { Modal } from '../../ui/Modal';

/** 设置页的分类，顺序即页面顺序：常用的在上面 */
const SECTIONS = [
  { id: 'data', label: '数据' },
  { id: 'decks', label: '牌组' },
  { id: 'srs', label: '复习' },
  { id: 'sync', label: '同步' },
  { id: 'ui', label: '界面' },
  { id: 'danger', label: '危险操作' },
] as const;

/** #/settings?s=decks → 打开后滚动到对应分类 */
const targetFromHash = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('s');

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
          <button key={x.id} type="button" className={`set-tab${active === x.id ? ' is-on' : ''}${x.id === 'danger' ? ' is-danger' : ''}`}
            onClick={() => document.getElementById(x.id)?.scrollIntoView({ behavior: 'smooth' })}>{x.label}</button>
        ))}
      </nav>
      <DataSection />
      <DeckSection />
      <SrsForm s={s} />
      <SyncSection />
      <UiSection s={s} />
      <DangerSection />
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

/** 一行设置：左边名称和说明，右边控件 */
/** stack：控件太宽（一排主题等）时放到说明下面，不跟左边抢宽度 */
export function SetRow({ label, hint, children, stack }: { label: ReactNode; hint?: ReactNode; children: ReactNode; stack?: boolean }) {
  return (
    <div className={`set-row${stack ? ' is-stack' : ''}`}>
      <div className="set-text"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <input type="checkbox" role="switch" className="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />;
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
        <small>也可以把备份 JSON 文件拖到这里。导入按"较新者胜出"逐条合并，可以重复导入。</small>
      </div>
      <SetRow label="导出备份" hint={decks && notes && cards ? `本机：${decks.length} 个牌组 · ${notes.length} 条笔记 · ${cards.length} 张卡` : '数据保存在这台设备的浏览器里'}>
        <button type="button" className="btn" onClick={() => void exportBundle().then((b) => downloadJson(b, `vcita-${fileStamp(Date.now())}.json`))}>导出 JSON</button>
      </SetRow>
      <input ref={bundleRef} type="file" accept=".json,application/json" hidden onChange={(e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) void importFile(file);
      }} />
      {pasting && <PasteBox onClose={() => setPasting(false)} />}
    </section>
  );
}

/* ---------------- 复习 ---------------- */

type NumKey = 'newPerDay' | 'frameNewPerDay' | 'reviewsPerDay' | 'graduatingInterval' | 'easyInterval' | 'startingEase' | 'hardFactor' | 'easyBonus' | 'lapseFactor' | 'overdueBonusMaxDays' | 'leechThreshold';
type Num = [NumKey, string, string, string?];
const DAILY: Num[] = [
  ['newPerDay', '每日新卡上限', '', '张'],
  ['frameNewPerDay', '其中句框卡最多', '语块库的新句框卡每天最多出几张，占用上面的新卡名额，没用完的给单词', '张'],
  ['reviewsPerDay', '每日复习上限', '0 = 不限（推荐）。到期的复习拖到明天会更难记、越积越多；量大时减少每日新卡', '张'],
];
const INTERVALS: Num[] = [
  ['graduatingInterval', '毕业间隔', '学习步骤走完后的第一个间隔', '天'],
  ['easyInterval', '"容易"毕业间隔', '新卡直接按"容易"时的间隔', '天'],
  ['startingEase', '初始倍率', '新卡的 ease，最低 1.3', '×'],
  ['hardFactor', '"困难"间隔倍数', '', '×'],
  ['easyBonus', '"容易"奖励倍数', '', '×'],
];
const LAPSES: Num[] = [
  ['lapseFactor', '遗忘后间隔倍数', '忘了之后：新间隔 = 原间隔 × 它，最少 1 天', '×'],
  ['overdueBonusMaxDays', '逾期加成上限', '逾期后答对，因逾期多给的天数最多这么多，0 = 不加成', '天'],
  ['leechThreshold', '顽固卡阈值', '遗忘这么多次后自动暂停（待改造），0 = 不暂停', '次'],
];
const ALL_NUMS = [...DAILY, ...INTERVALS, ...LAPSES];
const parseSteps = (s: string) => s.split(/[\s,，]+/).filter(Boolean).map(Number).filter((n) => n > 0);

/** 时区列表：常用的放前面，其余按字母 */
const COMMON_ZONES = ['Asia/Shanghai', 'Europe/Paris', 'America/Toronto', 'America/Montreal', 'America/New_York', 'America/Vancouver', 'UTC'];
function zoneOptions(): string[] {
  let all: string[] = [];
  try { all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { /* 旧浏览器 */ }
  return [...COMMON_ZONES, ...all.filter((z) => !COMMON_ZONES.includes(z))];
}

type Form = Settings & { learning: string; relearn: string; retentionPct: string; weights: string };
const toForm = (s: Settings): Form => ({
  ...s, learning: s.learningSteps.join(' '), relearn: s.relearnSteps.join(' '),
  retentionPct: String(Math.round(s.desiredRetention * 100)), weights: s.fsrsWeights?.join(', ') ?? '',
});
/** 粘贴的 FSRS 参数：空 = 默认；逗号 / 空格分隔的 21 个数（Anki 里复制出来的格式也行） */
const parseWeights = (x: string): number[] | null => {
  const ns = x.split(/[\s,，]+/).filter(Boolean).map(Number);
  return ns.length ? ns : null;
};
function toPatch(f: Form): Partial<Settings> {
  const patch: Partial<Settings> = { scheduler: f.scheduler, desiredRetention: Number(f.retentionPct) / 100, fsrsWeights: parseWeights(f.weights), fuzz: f.fuzz, dayStartHour: Number(f.dayStartHour), timeZone: f.timeZone || null, newReviewOrder: f.newReviewOrder, reviewSort: f.reviewSort, newSort: f.newSort, focusTags: f.focusTags, newSplit: f.newSplit, freshShare: Number(f.freshShare), freshDays: Number(f.freshDays), learningSteps: parseSteps(f.learning), relearnSteps: parseSteps(f.relearn) };
  for (const [k] of ALL_NUMS) patch[k] = Number(f[k]);
  return patch;
}

function SrsForm({ s }: { s: Settings }) {
  const [f, setF] = useState(() => toForm(s));
  useEffect(() => setF(toForm(s)), [s]);
  const patch = toPatch(f);
  const dirty = Object.entries(patch).some(([k, v]) => JSON.stringify(v) !== JSON.stringify(s[k as keyof Settings]));
  const save = async () => {
    try {
      await updateSettings(patch);
      toast('复习参数已保存');
    } catch {
      toast('有参数不合法，请检查', true);
    }
  };
  const num = ([k, label, hint, unit]: Num) => (
    <SetRow key={k} label={label} hint={hint}>
      <span className="num-unit">
        <input type="number" step="any" aria-label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value as unknown as number })} />
        {unit && <em>{unit}</em>}
      </span>
    </SetRow>
  );
  return (
    <section id="srs">
      <h2>复习</h2>
      <h3 className="set-sub">每日安排</h3>
      {DAILY.map(num)}
      <SetRow label="每日切换时间" hint={`在这之前学习仍算前一天。时区：${f.timeZone ? f.timeZone : `跟随设备（${deviceTimeZone()}）`}`}>
        <span className="row">
          <select aria-label="每日切换时间" value={f.dayStartHour} onChange={(e) => setF({ ...f, dayStartHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
          <select aria-label="时区" value={f.timeZone ?? ''} onChange={(e) => setF({ ...f, timeZone: e.target.value || null })} style={{ maxWidth: 230 }}>
            <option value="">跟随设备（{deviceTimeZone()}）</option>
            {zoneOptions().map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </span>
      </SetRow>
      <Forecast s={s} f={f} />
      <SetRow label="新卡出现时机" hint="穿插：复习积压时新卡也照常出现">
        <select value={f.newReviewOrder} onChange={(e) => setF({ ...f, newReviewOrder: e.target.value as Settings['newReviewOrder'] })}>
          <option value="mix">穿插在复习中</option>
          <option value="after">复习完再出</option>
        </select>
      </SetRow>
      <SetRow label="新卡顺序" hint="核心 = 要用出来的词（有产出卡）。常用度按 Lexique 词频（法语电影字幕 + 书籍，每百万词出现次数）；短语看其中最不常用的词。挖矿卡那一份额度不受影响，照样越新越先出">
        <select value={f.newSort} onChange={(e) => setF({ ...f, newSort: e.target.value as Settings['newSort'] })}>
          <option value="layer">重点主题 → 核心 → 中频，同层常用词先出</option>
          <option value="freq">重点主题 → 常用词先出（不分层）</option>
          <option value="created">按添加时间</option>
        </select>
      </SetRow>
      {f.newSort !== 'created' && (
        <SetRow stack label="重点主题" hint="这些主题的新卡最先出，例如考试写作里容易卡住的主题。不选 = 不区分主题">
          <div className="chips">
            {THEMES.map((t) => {
              const on = f.focusTags.includes(t);
              return <button key={t} type="button" className={`chip${on ? ' is-on' : ''}`} aria-pressed={on}
                onClick={() => setF({ ...f, focusTags: on ? f.focusTags.filter((x) => x !== t) : [...f.focusTags, t] })}>{t}</button>;
            })}
          </div>
        </SetRow>
      )}
      <SetRow label="新卡额度拆分" hint="把每日新卡上限分成两份，一份留给新鲜的卡（越新越先出），另一份按上面的顺序消化积压；一份用不完的让给另一份">
        <select value={f.newSplit} onChange={(e) => setF({ ...f, newSplit: e.target.value as Settings['newSplit'] })}>
          <option value="source">按来源：挖矿卡 / 词表卡</option>
          <option value="recent">按添加时间：最近几天 / 更早</option>
          <option value="off">不拆分</option>
        </select>
      </SetRow>
      {f.newSplit !== 'off' && <SplitRows f={f} setF={setF} />}
      <SetRow label="复习卡顺序" hint="相对逾期 = 逾期天数 ÷ 间隔">
        <select value={f.reviewSort} onChange={(e) => setF({ ...f, reviewSort: e.target.value as Settings['reviewSort'] })}>
          <option value="overdue">相对逾期（最可能忘的先出）</option>
          <option value="due">按到期时间</option>
        </select>
      </SetRow>

      <h3 className="set-sub">调度算法</h3>
      <SetRow label="算法" hint="FSRS：按「到期时还记得的概率」排期，参数可以用自己的复习记录优化（Anki 23.10 起的默认算法）。SM-2：旧算法，间隔 = 上次间隔 × 倍率">
        <select value={f.scheduler} onChange={(e) => setF({ ...f, scheduler: e.target.value as Settings['scheduler'] })}>
          <option value="fsrs">FSRS-6（推荐）</option>
          <option value="sm2">SM-2</option>
        </select>
      </SetRow>
      {f.scheduler === 'fsrs' && (
        <>
          <SetRow label="目标保持率" hint="到期时还记得的概率。90% 是常用的平衡点；调高复习量增长很快（95% 约是 90% 的两倍），调低忘得多">
            <span className="num-unit">
              <input type="number" min={70} max={99} aria-label="目标保持率" value={f.retentionPct} onChange={(e) => setF({ ...f, retentionPct: e.target.value })} /><em>%</em>
            </span>
          </SetRow>
          <SetRow stack label="FSRS 参数" hint="21 个数，逗号分隔；留空 = 默认参数。用自己的复习记录优化出来的参数预测更准（把导出的备份交给 Claude 优化，或者从 Anki 复制）。改了参数立刻对所有卡生效，不用迁移">
            <textarea className="weights" rows={3} aria-label="FSRS 参数" placeholder={FSRS6_DEFAULT.join(', ')} value={f.weights} onChange={(e) => setF({ ...f, weights: e.target.value })} />
            {f.weights.trim() && validWeights(parseWeights(f.weights)) === FSRS6_DEFAULT && <span className="red small">需要 21 个数</span>}
          </SetRow>
          <p className="hint">学习步骤、重学步骤、每日上限照常生效；毕业间隔、倍率、逾期加成这些 SM-2 参数在 FSRS 下不用（逾期由记忆模型自己算进去）。记忆状态每次从复习记录重放，切换算法不改任何已有数据。</p>
        </>
      )}

      <h3 className="set-sub">学习与间隔</h3>
      <SetRow label="学习步骤" hint="分钟，空格分隔；默认 10 1440（10 分钟、1 天）">
        <input className="steps" aria-label="学习步骤" value={f.learning} onChange={(e) => setF({ ...f, learning: e.target.value })} />
      </SetRow>
      {f.scheduler === 'sm2' && INTERVALS.map(num)}
      <SetRow label="间隔随机扰动 ±5%" hint="避免同一天加的卡永远挤在同一天到期">
        <Switch label="间隔随机扰动" checked={f.fuzz} onChange={(v) => setF({ ...f, fuzz: v })} />
      </SetRow>

      <h3 className="set-sub">遗忘</h3>
      <SetRow label="重学步骤" hint="分钟；默认 10">
        <input className="steps" aria-label="重学步骤" value={f.relearn} onChange={(e) => setF({ ...f, relearn: e.target.value })} />
      </SetRow>
      {LAPSES.filter(([k]) => f.scheduler === 'sm2' || k === 'leechThreshold').map(num)}

      <div className={`save-bar${dirty ? ' is-dirty' : ''}`}>
        <span className="muted small">{dirty ? '有未保存的修改' : '参数随同步应用到其他设备'}</span>
        <span className="grow" />
        {dirty && <button type="button" className="btn" onClick={() => setF(toForm(s))}>还原</button>}
        <button type="button" className="btn is-primary" disabled={!dirty} onClick={() => void save()}>保存复习参数</button>
      </div>

      <Backlog s={s} />
    </section>
  );
}

/** 负荷预测：按 FSRS 模拟未来 30 天，比较不同的每日新卡数 */
function Forecast({ s, f }: { s: Settings; f: Form }) {
  const cards = useCards();
  const logs = useAllLogs();
  const memories = useMemories(s.scheduler === 'fsrs' ? s : { ...s, scheduler: 'fsrs' });
  const [open, setOpen] = useState(false);
  const cur = Math.max(0, Math.floor(Number(f.newPerDay)) || 0);
  const rows = useMemo(() => {
    if (!open || !cards || !memories) return null;
    const w = validWeights(parseWeights(f.weights));
    const retention = Math.min(0.99, Math.max(0.7, Number(f.retentionPct) / 100 || 0.9));
    const steps = stepCounts(parseSteps(f.learning));
    const newAvailable = new Set(cards.filter((c) => c.state === 'new' && !c.suspended).map((c) => c.noteId)).size;
    const today = studyDay(Date.now(), s.dayStartHour);
    const options = [...new Set([0, 10, 20, 30, 50, cur])].sort((a, b) => a - b);
    return {
      newAvailable,
      list: options.map((n) => ({ n, ...simulate({ cards, memories, weights: w, retention, ...steps, maxInterval: s.maxInterval, today, dayStartHour: s.dayStartHour, days: 30, newPerDay: n, newAvailable }) })),
    };
  }, [open, cards, memories, f.weights, f.retentionPct, f.learning, cur, s.maxInterval, s.dayStartHour]);
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
          <span className="muted small">待学新卡 {rows.newAvailable} 条笔记。改了目标保持率、参数、学习步骤，表会跟着变（保存前就能比较）</span>
        </div>
      )}
    </SetRow>
  );
}

/** 拆分比例、最近天数，以及按当前设置每天大约怎么分 */
function SplitRows({ f, setF }: { f: Form; setF: (f: Form) => void }) {
  const notes = useNotes();
  const cards = useCards();
  const per = Math.max(0, Math.floor(Number(f.newPerDay)) || 0);
  const share = Math.min(100, Math.max(0, Number(f.freshShare) || 0));
  const fresh = Math.round((per * share) / 100);
  const label = f.newSplit === 'source' ? ['挖矿卡', '词表卡'] : ['最近添加', '更早添加'];
  // 待学新卡里各有多少条笔记（同一条笔记一天只出一张，所以按笔记算）
  let counts: [number, number] | null = null;
  if (notes && cards) {
    const newNotes = new Set(cards.filter((c) => c.state === 'new' && !c.deleted && !c.suspended).map((c) => c.noteId));
    const days = Math.max(1, Math.floor(Number(f.freshDays)) || 1);
    const from = Date.now() - days * 86_400_000;
    counts = [0, 0];
    for (const n of notes) {
      if (n.deleted || !newNotes.has(n.id)) continue;
      const isFresh = f.newSplit === 'source' ? noteOrigin(n) === 'mined' : fromIso(n.createdAt) >= from;
      counts[isFresh ? 0 : 1]++;
    }
  }
  return (
    <>
      <SetRow label={`${label[0]}占比`} hint={`每天约 ${fresh} 张${label[0]} + ${per - fresh} 张${label[1]}${counts ? `；待学：${label[0]} ${counts[0]} 条 · ${label[1]} ${counts[1]} 条` : ''}`}>
        <span className="num-unit">
          <input type="number" min={0} max={100} aria-label={`${label[0]}占比`} value={f.freshShare} onChange={(e) => setF({ ...f, freshShare: e.target.value as unknown as number })} /><em>%</em>
        </span>
      </SetRow>
      {f.newSplit === 'recent' && (
        <SetRow label="最近几天" hint="这几天内添加的新卡算新鲜的">
          <span className="num-unit">
            <input type="number" min={1} aria-label="最近几天" value={f.freshDays} onChange={(e) => setF({ ...f, freshDays: e.target.value as unknown as number })} /><em>天</em>
          </span>
        </SetRow>
      )}
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
    <div className="set-tool">
      <h3 className="set-sub">分散积压</h3>
      <SetRow label={<>积压的复习卡 <b className="accent">{n}</b> 张</>}
        hint="把今天之前就到期、还没复习的卡均匀改到未来几天到期，遗忘次数多、倍率低的排在前面。只改到期日，不改间隔和倍率">
        <span className="num-unit">
          <input type="number" min={1} aria-label="分散到几天" value={days} onChange={(e) => setDays(e.target.value)} /><em>天</em>
        </span>
        <button type="button" className="btn" disabled={!n} onClick={() => void run()}>分散</button>
      </SetRow>
    </div>
  );
}

/* ---------------- 界面 ---------------- */

function KnownTopInput({ value }: { value: number }) {
  const [v, setV] = useState(String(value));
  const commit = () => {
    const n = Math.max(0, Math.round(Number(v)));
    if (Number.isFinite(n) && n !== value) void updateSettings({ knownTop: n });
    else setV(String(value));
  };
  return <input type="number" min={0} step={500} aria-label="常用词前 N 个" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} style={{ width: 110 }} />;
}

function UiSection({ s }: { s: Settings }) {
  return (
    <section id="ui">
      <h2>界面</h2>
      <h3 className="set-sub">语言</h3>
      {(['sourceLang', 'targetLang1', 'targetLang2'] as const).map((k, i) => (
        <SetRow key={k} label={['学习语言', '翻译 1', '翻译 2'][i]} hint={i === 0 ? '新词按这里的设置自动翻译；复习时的题面在复习页顶部切换' : undefined}>
          <select aria-label={['学习语言', '翻译 1', '翻译 2'][i]} value={s[k]} onChange={(e) => void updateSettings({ [k]: e.target.value })}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </SetRow>
      ))}
      <h3 className="set-sub">卡片与添加</h3>
      <SetRow label="挖空卡横线处显示首字母和字母数" hint={'例如 s _ _ _ _ _ _ _。横线处的中文提示在编辑笔记的"挖空提示"里填，没填时正面显示中文意思'}>
        <Switch label="挖空首字母" checked={s.clozeLetters} onChange={(v) => void updateSettings({ clozeLetters: v })} />
      </SetRow>
      <SetRow label="阴阳性下划线" hint="名词下划线：阳性蓝、阴性红。只标考查部分：注意力留在要学的词上，句子其余部分干净；悬停：鼠标移到名词上才出现；关闭：不画线。哪种都能悬停（手机上点一下）看性别、另一个性的形式和词尾规则">
        <select aria-label="阴阳性下划线" value={genderDisplayOf(s)} onChange={(e) => void updateSettings({ genderDisplay: e.target.value as GenderDisplay })}>
          <option value="focus">只标考查部分（推荐）</option>
          <option value="always">所有名词</option>
          <option value="hover">悬停时显示</option>
          <option value="off">关闭（悬停仍显示说明）</option>
        </select>
      </SetRow>
      <h3 className="set-sub">阅读</h3>
      <SetRow label="常用词前 N 个算认识" hint="阅读页里，词频（Lexique）最高的前 N 个原形不标色、算进已知覆盖率。默认 2000；填 0 只按自己的卡和手动标的「认识」">
        <KnownTopInput value={s.knownTop} />
      </SetRow>
      <SetRow label={'添加页默认展开"更多字段"'} hint="例句、词族线索、出处、补充。关闭后需要时点“更多字段”展开">
        <Switch label="默认展开更多字段" checked={s.addShowMore} onChange={(v) => void updateSettings({ addShowMore: v })} />
      </SetRow>
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
