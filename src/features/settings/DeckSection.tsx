// 设置 → 牌组：牌组增删改频率很低，从独立页面并到设置里
import { useState } from 'react';
import { useCards, useDecks, useNotes } from '../../db/hooks';
import { createDeck, deleteDeck, mergeDeck, renameDeck } from '../../db/actions';
import { setPrefs, usePrefs } from '../../ui/prefs';
import { Modal } from '../../ui/Modal';
import { fromIso } from '../../lib/time';
import { toast } from '../../ui/toast';

export function DeckSection() {
  const decks = useDecks();
  const notes = useNotes();
  const cards = useCards();
  const prefs = usePrefs();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [merging, setMerging] = useState<{ from: string; to: string } | null>(null);
  if (!decks || !notes || !cards) return <section id="decks"><h2>牌组</h2></section>;
  const current = decks.find((d) => d.id === prefs.deckId)?.id ?? decks[0]?.id;
  const now = Date.now();
  const stat = (id: string) => {
    const cs = cards.filter((c) => c.deckId === id);
    return {
      notes: notes.filter((n) => n.deckId === id).length,
      due: cs.filter((c) => !c.suspended && c.state !== 'new' && fromIso(c.due) <= now).length,
      fresh: cs.filter((c) => !c.suspended && c.state === 'new').length,
      leech: cs.filter((c) => c.isLeech).length,
    };
  };
  const create = () => {
    if (!name.trim()) return;
    void createDeck(name).then(() => { setName(''); toast('已新建牌组'); });
  };
  return (
    <section id="decks">
      <h2>牌组</h2>
      <ul className="deck-list">
        {decks.map((d) => {
          const st = stat(d.id);
          const on = d.id === current;
          return (
            <li key={d.id} className={on ? 'is-on' : undefined}>
              <div className="deck-info">
                <div><b>{d.name}</b>{on && <span className="badge is-current">当前</span>}</div>
                <small className="muted">{st.notes} 条 · <span className="accent">{st.due} 到期</span> · <span className="blue">{st.fresh} 新</span>{st.leech ? <> · <span className="red">{st.leech} 待改造</span></> : null}</small>
              </div>
              <div className="deck-ops">
                {!on && <button type="button" className="btn" onClick={() => setPrefs({ deckId: d.id })}>设为当前</button>}
                <button type="button" className="icon" title="重命名" aria-label={`重命名 ${d.name}`} onClick={() => setRenaming({ id: d.id, name: d.name })}>✎</button>
                {decks.length > 1 && <button type="button" className="btn" title="把这个牌组的笔记和卡片并入另一个牌组，复习进度保留" onClick={() => setMerging({ from: d.id, to: decks.find((x) => x.id !== d.id)!.id })}>合并到…</button>}
                {decks.length > 1 && <button type="button" className="icon is-danger" title="删除" aria-label={`删除 ${d.name}`} onClick={() => setDeleting(d.id)}>🗑</button>}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="deck-new">
        <input placeholder="新牌组名称" aria-label="新牌组名称" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) create(); }} />
        <button type="button" className="btn" disabled={!name.trim()} onClick={create}>新建牌组</button>
      </div>
      {renaming && (
        <Modal title="重命名牌组" onClose={() => setRenaming(null)} footer={<button type="button" className="btn is-primary" onClick={() => void renameDeck(renaming.id, renaming.name).then(() => setRenaming(null))}>保存</button>}>
          <input value={renaming.name} autoFocus onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void renameDeck(renaming.id, renaming.name).then(() => setRenaming(null)); }} />
        </Modal>
      )}
      {merging && (
        <Modal title="合并牌组" onClose={() => setMerging(null)} footer={<>
          <button type="button" className="btn" onClick={() => setMerging(null)}>取消</button>
          <button type="button" className="btn is-primary" onClick={() => void mergeDeck(merging.from, merging.to).then((n) => {
            if (prefs.deckId === merging.from) setPrefs({ deckId: merging.to });
            setMerging(null); toast(`已合并 ${n} 条笔记`);
          }, (e: Error) => toast(e.message, true))}>合并</button>
        </>}>
          <p>把"{decks.find((d) => d.id === merging.from)?.name}"的 {stat(merging.from).notes} 条笔记并入：</p>
          <select value={merging.to} onChange={(e) => setMerging({ ...merging, to: e.target.value })} aria-label="目标牌组">
            {decks.filter((d) => d.id !== merging.from).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <p className="muted">复习进度和日志都保留，合并后原牌组删除。</p>
        </Modal>
      )}
      {deleting && (
        <Modal title="删除牌组" onClose={() => setDeleting(null)} footer={<>
          <button type="button" className="btn" onClick={() => setDeleting(null)}>取消</button>
          <button type="button" className="btn is-danger" onClick={() => void deleteDeck(deleting).then(() => { setDeleting(null); toast('已删除'); })}>确认删除</button>
        </>}>
          <p>确定删除"{decks.find((d) => d.id === deleting)?.name}"及其中 {stat(deleting).notes} 条笔记吗？</p>
        </Modal>
      )}
    </section>
  );
}
