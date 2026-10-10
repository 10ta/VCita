import { useEffect, useRef, useState } from 'react';
import { useCards, useSettings } from '../../db/hooks';
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

type NumKey = 'newPerDay' | 'reviewsPerDay' | 'graduatingInterval' | 'easyInterval' | 'startingEase' | 'hardFactor' | 'easyBonus' | 'lapseFactor' | 'overdueBonusMaxDays' | 'leechThreshold' | 'dayStartHour';
const NUMS: Array<[NumKey, string, string]> = [
  ['newPerDay', '每日新卡上限', ''],
  ['reviewsPerDay', '每日复习上限', '0 = 不限'],
  ['graduatingInterval', '毕业间隔（天）', '学习步骤走完后的第一个间隔'],
  ['easyInterval', '"容易"毕业间隔（天）', ''],
  ['startingEase', '初始倍率', '新卡的 ease，最低 1.3'],
  ['hardFactor', '"困难"间隔倍数', ''],
  ['easyBonus', '"容易"奖励倍数', ''],
  ['lapseFactor', '遗忘后间隔倍数', '忘了之后：新间隔 = 原间隔 × 它，最少 1 天'],
  ['overdueBonusMaxDays', '逾期加成上限（天）', '逾期后答对，因逾期多给的天数最多这么多，0 = 不加成'],
  ['leechThreshold', '顽固卡阈值（遗忘次数）', '达到后自动暂停，0 = 不暂停'],
  ['dayStartHour', '每日切换时间（点）', '在这之前学习仍算前一天'],
];
const parseSteps = (s: string) => s.split(/[\s,，]+/).filter(Boolean).map(Number).filter((n) => n > 0);

export function SettingsPage() {
  const s = useSettings();
  if (!s) return null;
  return (
    <div className="page settings">
      <section>
        <h2>语言</h2>
        <div className="row">
          {(['sourceLang', 'targetLang1', 'targetLang2'] as const).map((k, i) => (
            <label key={k} className="field"><span className="field-label">{['学习语言', '翻译 1', '翻译 2'][i]}</span>
              <select value={s[k]} onChange={(e) => void updateSettings({ [k]: e.target.value })}>
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
          ))}
        </div>
        <p className="hint">新词按这里的设置自动翻译；复习时的题面在复习页顶部切换。</p>
      </section>
      <section>
        <h2>添加</h2>
        <label className="toggle"><input type="checkbox" checked={s.addShowMore} onChange={(e) => void updateSettings({ addShowMore: e.target.checked })} />
          <span>默认展开"更多字段"<small>添加页里的例句、词族线索、出处、补充。关闭后需要时点"更多字段"展开</small></span></label>
      </section>
      <section>
        <h2>挖空卡</h2>
        <label className="toggle"><input type="checkbox" checked={s.clozeLetters} onChange={(e) => void updateSettings({ clozeLetters: e.target.checked })} />
          <span>横线处显示首字母和字母数<small>例如 s _ _ _ _ _ _ _。横线处的中文提示在编辑笔记的"挖空提示"里填，没填时正面显示中文意思</small></span></label>
      </section>
      <SrsForm s={s} />
      <SyncSection />
      <DataSection />
    </div>
  );
}

function SrsForm({ s }: { s: Settings }) {
  const [f, setF] = useState(() => ({ ...s, learning: s.learningSteps.join(' '), relearn: s.relearnSteps.join(' ') }));
  useEffect(() => setF({ ...s, learning: s.learningSteps.join(' '), relearn: s.relearnSteps.join(' ') }), [s]);
  const save = async () => {
    const patch: Partial<Settings> = { fuzz: f.fuzz, newReviewOrder: f.newReviewOrder, reviewSort: f.reviewSort, learningSteps: parseSteps(f.learning), relearnSteps: parseSteps(f.relearn) };
    for (const [k] of NUMS) patch[k] = Number(f[k]);
    try {
      await updateSettings(patch);
      toast('复习参数已保存');
    } catch {
      toast('有参数不合法，请检查', true);
    }
  };
  return (
    <section>
      <h2>复习</h2>
      <div className="grid2">
        <label className="field"><span className="field-label">新卡出现时机</span>
          <select value={f.newReviewOrder} onChange={(e) => setF({ ...f, newReviewOrder: e.target.value as Settings['newReviewOrder'] })}>
            <option value="mix">穿插在复习中</option>
            <option value="after">复习完再出</option>
          </select><small className="muted">穿插：复习积压时新卡也照常出现</small></label>
        <label className="field"><span className="field-label">复习卡顺序</span>
          <select value={f.reviewSort} onChange={(e) => setF({ ...f, reviewSort: e.target.value as Settings['reviewSort'] })}>
            <option value="overdue">相对逾期（最可能忘的先出）</option>
            <option value="due">按到期时间</option>
          </select><small className="muted">相对逾期 = 逾期天数 ÷ 间隔</small></label>
        {NUMS.map(([k, label, hint]) => (
          <label key={k} className="field" title={hint}><span className="field-label">{label}</span>
            <input type="number" step="any" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value as unknown as number })} />
            {hint && <small className="muted">{hint}</small>}
          </label>
        ))}
        <label className="field"><span className="field-label">学习步骤（分钟，空格分隔）</span>
          <input value={f.learning} onChange={(e) => setF({ ...f, learning: e.target.value })} /><small className="muted">默认 10 1440（10 分钟、1 天）</small></label>
        <label className="field"><span className="field-label">重学步骤（分钟）</span>
          <input value={f.relearn} onChange={(e) => setF({ ...f, relearn: e.target.value })} /><small className="muted">默认 10</small></label>
      </div>
      <label className="toggle"><input type="checkbox" checked={f.fuzz} onChange={(e) => setF({ ...f, fuzz: e.target.checked })} />
        <span>间隔随机扰动 ±5%<small>避免同一天加的卡永远挤在同一天到期</small></span></label>
      <div className="row"><button type="button" className="btn is-primary" onClick={() => void save()}>保存复习参数</button></div>
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
    <div className="backlog" style={{ marginTop: "1.5rem" }}>
      <h3>分散积压</h3>
      <p className="hint">今天之前就到期、还没复习的卡：<b>{n}</b> 张。可以一次性把它们均匀改到未来几天到期，遗忘次数多、倍率低的排在前面。只改到期日，不改间隔和倍率。</p>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ maxWidth: '10rem' }}><span className="field-label">分散到几天</span>
          <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} /></label>
        <button type="button" className="btn" disabled={!n} onClick={() => void run()}>分散积压</button>
      </div>
    </div>
  );
}

function DataSection() {
  const bundleRef = useRef<HTMLInputElement>(null);
  const legacyRef = useRef<HTMLInputElement>(null);
  const [legacy, setLegacy] = useState<LegacyBackup | null>(null);
  const [clearText, setClearText] = useState('');
  const pick = (ref: React.RefObject<HTMLInputElement | null>) => ref.current?.click();
  return (
    <section>
      <h2>数据</h2>
      <p className="hint">数据保存在这台设备的浏览器里（IndexedDB）。连接 GitHub 后会同步到私有仓库；也可以手动导出一个 JSON 备份。</p>
      <div className="row">
        <button type="button" className="btn" onClick={() => void exportBundle().then((b) => downloadJson(b, `vcita-${fileStamp(Date.now())}.json`))}>导出备份</button>
        <button type="button" className="btn" onClick={() => pick(bundleRef)}>导入备份</button>
        <button type="button" className="btn" onClick={() => pick(legacyRef)}>导入旧版备份</button>
      </div>
      <input ref={bundleRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file) return;
        try {
          const r = await importBundle(await readJsonFile(file));
          toast(`导入完成：笔记新增 ${r.notes.added}、更新 ${r.notes.updated}`);
        } catch (err) { toast((err as Error).message, true); }
      }} />
      <input ref={legacyRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file) return;
        try { setLegacy(readLegacyBackup(await readJsonFile(file))); } catch (err) { toast((err as Error).message, true); }
      }} />
      {legacy && <LegacyImport backup={legacy} onClose={() => setLegacy(null)} onDone={(m) => { setLegacy(null); toast(m); }} />}
      <div className="danger-zone">
        <p className="hint">清空本地数据：删除这台设备上的所有笔记、卡片、日志和设置；GitHub 同步设置和仓库里的数据保留。输入"清空"确认。</p>
        <div className="row">
          <input value={clearText} onChange={(e) => setClearText(e.target.value)} placeholder="清空" style={{ maxWidth: '8rem' }} />
          <button type="button" className="btn is-danger" disabled={clearText !== '清空'} onClick={() => void clearAllLocalData().then(() => { setClearText(''); toast('本地数据已清空'); })}>清空本地数据</button>
        </div>
      </div>
    </section>
  );
}
