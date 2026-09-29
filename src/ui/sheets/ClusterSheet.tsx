import { useApp } from '../../state/store';
import { useT } from '../../i18n';
import { Sheet } from '../common';
import { NoteCard } from '../pages/NotesPage';
import { haversine } from '../../core/geo';

/** Метки, которые лежат в одной точке и не разделяются даже на максимальном приближении. */
export function ClusterSheet({ ids }: { ids: string[] }) {
  const { t } = useT();
  const patch = useApp((s) => s.patch);
  const notes = useApp((s) => s.notes);
  const pos = useApp((s) => s.position);
  const list = notes.filter((n) => ids.includes(n.id)).sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Sheet tall title={`${t('cluster.title')} · ${list.length}`} onClose={() => patch({ sheet: null })}>
      <div className="form">
        <p className="muted">{t('cluster.hint')}</p>
        <div className="note-list">
          {list.map((n) => (
            <NoteCard key={n.id} note={n} dist={pos ? haversine(pos, n) : null} />
          ))}
        </div>
      </div>
    </Sheet>
  );
}
