import { useMemo } from 'react';

/** Схематичный маршрут (без карты): проекция подгоняется под рамку, сохраняя пропорции. */
export function RouteSvg({
  points,
  height = 220,
  fill,
  live,
  ariaLabel,
}: {
  points: [number, number][];
  height?: number;
  /** заливка внутри маршрута (петля / оболочка) */
  fill?: boolean;
  live?: boolean;
  ariaLabel: string;
}) {
  const W = 340;
  const d = useMemo(() => {
    if (points.length < 2) return null;
    const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xy = points.map(([lng, lat]) => [lng * k, -lat]);
    const xs = xy.map((p) => p[0]);
    const ys = xy.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 22;
    const sc = Math.min((W - 2 * pad) / Math.max(maxX - minX, 1e-9), (height - 2 * pad) / Math.max(maxY - minY, 1e-9));
    const ox = (W - (maxX - minX) * sc) / 2 - minX * sc;
    const oy = (height - (maxY - minY) * sc) / 2 - minY * sc;
    const pts = xy.map(([x, y]) => [x * sc + ox, y * sc + oy] as const);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    return { pts, path };
  }, [points, height]);

  if (!d) {
    return (
      <div className="route-empty" style={{ height }} role="img" aria-label={ariaLabel}>
        <span className="pulse-dot" />
      </div>
    );
  }
  const first = d.pts[0];
  const last = d.pts[d.pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" className="route-svg" role="img" aria-label={ariaLabel}>
      {fill && <path d={`${d.path}Z`} fill="var(--s3)" opacity={0.12} />}
      <path d={d.path} fill="none" stroke="var(--surface-solid)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d.path} fill="none" stroke="var(--s1)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={first[0]} cy={first[1]} r={6.5} fill="var(--surface-solid)" />
      <circle cx={first[0]} cy={first[1]} r={4.5} fill="var(--s3)" />
      <circle cx={last[0]} cy={last[1]} r={6.5} fill="var(--surface-solid)" />
      <circle cx={last[0]} cy={last[1]} r={4.5} fill={live ? 'var(--s2)' : 'var(--s5)'} className={live ? 'live-dot' : undefined} />
    </svg>
  );
}
