import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, CalendarCheck, GitBranch, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db, type DrillItem } from '../../lib/db';
import type { GameOpening } from '../../lib/openings';
import { fixState, type FixStatus } from '../../lib/progress';
import type { ReportResult } from '../../lib/pipeline';
import { INTERVALS_DAYS, isDue, isMastered, MASTERED_BOX, streak, todaysSession } from '../../lib/srs';
import { relativeTime } from '../Layout';
import { Learn } from '../Learn';
import { Openings } from '../Openings';

export type TrainTab = 'today' | 'mistakes' | 'openings' | 'learn';
const TABS: [TrainTab, string, typeof Target][] = [
  ['today', 'Today', CalendarCheck],
  ['mistakes', 'Mistakes', Target],
  ['openings', 'Openings', GitBranch],
  ['learn', 'Learn', BookOpen],
];
const label = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`;
const STATUS: Record<FixStatus, [string, string]> = { fixed: ['Fixed', 'perf-up'], repeating: ['Still happening', 'perf-down'], untested: ['Not met again yet', 'muted'] };

export function TrainPage({ tab, onTab, result, onStart, onCard }: {
  tab: TrainTab;
  onTab: (t: TrainTab) => void;
  result: ReportResult;
  onStart: (items: DrillItem[]) => void;
  onCard: () => void;
}) {
  return (
    <div>
      <nav className="tabs" aria-label="Training">
        {TABS.map(([t, name, Icon]) => (
          <a key={t} href={`#/train/${t}`} className={tab === t ? 'active' : ''} onClick={(e) => { e.preventDefault(); onTab(t); }}>
            <Icon size={16} /> {name}
          </a>
        ))}
      </nav>
      {tab === 'today' && <Today result={result} onStart={onStart} onCard={onCard} />}
      {tab === 'mistakes' && <Mistakes items={result.items} onStart={onStart} />}
      {tab === 'openings' && <Openings items={result.items} onDrill={(d) => onStart([d])} />}
      {tab === 'learn' && <LearnTab items={result.items} />}
    </div>
  );
}

function LearnTab({ items }: { items: GameOpening[] }) {
  const [color, setColor] = useState<'w' | 'b'>('w');
  return (
    <div>
      <div className="page-head">
        <div><h1>Learn from the book</h1><div className="sub">Lines from the lichess opening list (CC0)</div></div>
        <div className="segmented" role="group" aria-label="Colour">
          <button aria-pressed={color === 'w'} onClick={() => setColor('w')}>White</button>
          <button aria-pressed={color === 'b'} onClick={() => setColor('b')}>Black</button>
        </div>
      </div>
      <Learn key={color} items={items} color={color} />
    </div>
  );
}

function Today({ result, onStart, onCard }: { result: ReportResult; onStart: (i: DrillItem[]) => void; onCard: () => void }) {
  const drills = useLiveQuery(() => db.drills.toArray(), [], [] as DrillItem[]);
  const attempts = useLiveQuery(() => db.attempts.orderBy('at').reverse().limit(500).toArray(), [], []);
  const session = todaysSession(drills);
  const days = streak(attempts.map((a) => a.at));
  const today = attempts.filter((a) => new Date(a.at).toDateString() === new Date().toDateString());
  const mistakes = drills.filter((d) => d.kind !== 'line');
  const fixes = useMemo(() => mistakes.map((d) => fixState(d, result.items)), [mistakes, result.items]);
  const boxes = Array.from({ length: MASTERED_BOX + 1 }, (_, b) => drills.filter((d) => d.box === b).length);
  const maxBox = Math.max(1, ...boxes);
  const leak = result.report.leak;
  return (
    <div className="today-grid">
      <div className="col">
        <div className="card card-pad trainer-summary">
          <span className="section-title" style={{ margin: 0 }}>Today’s training · about 10 minutes</span>
          {session.length ? (
            <>
              <h2 style={{ margin: 0 }}>
                {(() => {
                  const m = session.filter((d) => d.kind !== 'line').length;
                  const line = session.some((d) => d.kind === 'line');
                  return m ? `${m} mistake${m === 1 ? '' : 's'} to fix${line ? ' + 1 opening line' : ''}` : 'Your main line';
                })()}
              </h2>
              <ul className="today-list">
                {session.slice(0, 5).map((d) => (
                  <li key={d.id}><span className={`dot ${d.kind === 'line' ? 'idle' : 'err'}`} /> {d.family} · {d.color === 'w' ? 'White' : 'Black'}{d.kind !== 'line' && d.played ? ` · not ${label(d.focusPly, d.played)}` : ''}</li>
                ))}
                {session.length > 5 && <li className="muted">and {session.length - 5} more</li>}
              </ul>
              <button className="btn primary lg" onClick={() => onStart(session)}>Start training</button>
            </>
          ) : drills.length ? (
            <>
              <h2 style={{ margin: 0 }}>All done for today</h2>
              <p className="muted" style={{ margin: 0 }}>Nothing is due. Lines come back on schedule; slips come back in 10 minutes.</p>
              <button className="btn" onClick={() => onStart([...drills].sort(() => Math.random() - 0.5).slice(0, 5))}>Practise anyway</button>
            </>
          ) : (
            <>
              <h2 style={{ margin: 0 }}>Finding your mistakes…</h2>
              <p className="muted" style={{ margin: 0 }}>The engine is checking the moves you play most. Your first drills appear here in a moment.</p>
            </>
          )}
          <div className="trainer-kpis">
            <div><b>{days}</b><span>day streak</span></div>
            <div><b>{today.length}</b><span>done today</span></div>
            <div><b>{mistakes.length}</b><span>mistakes found</span></div>
            <div><b>{drills.filter(isMastered).length}</b><span>mastered</span></div>
          </div>
        </div>
        {leak && (
          <button className="card card-pad leak-card" onClick={onCard}>
            <span className="section-title" style={{ margin: 0 }}>Your leak</span>
            <b>{leak.stat.family} as {leak.stat.color === 'w' ? 'White' : 'Black'}</b>
            <span className="muted">Open your report card →</span>
          </button>
        )}
      </div>
      <div className="col">
        <div className="card stat-card">
          <h3>Lines by stage</h3>
          <p className="desc">Spaced repetition: a clean run moves a line to the next stage.</p>
          <table className="data-table">
            <tbody>
              {boxes.map((n, b) => (
                <tr key={b}>
                  <td>{b === 0 ? 'New / relearning' : b === MASTERED_BOX ? 'Mastered' : `Every ${INTERVALS_DAYS[b]} day${INTERVALS_DAYS[b] === 1 ? '' : 's'}`}</td>
                  <td style={{ width: '55%' }}><div className="rate-track"><div style={{ width: `${(n / maxBox) * 100}%`, background: 'var(--accent)' }} /></div></td>
                  <td className="num">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card stat-card">
          <h3>Mistakes fixed</h3>
          <p className="desc">Fixed = the last time you reached the position in a game played after you started drilling it, you didn’t repeat the old move.</p>
          <table className="data-table">
            <tbody>
              {fixes.slice(0, 8).map((f) => (
                <tr key={f.item.id}>
                  <td>{f.item.family} · {f.item.color === 'w' ? 'White' : 'Black'}<div className="muted" style={{ fontSize: 12.5 }}>not {label(f.item.focusPly, f.item.played ?? '?')}</div></td>
                  <td className={`num ${STATUS[f.status][1]}`}>{STATUS[f.status][0]}</td>
                </tr>
              ))}
              {!fixes.length && <tr><td className="muted">No mistakes found yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Mistakes({ items, onStart }: { items: GameOpening[]; onStart: (i: DrillItem[]) => void }) {
  const drills = useLiveQuery(() => db.drills.filter((d) => d.kind !== 'line').toArray(), [], [] as DrillItem[]);
  const [filter, setFilter] = useState<'all' | 'opening' | 'game'>('all');
  const list = drills.filter((d) => filter === 'all' || (filter === 'opening' ? d.kind === 'mistake' : d.kind === 'position')).sort((a, b) => a.due - b.due || b.games - a.games);
  const due = list.filter((d) => isDue(d));
  const gameOf = new Map(items.map((i) => [i.game.id, i.game]));
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>My mistakes</h1>
          <div className="sub">{drills.length} mistakes · {due.length} due now</div>
        </div>
        <div className="row">
          <div className="segmented" role="group" aria-label="Source">
            <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
            <button aria-pressed={filter === 'opening'} onClick={() => setFilter('opening')}>Opening lines</button>
            <button aria-pressed={filter === 'game'} onClick={() => setFilter('game')}>From reviews</button>
          </div>
          <button className="btn primary" disabled={!due.length} onClick={() => onStart(due.slice(0, 20))}>Train {Math.min(20, due.length)} due</button>
        </div>
      </div>
      <div className="card">
        {list.map((d) => {
          const g = d.gameId ? gameOf.get(d.gameId) : undefined;
          return (
            <button key={d.id} className="opening-row" onClick={() => onStart([d])}>
              <span className={`dot ${isDue(d) ? 'err' : 'ok'}`} />
              <span className="grow" style={{ textAlign: 'left' }}>
                <b>{d.family}</b> · {d.color === 'w' ? 'White' : 'Black'} · not {label(d.focusPly, d.played ?? '?')}
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {d.kind === 'position' ? `From your game${g ? ` vs ${g.opponent}` : ''}` : `Repeated in ${d.games} games`} · {isDue(d) ? 'due now' : `next ${relativeTime(Date.now() - (d.due - Date.now())).replace(' ago', '').replace('just now', 'soon')}`}
                </div>
              </span>
              <span className="opening-progress"><div className="progress"><div style={{ width: `${(d.box / MASTERED_BOX) * 100}%` }} /></div><span className="muted">{d.box}/{MASTERED_BOX}</span></span>
            </button>
          );
        })}
        {!list.length && <div className="empty"><h3>No mistakes yet</h3><p>The engine adds them as it checks your openings; reviewing a whole game adds that game’s mistakes.</p></div>}
      </div>
    </div>
  );
}
