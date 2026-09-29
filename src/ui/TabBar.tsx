import { useApp, type Screen } from '../state/store';
import { useT } from '../i18n';
import { Icon } from './icons';
import { startNote } from '../state/actions';
import { tap } from '../services/haptics';

const TABS: { id: Screen; icon: string; label: string }[] = [
  { id: 'map', icon: 'map', label: 'tab.map' },
  { id: 'notes', icon: 'notebook', label: 'tab.notes' },
  { id: 'workout', icon: 'zap', label: 'tab.workout' },
  { id: 'profile', icon: 'user', label: 'tab.profile' },
];

export function TabBar() {
  const { t } = useT();
  const screen = useApp((s) => s.screen);
  const mode = useApp((s) => s.mode);
  const patch = useApp((s) => s.patch);
  if (mode !== 'normal') return null;
  const go = (id: Screen) => {
    tap('light');
    patch({ screen: id });
  };
  const item = (tab: (typeof TABS)[number]) => (
    <button key={tab.id} className={`tab ${screen === tab.id ? 'on' : ''}`} onClick={() => go(tab.id)} aria-label={t(tab.label)} data-tour={`tab-${tab.id}`}>
      <Icon name={tab.icon} size={22} strokeWidth={screen === tab.id ? 2.4 : 2} />
      <span>{t(tab.label)}</span>
    </button>
  );
  return (
    <nav className="tabbar glass">
      {item(TABS[0])}
      {item(TABS[1])}
      <button className="tab-add" onClick={startNote} aria-label={t('note.add')} data-tour="add">
        <Icon name="plus" size={28} strokeWidth={2.6} />
      </button>
      {item(TABS[2])}
      {item(TABS[3])}
    </nav>
  );
}
