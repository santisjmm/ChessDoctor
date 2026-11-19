import { useMemo, useState } from 'react';
import { pct } from '../lib/card';
import { siteName } from '../lib/importer';
import type { GameOpening } from '../lib/openings';
import { score, type Tally } from '../lib/report';
import { byColor, byRatingDiff, bySpeed, ratingPools, ratingSeries } from '../lib/stats';
import { LineChart } from './charts';

const SPEED: Record<string, string> = {
  ultraBullet: 'UltraBullet', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', daily: 'Daily', correspondence: 'Correspondence', unknown: 'Unknown',
};

function TallyRow({ name, t, extra }: { name: string; t: Tally; extra?: string }) {
  return (
    <li className="stat-row">
      <span className="op-name">{name}</span>
      <span className="op-n">{t.n}</span>
      <span className="op-score">{pct(score(t))}</span>
      <span className="op-diff muted stat-extra">{extra ?? ''}</span>
      <span className="op-meter" aria-label={`${t.wins} won, ${t.draws} drawn, ${t.losses} lost`}>
        <i style={{ width: `${(t.wins / t.n) * 100}%` }} className="w" />
        <i style={{ width: `${(t.draws / t.n) * 100}%` }} className="d" />
        <i style={{ width: `${(t.losses / t.n) * 100}%` }} className="l" />
      </span>
    </li>
  );
}

/** Results: by time control, rating over time, score vs rating difference, by colour. */
export function Stats({ items }: { items: GameOpening[] }) {
  const pools = useMemo(() => ratingPools(items), [items]);
  const [pool, setPool] = useState(0);
  const p = pools[Math.min(pool, pools.length - 1)];
  const series = useMemo(() => (p ? ratingSeries(items, p.site, p.speed) : []), [items, p]);
  const speeds = bySpeed(items);
  const diffs = byRatingDiff(items);
  const col = byColor(items);
  return (
    <div className="cols">
      <div>
        {p && series.length >= 2 ? (
          <section>
            {pools.length > 1 && (
              <div className="class-chips">
                {pools.slice(0, 6).map((x, i) => (
                  <button key={`${x.site}${x.speed}`} className={`chip ${i === pool ? 'on' : ''}`} onClick={() => setPool(i)}>
                    {siteName(x.site)} {SPEED[x.speed] ?? x.speed} · {x.n}
                  </button>
                ))}
              </div>
            )}
            <LineChart
              title={`Rating: ${siteName(p.site)} ${SPEED[p.speed] ?? p.speed}`}
              points={series.map((s) => ({
                label: new Date(s.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
                value: s.rating,
                detail: `${s.games} game${s.games === 1 ? '' : 's'} that day`,
              }))}
              format={(v) => String(Math.round(v))}
              step={50}
              clamp={[0, 4000]}
            />
          </section>
        ) : (
          <p className="hint">The rating chart needs at least two days of rated games in one time control.</p>
        )}
        <section>
          <h2>By time control</h2>
          <ul className="op-list">{speeds.map((s) => <TallyRow key={s.speed} name={SPEED[s.speed] ?? s.speed} t={s.tally} />)}</ul>
        </section>
      </div>
      <div>
        {diffs.length > 0 && (
          <section>
            <h2>Against stronger and weaker players</h2>
            <p className="hint">Your score by the opponent’s rating compared with yours. Right column: what the Elo formula expects.</p>
            <ul className="op-list">{diffs.map((d) => <TallyRow key={d.label} name={d.label} t={d.tally} extra={`exp. ${pct(d.expected)}`} />)}</ul>
          </section>
        )}
        <section>
          <h2>By colour</h2>
          <ul className="op-list">
            <TallyRow name="White" t={col.w} />
            <TallyRow name="Black" t={col.b} />
          </ul>
          <p className="hint">Bars: green won, grey drawn, red lost. From the {items.length} games on this device.</p>
        </section>
      </div>
    </div>
  );
}
