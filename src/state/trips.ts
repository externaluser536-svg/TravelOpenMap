// Поездки: загрузка, сохранение, удаление (обновляют store).

import { deleteTrip, getAllTrips, putTrip, uid, type Trip } from '../data/db';
import { useApp } from './store';
import { newTrip } from '../core/trips';
import { usePrefs } from './prefs';
import { countryByCode } from '../data/countries';

export async function loadTrips(): Promise<void> {
  useApp.getState().patch({ trips: await getAllTrips() });
}

export async function saveTrip(t: Trip): Promise<Trip> {
  const saved = { ...t, updatedAt: Date.now() };
  await putTrip(saved);
  const list = useApp.getState().trips;
  useApp.getState().patch({ trips: [saved, ...list.filter((x) => x.id !== saved.id)] });
  return saved;
}

export async function removeTrip(id: string): Promise<void> {
  await deleteTrip(id);
  useApp.getState().patch({ trips: useApp.getState().trips.filter((t) => t.id !== id) });
}

export function draftTrip(country = ''): Trip {
  const cur = countryByCode(country)?.cur || (usePrefs.getState().lang === 'ru' ? 'RUB' : 'EUR');
  return { ...newTrip(uid(), Date.now(), cur), country };
}
