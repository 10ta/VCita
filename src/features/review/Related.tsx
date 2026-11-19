// 背面最下面的「关联」：同话题的其他卡（意思相关、不能互相替换），只展示、不考、不记分；
// 这张卡在易混组里时，注明组里还有哪几个词（另有辨析卡专门练区别）。表达群的回想在它上面的 ClusterStrip 里
import type { Note } from '../../schema';
import { Fr } from '../FrText';
import { firstMeaning } from './ClusterStrip';

const MAX = 8;

/** 每个话题下的其他笔记（同表达群的不重复列，它们在表达群回想里） */
export function topicMates(note: Pick<Note, 'id' | 'topics' | 'cluster'>, notes: Note[]): Array<{ topic: string; mates: Note[] }> {
  const cluster = note.cluster?.trim();
  return (note.topics ?? []).map((topic) => ({
    topic,
    mates: notes.filter((n) => n.id !== note.id && !n.deleted && (n.topics ?? []).includes(topic) && !(cluster && n.cluster?.trim() === cluster))
      .sort((a, b) => a.lemma.localeCompare(b.lemma, 'fr')),
  })).filter((x) => x.mates.length);
}

export function Related({ note, notes, onEdit }: { note: Note; notes: Note[]; onEdit?: () => void }) {
  const topics = topicMates(note, notes);
  const contrast = note.contrastGroup ? notes.filter((n) => n.id !== note.id && !n.deleted && n.contrastGroup === note.contrastGroup) : [];
  if (!topics.length && !contrast.length) return null;
  return (
    <Fr>
      <div className="related small">
        {topics.map(({ topic, mates }) => (
          <div key={topic} className="rel-row">
            <span className="rel-label">话题 · {topic}</span>
            <span className="rel-items">
              {mates.slice(0, MAX).map((m) => <span key={m.id} className="rel-item"><span lang="fr">{m.lemma}</span> <span className="muted">{firstMeaning(m)}</span></span>)}
              {mates.length > MAX && <span className="muted">还有 {mates.length - MAX} 条</span>}
            </span>
          </div>
        ))}
        {onEdit && topics.length > 0 && <button type="button" className="pill rel-edit" title="在编辑里改话题、移出或加关联（E）" onClick={onEdit}>编辑关联</button>}
        {contrast.length > 0 && (
          <div className="rel-row">
            <span className="rel-label">易混</span>
            <span className="rel-items">
              {contrast.map((m) => <span key={m.id} className="rel-item"><span lang="fr">{m.lemma}</span> <span className="muted">{firstMeaning(m)}</span></span>)}
              <span className="muted">（辨析卡专门练区别）</span>
            </span>
          </div>
        )}
      </div>
    </Fr>
  );
}
