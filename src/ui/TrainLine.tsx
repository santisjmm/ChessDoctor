import { Chess, type Square } from 'chess.js';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/db';
import { moveLabel, type ReportResult } from '../lib/pipeline';
import { plyColor } from '../lib/openings';
import { Board } from './Board';

/**
 * First version of the drill: play your side of the leak line from memory. The opponent's
 * moves are played for you; at the leak, the expected move is the engine's better move.
 */
export function TrainLine({ result, onBack }: { result: ReportResult; onBack: () => void }) {
  const leak = result.report.leak!;
  const color = leak.stat.color;
  const target = useMemo(() => {
    const m = result.mistake;
    const base = result.leakLine ?? leak.line;
    if (m) return [...base.slice(0, m.ply), m.best];
    // No engine mistake: train the usual line through the user's last move in it.
    let end = base.length;
    while (end > leak.exitPly + 1 && plyColor(end - 1) !== color) end--;
    return base.slice(0, end);
  }, [result, leak, color]);
  const [ply, setPly] = useState(0);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad' | 'done'; text: string } | null>(null);
  const [misses, setMisses] = useState(0);
  const [saved, setSaved] = useState(false);

  const chess = useMemo(() => {
    const c = new Chess();
    for (const san of target.slice(0, ply)) c.move(san);
    return c;
  }, [target, ply]);

  // Opponent moves play themselves.
  useEffect(() => {
    if (ply < target.length && plyColor(ply) !== color) {
      const t = setTimeout(() => setPly((p) => p + 1), 450);
      return () => clearTimeout(t);
    }
    if (ply >= target.length && !saved) {
      setFeedback({ kind: 'done', text: misses ? `Line done with ${misses} slip${misses > 1 ? 's' : ''}. Run it again to make it stick.` : 'Clean run.' });
      db.lines
        .add({ createdAt: Date.now(), color, family: leak.stat.family, line: target, ply: target.length - 1, better: result.mistake?.best, source: 'report' })
        .then(() => setSaved(true))
        .catch(() => setSaved(true));
    }
  }, [ply, target, color, misses, saved, leak, result.mistake]);

  // Test hook for the headless screenshot run (scripts/screenshots.mjs).
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__trainColor = color;
    w.__trainPly = ply;
    if (!w.__trainTarget) {
      const c = new Chess();
      w.__trainTarget = target.map((san, i) => {
        const legal = c.moves({ verbose: true });
        const mv = c.move(san);
        const wrong = legal.find((m) => m.san !== san);
        return { ply: i, mine: plyColor(i) === color, uci: mv.from + mv.to, wrong: wrong && wrong.from + wrong.to };
      });
    }
  }, [ply, target, color]);

  const expected = ply < target.length ? target[ply] : null;
  const dests = useMemo(() => {
    const m = new Map<Key, Key[]>();
    if (!expected || plyColor(ply) !== color) return m;
    for (const mv of chess.moves({ verbose: true })) {
      const arr = m.get(mv.from as Key) ?? [];
      arr.push(mv.to as Key);
      m.set(mv.from as Key, arr);
    }
    return m;
  }, [chess, expected, ply, color]);

  const last = chess.history({ verbose: true }).at(-1);
  const [shapes, setShapes] = useState<NonNullable<Config['drawable']>['shapes']>([]);
  const config: Config = {
    fen: chess.fen(),
    orientation: color === 'w' ? 'white' : 'black',
    turnColor: chess.turn() === 'w' ? 'white' : 'black',
    lastMove: last ? [last.from as Key, last.to as Key] : undefined,
    check: chess.inCheck(),
    movable: {
      free: false,
      color: plyColor(ply) === color && expected ? (color === 'w' ? 'white' : 'black') : undefined,
      dests,
      showDests: true,
      events: {
        after: (from, to) => {
          const probe = new Chess(chess.fen());
          let san = '';
          try {
            san = probe.move({ from: from as Square, to: to as Square, promotion: 'q' }).san;
          } catch {
            return;
          }
          if (san === expected) {
            setFeedback({ kind: 'ok', text: `${moveLabel(ply, san)} ✓` });
            setShapes([]);
            setPly((p) => p + 1);
          } else {
            const right = new Chess(chess.fen()).move(expected!);
            setMisses((m) => m + 1);
            setFeedback({ kind: 'bad', text: `Not ${san}. The move is ${moveLabel(ply, expected!)}.` });
            setShapes([{ orig: right.from as Key, dest: right.to as Key, brush: 'green' }]);
          }
        },
      },
    },
    drawable: { enabled: false, visible: true, autoShapes: shapes }, // re-render snaps a wrong move back
    animation: { enabled: true, duration: 200 },
  };

  return (
    <main className="screen train">
      <header className="row">
        <button className="link" onClick={onBack}>← Report</button>
        <span className="muted">{leak.stat.family}</span>
      </header>
      <h1>Train this line</h1>
      <p className="hint">Play {color === 'w' ? 'White' : 'Black'}'s moves from memory. {result.mistake ? `At move ${moveLabel(result.mistake.ply, '').replace(/\.+$/, '')} play the better move, not the one you usually play.` : ''}</p>
      <Board config={config} />
      <p className={`feedback ${feedback?.kind ?? ''}`} aria-live="polite">
        {feedback?.text ?? (plyColor(ply) === color ? 'Your move.' : '…')}
      </p>
      <p className="moves">
        {target.slice(0, ply).map((san, i) => (
          <span key={i} className={plyColor(i) === color ? 'mine' : ''}>
            {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}
            {san}{' '}
          </span>
        ))}
      </p>
      {feedback?.kind === 'done' && (
        <div className="actions">
          <button
            className="secondary"
            onClick={() => {
              setPly(0);
              setMisses(0);
              setFeedback(null);
              setSaved(false);
              setShapes([]);
            }}
          >
            Again
          </button>
          <button className="primary" onClick={onBack}>Done</button>
        </div>
      )}
      {saved && <p className="hint center">Saved to your training on this device. Daily drills and the full openings tree come in the next update.</p>}
    </main>
  );
}
