// Графики на чистом SVG (без библиотек). Оформление — по правилам dataviz:
// тонкие метки (столбцы ≤ 24 px, скругление данных-конца 4 px, линии 2 px, заливка 10 %),
// зазор 2 px между сегментами, кольцо цвета фона вокруг маркеров, тихая сетка,
// подписи только у экстремумов, подсказка по наведению/касанию, табличный вид для доступности,
// легенда при ≥ 2 рядах. Цвета рядов — токены --s1…--s5 (проверенная палитра, свои значения на тёмной теме).

import { useId, useMemo, useState, type ReactNode } from 'react';
import { niceMax } from '../core/stats';
import { Icon } from './icons';
import { useT } from '../i18n';

// ---------- Карточка графика ----------

export interface TableData {
  head: string[];
  rows: string[][];
}

export function ChartCard({
  title,
  sub,
  legend,
  table,
  children,
}: {
  title: string;
  sub?: ReactNode;
  legend?: { color: string; label: string }[];
  table?: TableData;
  children: ReactNode;
}) {
  const { t } = useT();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card chart-card">
      <header className="chart-head">
        <div>
          <b>{title}</b>
          {sub && <small className="muted">{sub}</small>}
        </div>
        {table && (
          <button className={`icon-btn sm ${asTable ? 'on' : ''}`} onClick={() => setAsTable(!asTable)} aria-label={t('chart.table')} aria-pressed={asTable}>
            <Icon name={asTable ? 'chart' : 'table'} size={16} />
          </button>
        )}
      </header>
      {asTable && table ? (
        <div className="chart-table-wrap">
          <table className="chart-table">
            <thead>
              <tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
      {legend && legend.length > 1 && !asTable && (
        <ul className="legend">
          {legend.map((l) => (
            <li key={l.label}>
              <i style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- Общее ----------

const W = 340;
const roundTop = (x: number, y: number, w: number, h: number, r: number): string => {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
};

function Tip({ x, w, children }: { x: number; w: number; children: ReactNode }) {
  // x — доля ширины (0…1); подсказка не вылезает за края
  const left = Math.max(0.16, Math.min(0.84, x)) * 100;
  return (
    <div className="tip" style={{ left: `${left}%` }} data-w={w}>
      {children}
    </div>
  );
}

// ---------- Столбцы (в т.ч. составные) ----------

export interface BarDatum {
  label: string;
  /** значения сегментов снизу вверх */
  parts: number[];
  tip: string;
}

export function BarChart({
  data,
  colors,
  format,
  ariaLabel,
  height = 150,
  labelEvery = 1,
}: {
  data: BarDatum[];
  colors: string[];
  format: (v: number) => string;
  ariaLabel: string;
  height?: number;
  labelEvery?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const padL = 34;
  const padB = 20;
  const padT = 14;
  const plotH = H - padB - padT;
  const totals = data.map((d) => d.parts.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(...totals, 0));
  const band = (W - padL - 4) / data.length;
  const bw = Math.min(24, band * 0.68);
  const peak = totals.indexOf(Math.max(...totals));
  const y = (v: number) => padT + plotH - (v / max) * plotH;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.floor((x - padL) / band);
    setHover(i >= 0 && i < data.length ? i : null);
  };

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={padL - 6} y={y(max * f) + 3.5} textAnchor="end" className="tick">
              {format(max * f)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + band * i + band / 2;
          let acc = 0;
          const total = totals[i];
          return (
            <g key={i} opacity={hover === null || hover === i ? 1 : 0.55}>
              {d.parts.map((v, k) => {
                if (v <= 0) return null;
                const top = y(acc + v);
                const bottom = y(acc);
                acc += v;
                const isTop = acc >= total - 1e-9;
                const gap = k > 0 ? 2 : 0; // зазор цвета фона между сегментами
                const h = Math.max(1, bottom - top - gap);
                return isTop ? (
                  <path key={k} d={roundTop(cx - bw / 2, top, bw, h, 4)} fill={colors[k]} />
                ) : (
                  <rect key={k} x={cx - bw / 2} y={top} width={bw} height={h} fill={colors[k]} />
                );
              })}
              {i === peak && total > 0 && (
                <text x={cx} y={y(total) - 5} textAnchor="middle" className="peak">
                  {format(total)}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 5} textAnchor="middle" className="tick">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <Tip x={(padL + band * hover + band / 2) / W} w={W}>
          {data[hover].tip}
        </Tip>
      )}
    </div>
  );
}

// ---------- Линия с заливкой ----------

export function LineArea({
  values,
  labels,
  tips,
  color,
  format,
  ariaLabel,
  height = 150,
}: {
  values: number[];
  labels: string[];
  tips: string[];
  color: string;
  format: (v: number) => string;
  ariaLabel: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId();
  const H = height;
  const padL = 40;
  const padB = 20;
  const padT = 14;
  const plotH = H - padB - padT;
  const max = niceMax(Math.max(...values, 0));
  const n = values.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - 10));
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const path = useMemo(() => values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''), [values, max]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = `${path}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const last = n - 1;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - padL) / (W - padL - 10)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };
  const tickIdx = [0, Math.floor(n / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W - 10} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={padL - 6} y={y(max * f) + 3.5} textAnchor="end" className="tick">
              {format(max * f)}
            </text>
          </g>
        ))}
        <path d={area} fill={color} opacity={0.1} id={uid} />
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {tickIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 5} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} className="tick">
            {labels[i]}
          </text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={y(0)} className="cross" />}
        {/* конечная точка: r 4.5 + кольцо цвета фона 2 px */}
        <circle cx={x(hover ?? last)} cy={y(values[hover ?? last] ?? 0)} r={6.5} className="ring-bg" />
        <circle cx={x(hover ?? last)} cy={y(values[hover ?? last] ?? 0)} r={4.5} fill={color} />
        {hover === null && (
          <text x={x(last)} y={y(values[last]) - 10} textAnchor="end" className="peak">
            {format(values[last])}
          </text>
        )}
      </svg>
      {hover !== null && <Tip x={x(hover) / W} w={W}>{tips[hover]}</Tip>}
    </div>
  );
}

// ---------- Кольцевая диаграмма ----------

export interface Slice {
  label: string;
  value: number;
  color: string;
  icon?: string;
}

export function Donut({ slices, center, ariaLabel }: { slices: Slice[]; center: { big: string; small: string }; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="donut-row">
      <div className="donut">
        <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label={ariaLabel}>
          <circle cx="70" cy="70" r={R} fill="none" stroke="var(--grid-fill)" strokeWidth="14" />
          {slices.map((s, i) => {
            const len = (s.value / total) * C;
            const seg = (
              <circle
                key={s.label}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={hover === i ? 17 : 14}
                strokeDasharray={`${Math.max(0, len - 2.5)} ${C}`}
                strokeDashoffset={-acc}
                transform="rotate(-90 70 70)"
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onPointerDown={() => setHover(i)}
              />
            );
            acc += len;
            return seg;
          })}
        </svg>
        <div className="donut-c">
          <b>{hover !== null ? slices[hover].value : center.big}</b>
          <small>{hover !== null ? slices[hover].label : center.small}</small>
        </div>
      </div>
      <ul className="donut-legend">
        {slices.map((s, i) => (
          <li key={s.label} className={hover === i ? 'on' : ''} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{s.value}</b>
            <small>{Math.round((s.value / total) * 100)}%</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Календарь-теплокарта ----------

export function Heatmap({
  weeks,
  tip,
  ariaLabel,
  dayLabels,
  legend,
}: {
  weeks: { date: string; level: number; value: number; future: boolean }[][];
  tip: (c: { date: string; value: number }) => string;
  ariaLabel: string;
  dayLabels: string[];
  legend: [string, string];
}) {
  const [hover, setHover] = useState<{ w: number; d: number } | null>(null);
  const cell = 17;
  const gap = 3;
  const padL = 22;
  const Wd = padL + weeks.length * (cell + gap);
  const Hd = 7 * (cell + gap) + 4;
  const fills = ['var(--grid-fill)', 'color-mix(in srgb, var(--s3) 30%, var(--surface-solid))', 'color-mix(in srgb, var(--s3) 52%, var(--surface-solid))', 'color-mix(in srgb, var(--s3) 76%, var(--surface-solid))', 'var(--s3)'];
  const hc = hover ? weeks[hover.w][hover.d] : null;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${Wd} ${Hd}`} width="100%" role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
        {[0, 2, 4].map((d) => (
          <text key={d} x={0} y={d * (cell + gap) + cell - 4} className="tick">
            {dayLabels[d]}
          </text>
        ))}
        {weeks.map((col, w) =>
          col.map((c, d) =>
            c.future ? null : (
              <rect
                key={c.date}
                x={padL + w * (cell + gap)}
                y={d * (cell + gap)}
                width={cell}
                height={cell}
                rx={4}
                fill={fills[c.level]}
                stroke={hover?.w === w && hover.d === d ? 'var(--text)' : 'none'}
                strokeWidth={1.5}
                onPointerEnter={() => setHover({ w, d })}
                onPointerDown={() => setHover({ w, d })}
              />
            ),
          ),
        )}
      </svg>
      {hc && hover && <Tip x={(padL + hover.w * (cell + gap) + cell / 2) / Wd} w={Wd}>{tip(hc)}</Tip>}
      <div className="heat-legend">
        <small>{legend[0]}</small>
        {fills.map((f, i) => (
          <i key={i} style={{ background: f }} />
        ))}
        <small>{legend[1]}</small>
      </div>
    </div>
  );
}

// ---------- Горизонтальные полосы (доля выполненного) ----------

export function HBars({ rows, color }: { rows: { label: string; value: number; max: number; text: string }[]; color: string }) {
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.label}>
          <span>{r.label}</span>
          <div className="hb-track" role="img" aria-label={`${r.label}: ${r.text}`}>
            <i style={{ width: `${r.max ? Math.round((r.value / r.max) * 100) : 0}%`, background: color }} />
          </div>
          <b>{r.text}</b>
        </li>
      ))}
    </ul>
  );
}
