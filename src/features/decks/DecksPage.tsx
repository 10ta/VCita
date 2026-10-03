import { useState } from 'react';
import { useCards, useDecks, useNotes } from '../../db/hooks';
import { createDeck, deleteDeck, renameDeck } from '../../db/actions';
import { setPrefs } from '../../ui/prefs';
import { Modal } from '../../ui/Modal';
import { fromIso } from '../../lib/time';
import { toast } from '../../ui/toast';

export function DecksPage({ deckId }: { deckId: string }) {
  const decks = useDecks();
  const notes = useNotes();
  const cards = useCards();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  if (!decks || !notes || !cards) return null;
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
  return (
    <div className="page decks">
      <div className="add-row">
        <input placeholder="新牌组名称" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && name.trim()) void createDeck(name).then(() => setName('')); }} />
        <button type="button" className="btn is-primary" disabled={!name.trim()} onClick={() => void createDeck(name).then(() => setName(''))}>新建牌组</button>
      </div>
      <div className="deck-grid">
        {decks.map((d) => {
          const st = stat(d.id);
          return (
            <div key={d.id} className={`deck${d.id === deckId ? ' is-on' : ''}`} onClick={() => { setPrefs({ deckId: d.id }); location.hash = '#/review'; }}>
              <h3>{d.name}</h3>
              <p className="muted small">{st.notes} 条 · <span className="accent">{st.due} 到期</span> · <span className="blue">{st.fresh} 新</span>{st.leech ? <> · <span className="red">{st.leech} 待改造</span></> : null}</p>
              <div className="deck-actions">
                <button type="button" className="icon" title="重命名" onClick={(e) => { e.stopPropagation(); setRenaming({ id: d.id, name: d.name }); }}>✎</button>
                {decks.length > 1 && <button type="button" className="icon is-danger" title="删除" onClick={(e) => { e.stopPropagation(); setDeleting(d.id); }}>🗑</button>}
              </div>
            </div>
          );
        })}
      </div>
      {renaming && (
        <Modal title="重命名牌组" onClose={() => setRenaming(null)} footer={<button type="button" className="btn is-primary" onClick={() => void renameDeck(renaming.id, renaming.name).then(() => setRenaming(null))}>保存</button>}>
          <input value={renaming.name} autoFocus onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
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
    </div>
  );
}
