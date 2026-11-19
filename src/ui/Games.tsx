import { Chess } from 'chess.js';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { getEngine } from '../lib/analysis';
import { db, type DrillItem, type GameReview } from '../lib/db';
import { drillId } from '../lib/drills';
import { evalWords } from '../lib/reason';
import { classify, drops, reviewGame } from '../lib/review';
import { OPENING_PLIES, plyColor, type GameOpening } from '../lib/openings';
import { Board } from './Board';
import { EvalGraph } from './charts';

const label = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`;
const fmtDate = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const RESULT = { 1: ['Won', 'good'], 0.5: ['Draw', 'muted'], 0: ['Lost', 'bad'] } as const;
const SYMBOL = { inaccuracy: '?!', mistake: '?', blunder: '??' } as const;

export function Games({ items, onDrill }: { items: GameOpening[]; onDrill: (d: DrillItem) => void }) {
  const [filter, setFilter] = useState<'all' | 'w' | 'b'>('all');
  const [shown, setShown] = useState(40);
  const [open, setOpen] = useState<GameOpening | null>(null);
  const reviews = useLiveQuery(() => db.reviews.toArray(), [], [] as GameReview[]);
  const byId = useMemo(() => new Map(reviews.map((r) => [r.id, r])), [reviews]);
  const list = useMemo(
    () => [...items].filter((i) => filter === 'all' || i.game.color === filter).sort((a, b) => b.game.playedAt - a.game.playedAt),
    [items, filter],
  );
  if (open) return <GameReviewView item={open} onBack={() => setOpen(null)} onDrill={onDrill} />;
  return (
    <main className="screen games">
      <header className="row">
        <h1 className="tight">Games</h1>
        <div className="seg" role="tablist" aria-label="Colour">
          {(['all', 'w', 'b'] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'w' ? 'White' : 'Black'}</button>
          ))}
        </div>
      </header>
      <p className="hint">Tap a game to review its opening. The newest games are reviewed in the background.</p>
      <ul className="game-list">
        {list.slice(0, shown).map((it) => {
          const r = byId.get(it.game.id);
          const [res, cls] = RESULT[it.game.score];
          return (
            <li key={it.game.id}>
              <button className="game-row" onClick={() => setOpen(it)}>
                <span className={`res ${cls}`}>{res}</span>
                <span className="g-main">
                  <b>vs {it.game.opponent}{it.game.oppRating ? ` (${it.game.oppRating})` : ''}</b>
                  <span className="muted">{it.opening?.family ?? 'Unknown opening'} · {it.game.color === 'w' ? 'White' : 'Black'} · {it.game.speed} · {fmtDate(it.game.playedAt)}</span>
                </span>
                <span className="g-acc">
                  {r?.accuracy != null ? <b>{Math.round(r.accuracy)}%</b> : <span className="muted">–</span>}
                  {r?.firstMistake && <i className="tag red">{label(r.firstMistake.ply, r.firstMistake.played)}</i>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {shown < list.length && <button className="secondary" onClick={() => setShown((s) => s + 40)}>Show more</button>}
    </main>
  );
}

function GameReviewView({ item, onBack, onDrill }: { item: GameOpening; onBack: () => void; onDrill: (d: DrillItem) => void }) {
  const { game } = item;
  const sans = item.sans.slice(0, OPENING_PLIES);
  const [review, setReview] = useState<GameReview | null>(null);
  const [partial, setPartial] = useState<number[]>([]);
  const [ply, setPly] = useState(0); // positions 0..sans.length
  useEffect(() => {
    let live = true;
    reviewGame(getEngine(), item, (_d, _t, cps) => live && setPartial(cps)).then((r) => {
      if (!live) return;
      setReview(r);
      if (r.firstMistake) setPly(r.firstMistake.ply);
    });
    return () => {
      live = false;
    };
  }, [item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setPly((p) => Math.min(sans.length, p + 1));
      else if (e.key === 'Home') setPly(0);
      else if (e.key === 'End') setPly(sans.length);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sans.length]);

  const cps: (number | null)[] = review?.cps ?? [...partial, ...Array(sans.length + 1 - partial.length).fill(null)];
  const d = review ? drops(review.cps, game.color) : [];
  const marks = d
    .map((x, i) => ({ ply: i, x }))
    .filter((m): m is { ply: number; x: number } => m.x !== null && m.x >= 5)
    .map((m) => ({ ply: m.ply, kind: classify(m.x) as 'inaccuracy' | 'mistake' | 'blunder' }));

  const chess = useMemo(() => {
    const c = new Chess();
    for (const s of sans.slice(0, ply)) c.move(s);
    return c;
  }, [sans, ply]);
  const last = chess.history({ verbose: true }).at(-1);
  const bestHere = review?.best[ply];
  const config: Config = {
    fen: chess.fen(),
    orientation: game.color === 'w' ? 'white' : 'black',
    viewOnly: true,
    lastMove: last ? [last.from as Key, last.to as Key] : undefined,
    check: chess.inCheck(),
    coordinates: false,
    drawable: {
      enabled: false,
      visible: true,
      autoShapes: bestHere && ply < sans.length ? [{ orig: bestHere.slice(0, 2) as Key, dest: bestHere.slice(2, 4) as Key, brush: 'green' }] : [],
    },
  };
  const fm = review?.firstMistake;
  const [res, cls] = RESULT[game.score];
  const nowCp = cps[ply];

  return (
    <main className="screen review">
      <header className="row">
        <button className="link" onClick={onBack}>← Games</button>
        <a className="link" href={game.url} target="_blank" rel="noreferrer">Open game ↗</a>
      </header>
      <div>
        <h2 className="tight"><span className={cls}>{res}</span> vs {game.opponent}</h2>
        <p className="hint">{item.opening?.name ?? 'Unknown opening'} · {game.color === 'w' ? 'White' : 'Black'} · {game.speed} · {fmtDate(game.playedAt)}</p>
      </div>
      <div className="split">
      <div className="split-main">
      <div className="mini-board"><Board config={config} /></div>
      <EvalGraph cps={cps} marks={marks} current={ply} onSelect={setPly} />
      <div className="row nav-row">
        <button className="secondary small" onClick={() => setPly(0)} aria-label="Start">⏮</button>
        <button className="secondary small" onClick={() => setPly((p) => Math.max(0, p - 1))} aria-label="Back">◀</button>
        <span className="muted center grow">
          {ply ? label(ply - 1, sans[ply - 1]) : 'Start'}
          {nowCp != null ? ` · ${evalWords(nowCp, game.color)}` : ''}
        </span>
        <button className="secondary small" onClick={() => setPly((p) => Math.min(sans.length, p + 1))} aria-label="Forward">▶</button>
        <button className="secondary small" onClick={() => setPly(sans.length)} aria-label="End">⏭</button>
      </div>
      </div>
      <div className="split-side">
      {!review && <p className="hint">Analysing the opening on this device… {partial.length}/{sans.length + 1}</p>}
      {review && (
        <section className={`verdict ${fm ? 'has-mistake' : ''}`}>
          <p className="eyebrow tight">Opening accuracy {review.accuracy != null ? `${Math.round(review.accuracy)}%` : '–'}</p>
          {fm ? (
            <>
              <p className="verdict-title">First real mistake: <span className="bad">{label(fm.ply, fm.played)}{SYMBOL[classify(fm.drop) as keyof typeof SYMBOL] ?? ''}</span></p>
              <p>Better: <b className="good">{label(fm.ply, fm.best)}</b>. {fm.reason}</p>
              <div className="row">
                <button className="secondary small" onClick={() => setPly(fm.ply)}>Show position</button>
                <button
                  className="primary small"
                  onClick={() => {
                    const line = [...sans.slice(0, fm.ply), fm.best];
                    onDrill({
                      id: drillId(game.color, line), kind: 'mistake', color: game.color, family: item.opening?.family ?? 'Unknown',
                      opening: item.opening?.name, line, focusPly: fm.ply, played: fm.played, reason: fm.reason, games: 1,
                      createdAt: Date.now(), box: 0, due: Date.now(), reps: 0, lapses: 0,
                    });
                  }}
                >
                  Drill this
                </button>
              </div>
            </>
          ) : (
            <p className="verdict-title">No real mistakes in the first {Math.ceil(sans.length / 2)} moves.</p>
          )}
        </section>
      )}
      <p className="moves review-moves">
        {sans.map((s, i) => {
          const k = d[i] != null && d[i]! >= 5 ? classify(d[i]!) : null;
          return (
            <button key={i} className={`mvbtn ${plyColor(i) === game.color ? 'mine' : ''} ${ply === i + 1 ? 'on' : ''} ${k ?? ''}`} onClick={() => setPly(i + 1)}>
              {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}{s}{k ? SYMBOL[k as keyof typeof SYMBOL] : ''}
            </button>
          );
        })}
      </p>
      <p className="hint">On a keyboard: ← → step through the moves, Home / End jump to the start / end.</p>
      </div>
      </div>
    </main>
  );
}
