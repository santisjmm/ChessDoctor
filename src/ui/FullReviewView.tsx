import { Chess, type Square } from 'chess.js';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getEngine } from '../lib/analysis';
import { loadBook } from '../lib/book';
import { db } from '../lib/db';
import type { MoveClass } from '../lib/gr/classify';
import { explain, pvToSan } from '../lib/gr/explain';
import { fullReview, type FullReview } from '../lib/gr/fullreview';
import { cpEval, formatEval, mateEval, whiteCp, type Eval } from '../lib/gr/winprob';
import { cachedEval, PHONE_LIMITS } from '../lib/leakcheck';
import type { GameOpening } from '../lib/openings';
import type { Color } from '../lib/types';
import { Board } from './Board';
import { EvalGraph } from './charts';

export const CLASS_META: Record<MoveClass, { sym: string; label: string }> = {
  brilliant: { sym: '!!', label: 'Brilliant' },
  great: { sym: '!', label: 'Great' },
  best: { sym: '★', label: 'Best' },
  excellent: { sym: '', label: 'Excellent' },
  good: { sym: '', label: 'Good' },
  book: { sym: '', label: 'Book' },
  inaccuracy: { sym: '?!', label: 'Inaccuracy' },
  mistake: { sym: '?', label: 'Mistake' },
  miss: { sym: '×', label: 'Miss' },
  blunder: { sym: '??', label: 'Blunder' },
};
const ARTICLE: Record<MoveClass, string> = {
  brilliant: 'brilliant', great: 'a great move', best: 'the best move', excellent: 'excellent', good: 'good', book: 'a book move',
  inaccuracy: 'an inaccuracy', mistake: 'a mistake', miss: 'a miss', blunder: 'a blunder',
};
const ERRORS = new Set<MoveClass>(['inaccuracy', 'mistake', 'miss', 'blunder']);
const SHOWN: MoveClass[] = ['brilliant', 'great', 'best', 'inaccuracy', 'mistake', 'miss', 'blunder'];
const label = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`;
const play = (c: Chess, uci: string) => c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });

export function FullReviewView({
  item, onTrainMistake, onReviewed,
}: {
  item: GameOpening;
  onTrainMistake: (review: FullReview, ply: number) => void;
  onReviewed?: (review: FullReview) => void;
}) {
  const { game } = item;
  const me = game.color;
  const [review, setReview] = useState<FullReview | null | undefined>(undefined); // undefined = loading cache
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [ply, setPly] = useState(0);
  const [variation, setVariation] = useState<{ base: number; moves: string[]; at: number } | null>(null);
  const [varEval, setVarEval] = useState<{ eval: Eval; best: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    db.fullReviews.get(game.id).then((r) => setReview(r ?? null)).catch(() => setReview(null));
    return () => abort.current?.abort();
  }, [game.id]);

  const run = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setProgress([0, 1]);
    try {
      const r = await fullReview(getEngine(), game, await loadBook(), (d, t) => setProgress([d, t]), ac.signal);
      setReview(r);
      onReviewed?.(r);
      const firstMine = r.keyMoments.find((i) => r.plies[i].color === me);
      setPly(firstMine !== undefined ? firstMine + 1 : 0);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e;
    } finally {
      setProgress(null);
    }
  };

  // Position shown: the game at `ply`, or a variation branching from it.
  const shown = useMemo(() => {
    if (!review) return null;
    const c = new Chess(review.fens[variation ? variation.base : ply]);
    const vm = variation ? variation.moves.slice(0, variation.at) : [];
    let last: [Key, Key] | undefined;
    for (const u of vm) {
      const m = play(c, u);
      last = [m.from as Key, m.to as Key];
    }
    if (!variation && ply > 0) {
      const m = new Chess(review.fens[ply - 1]).move(review.sans[ply - 1]);
      last = [m.from as Key, m.to as Key];
    }
    return { chess: c, last };
  }, [review, ply, variation]);

  // Engine eval for variation positions (one search each, cached).
  useEffect(() => {
    if (!variation || !shown) return setVarEval(null);
    let live = true;
    const fen = shown.chess.fen();
    if (shown.chess.isGameOver()) {
      setVarEval({ eval: shown.chess.isCheckmate() ? mateEval(0, shown.chess.turn() === 'w' ? 'b' : 'w') : cpEval(0), best: '' });
      return;
    }
    cachedEval(getEngine(), fen, PHONE_LIMITS).then((r) => live && setVarEval({ eval: r.mate !== null ? mateEval(r.mate) : cpEval(r.cp), best: r.bestmove }));
    return () => {
      live = false;
    };
  }, [variation, shown]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!review) return;
      const n = review.sans.length;
      if (e.key === 'Escape') setVariation(null);
      else if (e.key === 'ArrowLeft') {
        if (variation) setVariation((v) => (v && v.at > 0 ? { ...v, at: v.at - 1 } : null));
        else setPly((p) => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight') {
        if (variation) setVariation((v) => v && { ...v, at: Math.min(v.moves.length, v.at + 1) });
        else setPly((p) => Math.min(n, p + 1));
      } else if (e.key === 'Home') !variation && setPly(0);
      else if (e.key === 'End') !variation && setPly(n);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review, variation]);

  if (review === undefined) return <p className="hint">Loading…</p>;
  if (!review)
    return (
      <section className="verdict">
        <p className="verdict-title">Review the whole game</p>
        <p className="hint">
          Every move classified (brilliant to blunder), accuracy for both players, a Game Rating and the key moments, computed on this device. About {Math.round((Math.min(game.moves.length, 160) + 1) * 0.5)} seconds on a phone; the result is saved.
        </p>
        {progress ? (
          <div className="bar">
            <div className="bar-label"><span>Analysing</span><span>{progress[0]} / {progress[1]} positions</span></div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${(progress[0] / progress[1]) * 100}%` }} /></div>
          </div>
        ) : (
          <button className="primary" onClick={run}>Review the whole game</button>
        )}
      </section>
    );

  const n = review.sans.length;
  const chess = shown!.chess;
  const turn = chess.turn();
  const dests = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) dests.set(m.from as Key, [...(dests.get(m.from as Key) ?? []), m.to as Key]);
  // On an error: the move that should have been played (green). Otherwise: the engine's move for the side to move (pale).
  const prevPly = ply > 0 ? review.plies[ply - 1] : null;
  const showFix = !variation && !!prevPly && ERRORS.has(prevPly.classification);
  const bestHere = variation ? varEval?.best : showFix ? review.positions[ply - 1].lines[0]?.move : review.positions[ply]?.lines[0]?.move;
  const config: Config = {
    fen: chess.fen(),
    orientation: me === 'w' ? 'white' : 'black',
    lastMove: shown!.last,
    check: chess.inCheck(),
    turnColor: turn === 'w' ? 'white' : 'black',
    movable: {
      free: false,
      color: turn === 'w' ? 'white' : 'black',
      dests,
      showDests: true,
      events: {
        after: (from, to) => {
          const m = new Chess(chess.fen()).move({ from: from as Square, to: to as Square, promotion: 'q' });
          const u = m.from + m.to + (m.promotion ?? '');
          if (variation) setVariation({ base: variation.base, moves: [...variation.moves.slice(0, variation.at), u], at: variation.at + 1 });
          else if (ply < n && review.fens[ply + 1] && new Chess(review.fens[ply]).move(review.sans[ply]).lan === m.lan) setPly(ply + 1);
          else setVariation({ base: ply, moves: [u], at: 1 });
        },
      },
    },
    drawable: {
      enabled: false, visible: true,
      autoShapes: bestHere ? [{ orig: bestHere.slice(0, 2) as Key, dest: bestHere.slice(2, 4) as Key, brush: showFix ? 'green' : 'paleBlue' }] : [],
    },
    coordinates: false,
  };

  const cur = ply > 0 ? review.plies[ply - 1] : null;
  const expl =
    cur && !variation
      ? explain({
          fenBefore: review.fens[ply - 1],
          uci: (() => {
            const m = new Chess(review.fens[ply - 1]).move(review.sans[ply - 1]);
            return m.from + m.to + (m.promotion ?? '');
          })(),
          classification: cur.classification,
          reasons: cur.reasons,
          best: review.positions[ply - 1].lines[0] ? { move: review.positions[ply - 1].lines[0].move, pv: review.positions[ply - 1].lines[0].pv, eval: review.positions[ply - 1].lines[0].eval } : null,
          replyPv: review.positions[ply]?.lines[0]?.pv ?? [],
          evalAfter: review.evals[ply],
        })
      : null;
  const bestLineBefore = cur ? review.positions[ply - 1].lines[0] : null;
  const bestSans = bestLineBefore && !variation ? pvToSan(review.fens[ply - 1], bestLineBefore.pv, 8) : [];
  const graph = review.evals.map((e) => whiteCp(e));
  const marks = review.plies
    .map((p, i) => ({ ply: i, kind: p.classification }))
    .filter((m) => m.kind === 'inaccuracy' || m.kind === 'mistake' || m.kind === 'blunder' || m.kind === 'miss' || m.kind === 'great' || m.kind === 'brilliant');
  const player = (c: Color) => {
    const s = c === 'w' ? review.white : review.black;
    const r = review.rating[c];
    return (
      <div className={`player ${c === me ? 'me' : ''}`}>
        <div className="player-head">
          <b>{c === me ? 'You' : game.opponent}</b>
          <span className="acc">{s.accuracy != null ? `${s.accuracy.toFixed(1)}%` : '–'}</span>
        </div>
        <p className="hint tight">{r.rating ? `Game Rating ${r.rating} (${r.low}–${r.high})` : 'Game Rating: not enough moves'}</p>
        <div className="class-chips">
          {SHOWN.filter((k) => s.counts[k]).map((k) => (
            <span key={k} className={`chip cls-${k}`} title={CLASS_META[k].label}>
              {CLASS_META[k].sym || '•'} {s.counts[k]} <span className="chip-name">{CLASS_META[k].label}</span>
            </span>
          ))}
        </div>
      </div>
    );
  };
  const canTrain = cur && !variation && cur.color === me && (cur.classification === 'mistake' || cur.classification === 'blunder' || cur.classification === 'miss');

  return (
    <div className="split">
      <div className="split-main">
        <div className="mini-board"><Board config={config} /></div>
        <EvalGraph cps={graph} marks={marks as never} current={variation ? variation.base : ply} onSelect={(i) => { setVariation(null); setPly(i); }} />
        <div className="row nav-row">
          <button className="secondary small" onClick={() => { setVariation(null); setPly(0); }} aria-label="Start">⏮</button>
          <button className="secondary small" onClick={() => (variation ? setVariation(variation.at > 0 ? { ...variation, at: variation.at - 1 } : null) : setPly(Math.max(0, ply - 1)))} aria-label="Back">◀</button>
          <span className="muted center grow">
            {variation ? `Variation · ${varEval ? formatEval(varEval.eval) : '…'}` : `${ply ? label(ply - 1, review.sans[ply - 1]) : 'Start'} · ${formatEval(review.evals[ply])}`}
          </span>
          <button className="secondary small" onClick={() => (variation ? setVariation({ ...variation, at: Math.min(variation.moves.length, variation.at + 1) }) : setPly(Math.min(n, ply + 1)))} aria-label="Forward">▶</button>
          <button className="secondary small" onClick={() => { setVariation(null); setPly(n); }} aria-label="End">⏭</button>
        </div>
        <p className="hint">Drag a piece on any position to try your own line; the engine evaluates it.</p>
      </div>
      <div className="split-side">
        <div className="players">{player('w')}{player('b')}</div>

        {variation ? (
          <section className="verdict">
            <p className="verdict-title">Variation from {variation.base ? label(variation.base - 1, review.sans[variation.base - 1]) : 'the start'}</p>
            <p className="moves">
              {pvToSan(review.fens[variation.base], variation.moves).map((s, i) => (
                <button key={i} className={`mvbtn ${i + 1 === variation.at ? 'on' : ''}`} onClick={() => setVariation({ ...variation, at: i + 1 })}>
                  {label(variation.base + i, s)}
                </button>
              ))}
            </p>
            <p className="hint">{varEval ? `Engine: ${formatEval(varEval.eval)}${varEval.best ? `, best ${pvToSan(chess.fen(), [varEval.best])[0] ?? ''}` : ''}` : 'Engine thinking…'}</p>
            <button className="secondary small" onClick={() => setVariation(null)}>Back to the game (Esc)</button>
          </section>
        ) : cur && expl ? (
          <section className={`verdict cls-border-${cur.classification}`}>
            <p className="verdict-title">
              <span className={`badge cls-${cur.classification}`}>{CLASS_META[cur.classification].sym || '•'}</span> {label(ply - 1, review.sans[ply - 1])} is {ARTICLE[cur.classification]}
            </p>
            <p>{expl.detail}</p>
            {bestSans.length > 0 && !cur.isBest && (
              <p className="moves">
                <span className="muted">Best line: </span>
                {bestSans.map((s, i) => (
                  <button key={i} className="mvbtn" onClick={() => setVariation({ base: ply - 1, moves: bestLineBefore!.pv.slice(0, 8), at: i + 1 })}>
                    {label(ply - 1 + i, s)}
                  </button>
                ))}
              </p>
            )}
            {canTrain && <button className="primary small" onClick={() => onTrainMistake(review, ply - 1)}>Train this mistake</button>}
          </section>
        ) : (
          <p className="hint">Step through the game, or jump to a key moment.</p>
        )}

        {review.keyMoments.length > 0 && (
          <section>
            <h3>Key moments</h3>
            <div className="class-chips">
              {review.keyMoments.map((i) => (
                <button key={i} className={`chip cls-${review.plies[i].classification} ${ply === i + 1 && !variation ? 'on' : ''}`} onClick={() => { setVariation(null); setPly(i + 1); }}>
                  {label(i, review.sans[i])}{CLASS_META[review.plies[i].classification].sym}
                  {review.plies[i].color === me ? '' : ' (opp.)'}
                </button>
              ))}
            </div>
          </section>
        )}

        <p className="moves review-moves">
          {review.sans.map((s, i) => {
            const k = review.plies[i].classification;
            return (
              <button key={i} className={`mvbtn ${review.plies[i].color === me ? 'mine' : ''} ${ply === i + 1 && !variation ? 'on' : ''} cls-text-${k}`} onClick={() => { setVariation(null); setPly(i + 1); }}>
                {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}{s}{CLASS_META[k].sym === '★' ? '' : CLASS_META[k].sym}
              </button>
            );
          })}
        </p>
        {review.truncated && <p className="hint">Long game: the first {n / 2} moves were reviewed.</p>}
        <p className="hint">Classifications follow the Review app’s rules (similar to chess.com’s, not identical). Accuracy is calibrated to chess.com’s; Game Rating is our own estimate and can differ by ~200 points for a single game.</p>
      </div>
    </div>
  );
}
