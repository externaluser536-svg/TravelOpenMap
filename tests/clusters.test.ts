import { describe, expect, it } from 'vitest';
import { NoteClusters, categoryRing, type ClusterNote } from '../src/map/clusters';

const base = { lng: 7.4246, lat: 43.7384 };
const notes: ClusterNote[] = [
  { id: 'a', ...base, category: 'food' },
  { id: 'b', lng: base.lng + 0.00005, lat: base.lat, category: 'food' },
  { id: 'c', lng: base.lng + 0.0001, lat: base.lat + 0.00005, category: 'view' },
  { id: 'far', lng: base.lng + 0.3, lat: base.lat + 0.2, category: 'place' },
];
const bbox: [number, number, number, number] = [7.0, 43.5, 8.0, 44.2];

describe('кластеры меток', () => {
  const c = new NoteClusters(notes);

  it('на дальнем зуме близкие метки собираются в группу со счётчиком', () => {
    const v = c.view(bbox, 11);
    const clusters = v.filter((i) => i.kind === 'cluster');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].kind === 'cluster' && clusters[0].count).toBe(3);
    // общее число меток сохраняется
    expect(v.reduce((s, i) => s + (i.kind === 'cluster' ? i.count : 1), 0)).toBe(4);
  });

  it('на ближнем зуме группа распадается на отдельные метки', () => {
    const v = c.view(bbox, 21);
    expect(v.filter((i) => i.kind === 'pin')).toHaveLength(4);
    expect(v.some((i) => i.kind === 'cluster')).toBe(false);
    // а на зуме улицы (≈ 17) метки в 10 метрах друг от друга ещё вместе
    const street = c.view(bbox, 17);
    expect(street.filter((i) => i.kind === 'cluster')).toHaveLength(1);
  });

  it('состав категорий и id группы доступны', () => {
    const cl = c.view(bbox, 11).find((i) => i.kind === 'cluster');
    if (!cl || cl.kind !== 'cluster') throw new Error('нет группы');
    expect(cl.cats).toEqual({ food: 2, view: 1 });
    expect(c.leaves(cl.clusterId).sort()).toEqual(['a', 'b', 'c']);
    const z = c.expansionZoom(cl.clusterId);
    expect(z).toBeGreaterThan(11);
    // после zoom распада группа действительно делится
    const after = c.view(bbox, z);
    expect(after.reduce((s, i) => s + (i.kind === 'cluster' ? i.count : 1), 0)).toBe(4);
    expect(after.filter((i) => i.kind === 'cluster' && i.count === 3)).toHaveLength(0);
  });

  it('метки в одной точке остаются группой даже на максимальном zoom', () => {
    const same = new NoteClusters([
      { id: '1', ...base, category: 'place' },
      { id: '2', ...base, category: 'place' },
    ]);
    const v = same.view(bbox, 19.5);
    expect(v).toHaveLength(1);
    expect(v[0].kind === 'cluster' && v[0].count).toBe(2);
  });

  it('кольцо категорий задаёт доли', () => {
    const ring = categoryRing({ a: 3, b: 1 }, (id) => (id === 'a' ? '#111' : '#222'));
    expect(ring).toBe('conic-gradient(#111 0.00% 75.00%, #222 75.00% 100.00%)');
  });
});
