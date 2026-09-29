import { useApp } from '../state/store';
import { usePrefs } from '../state/prefs';
import { Icon } from './icons';
import { distNum } from './format';
import { formatDuration } from '../core/workout';

/** Плашка идущей тренировки поверх других экранов. */
export function WorkoutMini() {
  const live = useApp((s) => s.workoutLive);
  const units = usePrefs((s) => s.units);
  const patch = useApp((s) => s.patch);
  if (!live) return null;
  return (
    <button className={`wk-mini glass ${live.state}`} onClick={() => patch({ screen: 'workout' })}>
      <span className="rec" />
      <Icon name={live.type === 'run' ? 'zap' : 'footprints'} size={15} />
      <b className="mono-num">{formatDuration(live.elapsedS)}</b>
      <span className="mono-num">{distNum(live.distanceM, units)} {units === 'imperial' ? 'mi' : 'km'}</span>
    </button>
  );
}
