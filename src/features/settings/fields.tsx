// 设置项：每一项的名称、说明、默认值和控件集中在这里。改了立刻保存（数字和文本在失焦 / 回车时保存），
// 说明末尾自动带上默认值；「恢复默认」按分组把这些项改回默认（先列出会改哪些，确认后才改）
import { useEffect, useState, type ReactNode } from 'react';
import { updateSettings } from '../../db/actions';
import { SettingsV2 } from '../../schema/v2';
import type { Settings } from '../../schema';
import { FSRS6_DEFAULT } from '../../srs/fsrs';
import { genderDisplayOf } from '../FrText';
import { toast } from '../../ui/toast';
import { langLabel } from '../../ui/langs';
import { Modal } from '../../ui/Modal';

/** 所有设置的默认值，直接从 schema 取，和代码里的默认值永远一致 */
export const DEFAULTS: Settings = { ...SettingsV2.parse({ updatedAt: '1970-01-01T00:00:00.000Z' }), genderDisplay: 'focus' };

type Key = keyof Settings;
type Opt = readonly [string, string];
export type Meta =
  | { kind: 'num'; label: string; hint?: string; unit?: string; min?: number; max?: number; int?: boolean; scale?: number; zero?: string }
  | { kind: 'sel'; label: string; hint?: string; options: readonly Opt[] }
  | { kind: 'sw'; label: string; hint?: string }
  | { kind: 'steps'; label: string; hint?: string }
  | { kind: 'other'; label: string; fmt: (v: unknown) => string };

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export const META: Partial<Record<Key, Meta>> = {
  // ---- 每日 ----
  newPerDay: { kind: 'num', label: '每日新卡上限', unit: '张', min: 0, int: true },
  frameNewPerDay: { kind: 'num', label: '其中句框卡最多', hint: '语块库的新句框卡每天最多出几张，占用上面的新卡名额，没用完的给单词', unit: '张', min: 0, int: true },
  reviewsPerDay: { kind: 'num', label: '每日复习上限', hint: '到期的复习拖到明天会更难记、越积越多；量大时减少每日新卡', unit: '张', min: 0, int: true, zero: '不限' },
  dayStartHour: { kind: 'other', label: '每日切换时间', fmt: (v) => hh(v as number) },
  timeZone: { kind: 'other', label: '时区', fmt: (v) => (v as string | null) ?? '跟随设备' },
  // ---- 出卡顺序 ----
  newReviewOrder: { kind: 'sel', label: '新卡出现时机', hint: '穿插：复习积压时新卡也照常出现', options: [['mix', '穿插在复习中'], ['after', '复习完再出']] },
  newSort: {
    kind: 'sel', label: '新卡顺序',
    hint: '核心 = 要用出来的词（有产出卡）。常用度按 Lexique 词频（法语电影字幕 + 书籍，每百万词出现次数）；短语看其中最不常用的词。挖矿卡那一份额度不受影响，照样越新越先出',
    options: [['layer', '重点主题 → 核心 → 中频，同层常用词先出'], ['freq', '重点主题 → 常用词先出（不分层）'], ['created', '按添加时间']],
  },
  focusTags: { kind: 'other', label: '重点主题', fmt: (v) => ((v as string[]).length ? (v as string[]).join('、') : '不区分') },
  newSplit: {
    kind: 'sel', label: '新卡额度拆分', hint: '把每日新卡上限分成两份，一份留给新鲜的卡（越新越先出），另一份按上面的顺序消化积压；一份用不完的让给另一份',
    options: [['source', '按来源：挖矿卡 / 词表卡'], ['recent', '按添加时间：最近几天 / 更早'], ['off', '不拆分']],
  },
  freshShare: { kind: 'num', label: '新鲜那一份的占比', unit: '%', min: 0, max: 100, int: true },
  freshDays: { kind: 'num', label: '最近几天', hint: '这几天内添加的新卡算新鲜的', unit: '天', min: 1, int: true },
  reviewSort: { kind: 'sel', label: '复习卡顺序', hint: '相对逾期 = 逾期天数 ÷ 间隔', options: [['overdue', '相对逾期（最可能忘的先出）'], ['due', '按到期时间']] },
  productionAfterRecognition: { kind: 'sw', label: '产出卡等认读卡学会再出', hint: '同一条笔记的认读卡进入复习（走完学习步骤）以后，才出它的产出卡：先认得，再练写得出，少出现连续忘的顽固卡' },
  // ---- 记忆算法 ----
  scheduler: { kind: 'sel', label: '算法', hint: 'FSRS：按「到期时还记得的概率」排期，参数可以用自己的复习记录优化（Anki 23.10 起的默认算法）。SM-2：旧算法，间隔 = 上次间隔 × 倍率', options: [['fsrs', 'FSRS-6'], ['sm2', 'SM-2']] },
  desiredRetention: { kind: 'num', label: '目标保持率 · 产出类', hint: '产出、挖空、句框、套用：要写得出来的卡，到期时还记得的概率。90% 是常用的平衡点；调高复习量增长很快（95% 约是 90% 的两倍），调低忘得多', unit: '%', min: 70, max: 99, int: true, scale: 100 },
  retentionRecognition: { kind: 'num', label: '目标保持率 · 认读类', hint: '认读（含听力卡）、辨析：认得就行，可以低一点，间隔更长、复习更少', unit: '%', min: 70, max: 99, int: true, scale: 100 },
  fsrsWeights: { kind: 'other', label: 'FSRS 参数', fmt: (v) => (v ? '自己的参数' : '默认参数') },
  implicitRecognitionCredit: { kind: 'sw', label: '产出答对顺带记认读', hint: '写得出来就一定认得：产出卡答「良好 / 容易」时，同一条笔记已在复习中的认读卡记一次「良好」，下次复习往后推（只推后、不提前）。不算进复习数和保持率；撤销时一起撤回' },
  learningSteps: { kind: 'steps', label: '学习步骤', hint: '新卡要按顺序答对这几步才毕业成复习卡。分钟，空格分隔，1440 = 1 天' },
  relearnSteps: { kind: 'steps', label: '重学步骤', hint: '复习卡按「忘了」之后要再答对这几步。分钟，空格分隔' },
  fuzzPercent: { kind: 'other', label: '间隔随机扰动', fmt: (v) => ((v as number) > 0 ? `±${v}%` : '关闭') },
  fuzz: { kind: 'other', label: '间隔随机扰动开关', fmt: (v) => (v ? '开' : '关') },
  leechThreshold: { kind: 'num', label: '顽固卡阈值', hint: '遗忘这么多次后自动暂停（待改造）', unit: '次', min: 0, int: true, zero: '不暂停' },
  graduatingInterval: { kind: 'num', label: '毕业间隔', hint: '学习步骤走完后的第一个间隔', unit: '天', min: 1, int: true },
  easyInterval: { kind: 'num', label: '「容易」毕业间隔', hint: '新卡直接按「容易」时的间隔', unit: '天', min: 1, int: true },
  startingEase: { kind: 'num', label: '初始倍率', hint: '新卡的 ease，最低 1.3', unit: '×', min: 1.3 },
  hardFactor: { kind: 'num', label: '「困难」间隔倍数', unit: '×', min: 0.01 },
  easyBonus: { kind: 'num', label: '「容易」奖励倍数', unit: '×', min: 0.01 },
  lapseFactor: { kind: 'num', label: '遗忘后间隔倍数', hint: '忘了之后：新间隔 = 原间隔 × 它，最少 1 天', unit: '×', min: 0, max: 1 },
  overdueBonusMaxDays: { kind: 'num', label: '逾期加成上限', hint: '逾期后答对，因逾期多给的天数最多这么多', unit: '天', min: 0, int: true, zero: '不加成' },
  // ---- 界面 ----
  sourceLang: { kind: 'other', label: '学习语言', fmt: (v) => langLabel(v as string) },
  targetLang1: { kind: 'other', label: '翻译 1', fmt: (v) => langLabel(v as string) },
  targetLang2: { kind: 'other', label: '翻译 2', fmt: (v) => langLabel(v as string) },
  clozeLetters: { kind: 'sw', label: '挖空卡横线处显示首字母和字母数', hint: '例如 s _ _ _ _ _ _ _。横线处的中文提示在编辑笔记的「挖空提示」里填，没填时正面显示中文意思' },
  genderDisplay: {
    kind: 'sel', label: '阴阳性下划线',
    hint: '名词下划线：阳性蓝、阴性红。只标考查部分：注意力留在要学的词上，句子其余部分干净；悬停：鼠标移到名词上才出现；关闭：不画线。哪种都能悬停（手机上点一下）看性别、另一个性的形式和词尾规则',
    options: [['focus', '只标考查部分'], ['always', '所有名词'], ['hover', '悬停时显示'], ['off', '关闭（悬停仍显示说明）']],
  },
  knownTop: { kind: 'num', label: '常用词前 N 个算认识', hint: '短文挖词里，词频（Lexique）最高的前 N 个原形不算生词、算进已知覆盖率', unit: '个', min: 0, int: true, zero: '只按自己的卡和手动标的「认识」' },
  addShowMore: { kind: 'sw', label: '添加页默认展开「背面补充」', hint: '词源、词族线索、补充、出处。关闭后需要时点「背面补充」展开' },
};

const metaOf = (k: Key) => META[k] ?? ({ kind: 'other', label: String(k), fmt: String } as Meta);

/** 一个值的文字（默认值说明、恢复默认的对比列表都用它） */
export function fmtValue(k: Key, v: unknown): string {
  const m = metaOf(k);
  switch (m.kind) {
    case 'num': {
      const n = Math.round((v as number) * (m.scale ?? 1) * 100) / 100;
      return n === 0 && m.zero ? `0（${m.zero}）` : `${n}${m.unit ? ` ${m.unit}` : ''}`;
    }
    case 'sel': return m.options.find(([x]) => x === v)?.[1] ?? String(v);
    case 'sw': return v ? '开' : '关';
    case 'steps': return `${(v as number[]).join(' ')} 分钟`;
    default: return m.fmt(v);
  }
}
export const defText = (k: Key) => fmtValue(k, DEFAULTS[k]);

/** 一行设置：左边名称、说明（末尾带默认值），右边控件 */
/** stack：控件太宽（一排主题等）时放到说明下面，不跟左边抢宽度 */
export function SetRow({ label, hint, def, children, stack }: { label: ReactNode; hint?: ReactNode; def?: ReactNode; children: ReactNode; stack?: boolean }) {
  return (
    <div className={`set-row${stack ? ' is-stack' : ''}`}>
      <div className="set-text">
        <span>{label}</span>
        {(hint || def) && <small>{hint}{def != null && <span className="set-def">默认：{def}</span>}</small>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <input type="checkbox" role="switch" className="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

/** 保存一项或几项；不合法时提示并返回 false */
export async function save(patch: Partial<Omit<Settings, 'updatedAt'>>): Promise<boolean> {
  try { await updateSettings(patch); return true; } catch { toast('这个值不合法，没有保存', true); return false; }
}

/** 输入框：失焦或回车时保存；不合法就提示并恢复原值 */
function CommitInput({ value, parse, ...rest }: { value: string; parse: (raw: string) => Promise<boolean> } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = async () => { if (v.trim() !== value && !(await parse(v.trim()))) setV(value); };
  return <input {...rest} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => void commit()}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value); (e.target as HTMLInputElement).blur(); } }} />;
}

function NumCtl({ k, s }: { k: Key; s: Settings }) {
  const m = metaOf(k);
  if (m.kind !== 'num') return null;
  const scale = m.scale ?? 1;
  const shown = String(Math.round((s[k] as number) * scale * 100) / 100);
  return (
    <span className="num-unit">
      <CommitInput type="number" step="any" min={m.min} max={m.max} aria-label={m.label} value={shown} parse={async (raw) => {
        const n = Number(raw);
        if (raw === '' || !Number.isFinite(n) || (m.int && !Number.isInteger(n)) || (m.min != null && n < m.min) || (m.max != null && n > m.max)) {
          toast(`${m.label}：${m.int ? '整数，' : ''}${m.min != null ? `最小 ${m.min}` : ''}${m.max != null ? `，最大 ${m.max}` : ''}`, true);
          return false;
        }
        return save({ [k]: n / scale });
      }} />
      {m.unit && <em>{m.unit}</em>}
    </span>
  );
}

const parseSteps = (x: string) => x.split(/[\s,，]+/).filter(Boolean).map(Number);

/** 按 META 渲染一行：数字 / 下拉 / 开关 / 步骤 */
export function Field({ k, s, hint, label }: { k: Key; s: Settings; hint?: ReactNode; label?: string }) {
  const m = metaOf(k);
  const h = hint ?? ('hint' in m ? m.hint : undefined);
  let ctl: ReactNode = null;
  if (m.kind === 'num') ctl = <NumCtl k={k} s={s} />;
  else if (m.kind === 'sel') {
    const cur = k === 'genderDisplay' ? genderDisplayOf(s) : (s[k] as string);
    ctl = (
      <select aria-label={m.label} value={cur} onChange={(e) => void save({ [k]: e.target.value })}>
        {m.options.map(([v, l]) => <option key={v} value={v}>{l}{v === DEFAULTS[k] ? '（默认）' : ''}</option>)}
      </select>
    );
  } else if (m.kind === 'sw') ctl = <Switch label={m.label} checked={!!s[k]} onChange={(v) => void save({ [k]: v })} />;
  else if (m.kind === 'steps') {
    ctl = <CommitInput className="steps" aria-label={m.label} value={(s[k] as number[]).join(' ')} parse={async (raw) => {
      const xs = parseSteps(raw);
      if (!xs.length || xs.some((x) => !(x > 0))) { toast(`${m.label}：至少一个大于 0 的分钟数，空格分隔`, true); return false; }
      return save({ [k]: xs });
    }} />;
  }
  return <SetRow label={label ?? m.label} hint={h} def={defText(k)}>{ctl}</SetRow>;
}

/** 间隔随机扰动：± 百分比，0 = 关闭 */
export function FuzzField({ s }: { s: Settings }) {
  const cur = s.fuzz ? s.fuzzPercent : 0;
  return (
    <SetRow label="间隔随机扰动" hint="复习间隔随机加减这么多，避免同一天加的卡永远挤在同一天到期。3 天以下的间隔不扰动，至少 ±1 天；0 = 关闭" def={`±${DEFAULTS.fuzzPercent}%`}>
      <span className="num-unit">
        <em>±</em>
        <CommitInput type="number" step="any" min={0} max={50} aria-label="间隔随机扰动" value={String(cur)} parse={async (raw) => {
          const n = Number(raw);
          if (raw === '' || !Number.isFinite(n) || n < 0 || n > 50) { toast('间隔随机扰动：0–50 之间的百分比', true); return false; }
          return save(n > 0 ? { fuzz: true, fuzzPercent: n } : { fuzz: false });
        }} />
        <em>%</em>
      </span>
    </SetRow>
  );
}

/** FSRS 参数：失焦时保存；空 = 默认参数；需要 21 个数（Anki 里复制出来的格式也行） */
export function WeightsField({ s }: { s: Settings }) {
  const value = s.fsrsWeights?.join(', ') ?? '';
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const ns = v.split(/[\s,，]+/).filter(Boolean).map(Number);
  const bad = ns.length > 0 && (ns.length !== 21 || ns.some((x) => !Number.isFinite(x)));
  const commit = () => {
    if (bad) return;
    const next = ns.length ? ns : null;
    if (JSON.stringify(next) !== JSON.stringify(s.fsrsWeights)) void save({ fsrsWeights: next });
  };
  return (
    <SetRow stack label="FSRS 参数" hint="21 个数，逗号分隔；留空 = 默认参数。用自己的复习记录优化出来的参数预测更准（把导出的备份交给 Claude 优化，或者从 Anki 复制）。改了参数立刻对所有卡生效，不用迁移" def="默认参数（留空）">
      <textarea className="weights" rows={3} aria-label="FSRS 参数" placeholder={FSRS6_DEFAULT.join(', ')} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} />
      {bad && <span className="red small">需要 21 个数，改好之前不会保存</span>}
    </SetRow>
  );
}

/** 恢复默认：列出这一组里和默认值不同的项，确认后改回默认 */
export function ResetDefaults({ s, keys, note }: { s: Settings; keys: Key[]; note?: string }) {
  const [open, setOpen] = useState(false);
  const cur = (k: Key) => (k === 'genderDisplay' ? genderDisplayOf(s) : s[k]);
  const diffs = keys.filter((k) => JSON.stringify(cur(k)) !== JSON.stringify(DEFAULTS[k]));
  // 扰动的开关和幅度合成一行显示
  const rows = diffs.filter((k) => k !== 'fuzz').map((k) => (k === 'fuzzPercent'
    ? { k, label: '间隔随机扰动', from: s.fuzz ? `±${s.fuzzPercent}%` : '关闭', to: `±${DEFAULTS.fuzzPercent}%` }
    : { k, label: metaOf(k).label, from: fmtValue(k, cur(k)), to: defText(k) }));
  const visible = diffs.includes('fuzz') && !diffs.includes('fuzzPercent') ? [...rows, { k: 'fuzz' as Key, label: '间隔随机扰动', from: '关闭', to: `±${DEFAULTS.fuzzPercent}%` }] : rows;
  const apply = async () => {
    const patch = Object.fromEntries(diffs.map((k) => [k, DEFAULTS[k]])) as Partial<Settings>;
    if (await save(patch)) { setOpen(false); toast(`已恢复 ${visible.length} 项默认值`); }
  };
  return (
    <>
      <button type="button" className="pill set-reset" disabled={!diffs.length} title={diffs.length ? `${visible.length} 项和默认值不同` : '都是默认值'} onClick={() => setOpen(true)}>恢复默认</button>
      {open && (
        <Modal title="恢复默认值" onClose={() => setOpen(false)} footer={<>
          <button type="button" className="btn" onClick={() => setOpen(false)}>取消</button>
          <button type="button" className="btn is-primary" onClick={() => void apply()}>确认恢复</button>
        </>}>
          <p>下面 {visible.length} 项会改回默认值：</p>
          <table className="stat-table reset-table">
            <thead><tr><th>设置</th><th>现在</th><th>默认</th></tr></thead>
            <tbody>{visible.map((r) => <tr key={r.k}><td>{r.label}</td><td>{r.from}</td><td>{r.to}</td></tr>)}</tbody>
          </table>
          {note && <p className="muted small">{note}</p>}
        </Modal>
      )}
    </>
  );
}

/** 分组标题：左边标题，右边「恢复默认」 */
export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="set-head"><h2>{title}</h2>{children}</div>;
}
