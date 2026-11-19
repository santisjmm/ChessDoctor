import { Chess, type Square } from 'chess.js';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DrillItem } from '../lib/db';
import { plyColor } from '../lib/openings';
import { Board } from './Board';

const label = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`;

/**
 * Play your side of a line from memory. The opponent's moves play themselves. A wrong move
 * snaps back, shows the right one and says why. Calls onFinish with the number of slips.
 */
export function LineDrill({
  item, onFinish, aside, children,
}: { item: DrillItem; onFinish: (misses: number) => void; aside?: ReactNode; children?: ReactNode }) {
  const { line, color } = item;
  const [ply, setPly] = useState(0);
  const [misses, setMisses] = useState(0);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad' | 'done'; text: string } | null>(null);
  const [shapes, setShapes] = useState<{ orig: Key; dest: Key; brush: string }[]>([]);
  const [finished, setFinished] = useState(false);

  const chess = useMemo(() => {
    const c = new Chess();
    for (const san of line.slice(0, ply)) c.move(san);
    return c;
  }, [line, ply]);

  useEffect(() => {
    if (ply < line.length && plyColor(ply) !== color) {
      const t = setTimeout(() => setPly((p) => p + 1), ply === 0 ? 600 : 450);
      return () => clearTimeout(t);
    }
    if (ply >= line.length && !finished) {
      setFinished(true);
      setFeedback({ kind: 'done', text: misses ? `Done with ${misses} slip${misses > 1 ? 's' : ''}. It comes back in 10 minutes.` : 'Clean run.' });
      onFinish(misses);
    }
  }, [ply, line, color, misses, finished, onFinish]);

  // Test hook for the headless screenshot run (scripts/screenshots.mjs).
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__trainColor = color;
    w.__trainPly = ply;
    w.__trainItem = item.id;
    const c = new Chess();
    w.__trainTarget = line.map((san, i) => {
      const legal = c.moves({ verbose: true });
      const mv = c.move(san);
      const wrong = legal.find((m) => m.san !== san);
      return { ply: i, mine: plyColor(i) === color, uci: mv.from + mv.to, wrong: wrong && wrong.from + wrong.to };
    });
  }, [ply, line, color, item.id]);

  const expected = ply < line.length ? line[ply] : null;
  const myTurn = !!expected && plyColor(ply) === color;
  const dests = useMemo(() => {
    const m = new Map<Key, Key[]>();
    if (!myTurn) return m;
    for (const mv of chess.moves({ verbose: true })) m.set(mv.from as Key, [...(m.get(mv.from as Key) ?? []), mv.to as Key]);
    return m;
  }, [chess, myTurn]);

  function why(san: string): string {
    if (ply === item.focusPly && item.reason) return item.reason;
    if (ply === item.focusPly && item.played) return `You usually play ${label(ply, item.played)} here; ${label(ply, san)} is better.`;
    if (item.kind === 'line') return 'This is the move you play most often here.';
    return ply < item.focusPly ? 'This is the way into the position you keep getting wrong.' : 'This is the engine’s move here.';
  }

  const last = chess.history({ verbose: true }).at(-1);
  const config: Config = {
    fen: chess.fen(),
    orientation: color === 'w' ? 'white' : 'black',
    turnColor: chess.turn() === 'w' ? 'white' : 'black',
    lastMove: last ? [last.from as Key, last.to as Key] : undefined,
    check: chess.inCheck(),
    movable: {
      free: false,
      color: myTurn ? (color === 'w' ? 'white' : 'black') : undefined,
      dests,
      showDests: true,
      events: {
        after: (from, to) => {
          let san = '';
          try {
            san = new Chess(chess.fen()).move({ from: from as Square, to: to as Square, promotion: 'q' }).san;
          } catch {
            return;
          }
          if (san === expected) {
            setFeedback({ kind: 'ok', text: `${label(ply, san)} ✓${ply === item.focusPly ? ' That’s the fix.' : ''}` });
            setShapes([]);
            setPly((p) => p + 1);
          } else {
            const right = new Chess(chess.fen()).move(expected!);
            setMisses((m) => m + 1);
            setFeedback({ kind: 'bad', text: `Not ${san}: play ${label(ply, expected!)}. ${why(expected!)}` });
            setShapes([{ orig: right.from as Key, dest: right.to as Key, brush: 'green' }]);
          }
        },
      },
    },
    drawable: { enabled: false, visible: true, autoShapes: shapes }, // a re-render snaps a wrong move back
    animation: { enabled: true, duration: 200 },
  };

  return (
    <div className="drill split">
      <div className="split-main">
        <Board config={config} />
      </div>
      <div className="split-side">
      {aside}
      <p className={`feedback ${feedback?.kind ?? ''}`} aria-live="polite">
        {feedback?.text ?? (myTurn ? (ply === item.focusPly ? 'Your move. This is the one you usually get wrong.' : 'Your move.') : '…')}
      </p>
      <p className="moves">
        {line.slice(0, ply).map((san, i) => (
          <span key={i} className={plyColor(i) === color ? 'mine' : ''}>
            {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}
            {san}{' '}
          </span>
        ))}
      </p>
      {children}
      </div>
    </div>
  );
}
