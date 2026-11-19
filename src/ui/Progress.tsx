import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useSyncExternalStore } from 'react';
import { analysis } from '../lib/analysis';
import { db, type DrillItem, type GameReview } from '../lib/db';
import type { GameOpening } from '../lib/openings';
import { accuracyOverTime, fixState, type FixStatus } from '../lib/progress';
import { INTERVALS_DAYS, MASTERED_BOX } from '../lib/srs';
import { LineChart } from './charts';

const label = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`;
const STATUS: Record<FixStatus, [string, string]> = {
  fixed: ['Fixed', 'good'],
  repeating: ['Still happening', 'bad'],
  untested: ['Not met again yet', 'muted'],
};

export function Progress({ items }: { items: GameOpening[] }) {
  const reviews = useLiveQuery(() => db.reviews.toArray(), [], [] as GameReview[]);
  const drills = useLiveQuery(() => db.drills.toArray(), [], [] as DrillItem[]);
  const engine = useSyncExternalStore(analysis.subscribe, analysis.getSnapshot);
  const points = useMemo(() => accuracyOverTime(reviews), [reviews]);
  const fixes = useMemo(
    () => drills.filter((d) => d.kind === 'mistake').map((d) => fixState(d, items)).sort((a, b) => b.item.games - a.item.games),
    [drills, items],
  );
  const recent = [...reviews].filter((r) => r.accuracy !== null).sort((a, b) => b.playedAt - a.playedAt);
  const avg = (rs: GameReview[]) => (rs.length ? rs.reduce((s, r) => s + r.accuracy!, 0) / rs.length : null);
  const last10 = avg(recent.slice(0, 10));
  const prev10 = recent.length >= 20 ? avg(recent.slice(10, 20)) : null;
  const mastered = drills.filter((d) => d.box >= MASTERED_BOX).length;
  const fixed = fixes.filter((f) => f.status === 'fixed').length;
  const boxes = Array.from({ length: MASTERED_BOX + 1 }, (_, b) => drills.filter((d) => d.box === b).length);
  const maxBox = Math.max(1, ...boxes);

  return (
    <main className="screen progress">
      <h1 className="tight">Progress</h1>

      <div className="cols">
      <div>
      <section className="hero">
        <p className="eyebrow tight">Opening accuracy, last {Math.min(10, recent.length)} reviewed games</p>
        <p className="hero-num">{last10 != null ? `${Math.round(last10)}%` : '–'}</p>
        <p className="hint">
          {prev10 != null && last10 != null
            ? `${last10 >= prev10 ? 'Up' : 'Down'} ${Math.abs(Math.round(last10 - prev10))} points on the 10 games before.`
            : 'Accuracy of your moves in the first 15 moves, as Lichess scores it.'}
          {engine.reviewsTotal > engine.reviewsDone ? ` Reviewing your newest games: ${engine.reviewsDone}/${engine.reviewsTotal}.` : ''}
        </p>
      </section>

      {points.length >= 2 ? (
        <LineChart
          title={`Opening accuracy by ${points.length > 1 && points[1].start - points[0].start < 20 * 86_400_000 ? 'week' : 'month'}`}
          points={points.map((p) => ({ label: p.label, value: p.accuracy, detail: `${p.n} games reviewed` }))}
          format={(v) => `${Math.round(v)}%`}
        />
      ) : (
        <p className="hint">The chart appears once at least two periods have two or more reviewed games.</p>
      )}

      <section className="stats-row">
        <div><b>{mastered}</b><span>lines mastered</span></div>
        <div><b>{drills.length - mastered}</b><span>in training</span></div>
        <div><b>{fixed}</b><span>mistakes fixed</span></div>
      </section>

      </div>
      <div>
      <section>
        <h2>Lines by stage</h2>
        <ul className="boxes">
          {boxes.map((n, b) => (
            <li key={b}>
              <span className="box-name">{b === 0 ? 'New / relearning' : b === MASTERED_BOX ? 'Mastered' : `Every ${INTERVALS_DAYS[b]} day${INTERVALS_DAYS[b] === 1 ? '' : 's'}`}</span>
              <span className="box-bar"><i style={{ width: `${(n / maxBox) * 100}%`, opacity: 0.35 + (0.65 * b) / MASTERED_BOX }} /></span>
              <span className="box-n">{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Mistakes you’re training</h2>
        <p className="hint">“Fixed” means the last time you reached the position in a game played after you started drilling it, you didn’t play the old move.</p>
        <ul className="fix-list">
          {fixes.slice(0, 20).map((f) => {
            const [text, cls] = STATUS[f.status];
            return (
              <li key={f.item.id}>
                <span className="g-main">
                  <b>{f.item.family} · {f.item.color === 'w' ? 'White' : 'Black'}</b>
                  <span className="muted">
                    not {label(f.item.focusPly, f.item.played ?? '?')}, play {label(f.item.focusPly, f.item.line[f.item.focusPly])}
                    {f.later ? ` · met in ${f.later} later game${f.later === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
                <span className={`status ${cls}`}>{f.status === 'fixed' ? '✓ ' : f.status === 'repeating' ? '✗ ' : ''}{text}</span>
              </li>
            );
          })}
          {!fixes.length && <li className="muted">No mistakes found yet.</li>}
        </ul>
      </section>
      </div>
      </div>
    </main>
  );
}
