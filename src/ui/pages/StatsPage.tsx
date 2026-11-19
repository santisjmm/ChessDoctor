import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { pct } from '../../lib/card';
import { db, type GameReview } from '../../lib/db';
import { lossByPhase, reviewKpis, rolling, type ReviewedGame } from '../../lib/gamestats';
import { siteName } from '../../lib/importer';
import type { GameOpening } from '../../lib/openings';
import type { ReportResult } from '../../lib/pipeline';
import { score, type Tally } from '../../lib/report';
import { byColor, byRatingDiff, bySpeed } from '../../lib/stats';
import { SeriesChart } from '../charts';

const SPEED: Record<string, string> = { ultraBullet: 'UltraBullet', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', daily: 'Daily', correspondence: 'Daily', unknown: 'Unknown' };
const PERIODS: [string, number][] = [['30d', 30], ['90d', 90], ['1y', 365], ['All', 0]];
const DAY = 86_400_000;

function Wdl({ t }: { t: Tally }) {
  return (
    <div className="wdl" aria-label={`${t.wins} won, ${t.draws} drawn, ${t.losses} lost`}>
      <div style={{ width: `${(t.wins / t.n) * 100}%`, background: 'var(--win)' }} />
      <div style={{ width: `${(t.draws / t.n) * 100}%`, background: 'var(--draw)' }} />
      <div style={{ width: `${(t.losses / t.n) * 100}%`, background: 'var(--loss)' }} />
    </div>
  );
}

export function StatsPage({ result, onOpenGame, onCard }: { result: ReportResult; onOpenGame: (id: string) => void; onCard: () => void }) {
  const [speed, setSpeed] = useState('');
  const [site, setSite] = useState('');
  const [days, setDays] = useState(0);
  const full = useLiveQuery(() => db.fullReviews.toArray(), [], []);
  const light = useLiveQuery(() => db.reviews.toArray(), [], [] as GameReview[]);
  const all = result.items;
  const speeds = useMemo(() => [...new Set(all.map((i) => i.game.speed))], [all]);
  const sites = useMemo(() => [...new Set(all.map((i) => i.game.site))], [all]);
  const newest = Math.max(...all.map((i) => i.game.playedAt));
  const items: GameOpening[] = all.filter(
    (i) => (!speed || i.game.speed === speed) && (!site || i.game.site === site) && (!days || i.game.playedAt >= newest - days * DAY),
  );
  const byId = new Map(items.map((i) => [i.game.id, i]));
  const reviewed: ReviewedGame[] = full.filter((r) => byId.has(r.id)).map((r) => ({ item: byId.get(r.id)!, review: r })).sort((a, b) => a.item.game.playedAt - b.item.game.playedAt);
  const k = reviewKpis(reviewed);
  const highRated = reviewed.some((r) => (r.item.game.userRating ?? 0) > 2200);
  const lightRows = light.filter((r) => byId.has(r.id)).sort((a, b) => a.playedAt - b.playedAt);
  const openAcc = lightRows.filter((r) => r.accuracy !== null);

  // Ratings now and at their best, per site and speed.
  const standing = useMemo(() => {
    const m = new Map<string, { site: GameOpening['game']['site']; speed: string; now: number; peak: number; first: number; n: number }>();
    for (const { game } of [...items].sort((a, b) => a.game.playedAt - b.game.playedAt)) {
      if (!game.userRating) continue;
      const key = `${game.site}|${game.speed}`;
      const e = m.get(key) ?? { site: game.site, speed: game.speed, now: game.userRating, peak: game.userRating, first: game.userRating, n: 0 };
      e.now = game.userRating;
      e.peak = Math.max(e.peak, game.userRating);
      e.n++;
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 4);
  }, [items]);

  const accPts = rolling(reviewed, (r) => (r.item.game.color === 'w' ? r.review.white.accuracy : r.review.black.accuracy));
  const grPts = rolling(reviewed, (r) => r.review.rating[r.item.game.color].rating);
  const phases = lossByPhase(reviewed);
  const speedRows = bySpeed(items);
  const diffs = byRatingDiff(items);
  const col = byColor(items);
  const total = items.reduce((t, i) => ({ ...t, n: t.n + 1, points: t.points + i.game.score }), { n: 0, points: 0 });

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Stats</h1>
          <div className="sub">{items.length} games · {reviewed.length} fully reviewed · {lightRows.length} openings checked</div>
        </div>
      </div>
      <div className="filters">
        <select className="select" value={speed} onChange={(e) => setSpeed(e.target.value)} aria-label="Time control">
          <option value="">All time controls</option>
          {speeds.map((s) => <option key={s} value={s}>{SPEED[s] ?? s}</option>)}
        </select>
        {sites.length > 1 && (
          <select className="select" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Platform">
            <option value="">All platforms</option>
            {sites.map((s) => <option key={s} value={s}>{siteName(s)}</option>)}
          </select>
        )}
        <div className="segmented" role="group" aria-label="Period">
          {PERIODS.map(([l, d]) => <button key={l} aria-pressed={days === d} onClick={() => setDays(d)}>{l}</button>)}
        </div>
      </div>

      <div className="kpis">
        <div className="card kpi">
          <div className="label">Average accuracy</div>
          <div className="value">{k.accuracy != null ? k.accuracy.toFixed(1) : openAcc.length ? (openAcc.reduce((s, r) => s + r.accuracy!, 0) / openAcc.length).toFixed(1) : '–'}</div>
          <div className="hint">{k.accuracy != null ? `${k.moves} moves in ${k.games} reviewed games` : openAcc.length ? `Opening phase, ${openAcc.length} games` : 'Review games to see it'}</div>
        </div>
        <div className="card kpi">
          <div className="label">Average Game Rating</div>
          <div className="value">{k.gameRating ?? '–'}</div>
          <div className="hint">{k.vsActual != null ? `${k.vsActual >= 0 ? '+' : '−'}${Math.abs(k.vsActual)} vs your actual rating` : 'From whole-game reviews'}</div>
          {highRated && <div className="hint">Calibrated on club-level games: above ~2200 it reads low.</div>}
        </div>
        <div className="card kpi">
          <div className="label">Blunders per 100 moves</div>
          <div className="value">{k.blunders != null ? k.blunders.toFixed(1) : '–'}</div>
          <div className="hint">{k.misses != null ? `Misses ${k.misses.toFixed(1)}` : ''}</div>
        </div>
        <div className="card kpi">
          <div className="label">Mistakes per 100 moves</div>
          <div className="value">{k.mistakes != null ? k.mistakes.toFixed(1) : '–'}</div>
          <div className="hint">{k.inaccuracies != null ? `Inaccuracies ${k.inaccuracies.toFixed(1)}` : ''}</div>
        </div>
        <div className="card kpi">
          <div className="label">Score</div>
          <div className="value">{total.n ? pct(total.points / total.n) : '–'}</div>
          <div className="hint">White {pct(score(col.w))} · Black {pct(score(col.b))}</div>
        </div>
      </div>

      {standing.length > 0 && (
        <div className="card standing">
          <h3>Your ratings</h3>
          <div className="standing-rows">
            {standing.map((s) => (
              <div key={`${s.site}${s.speed}`} className="standing-row">
                <div className="standing-head"><span className="site">{siteName(s.site)} {SPEED[s.speed] ?? s.speed}</span><span className="rating">{s.now}</span></div>
                <span className="standing-text">Peak {s.peak} · {s.now - s.first >= 0 ? '+' : '−'}{Math.abs(s.now - s.first)} over {s.n} games</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stats-grid">
        <div className="card stat-card">
          <h3>Accuracy over time</h3>
          <p className="desc">Each dot is a reviewed game (click to open it). The line is a 10-game rolling average.</p>
          <SeriesChart
            yFormat={(v) => String(Math.round(v))} yClamp={[0, 100]}
            series={[
              { name: 'Single game', color: 'var(--series-1)', kind: 'dots', points: accPts.map((p) => ({ x: p.row.item.game.playedAt, y: p.value, tip: `${p.value.toFixed(1)} vs ${p.row.item.game.opponent}`, onClick: () => onOpenGame(p.row.item.game.id) })) },
              { name: 'Rolling average', color: 'var(--series-1)', kind: 'line', points: accPts.map((p) => ({ x: p.row.item.game.playedAt, y: p.avg })) },
            ]}
          />
        </div>
        <div className="card stat-card">
          <h3>Game Rating vs actual rating</h3>
          <p className="desc">{speed ? SPEED[speed] : 'All time controls'} · rolling average of 10 games. Pick a time control for a cleaner comparison.</p>
          <SeriesChart
            yFormat={(v) => String(Math.round(v))} yStep={100}
            series={[
              { name: 'Game Rating (rolling)', color: 'var(--series-1)', kind: 'line', points: grPts.map((p) => ({ x: p.row.item.game.playedAt, y: p.avg })) },
              { name: 'Single game', color: 'var(--series-1)', kind: 'dots', points: grPts.map((p) => ({ x: p.row.item.game.playedAt, y: p.value, tip: `GR ${p.value} vs ${p.row.item.game.opponent}`, onClick: () => onOpenGame(p.row.item.game.id) })) },
              { name: 'Actual rating', color: 'var(--series-2)', kind: 'step', points: reviewed.filter((r) => r.item.game.userRating).map((r) => ({ x: r.item.game.playedAt, y: r.item.game.userRating! })) },
            ]}
          />
        </div>
        <div className="card stat-card">
          <h3>Where you lose evaluation</h3>
          <p className="desc">Average win chance given up per move, by game phase (reviewed games).</p>
          <table className="data-table">
            <thead><tr><th>Phase</th><th>Win% lost per move</th><th className="num">Accuracy</th><th className="num">Share of loss</th></tr></thead>
            <tbody>
              {phases.map((p) => (
                <tr key={p.phase}>
                  <td style={{ textTransform: 'capitalize' }}>{p.phase}</td>
                  <td><div className="row"><div className="rate-track"><div style={{ width: `${Math.min(100, ((p.lostPerMove ?? 0) / Math.max(1, ...phases.map((x) => x.lostPerMove ?? 0))) * 100)}%`, background: 'var(--series-1)' }} /></div><span className="nums">{p.lostPerMove?.toFixed(1) ?? '–'}</span></div></td>
                  <td className="num">{p.accuracy?.toFixed(1) ?? '–'}</td>
                  <td className="num">{p.share != null ? pct(p.share) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card stat-card">
          <h3>Results by time control</h3>
          <p className="desc">Score and won / drawn / lost.</p>
          <table className="data-table">
            <thead><tr><th>Time control</th><th className="num">Games</th><th className="num">Score</th><th>W / D / L</th></tr></thead>
            <tbody>{speedRows.map((s) => <tr key={s.speed}><td>{SPEED[s.speed] ?? s.speed}</td><td className="num">{s.tally.n}</td><td className="num">{pct(score(s.tally))}</td><td><Wdl t={s.tally} /></td></tr>)}</tbody>
          </table>
        </div>
        <div className="card stat-card">
          <h3>Against stronger and weaker players</h3>
          <p className="desc">Your score by the opponent’s rating compared with yours, next to what the Elo formula expects.</p>
          <table className="data-table">
            <thead><tr><th>Opponent</th><th className="num">Games</th><th className="num">Score</th><th className="num">Expected</th><th>W / D / L</th></tr></thead>
            <tbody>{diffs.map((d) => <tr key={d.label}><td>{d.label}</td><td className="num">{d.tally.n}</td><td className={`num ${score(d.tally) >= d.expected ? 'perf-up' : 'perf-down'}`}>{pct(score(d.tally))}</td><td className="num">{pct(d.expected)}</td><td><Wdl t={d.tally} /></td></tr>)}</tbody>
          </table>
        </div>
        <button className="card stat-card report-tile" onClick={onCard}>
          <h3>Your opening report card</h3>
          <p className="desc">Best opening, biggest leak, ratings and repertoire on one shareable image.</p>
          {result.report.leak && <p style={{ margin: 0 }}>Leak: <b>{result.report.leak.stat.family}</b> as {result.report.leak.stat.color === 'w' ? 'White' : 'Black'}</p>}
          <span className="btn primary" style={{ alignSelf: 'flex-start', marginTop: 8 }}>Open the card</span>
        </button>
      </div>
    </div>
  );
}
