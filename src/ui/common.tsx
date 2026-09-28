import { useRef, useState, type ReactNode, type PointerEvent as RPE } from 'react';
import { Icon } from './icons';

// ---------- Шторка ----------

export function Sheet({
  title,
  onClose,
  children,
  footer,
  tall,
  back,
  className = '',
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  tall?: boolean;
  back?: () => void;
  className?: string;
}) {
  const [dy, setDy] = useState(0);
  const start = useRef<number | null>(null);
  const down = (e: RPE) => {
    start.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: RPE) => {
    if (start.current === null) return;
    setDy(Math.max(0, e.clientY - start.current));
  };
  const up = () => {
    if (start.current === null) return;
    start.current = null;
    if (dy > 110) onClose();
    setDy(0);
  };
  return (
    <div className="sheet-layer">
      <div className="sheet-backdrop" onClick={onClose} />
      <section
        className={`sheet ${tall ? 'sheet-tall' : ''} ${className}`}
        style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}
        role="dialog"
      >
        <div className="sheet-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <span className="grab-bar" />
        </div>
        {(title || back) && (
          <header className="sheet-head">
            {back ? (
              <button className="icon-btn" onClick={back} aria-label="back">
                <Icon name="chevron-left" />
              </button>
            ) : null}
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="close">
              <Icon name="x" />
            </button>
          </header>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </section>
    </div>
  );
}

// ---------- Мелочи ----------

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressRing({ value, size = 48, stroke = 4, children, color = 'var(--accent)' }: { value: number; size?: number; stroke?: number; children?: ReactNode; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.2,.9,.2,1)' }}
        />
      </svg>
      <div className="ring-in">{children}</div>
    </div>
  );
}

export function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar">
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: color }} />
    </div>
  );
}

export function Row({
  icon,
  title,
  sub,
  right,
  onClick,
  danger,
}: {
  icon?: string;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  const inner = (
    <>
      {icon && (
        <span className={`row-ic ${danger ? 'danger' : ''}`}>
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="row-main">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      {right ?? (onClick ? <Icon name="chevron-right" size={18} className="muted" /> : null)}
    </>
  );
  return onClick ? (
    <button className="row" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className="row">{inner}</div>
  );
}

export function Empty({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-ic">
        <Icon name={icon} size={30} />
      </span>
      <b>{title}</b>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

/** Роза ветров: красная стрелка указывает на север, поворот задаётся углом (град.). */
export function CompassRose({ size = 28, angle = 0, ring = true }: { size?: number; angle?: number; ring?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ transform: `rotate(${angle}deg)`, transition: 'transform .12s linear' }} aria-hidden>
      {ring && <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity=".28" strokeWidth="1.6" />}
      <path d="M16 3 L20.2 16 H11.8 Z" fill="#FF5C5C" />
      <path d="M16 29 L11.8 16 H20.2 Z" fill="currentColor" fillOpacity=".85" />
      <circle cx="16" cy="16" r="2" fill="var(--surface-solid)" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
