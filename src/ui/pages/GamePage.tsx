import { Chess, type Square } from 'chess.js';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Copy, ExternalLink, FlipVertical2, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getEngine } from '../../lib/analysis';
import { loadBook } from '../../lib/book';
import { db } from '../../lib/db';
import type { MoveClass } from '../../lib/gr/classify';
import { explain, pvToSan } from '../../lib/gr/explain';
import { fullReview, type FullReview } from '../../lib/gr/fullreview';
import { cpEval, formatEval, mateEval, whiteCp, whiteWinPct, type Eval } from '../../lib/gr/winprob';
import { cachedEval, PHONE_LIMITS } from '../../lib/leakcheck';
import type { GameOpening } from '../../lib/openings';
import type { Color } from '../../lib/types';
import { Board } from '../Board';
import { EvalGraph } from '../charts';
import { CLASS_META, CLASS_ORDER, ClassIcon } from '../ClassIcon';

const ORDER = CLASS_ORDER;
const ERRORS = new Set<MoveClass>(['inaccuracy', 'mistake', 'miss', 'blunder']);
const SPEED: Record<string, string> = { ultraBullet: 'UltraBullet', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', daily: 'Daily', correspondence: 'Daily', unknown: '' };
const label = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`;
const play = (c: Chess, uci: string) => c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });
const toEval = (r: { cp: number; mate: number | null }): Eval => (r.mate !== null ? mateEval(r.mate) : cpEval(r.cp));

function EvalBar({ ev, orientation }: { ev: Eval | null; orientation: Color }) {
  const w = ev ? whiteWinPct(ev) : 50;
  const text = ev ? formatEval(ev).replace('+', '') : '';
  const whiteAhead = w >= 50;
  const atBottom = orientation === 'w' ? whiteAhead : !whiteAhead;
  return (
    <div className={`eval-bar ${orientation === 'b' ? 'flipped' : ''}`} role="meter" aria-label="Evaluation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w)}>
      <div className="white-part" style={{ height: `${w}%` }} />
      <div className={`label ${atBottom ? 'bottom' : 'top'}`} style={{ color: whiteAhead ? '#1b1a18' : '#f0efec' }}>{text}</div>
    </div>
  );
}

function evChip(ev: Eval, color: Color = 'w') {
  const w = whiteWinPct(ev) >= 50;
  return <span className={`ev ${w ? 'w' : 'b'}`} title={color === 'w' ? 'White POV' : ''}>{formatEval(ev)}</span>;
}

export function GamePage({ item, onBack, onTrainMistake, onReviewed }: {
  item: GameOpening;
  onBack: () => void;
  onTrainMistake: (r: FullReview, ply: number) => void;
  onReviewed: (r: FullReview) => void;
}) {
  const { game } = item;
  const me = game.color;
  const [review, setReview] = useState<FullReview | null | undefined>(undefined);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [ply, setPly] = useState(0);
  const [flip, setFlip] = useState(false);
  const [variation, setVariation] = useState<{ base: number; moves: string[]; at: number } | null>(null);
  const [varEval, setVarEval] = useState<{ eval: Eval; best: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const light = useLiveQuery(() => db.reviews.get(game.id), [game.id]);
  const abort = useRef<AbortController | null>(null);

  // Game moves (whole game) for stepping even before a review exists.
  const base = useMemo(() => {
    const c = new Chess();
    const sans: string[] = [];
    const fens = [c.fen()];
    for (const m of game.moves) {
      try {
        sans.push(c.move(m).san);
      } catch {
        break;
      }
      fens.push(c.fen());
    }
    return { sans, fens };
  }, [game.moves]);

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
      onReviewed(r);
      const firstMine = r.keyMoments.find((i) => r.plies[i].color === me);
      setPly(firstMine !== undefined ? firstMine + 1 : 0);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e;
    } finally {
      setProgress(null);
    }
  };

  const sans = review?.sans ?? base.sans;
  const fens = review?.fens ?? base.fens;
  const n = sans.length;

  const shown = useMemo(() => {
    const c = new Chess(fens[variation ? variation.base : ply]);
    let last: [Key, Key] | undefined;
    if (variation) {
      for (const u of variation.moves.slice(0, variation.at)) {
        const m = play(c, u);
        last = [m.from as Key, m.to as Key];
      }
    } else if (ply > 0) {
      const m = new Chess(fens[ply - 1]).move(sans[ply - 1]);
      last = [m.from as Key, m.to as Key];
    }
    return { chess: c, last };
  }, [fens, sans, ply, variation]);

  useEffect(() => {
    if (!variation) return setVarEval(null);
    let live = true;
    const c = shown.chess;
    if (c.isGameOver()) {
      setVarEval({ eval: c.isCheckmate() ? mateEval(0, c.turn() === 'w' ? 'b' : 'w') : cpEval(0), best: '' });
      return;
    }
    cachedEval(getEngine(), c.fen(), PHONE_LIMITS).then((r) => live && setVarEval({ eval: toEval(r), best: r.bestmove }));
    return () => {
      live = false;
    };
  }, [variation, shown]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') setVariation(null);
      else if (e.key === 'ArrowLeft') variation ? setVariation((v) => (v && v.at > 0 ? { ...v, at: v.at - 1 } : null)) : setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') variation ? setVariation((v) => v && { ...v, at: Math.min(v.moves.length, v.at + 1) }) : setPly((p) => Math.min(n, p + 1));
      else if (e.key === 'Home') !variation && setPly(0);
      else if (e.key === 'End') !variation && setPly(n);
      else if (e.key === 'f') setFlip((f) => !f);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variation, n]);

  const orientation: Color = flip ? (me === 'w' ? 'b' : 'w') : me;
  const chess = shown.chess;
  const turn = chess.turn();
  const cur = review && ply > 0 && !variation ? review.plies[ply - 1] : null;
  const showFix = !!cur && ERRORS.has(cur.classification);
  const bestHere = variation ? varEval?.best : review ? (showFix ? review.positions[ply - 1].lines[0]?.move : review.positions[ply]?.lines[0]?.move) : undefined;
  const dests = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) dests.set(m.from as Key, [...(dests.get(m.from as Key) ?? []), m.to as Key]);
  const config: Config = {
    fen: chess.fen(),
    orientation: orientation === 'w' ? 'white' : 'black',
    lastMove: shown.last,
    check: chess.inCheck(),
    turnColor: turn === 'w' ? 'white' : 'black',
    movable: {
      free: false, color: turn === 'w' ? 'white' : 'black', dests, showDests: true,
      events: {
        after: (from, to) => {
          const m = new Chess(chess.fen()).move({ from: from as Square, to: to as Square, promotion: 'q' });
          const u = m.from + m.to + (m.promotion ?? '');
          if (variation) setVariation({ base: variation.base, moves: [...variation.moves.slice(0, variation.at), u], at: variation.at + 1 });
          else if (ply < n && new Chess(fens[ply]).move(sans[ply]).lan === m.lan) setPly(ply + 1);
          else setVariation({ base: ply, moves: [u], at: 1 });
        },
      },
    },
    drawable: { enabled: false, visible: true, autoShapes: bestHere ? [{ orig: bestHere.slice(0, 2) as Key, dest: bestHere.slice(2, 4) as Key, brush: showFix ? 'green' : 'paleBlue' }] : [] },
    coordinates: true,
  };

  // Badge on the destination square of the move just played.
  let badge: { left: string; top: string; cls: MoveClass } | null = null;
  if (cur && shown.last) {
    const sq = shown.last[1];
    const f = sq.charCodeAt(0) - 97, r = Number(sq[1]) - 1;
    const [cx, cy] = orientation === 'w' ? [f, 7 - r] : [7 - f, r];
    badge = { left: `${((cx + 1) / 8) * 100}%`, top: `${(cy / 8) * 100}%`, cls: cur.classification };
  }

  const names: Record<Color, string> = { w: me === 'w' ? 'You' : game.opponent, b: me === 'b' ? 'You' : game.opponent };
  const ratings: Record<Color, number | undefined> = { w: me === 'w' ? game.userRating : game.oppRating, b: me === 'b' ? game.userRating : game.oppRating };
  const stats = review ? { w: review.white, b: review.black } : null;
  const strip = (c: Color) => (
    <div className="player-strip">
      <span className={`color-dot ${c === 'w' ? 'white' : 'black'}`} />
      <span className="name">{names[c]}</span>
      {ratings[c] ? <span className="rating">({ratings[c]})</span> : null}
      {stats?.[c].accuracy != null && <span className="badge">{stats[c].accuracy!.toFixed(1)}%</span>}
    </div>
  );
  const top: Color = orientation === 'w' ? 'b' : 'w';
  const curEval = variation ? varEval?.eval ?? null : review ? review.evals[ply] : null;
  const resultText = game.score === 1 ? (me === 'w' ? '1-0' : '0-1') : game.score === 0 ? (me === 'w' ? '0-1' : '1-0') : '½-½';
  const pgn = () => sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : s)).join(' ') + ` ${resultText.replace('½-½', '1/2-1/2')}`;

  const expl =
    cur && review
      ? explain({
          fenBefore: fens[ply - 1],
          uci: (() => {
            const m = new Chess(fens[ply - 1]).move(sans[ply - 1]);
            return m.from + m.to + (m.promotion ?? '');
          })(),
          classification: cur.classification, reasons: cur.reasons,
          best: review.positions[ply - 1].lines[0] ? { ...review.positions[ply - 1].lines[0] } : null,
          replyPv: review.positions[ply]?.lines[0]?.pv ?? [], evalAfter: review.evals[ply],
        })
      : null;
  const keyMoves = review?.keyMoments ?? [];
  const nextKey = keyMoves.find((i) => i + 1 > ply);
  const prevKey = [...keyMoves].reverse().find((i) => i + 1 < ply);
  const lineRow = (fen: string, baseIdx: number, line: { move: string; eval: Eval; pv: string[] }, key: string) => {
    const s = pvToSan(fen, line.pv, 10);
    return (
      <div key={key} className="line-row">
        {evChip(line.eval)}
        <span className="pv">
          {s.map((m, i) => (
            <span key={i} className="pv-item">
              {(baseIdx + i) % 2 === 0 || i === 0 ? <span className="pv-no">{Math.floor((baseIdx + i) / 2) + 1}{(baseIdx + i) % 2 === 0 ? '.' : '...'}</span> : null}
              <button className={`pv-move ${i === 0 ? 'first' : ''}`} onClick={() => setVariation({ base: baseIdx, moves: line.pv.slice(0, 10), at: i + 1 })}>{m}</button>
            </span>
          ))}
        </span>
      </div>
    );
  };
  const playedLike = (c: Color) => {
    const r = review?.rating[c];
    const actual = ratings[c];
    if (!r?.rating) return null;
    const d = actual ? r.rating - actual : null;
    return (
      <span className="played-like">
        {c === me ? 'You played' : 'Played'} like a {r.rating}{actual ? ` · rated ${actual} ` : ''}
        {d !== null && <span className={d >= 0 ? 'perf-up' : 'perf-down'}>{d >= 0 ? '+' : '−'}{Math.abs(d)}</span>}
        {actual && actual > 2200 && <span className="muted"> · estimate made for club level</span>}
      </span>
    );
  };

  return (
    <div className="review">
      <div className="board-col">
        {strip(top)}
        <div className="board-row">
          {review && <EvalBar ev={curEval} orientation={orientation} />}
          <div className="board-size">
            <div className={`board-wrap orientation-${orientation === 'w' ? 'white' : 'black'}`}>
              <Board config={config} />
              {badge && <span className="sq-badge" style={{ left: badge.left, top: badge.top }}><ClassIcon cls={badge.cls} size={26} /></span>}
            </div>
          </div>
        </div>
        {strip(top === 'w' ? 'b' : 'w')}
        <div className="controls">
          <button className="btn icon" aria-label="Start" onClick={() => { setVariation(null); setPly(0); }}><ChevronFirst size={18} /></button>
          <button className="btn icon" aria-label="Back" onClick={() => (variation ? setVariation(variation.at > 0 ? { ...variation, at: variation.at - 1 } : null) : setPly(Math.max(0, ply - 1)))}><ChevronLeft size={18} /></button>
          <button className="btn icon" aria-label="Forward" onClick={() => (variation ? setVariation({ ...variation, at: Math.min(variation.moves.length, variation.at + 1) }) : setPly(Math.min(n, ply + 1)))}><ChevronRight size={18} /></button>
          <button className="btn icon" aria-label="End" onClick={() => { setVariation(null); setPly(n); }}><ChevronLast size={18} /></button>
          <span className="sep" />
          <button className="btn icon" aria-label="Flip board" aria-pressed={flip} onClick={() => setFlip((f) => !f)}><FlipVertical2 size={18} /></button>
          <button className="btn icon" aria-label="Copy PGN" title={copied ? 'Copied' : 'Copy PGN'} onClick={async () => { try { await navigator.clipboard.writeText(pgn()); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}><Copy size={18} /></button>
          {game.url && <a className="btn icon" aria-label="Open the game on its site" href={game.url} target="_blank" rel="noreferrer"><ExternalLink size={18} /></a>}
          {variation && <button className="btn sm" onClick={() => setVariation(null)}><RotateCcw size={14} /> Back to game</button>}
        </div>
      </div>

      <div className="panel">
        <div className="card game-head">
          <div className="title">
            <button className="btn icon ghost sm" aria-label="Back to games" onClick={onBack}><ArrowLeft size={18} /></button>
            <span className="grow fit-text">{me === 'w' ? `You vs ${game.opponent}` : `${game.opponent} vs You`}</span>
            <span className="badge">{resultText}</span>
          </div>
          <div className="sub">{SPEED[game.speed]}{SPEED[game.speed] ? ' · ' : ''}{new Date(game.playedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {game.score === 1 ? 'You won' : game.score === 0 ? 'You lost' : 'Draw'}</div>
          {item.opening && <div className="opening-line"><span className="eco">{item.opening.eco}</span> {item.opening.name}</div>}
        </div>

        {review === null && (
          <div className="card cta p-primary">
            <h3 style={{ margin: 0 }}>Review this game</h3>
            <p>Every move classified, accuracy for both players, a Game Rating and the key moments. Computed on this device in about {Math.round((Math.min(game.moves.length, 160) + 1) * 0.5)} seconds; the result is saved.</p>
            {progress ? (
              <div className="row"><div className="progress grow"><div style={{ width: `${(progress[0] / progress[1]) * 100}%` }} /></div><span className="muted nums">{progress[0]}/{progress[1]}</span></div>
            ) : (
              <button className="btn primary lg" onClick={run}>Review this game</button>
            )}
            {light && (
              <p className="muted" style={{ fontSize: 13.5 }}>
                Opening check: accuracy {light.accuracy != null ? `${Math.round(light.accuracy)}%` : '–'} in the first 15 moves
                {light.firstMistake ? `, first mistake ${label(light.firstMistake.ply, light.firstMistake.played)} (better ${label(light.firstMistake.ply, light.firstMistake.best)}).` : ', no real mistakes.'}
              </p>
            )}
          </div>
        )}

        {review && (
          <>
            <div className="card">
              <div className="summary-grid">
                {(['w', 'b'] as const).map((c) => (
                  <div key={c} className="summary-side">
                    <div className="who"><span className={`color-dot ${c === 'w' ? 'white' : 'black'}`} /> <span className="fit-text">{c === me ? 'You' : game.opponent}</span></div>
                    <div className="acc">{stats![c].accuracy?.toFixed(1) ?? '–'}<small>accuracy</small></div>
                    <div className="game-rating">
                      <span className="gr-label">Game Rating</span>
                      <span className="gr-value">{review.rating[c].rating ? <><b>{review.rating[c].rating}</b><span className="range">{review.rating[c].low}–{review.rating[c].high}</span></> : <span className="muted">not enough moves</span>}</span>
                      {playedLike(c)}
                    </div>
                  </div>
                ))}
              </div>
              <table className="counts">
                <tbody>
                  {ORDER.filter((k) => review.white.counts[k] || review.black.counts[k]).map((k) => {
                    const first = review.plies.findIndex((p) => p.classification === k && p.color === me);
                    return (
                      <tr key={k} className={first >= 0 ? 'clickable' : ''} onClick={() => first >= 0 && (setVariation(null), setPly(first + 1))}>
                        <td className={`n ${review.white.counts[k] ? '' : 'zero'}`}>{review.white.counts[k]}</td>
                        <td className="lbl"><ClassIcon cls={k} size={18} /> {CLASS_META[k].label}</td>
                        <td className={`n ${review.black.counts[k] ? '' : 'zero'}`}>{review.black.counts[k]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="card chart-card">
              <div className="chart-title"><span>Evaluation</span><span className="nums">{curEval ? formatEval(curEval) : ''}</span></div>
              <EvalGraph
                cps={review.evals.map((e) => whiteCp(e))}
                marks={review.plies.map((p, i) => ({ ply: i, kind: p.classification })).filter((m) => ['inaccuracy', 'mistake', 'blunder', 'miss', 'great', 'brilliant'].includes(m.kind)) as never}
                current={variation ? variation.base : ply}
                onSelect={(i) => { setVariation(null); setPly(i); }}
              />
            </div>

            {variation ? (
              <div className="card move-card p-primary">
                <div className="headline">Variation <span className="ev">{varEval ? formatEval(varEval.eval) : '…'}</span></div>
                <div className="crumbs">
                  {pvToSan(fens[variation.base], variation.moves).map((s, i) => (
                    <button key={i} className={`crumb ${i + 1 === variation.at ? 'active' : ''}`} onClick={() => setVariation({ ...variation, at: i + 1 })}>{label(variation.base + i, s)}</button>
                  ))}
                </div>
                <p className="detail">Drag pieces to try your own moves; the engine evaluates each position on this device. Esc goes back to the game.</p>
              </div>
            ) : cur && expl ? (
              <div className="card move-card p-primary">
                <div className="headline"><ClassIcon cls={cur.classification} size={26} /> <span className="grow">{sans[ply - 1]} is {CLASS_META[cur.classification].phrase}</span>{evChip(review.evals[ply])}</div>
                <p className="detail">{expl.detail}</p>
                {!cur.isBest && review.positions[ply - 1].lines[0] && (
                  <>
                    <span className="muted" style={{ fontSize: 13 }}>Best was</span>
                    <div className="lines">{lineRow(fens[ply - 1], ply - 1, review.positions[ply - 1].lines[0], 'best')}</div>
                  </>
                )}
                {cur.color === me && ['mistake', 'blunder', 'miss'].includes(cur.classification) && (
                  <button className="btn" onClick={() => onTrainMistake(review, ply - 1)}><RotateCcw size={15} /> Train this mistake</button>
                )}
                {review.positions[ply]?.lines.length ? (
                  <>
                    <span className="muted" style={{ fontSize: 13 }}>Top engine lines · {turn === 'w' ? 'White' : 'Black'} to move</span>
                    <div className="lines">{review.positions[ply].lines.map((l, i) => lineRow(fens[ply], ply, l, `l${i}`))}</div>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="card move-card">
                <p className="detail">Step through the game with the arrows, or jump to a key moment.</p>
              </div>
            )}
            {keyMoves.length > 0 && (
              <div className="card key-nav">
                <button className="btn sm" disabled={prevKey === undefined} onClick={() => prevKey !== undefined && (setVariation(null), setPly(prevKey + 1))}><ChevronLeft size={14} /> Previous key moment</button>
                <button className="btn sm" disabled={nextKey === undefined} onClick={() => nextKey !== undefined && (setVariation(null), setPly(nextKey + 1))}>Next key moment <ChevronRight size={14} /></button>
              </div>
            )}
          </>
        )}

        <div className="card moves">
          <table>
            <tbody>
              {Array.from({ length: Math.ceil(n / 2) }, (_, r) => (
                <tr key={r}>
                  <td className="no">{r + 1}.</td>
                  {[2 * r, 2 * r + 1].map((i) =>
                    i < n ? (
                      <td key={i}>
                        <button className={`mv ${ply === i + 1 && !variation ? 'active' : ''}`} onClick={() => { setVariation(null); setPly(i + 1); }}>
                          {review ? (['best', 'excellent', 'good'].includes(review.plies[i].classification) ? <span className="mv-quiet" /> : <ClassIcon cls={review.plies[i].classification} size={16} title={false} />) : null}
                          <span className="san">{sans[i]}</span>
                        </button>
                      </td>
                    ) : <td key={i} />,
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {review?.truncated && <p className="muted" style={{ fontSize: 13 }}>Long game: the first {n / 2} moves were reviewed.</p>}
        {review && <p className="muted" style={{ fontSize: 12.5 }}>Classifications follow the Review app’s rules (similar to chess.com’s, not identical). Accuracy is calibrated to chess.com’s; Game Rating is an estimate and can differ by ~200 points for one game.</p>}
      </div>
    </div>
  );
}
