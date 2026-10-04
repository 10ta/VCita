import { useMemo, useState } from 'react';
import { addNotes } from '../../db/actions';
import { useNotes } from '../../db/hooks';
import { parseImportLines } from '../../io/lines';
import { toast } from '../../ui/toast';

const EXAMPLE = `# 每行一条：句子（含 {{…}}）| 中文意思 | 英语 | 出处 | 主题
Après le déménagement, les enfants ont perdu tous leurs {{repères}}. | 熟悉的参照、依靠 | bearings | InnerFrench 12 | SOCIÉTÉ
Il faut {{tenir compte de}} l'avis des habitants. | 考虑到 | take into account | | SOCIÉTÉ`;

export function BulkImport({ deckId }: { deckId: string }) {
  const notes = useNotes();
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseImportLines(text), [text]);
  const existing = useMemo(() => new Set((notes ?? []).filter((n) => n.deckId === deckId && n.sentence).map((n) => n.sentence.trim())), [notes, deckId]);
  const good = parsed.filter((p) => !p.error && !existing.has(p.sentence));
  const dup = parsed.filter((p) => !p.error && existing.has(p.sentence)).length;
  const bad = parsed.filter((p) => p.error);
  const run = async () => {
    await addNotes(good.map((p) => ({ deckId, sentence: p.sentence, lemma: p.lemma, meaningZh: p.meaningZh, meaningEn: p.meaningEn, source: p.source, tags: p.tags })));
    toast(`已导入 ${good.length} 条`);
    setText('');
  };
  return (
    <div>
      <p className="hint">每行一条笔记，字段用 <code>|</code> 分隔：<b>句子（含 {'{{…}}'}）| 中文意思 | 英语 | 出处 | 主题</b>。后四项可省略；主题可写多个，写不全时按名称猜。导入后都是中频、只生成认读卡，需要产出卡的在词库里编辑。</p>
      <textarea className="bulk" rows={10} value={text} placeholder={EXAMPLE} onChange={(e) => setText(e.target.value)} />
      {parsed.length > 0 && (
        <p className="muted small">
          可导入 {good.length} 条{dup ? `，${dup} 条句子已存在（跳过）` : ''}{bad.length ? `，${bad.length} 行有问题` : ''}
        </p>
      )}
      {bad.map((b) => <p key={b.line} className="form-error">第 {b.line} 行：{b.error}</p>)}
      {good.length > 0 && (
        <ul className="recent">
          {good.slice(0, 8).map((p) => (
            <li key={p.line}><b>{p.lemma}</b><span className="arrow">→</span><span>{p.meaningZh}</span>{p.tags.map((t) => <span key={t} className="badge is-theme">{t}</span>)}</li>
          ))}
          {good.length > 8 && <li className="muted small">… 共 {good.length} 条</li>}
        </ul>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn is-primary" disabled={!good.length} onClick={() => void run()}>导入 {good.length || ''} 条</button>
      </div>
    </div>
  );
}
