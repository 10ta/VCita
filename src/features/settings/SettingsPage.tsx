import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useCards, useDecks, useNotes, useSettings } from '../../db/hooks';
import { clearAllLocalData, spreadBacklog, updateSettings } from '../../db/actions';
import { exportBundle, importBundle } from '../../io/bundle';
import { readLegacyBackup, type LegacyBackup } from '../../io/legacy';
import { downloadJson, readJsonFile } from '../../io/download';
import { dayStartMs, fileStamp, fromIso, studyDay } from '../../lib/time';
import { SyncSection } from '../../sync/SyncSection';
import { LANGS } from '../../ui/langs';
import { toast } from '../../ui/toast';
import type { Settings } from '../../schema';
import { LegacyImport } from './LegacyImport';
import { DeckSection } from './DeckSection';

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
export function SetRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
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

/** 从剪贴板导入备份 JSON：读不到、不是 JSON、不是备份时只给一条简短提示 */
async function importFromClipboard() {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { return toast('读不到剪贴板（浏览器未授权）', true); }
  let raw: unknown;
  try { raw = JSON.parse(text.trim()); } catch { return toast('剪贴板里没有备份 JSON', true); }
  try {
    toast(importedMsg(await importBundle(raw)));
  } catch { toast('剪贴板里的内容不是 VCita 备份', true); }
}

async function importFile(file: File) {
  try {
    toast(importedMsg(await importBundle(await readJsonFile(file))));
  } catch (err) { toast((err as Error).message, true); }
}

function DataSection() {
  const bundleRef = useRef<HTMLInputElement>(null);
  const legacyRef = useRef<HTMLInputElement>(null);
  const [legacy, setLegacy] = useState<LegacyBackup | null>(null);
  const [over, setOver] = useState(false);
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
          <button type="button" className="btn is-primary" title="复制了备份 JSON 后点这里直接导入" onClick={() => void importFromClipboard()}>从剪贴板导入</button>
        </div>
        <small>也可以把备份 JSON 文件拖到这里。导入按"较新者胜出"逐条合并，可以重复导入。</small>
      </div>
      <SetRow label="导出备份" hint={decks && notes && cards ? `本机：${decks.length} 个牌组 · ${notes.length} 条笔记 · ${cards.length} 张卡` : '数据保存在这台设备的浏览器里'}>
        <button type="button" className="btn" onClick={() => void exportBundle().then((b) => downloadJson(b, `vcita-${fileStamp(Date.now())}.json`))}>导出 JSON</button>
      </SetRow>
      <SetRow label="导入旧版备份" hint="旧版（服务器版）导出的 vocabforge-*.json，导入时选择用户并把标签映射到主题">
        <button type="button" className="btn" onClick={() => legacyRef.current?.click()}>选择文件</button>
      </SetRow>
      <input ref={bundleRef} type="file" accept=".json,application/json" hidden onChange={(e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (file) void importFile(file);
      }} />
      <input ref={legacyRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file) return;
        try { setLegacy(readLegacyBackup(await readJsonFile(file))); } catch (err) { toast((err as Error).message, true); }
      }} />
      {legacy && <LegacyImport backup={legacy} onClose={() => setLegacy(null)} onDone={(m) => { setLegacy(null); toast(m); }} />}
    </section>
  );
}

/* ---------------- 复习 ---------------- */

type NumKey = 'newPerDay' | 'reviewsPerDay' | 'graduatingInterval' | 'easyInterval' | 'startingEase' | 'hardFactor' | 'easyBonus' | 'lapseFactor' | 'overdueBonusMaxDays' | 'leechThreshold' | 'dayStartHour';
type Num = [NumKey, string, string, string?];
const DAILY: Num[] = [
  ['newPerDay', '每日新卡上限', '', '张'],
  ['reviewsPerDay', '每日复习上限', '0 = 不限', '张'],
  ['dayStartHour', '每日切换时间', '在这之前学习仍算前一天', '点'],
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

type Form = Settings & { learning: string; relearn: string };
const toForm = (s: Settings): Form => ({ ...s, learning: s.learningSteps.join(' '), relearn: s.relearnSteps.join(' ') });
function toPatch(f: Form): Partial<Settings> {
  const patch: Partial<Settings> = { fuzz: f.fuzz, newReviewOrder: f.newReviewOrder, reviewSort: f.reviewSort, learningSteps: parseSteps(f.learning), relearnSteps: parseSteps(f.relearn) };
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
      <SetRow label="新卡出现时机" hint="穿插：复习积压时新卡也照常出现">
        <select value={f.newReviewOrder} onChange={(e) => setF({ ...f, newReviewOrder: e.target.value as Settings['newReviewOrder'] })}>
          <option value="mix">穿插在复习中</option>
          <option value="after">复习完再出</option>
        </select>
      </SetRow>
      <SetRow label="复习卡顺序" hint="相对逾期 = 逾期天数 ÷ 间隔">
        <select value={f.reviewSort} onChange={(e) => setF({ ...f, reviewSort: e.target.value as Settings['reviewSort'] })}>
          <option value="overdue">相对逾期（最可能忘的先出）</option>
          <option value="due">按到期时间</option>
        </select>
      </SetRow>

      <h3 className="set-sub">学习与间隔</h3>
      <SetRow label="学习步骤" hint="分钟，空格分隔；默认 10 1440（10 分钟、1 天）">
        <input className="steps" aria-label="学习步骤" value={f.learning} onChange={(e) => setF({ ...f, learning: e.target.value })} />
      </SetRow>
      {INTERVALS.map(num)}
      <SetRow label="间隔随机扰动 ±5%" hint="避免同一天加的卡永远挤在同一天到期">
        <Switch label="间隔随机扰动" checked={f.fuzz} onChange={(v) => setF({ ...f, fuzz: v })} />
      </SetRow>

      <h3 className="set-sub">遗忘</h3>
      <SetRow label="重学步骤" hint="分钟；默认 10">
        <input className="steps" aria-label="重学步骤" value={f.relearn} onChange={(e) => setF({ ...f, relearn: e.target.value })} />
      </SetRow>
      {LAPSES.map(num)}

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
