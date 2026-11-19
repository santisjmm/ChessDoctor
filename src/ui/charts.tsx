import { useEffect, useRef, useState, type ReactNode } from 'react';
import { winPct } from '../lib/engine';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface Point {
  label: string;
  value: number;
  detail: string; // tooltip second line
}

/** Single-series line chart (no legend: the title names it), with a tap/hover tooltip. */
export function LineChart({ points, format, title, step = 10, clamp = [0, 100] }: { points: Point[]; format: (v: number) => string; title: string; step?: number; clamp?: [number, number] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = 180, padL = 36, padR = 12, padT = 12, padB = 26;
  const vals = points.map((p) => p.value);
  const lo = Math.max(clamp[0], Math.floor((Math.min(...vals) - step / 2) / step) * step);
  const hi = Math.min(clamp[1], Math.ceil((Math.max(...vals) + step / 2) / step) * step);
  const x = (i: number) => padL + (points.length === 1 ? (w - padL - padR) / 2 : (i * (w - padL - padR)) / (points.length - 1));
  const y = (v: number) => padT + ((hi - v) * (h - padT - padB)) / Math.max(1, hi - lo);
  const ticks = [lo, (lo + hi) / 2, hi];
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.floor((w - padL) / 56)));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const hp = hover !== null ? points[hover] : null;
  return (
    <figure className="chart" ref={ref}>
      <figcaption>{title}</figcaption>
      <svg width={w} height={h} role="img" aria-label={title} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 6} y={y(t) + 4} className="axis" textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {points.map((p, i) =>
          (points.length - 1 - i) % labelEvery === 0 ? ( // evenly spaced back from the newest point
            <text key={i} x={x(i)} y={h - 8} className="axis" textAnchor={x(i) > w - 40 ? 'end' : x(i) < padL + 20 ? 'start' : 'middle'}>{p.label}</text>
          ) : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={h - padB} className="crosshair" />}
        <path d={path} className="series" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 4} className="dot" />
        ))}
        {points.map((_, i) => (
          <rect
            key={i}
            x={x(i) - (w - padL - padR) / Math.max(1, points.length) / 2}
            width={(w - padL - padR) / Math.max(1, points.length)}
            y={0}
            height={h}
            fill="transparent"
            onPointerEnter={() => setHover(i)}
            onPointerDown={() => setHover(i)}
          />
        ))}
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: Math.min(w - 150, Math.max(0, x(hover!) - 75)) }}>
          <b>{hp.label}: {format(hp.value)}</b>
          <span>{hp.detail}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}><th>{p.label}</th><td>{format(p.value)}</td><td>{p.detail}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/**
 * Evaluation graph for a game's opening: White's winning chances per position (50% = level),
 * user mistakes marked. Tap a column to jump to that position.
 */
export function EvalGraph({
  cps, marks, current, onSelect, children,
}: {
  cps: (number | null)[];
  marks: { ply: number; kind: 'inaccuracy' | 'mistake' | 'blunder' }[];
  current: number;
  onSelect: (ply: number) => void;
  children?: ReactNode;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const h = 96, pad = 6;
  const n = Math.max(2, cps.length);
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (n - 1);
  const y = (cp: number) => pad + ((100 - winPct(cp)) * (h - 2 * pad)) / 100;
  const known = cps.map((c, i) => ({ c, i })).filter((p): p is { c: number; i: number } => p.c !== null);
  const line = known.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.c).toFixed(1)}`).join('');
  const area = known.length ? `${line}L${x(known.at(-1)!.i)},${h / 2}L${x(known[0].i)},${h / 2}Z` : '';
  return (
    <div className="evalgraph" ref={ref}>
      <svg width={w} height={h} role="img" aria-label="Evaluation through the opening">
        <rect x={0} y={0} width={w} height={h} className="eval-bg" rx={8} />
        <clipPath id="eg-top"><rect x={0} y={0} width={w} height={h / 2} /></clipPath>
        <clipPath id="eg-bot"><rect x={0} y={h / 2} width={w} height={h / 2} /></clipPath>
        <path d={area} className="eval-white" clipPath="url(#eg-top)" />
        <path d={area} className="eval-black" clipPath="url(#eg-bot)" />
        <line x1={0} x2={w} y1={h / 2} y2={h / 2} className="grid" />
        <line x1={x(current)} x2={x(current)} y1={0} y2={h} className="crosshair" />
        <path d={line} className="series thin" />
        {marks.map((m) =>
          cps[m.ply + 1] != null ? <circle key={m.ply} cx={x(m.ply + 1)} cy={y(cps[m.ply + 1]!)} r={4.5} className={`mark ${m.kind}`} /> : null,
        )}
        {cps.map((_, i) => (
          <rect key={i} x={x(i) - (w - 2 * pad) / (n - 1) / 2} width={(w - 2 * pad) / (n - 1)} y={0} height={h} fill="transparent" onPointerDown={() => onSelect(i)} />
        ))}
      </svg>
      {children}
    </div>
  );
}

export interface Series {
  name: string;
  color: string; // CSS colour (token)
  kind: 'line' | 'dots' | 'step';
  points: { x: number; y: number; tip?: string; onClick?: () => void }[];
}

/** Time-series chart: lines, steps and dots sharing one y-axis, with legend and hover tooltip. */
export function SeriesChart({ series, yFormat, height = 220, yStep = 10, yClamp }: { series: Series[]; yFormat: (v: number) => string; height?: number; yStep?: number; yClamp?: [number, number] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; y: number; tip: string } | null>(null);
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <p className="muted" style={{ fontSize: 13 }}>Not enough data yet.</p>;
  const padL = 44, padR = 12, padT = 10, padB = 24, h = height;
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let lo = Math.floor(Math.min(...ys) / yStep) * yStep, hi = Math.ceil(Math.max(...ys) / yStep) * yStep;
  if (yClamp) { lo = Math.max(yClamp[0], lo); hi = Math.min(yClamp[1], hi); }
  if (hi === lo) hi = lo + yStep;
  const X = (x: number) => padL + ((x - x0) / Math.max(1, x1 - x0)) * (w - padL - padR);
  const Y = (y: number) => padT + ((hi - y) / (hi - lo)) * (h - padT - padB);
  const ticks = [0, 1, 2, 3, 4].map((k) => lo + ((hi - lo) * k) / 4);
  const days = (x1 - x0) / 86_400_000;
  const fmtX = (x: number) => new Date(x).toLocaleDateString('en-GB', days > 400 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });
  const nTicks = x1 === x0 ? 1 : Math.max(2, Math.min(6, Math.floor((w - padL) / 90)));
  const xTicks = nTicks === 1 ? [x0] : Array.from({ length: nTicks }, (_, k) => x0 + ((x1 - x0) * k) / (nTicks - 1));
  return (
    <div className="series-chart" ref={ref} style={{ position: 'relative' }}>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => <span key={s.name}><i className={s.kind === 'dots' ? 'dot' : ''} style={{ background: s.color }} /> {s.name}</span>)}
        </div>
      )}
      <svg width={w} height={h} role="img" aria-label={series.map((s) => s.name).join(', ')} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} stroke="var(--grid)" />
            <text x={padL - 6} y={Y(t) + 4} className="axis" textAnchor="end">{yFormat(t)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => <text key={i} x={X(t)} y={h - 6} className="axis" textAnchor={xTicks.length === 1 ? 'start' : i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{fmtX(t)}</text>)}
        {series.map((s) => {
          if (s.kind === 'dots')
            return s.points.map((p, i) => (
              <circle key={`${s.name}${i}`} cx={X(p.x)} cy={Y(p.y)} r={4} fill={s.color} opacity={0.85} style={{ cursor: p.onClick ? 'pointer' : undefined }}
                onPointerEnter={() => setHover({ x: X(p.x), y: Y(p.y), tip: p.tip ?? yFormat(p.y) })} onClick={p.onClick} />
            ));
          const pts = [...s.points].sort((a, b) => a.x - b.x);
          const d = pts.map((p, i) => (s.kind === 'step' && i > 0 ? `H${X(p.x).toFixed(1)}V${Y(p.y).toFixed(1)}` : `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`)).join('');
          return <path key={s.name} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
        })}
      </svg>
      {hover && <div className="tooltip" style={{ left: Math.min(w - 160, Math.max(0, hover.x - 60)), top: Math.max(0, hover.y - 44) }}>{hover.tip}</div>}
    </div>
  );
}
