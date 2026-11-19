import { Chess, type Square } from 'chess.js';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getEngine } from '../lib/analysis';
import type { DrillItem } from '../lib/db';
import { PUZZLE_ACCEPT_DROP } from '../lib/drills';
import { pvToSan } from '../lib/gr/explain';
import { winPctFor } from '../lib/gr/winprob';
import { cachedEval, PHONE_LIMITS } from '../lib/leakcheck';
import { Board } from './Board';

const label = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`;

/**
 * Find a good move in a position from one of your games. Any move within 2% win chance of the
 * engine's best counts; moves the stored lines don't cover get a fresh search.
 */
export function PositionDrill({
  item, onFinish, aside, children,
}: { item: DrillItem; onFinish: (misses: number) => void; aside?: ReactNode; children?: ReactNode }) {
  const fen = item.fen!;
  const color = item.color;
  const [state, setState] = useState<'move' | 'checking' | 'right' | 'wrong'>('move');
  const [tried, setTried] = useState<{ uci: string; san: string } | null>(null);
  const chess = useMemo(() => new Chess(fen), [fen]);
  const bestSan = pvToSan(fen, [item.best!])[0] ?? item.best!;

  // Test hook for the headless run.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__puzzle = { fen, best: item.best, color, state };
  }, [fen, item.best, color, state]);

  async function judge(uci: string, san: string) {
    setTried({ uci, san });
    if (item.accept?.includes(uci)) return finish(true);
    if (uci === item.best) return finish(true);
    setState('checking');
    try {
      const before = await cachedEval(getEngine(), fen, PHONE_LIMITS);
      const after = new Chess(fen);
      after.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      const r = await cachedEval(getEngine(), after.fen(), PHONE_LIMITS);
      const ev = (x: { cp: number; mate: number | null }) => (x.mate !== null ? { cp: null, mate: x.mate } : { cp: x.cp, mate: null });
      const drop = winPctFor(ev(before), color) - winPctFor(ev(r), color);
      finish(drop <= PUZZLE_ACCEPT_DROP);
    } catch {
      finish(false);
    }
  }
  function finish(ok: boolean) {
    setState(ok ? 'right' : 'wrong');
    onFinish(ok ? 0 : 1);
  }

  const dests = new Map<Key, Key[]>();
  if (state === 'move') for (const m of chess.moves({ verbose: true })) dests.set(m.from as Key, [...(dests.get(m.from as Key) ?? []), m.to as Key]);
  const shownFen = tried ? (() => { const c = new Chess(fen); c.move({ from: tried.uci.slice(0, 2), to: tried.uci.slice(2, 4), promotion: tried.uci[4] }); return state === 'wrong' ? fen : c.fen(); })() : fen;
  const config: Config = {
    fen: shownFen,
    orientation: color === 'w' ? 'white' : 'black',
    turnColor: color === 'w' ? 'white' : 'black',
    movable: {
      free: false,
      color: state === 'move' ? (color === 'w' ? 'white' : 'black') : undefined,
      dests,
      showDests: true,
      events: {
        after: (from, to) => {
          const m = new Chess(fen).move({ from: from as Square, to: to as Square, promotion: 'q' });
          void judge(m.from + m.to + (m.promotion ?? ''), m.san);
        },
      },
    },
    drawable: {
      enabled: false, visible: true,
      autoShapes: state === 'wrong' || state === 'right' ? [{ orig: item.best!.slice(0, 2) as Key, dest: item.best!.slice(2, 4) as Key, brush: 'green' }] : [],
    },
  };
  return (
    <div className="drill split">
      <div className="split-main"><Board config={config} /></div>
      <div className="split-side">
        {aside}
        <p className={`feedback ${state === 'right' ? 'ok' : state === 'wrong' ? 'bad' : ''}`} aria-live="polite">
          {state === 'move' && `${color === 'w' ? 'White' : 'Black'} to move. In the game you played ${label(item.focusPly, item.played ?? '?')}. Find a better move.`}
          {state === 'checking' && `Checking ${tried?.san}…`}
          {state === 'right' && `${tried?.san} ✓ ${tried?.uci === item.best ? 'The engine’s move.' : `Good enough: within ${PUZZLE_ACCEPT_DROP}% of the best (${bestSan}).`}`}
          {state === 'wrong' && `Not ${tried?.san}. Best was ${bestSan}. It comes back in 10 minutes.`}
        </p>
        {(state === 'right' || state === 'wrong') && item.reason && <p className="hint">About your game move: {item.reason}</p>}
        {children}
      </div>
    </div>
  );
}
