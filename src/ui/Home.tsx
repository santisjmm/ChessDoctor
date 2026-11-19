import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { analysis } from '../lib/analysis';
import { db, type DrillItem } from '../lib/db';
import { siteName, type Account } from '../lib/importer';
import type { ReportResult } from '../lib/pipeline';
import { isMastered, streak, todaysSession } from '../lib/srs';

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

export function Home({
  accounts, result, busy, onStart, onRefresh, onCard, onChangeAccounts,
}: {
  accounts: Account[];
  result: ReportResult | null;
  busy: string | null;
  onStart: (items: DrillItem[]) => void;
  onRefresh: () => void;
  onCard: () => void;
  onChangeAccounts: () => void;
}) {
  const drills = useLiveQuery(() => db.drills.toArray(), [], [] as DrillItem[]);
  const attempts = useLiveQuery(() => db.attempts.orderBy('at').reverse().limit(400).toArray(), [], []);
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);
  const engine = useSyncExternalStore(analysis.subscribe, analysis.getSnapshot);
  const session = todaysSession(drills);
  const dueMistakes = session.filter((d) => d.kind === 'mistake').length;
  const hasLine = session.some((d) => d.kind === 'line');
  const days = streak(attempts.map((a) => a.at));
  const trainedToday = attempts.some((a) => new Date(a.at).toDateString() === new Date().toDateString());
  const lastImport = Math.max(0, ...profiles.map((p) => p.lastImportAt));
  const mastered = drills.filter(isMastered).length;

  return (
    <main className="screen home">
      <header className="row">
        <h1 className="tight">Today</h1>
        <span className={`streak ${trainedToday ? 'on' : ''}`} title="Days in a row with training">
          {days} day{days === 1 ? '' : 's'} streak
        </span>
      </header>

      <section className="today">
        <p className="eyebrow tight">Today’s training · about 10 minutes</p>
        {session.length ? (
          <>
            <h2 className="tight">
              {dueMistakes ? `${dueMistakes} mistake${dueMistakes === 1 ? '' : 's'} to fix` : 'Your main line'}
              {dueMistakes && hasLine ? ' + 1 opening line' : ''}
            </h2>
            <ul className="today-list">
              {session.slice(0, 4).map((d) => (
                <li key={d.id}>
                  <span className={d.kind === 'mistake' ? 'dot red' : 'dot grey'} /> {d.family} · {d.color === 'w' ? 'White' : 'Black'}
                  {d.kind === 'mistake' && d.played ? ` · not ${Math.floor(d.focusPly / 2) + 1}${d.focusPly % 2 === 0 ? '.' : '...'}${d.played}` : ''}
                </li>
              ))}
              {session.length > 4 && <li className="muted">and {session.length - 4} more</li>}
            </ul>
            <button className="primary" onClick={() => onStart(session)}>Start training</button>
          </>
        ) : drills.length ? (
          <>
            <h2 className="tight">All done for today</h2>
            <p className="hint">Nothing is due. Lines come back on schedule; slips come back in 10 minutes.</p>
            <button className="secondary" onClick={() => onStart([...drills].sort(() => Math.random() - 0.5).slice(0, 5))}>Practise anyway</button>
          </>
        ) : (
          <>
            <h2 className="tight">Finding your mistakes…</h2>
            <p className="hint">The engine is checking the moves you play most. Your first drills appear here in a moment.</p>
          </>
        )}
      </section>

      {engine.running && (
        <div className="bar">
          {engine.done < engine.total ? (
            <>
              <div className="bar-label"><span>Engine checking your moves</span><span>{engine.done} / {engine.total}</span></div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(engine.done / Math.max(1, engine.total)) * 100}%` }} /></div>
            </>
          ) : (
            <>
              <div className="bar-label"><span>Reviewing your newest games</span><span>{engine.reviewsDone} / {engine.reviewsTotal}</span></div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${(engine.reviewsDone / Math.max(1, engine.reviewsTotal)) * 100}%` }} /></div>
            </>
          )}
        </div>
      )}

      <section className="stats-row">
        <div><b>{drills.filter((d) => d.kind === 'mistake').length}</b><span>mistakes found</span></div>
        <div><b>{mastered}</b><span>lines mastered</span></div>
        <div><b>{result?.items.length ?? '–'}</b><span>games</span></div>
      </section>

      {result?.report.leak && (
        <button className="leak-link" onClick={onCard}>
          <span className="muted">Your leak</span>
          <b>{result.report.leak.stat.family}</b>
          <span className="muted">See your report card →</span>
        </button>
      )}

      <section className="accounts">
        <p className="hint">
          {accounts.map((a) => `${siteName(a.site)}: ${a.user}`).join(' · ')}
          {lastImport ? ` · updated ${ago(lastImport)}` : ''}
        </p>
        <div className="row">
          <button className="secondary small" onClick={onRefresh} disabled={!!busy}>{busy ?? 'Fetch new games'}</button>
          <button className="link" onClick={onChangeAccounts}>Change usernames</button>
        </div>
      </section>
    </main>
  );
}
