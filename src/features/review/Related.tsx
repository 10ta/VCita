// 背面最下面的「关联」：由关联引擎（srs/related.ts）静态算出，只展示、不考、不记分。
// 同词另义 → 同概念（强）→ 同类（弱，强关联太少时才补）→ 易混组 → 可能相关（等你确认 ✓ 或否决 ✗）。
// 同词族不在这里列：它并进上面的「词族」分区（手写的词族线索 + 库里同词族的卡），见 useFamilyEntries
// 表达群的回想在它上面的 ClusterStrip 里，同群的不在这里重复列
import type { Note } from '../../schema';
import { Fr } from '../FrText';
import { firstMeaning } from './ClusterStrip';
import { relatedOf } from '../../srs/related';
import { isConcept } from '../../lib/concepts';
import { useWiktLinks } from '../../lib/wikt';
import { updateNote, updateNotes } from '../../db/actions';
import { toast } from '../../ui/toast';

/** 库里同词族的卡，给背面「词族」分区用（和手写的词族线索并在一起显示） */
export function useFamilyEntries(note: Note | null | undefined, notes: Note[] | undefined): Array<{ fr: string; zh: string }> {
  const wikt = useWiktLinks(true);
  if (!note || !notes) return [];
  return relatedOf(note, notes, wikt).family.map((m) => ({ fr: m.lemma, zh: firstMeaning(m) }));
}

function Items({ list }: { list: Note[] }) {
  return <>{list.map((m) => <span key={m.id} className="rel-item"><span lang="fr">{m.lemma}</span> <span className="muted">{firstMeaning(m)}</span></span>)}</>;
}

export function Related({ note, notes, onEdit }: { note: Note; notes: Note[]; onEdit?: () => void }) {
  const wikt = useWiktLinks(true);
  const r = relatedOf(note, notes, wikt);
  const contrast = note.contrastGroup ? notes.filter((n) => n.id !== note.id && !n.deleted && n.contrastGroup === note.contrastGroup) : [];
  const mine = (note.topics ?? []).filter(isConcept);
  const confirm = (m: Note) => {
    if (!mine.length) { toast('这条还没有概念：先在编辑里给它挑一个，再确认关联'); onEdit?.(); return; }
    const c = mine[0];
    void updateNotes([m.id], (n) => ({ topics: [...new Set([...(n.topics ?? []), c])] })).then(() => toast(`已把「${m.lemma}」挂到概念「${c}」`));
  };
  const reject = (m: Note) => void updateNote(note.id, { relNo: [...new Set([...(note.relNo ?? []), m.id])] }).then(() => toast(`以后不再推荐「${m.lemma}」`));
  const empty = !r.sameWord.length && !r.concepts.length && !r.weak && !contrast.length && !r.suspects.length;
  if (empty && !onEdit) return null;
  return (
    <Fr>
      <div className="related small">
        <div className="rel-head" title="和这张卡有关的其他卡：只看不考，不影响评分">关联<span className="muted"> · 只看不考</span></div>
        {empty && <div className="muted">还没有关联：给这条挂上概念，同概念的卡就会出现在这里</div>}
        {r.sameWord.length > 0 && (
          <div className="rel-row">
            <span className="rel-label" title="同一个词的其他义项、其他搭配：各是一张卡，复习这张顺带看一眼">同词另义</span>
            <span className="rel-items">{r.sameWord.map((m) => <span key={m.id} className="rel-item"><span lang="fr">{m.lemma}</span> <span className="muted">{m.sense?.trim() || firstMeaning(m)}</span></span>)}</span>
          </div>
        )}
        {r.concepts.map(({ concept, legacy, mates }) => (
          <div key={concept} className="rel-row">
            <span className="rel-label" title={legacy ? '旧话题，还没换成概念表里的概念' : '同一个概念下的卡'}>{legacy ? '话题' : '概念'} · {concept}</span>
            <span className="rel-items"><Items list={mates} /></span>
          </div>
        ))}
        {r.weak && (
          <div className="rel-row">
            <span className="rel-label" title="同一大类里意思最接近的几条（这条的同概念卡太少时才列）">同类 · {r.weak.group}</span>
            <span className="rel-items"><Items list={r.weak.mates} /></span>
          </div>
        )}
        {contrast.length > 0 && (
          <div className="rel-row">
            <span className="rel-label">易混</span>
            <span className="rel-items"><Items list={contrast} /><span className="muted">（辨析卡专门练区别）</span></span>
          </div>
        )}
        {r.suspects.length > 0 && (
          <div className="rel-row rel-suspects">
            <span className="rel-label" title="意思很接近、但还没有共同概念：✓ 把这条的概念加给它；✗ 以后不再推荐">可能相关</span>
            <span className="rel-items">
              {r.suspects.map((m) => (
                <span key={m.id} className="rel-item">
                  <span lang="fr">{m.lemma}</span> <span className="muted">{firstMeaning(m)}</span>
                  <button type="button" className="icon rel-yes" title={mine.length ? `相关：挂到概念「${mine[0]}」` : '相关（先给这条挑概念）'} aria-label={`相关：${m.lemma}`} onClick={() => confirm(m)}>✓</button>
                  <button type="button" className="icon rel-no" title="不相关：以后不再推荐" aria-label={`不相关：${m.lemma}`} onClick={() => reject(m)}>✗</button>
                </span>
              ))}
            </span>
          </div>
        )}
        {onEdit && <button type="button" className="pill rel-edit" title="在编辑里改概念（E）" onClick={onEdit}>{mine.length ? '编辑关联' : '给这条挑概念'}</button>}
      </div>
    </Fr>
  );
}
