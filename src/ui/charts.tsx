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
export function LineChart({ points, format, title }: { points: Point[]; format: (v: number) => string; title: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = 180, padL = 36, padR = 12, padT = 12, padB = 26;
  const vals = points.map((p) => p.value);
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 5) / 10) * 10);
  const hi = Math.min(100, Math.ceil((Math.max(...vals) + 5) / 10) * 10);
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
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={i} x={x(i)} y={h - 8} className="axis" textAnchor="middle">{p.label}</text>
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
