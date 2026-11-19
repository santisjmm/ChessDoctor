// Classification badges, ported from the Review app (components/ClassIcon.tsx, lib/classes.ts):
// distinct shape + glyph + colour, so every class is distinguishable without colour vision.
import type { MoveClass } from '../lib/gr/classify';

type Shape = 'circle' | 'square' | 'hexagon';
export const CLASS_META: Record<MoveClass, { label: string; color: string; glyph: string; icon?: 'star' | 'thumb' | 'check' | 'book'; shape: Shape; ink: string; phrase: string }> = {
  brilliant: { label: 'Brilliant', color: '#179c96', glyph: '!!', shape: 'circle', ink: '#fff', phrase: 'brilliant' },
  great: { label: 'Great', color: '#5585ad', glyph: '!', shape: 'circle', ink: '#fff', phrase: 'a great move' },
  best: { label: 'Best', color: '#6a9f3a', glyph: '', icon: 'star', shape: 'circle', ink: '#fff', phrase: 'best' },
  excellent: { label: 'Excellent', color: '#4f9145', glyph: '', icon: 'thumb', shape: 'circle', ink: '#fff', phrase: 'excellent' },
  good: { label: 'Good', color: '#6f8a59', glyph: '', icon: 'check', shape: 'circle', ink: '#fff', phrase: 'good' },
  book: { label: 'Book', color: '#977756', glyph: '', icon: 'book', shape: 'square', ink: '#fff', phrase: 'a book move' },
  inaccuracy: { label: 'Inaccuracy', color: '#e8b222', glyph: '?!', shape: 'hexagon', ink: '#1b1a18', phrase: 'an inaccuracy' },
  mistake: { label: 'Mistake', color: '#e58f2a', glyph: '?', shape: 'hexagon', ink: '#1b1a18', phrase: 'a mistake' },
  miss: { label: 'Miss', color: '#d65a40', glyph: '×', shape: 'hexagon', ink: '#fff', phrase: 'a miss' },
  blunder: { label: 'Blunder', color: '#ca3431', glyph: '??', shape: 'hexagon', ink: '#fff', phrase: 'a blunder' },
};
export const CLASS_ORDER: MoveClass[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];

const ICONS = {
  star: 'M12 3.6l2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.5l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7z',
  thumb: 'M7.5 10.5v8h-3v-8zm2 8V10l3.2-5.4c.8-.1 1.7.5 1.6 1.5l-.6 3.4h4.1c1 0 1.7.9 1.5 1.9l-1.2 5.6c-.2.9-1 1.5-1.9 1.5z',
  check: 'M5 12.5l4.3 4.3L19 7.1',
  book: 'M5.5 5.5c2.5-.8 4.7-.4 6.5 1v11c-1.8-1.4-4-1.8-6.5-1zm13 0c-2.5-.8-4.7-.4-6.5 1v11c1.8-1.4 4-1.8 6.5-1z',
} as const;

function hexagon(r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${12 + r * Math.cos(a)},${12 + r * Math.sin(a)}`;
  }).join(' ');
}

export function ClassIcon({ cls, size = 18, title = true }: { cls: MoveClass; size?: number; title?: boolean }) {
  const m = CLASS_META[cls];
  const ring = 'rgba(0,0,0,0.28)';
  return (
    <svg className="class-icon" width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title ? m.label : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{m.label}</title>}
      {m.shape === 'circle' && <circle cx="12" cy="12" r="11" fill={m.color} stroke={ring} strokeWidth="1" />}
      {m.shape === 'square' && <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill={m.color} stroke={ring} strokeWidth="1" />}
      {m.shape === 'hexagon' && <polygon points={hexagon(11.6)} fill={m.color} stroke={ring} strokeWidth="1" strokeLinejoin="round" />}
      {m.icon === 'check' ? (
        <path d={ICONS.check} fill="none" stroke={m.ink} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : m.icon ? (
        <path d={ICONS[m.icon]} fill={m.ink} />
      ) : (
        <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central" fill={m.ink} fontSize={m.glyph.length > 1 ? 11.5 : 15} fontWeight="800" fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif" letterSpacing={m.glyph.length > 1 ? -0.8 : 0}>
          {m.glyph}
        </text>
      )}
    </svg>
  );
}

/** Small result badge (W / L / D) as in the Review app's games list. */
export function ResultBadge({ score }: { score: 0 | 0.5 | 1 }) {
  const [cls, t] = score === 1 ? ['win', 'W'] : score === 0 ? ['loss', 'L'] : ['draw', 'D'];
  return <span className={`result ${cls}`} aria-label={cls}><span>{t}</span></span>;
}

/** Neutral platform tile (no third-party branding). */
export function PlatformTile({ site }: { site: 'lichess' | 'chesscom' | 'pgn' }) {
  const [t, bg] = site === 'lichess' ? ['Li', '#5d5b56'] : site === 'chesscom' ? ['C', '#6a9f3a'] : ['P', '#5585ad'];
  return (
    <span className="platform-icon platform-tile" style={{ background: bg }} title={site === 'lichess' ? 'Lichess' : site === 'chesscom' ? 'Chess.com' : 'PGN import'}>
      {t}
    </span>
  );
}
