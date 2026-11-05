// 阅读页：粘贴文章或导入字幕 / Markdown，按自己的词汇标色，算已知覆盖率；点词（或选中）查词、摘句。
// 对应手册的精读：85–90% 精读、98% 以上泛读；一页查词超过 10 个换台阶版本；每篇摘 5–10 句。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useClips, useEncounters, useTexts } from '../../db/hooks';
import { addText, deleteText, updateText } from '../../db/actions';
import { useFrDict } from '../../lib/gender/dict';
import { annotate, coverage, coverageAdvice, importFile, useReadingIndex, wordCount, type Tok } from '../../lib/reading';
import { usePrefs, setPrefs } from '../../ui/prefs';
import { toast } from '../../ui/toast';
import type { Text } from '../../schema';

const textIdFromHash = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('t');
const openText = (id: string | null) => { location.hash = id ? `#/read?t=${id}` : '#/read'; };

export function ReadPage() {
  const texts = useTexts();
  const [id, setId] = useState(textIdFromHash);
  // 列表 ⇄ 文章只改 ?t=，路由还是阅读页，要自己听 hash 变化
  useEffect(() => {
    const on = () => setId(textIdFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (!texts) return null;
  const t = id ? texts.find((x) => x.id === id) : undefined;
  return <div className="page read">{t ? <Reader key={t.id} t={t} /> : <TextList texts={texts} />}</div>;
}

function TextList({ texts }: { texts: Text[] }) {
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [body, setBody] = useState('');
  const [cues, setCues] = useState<Text['cues']>([]);
  const file = useRef<HTMLInputElement>(null);
  const encounters = useEncounters();
  const lookups = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of encounters ?? []) if (e.textId) (m.get(e.textId) ?? m.set(e.textId, new Set()).get(e.textId)!).add(e.key);
    return m;
  }, [encounters]);

  const save = async () => {
    if (!body.trim()) return;
    const id = await addText({ title: title || body.trim().slice(0, 40), source, body: body.trim(), cues });
    setTitle(''); setSource(''); setBody(''); setCues([]);
    openText(id);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = importFile(f.name, await f.text());
    setTitle(r.title); setBody(r.body); setCues(r.cues);
    toast(r.cues.length ? `字幕：${r.cues.length} 条` : `${wordCount(r.body)} 个词`);
  };

  return (
    <>
      <h3 className="sub">新文章</h3>
      <div className="grid2">
        <label className="field"><span className="field-label">标题</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="不填就用正文开头" /></label>
        <label className="field"><span className="field-label">出处</span><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="链接、节目和集数、题库题号" /></label>
      </div>
      <textarea className="read-input" rows={6} value={body} onChange={(e) => { setBody(e.target.value); setCues([]); }} placeholder="粘贴法语文章；也可以导入 .txt / .md / .srt / .vtt" />
      <div className="toolbar">
        <button type="button" className="btn is-primary" disabled={!body.trim()} onClick={() => void save()}>开始阅读</button>
        <button type="button" className="btn" onClick={() => file.current?.click()}>导入文件</button>
        {body && <span className="muted small">{cues.length ? `字幕 ${cues.length} 条 · ` : ''}{wordCount(body)} 个词</span>}
        <input ref={file} type="file" hidden accept=".txt,.md,.markdown,.srt,.vtt,text/plain" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <h3 className="sub">文章（{texts.length}）</h3>
      {!texts.length && <p className="empty muted">还没有文章。精读材料、TCF 阅读长文、听写视频的字幕都可以放进来。</p>}
      <ul className="texts">
        {texts.map((t) => (
          <li key={t.id} className="text-row" onClick={() => openText(t.id)}>
            <div className="grow">
              <b>{t.title}</b>
              <div className="muted small">{t.source ? `${t.source} · ` : ''}{t.createdAt.slice(0, 10)} · {wordCount(t.body)} 词 · 查词 {lookups.get(t.id)?.size ?? 0}{t.summary ? ' · 已复述' : ''}</div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

const STATUS_LABEL: Record<NonNullable<Tok['status']>, string> = { known: '认识', learning: '学习中', new: '有卡未学', unknown: '生词' };

function Reader({ t }: { t: Text }) {
  const prefs = usePrefs();
  const dict = useFrDict(true);
  const index = useReadingIndex(true);
  const encounters = useEncounters();
  const clips = useClips();
  const [skim, setSkim] = useState(false); // 通读：不标色、不查词
  const [summary, setSummary] = useState(t.summary);
  const [confirmDel, setConfirmDel] = useState(false);
  const colors = prefs.readColors && !skim;

  const paras = useMemo(
    () => (t.cues.length ? t.cues.map((c) => ({ t: c.t, toks: annotate(c.text, index, dict) })) : t.body.split(/\n+/).filter((p) => p.trim()).map((p) => ({ t: '', toks: annotate(p, index, dict) }))),
    [t.body, t.cues, index, dict],
  );
  const cov = useMemo(() => coverage(paras.flatMap((p) => p.toks)), [paras]);
  const words = cov.total || wordCount(t.body);
  const looked = new Set((encounters ?? []).filter((e) => e.textId === t.id).map((e) => e.key)).size;
  const per300 = words ? Math.round((looked / words) * 300 * 10) / 10 : 0;
  const clipped = (clips ?? []).filter((c) => c.textId === t.id).length;

  // 点一个词：选中它，划词气泡会接着读选区
  const click = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('.rw');
    if (!el || skim || !window.getSelection()?.isCollapsed) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  };

  return (
    <div className="reader" data-text-id={t.id} data-lookup-source={t.title}>
      <div className="toolbar">
        <button type="button" className="pill" onClick={() => openText(null)}>← 文章列表</button>
        <span className="grow" />
        <button type="button" className={`pill${skim ? ' is-on' : ''}`} onClick={() => setSkim(!skim)} title="通读：不标色、不查词，读完写三句大意">通读模式</button>
        <button type="button" className={`pill${colors ? ' is-on' : ''}`} disabled={skim} onClick={() => setPrefs({ readColors: !prefs.readColors })}>标色</button>
      </div>
      <h2 className="read-title">{t.title}</h2>
      {t.source && <p className="muted small">{/^https?:\/\//.test(t.source) ? <a href={t.source} target="_blank" rel="noreferrer">{t.source}</a> : t.source}</p>}
      {index ? (
        <div className="read-stats">
          <div className="cov-bar" title={`认识 ${cov.known} · 学习中 ${cov.learning} · 有卡未学 ${cov.new} · 生词 ${cov.unknown}`}>
            <span className="cov-known" style={{ width: `${(cov.known / Math.max(1, cov.total)) * 100}%` }} />
            <span className="cov-learning" style={{ width: `${(cov.learning / Math.max(1, cov.total)) * 100}%` }} />
            <span className="cov-new" style={{ width: `${(cov.new / Math.max(1, cov.total)) * 100}%` }} />
          </div>
          <p className="small"><b>已知 {cov.pct}%</b> · {coverageAdvice(cov.pct)}</p>
          <p className="muted small">
            {cov.total} 词：认识 {cov.known} · 学习中 {cov.learning} · 有卡未学 {cov.new} · 生词 {cov.unknown}（{cov.uniqueUnknown} 个不同的词）
            {' · '}本篇查词 {looked}（每 300 词 {per300}）{per300 > 10 && <span className="accent"> 查词太多，建议换台阶版本</span>}
            {' · '}摘句 {clipped}{clipped >= 10 ? '（够了）' : clipped >= 5 ? '' : '（建议 5–10 句）'}
          </p>
        </div>
      ) : <p className="muted small pulse">加载词典…</p>}
      <div className={`read-body${colors ? ' is-colored' : ''}`} onClick={click} data-no-lookup={skim ? '' : undefined}>
        {paras.map((p, i) => (
          <p key={i} className={p.t ? 'cue-line' : undefined}>
            {p.t && <span className="cue-t" data-no-lookup="">{p.t}</span>}
            <span>{p.toks.map((k, j) => (k.status ? <span key={j} className={`rw st-${k.status}`} title={colors ? STATUS_LABEL[k.status] : undefined}>{k.text}</span> : k.text))}</span>
          </p>
        ))}
      </div>
      <h3 className="sub">复述</h3>
      <textarea className="read-input" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} onBlur={() => summary !== t.summary && void updateText(t.id, { summary })}
        placeholder="读完用 3–5 句法语写大意，或用文中两个表达写一句自己的观点" />
      <div className="toolbar">
        <span className="grow" />
        {confirmDel
          ? <><span className="muted small">删除这篇文章？摘句篮和遇见记录不受影响</span><button type="button" className="btn is-danger" onClick={() => { void deleteText(t.id); openText(null); }}>确认删除</button><button type="button" className="btn" onClick={() => setConfirmDel(false)}>取消</button></>
          : <button type="button" className="pill" onClick={() => setConfirmDel(true)}>删除文章</button>}
      </div>
    </div>
  );
}
