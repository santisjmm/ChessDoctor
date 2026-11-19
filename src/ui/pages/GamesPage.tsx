import { useLiveQuery } from 'dexie-react-hooks';
import { Search, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db } from '../../lib/db';
import type { Account } from '../../lib/importer';
import type { GameOpening } from '../../lib/openings';
import { PlatformTile, ResultBadge } from '../ClassIcon';
import { PgnImport } from '../PgnImport';

const SPEED: Record<string, string> = { ultraBullet: 'UltraBullet', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', daily: 'Daily', correspondence: 'Daily', unknown: '—' };
const fmtDate = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function GamesPage({ items, onOpen, onImported }: { items: GameOpening[]; onOpen: (id: string) => void; onImported: (a: Account) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [site, setSite] = useState('');
  const [speed, setSpeed] = useState('');
  const [color, setColor] = useState('');
  const [result, setResult] = useState('');
  const [opening, setOpening] = useState('');
  const [shown, setShown] = useState(60);
  const [importing, setImporting] = useState(false);
  const full = useLiveQuery(() => db.fullReviews.toArray(), [], []);
  const light = useLiveQuery(() => db.reviews.toArray(), [], []);
  const fullBy = useMemo(() => new Map(full.map((r) => [r.id, r])), [full]);
  const lightBy = useMemo(() => new Map(light.map((r) => [r.id, r])), [light]);

  const families = useMemo(() => [...new Set(items.map((i) => i.opening?.family).filter(Boolean) as string[])].sort(), [items]);
  const speeds = useMemo(() => [...new Set(items.map((i) => i.game.speed))], [items]);
  const sites = useMemo(() => [...new Set(items.map((i) => i.game.site))], [items]);
  const list = useMemo(
    () =>
      [...items]
        .filter((i) => !q || i.game.opponent.toLowerCase().includes(q.toLowerCase()))
        .filter((i) => !site || i.game.site === site)
        .filter((i) => !speed || i.game.speed === speed)
        .filter((i) => !color || i.game.color === color)
        .filter((i) => !result || String(i.game.score) === result)
        .filter((i) => !opening || i.opening?.family === opening)
        .sort((a, b) => b.game.playedAt - a.game.playedAt),
    [items, q, site, speed, color, result, opening],
  );
  const analysed = items.filter((i) => fullBy.has(i.game.id)).length;

  return (
    <div className="games-page">
      <div className="page-head">
        <div>
          <h1>Games</h1>
          <div className="sub">{items.length.toLocaleString()} games · {analysed} analysed</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setImporting((v) => !v)}><Upload size={16} /> Import PGN</button>
        </div>
      </div>
      {importing && <div style={{ marginBottom: 12 }}><PgnImport onImported={onImported} onClose={() => setImporting(false)} /></div>}
      <div className="filters">
        <label className="input-icon">
          <Search size={16} />
          <input className="input" placeholder="Search opponent" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {sites.length > 1 && (
          <select className="select" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Platform">
            <option value="">All platforms</option>
            {sites.map((s) => <option key={s} value={s}>{s === 'lichess' ? 'Lichess' : s === 'chesscom' ? 'Chess.com' : 'PGN import'}</option>)}
          </select>
        )}
        <select className="select" value={speed} onChange={(e) => setSpeed(e.target.value)} aria-label="Time control">
          <option value="">All time controls</option>
          {speeds.map((s) => <option key={s} value={s}>{SPEED[s] ?? s}</option>)}
        </select>
        <select className="select" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Colour">
          <option value="">Both colours</option>
          <option value="w">White</option>
          <option value="b">Black</option>
        </select>
        <select className="select" value={result} onChange={(e) => setResult(e.target.value)} aria-label="Result">
          <option value="">All results</option>
          <option value="1">Wins</option>
          <option value="0.5">Draws</option>
          <option value="0">Losses</option>
        </select>
        <select className="select" value={opening} onChange={(e) => setOpening(e.target.value)} aria-label="Opening">
          <option value="">All openings</option>
          {families.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="game-list static">
        {list.slice(0, shown).map((it) => {
          const g = it.game;
          const fr = fullBy.get(g.id);
          const lr = lightBy.get(g.id);
          const mine = fr ? (g.color === 'w' ? fr.white : fr.black) : null;
          const gr = fr?.rating[g.color];
          return (
            <a key={g.id} className="game-row" href={`#/games/${encodeURIComponent(g.id)}`} onClick={(e) => { e.preventDefault(); onOpen(g.id); }}>
              <ResultBadge score={g.score} />
              <span className="platform-cell"><PlatformTile site={g.site} /></span>
              <span style={{ minWidth: 0 }}>
                <div className="opp fit-text">{g.opponent}{g.oppRating ? <small>({g.oppRating})</small> : null}</div>
                <div className="meta-line"><span className={`color-dot ${g.color === 'w' ? 'white' : 'black'}`} /> You{g.userRating ? ` ${g.userRating}` : ''} · {Math.ceil(g.moves.length / 2)} moves</div>
              </span>
              <span className="tc"><span>{SPEED[g.speed] ?? g.speed}</span><small>{g.rated ? 'Rated' : 'Casual'}</small></span>
              <span className="opening">{it.opening ? <><span className="eco-inline">{it.opening.eco}</span> {it.opening.name}</> : <span className="muted">Unknown opening</span>}</span>
              <span className="date">{fmtDate(g.playedAt)}</span>
              <span className="act">
                {fr && mine?.accuracy != null ? (
                  <span className="analysed">
                    <span className="badge accent">Analysed</span>
                    <span className="acc-chip"><b>{mine.accuracy.toFixed(1)}</b><span>{gr?.rating ? `GR ${gr.rating}` : ''}</span></span>
                  </span>
                ) : (
                  <>
                    {lr?.accuracy != null && <span className="acc-chip"><b>{Math.round(lr.accuracy)}</b><span>opening</span></span>}
                    <span className="btn sm primary">Review</span>
                  </>
                )}
              </span>
            </a>
          );
        })}
        {!list.length && <div className="empty"><h3>No games match</h3><p>Change the filters above.</p></div>}
      </div>
      {shown < list.length && <div style={{ textAlign: 'center', marginTop: 12 }}><button className="btn" onClick={() => setShown((s) => s + 60)}>Show more</button></div>}
    </div>
  );
}
