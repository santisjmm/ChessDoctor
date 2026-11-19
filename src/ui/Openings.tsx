import { Chess } from 'chess.js';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { analysis } from '../lib/analysis';
import { pct, signedPct } from '../lib/card';
import type { DrillItem } from '../lib/db';
import { drillId, verdictReason } from '../lib/drills';
import { LEAK_DROP } from '../lib/leakcheck';
import { plyColor, type GameOpening } from '../lib/openings';
import { score } from '../lib/report';
import { buildTree, findNode, tone, type TreeNode } from '../lib/tree';
import type { Color } from '../lib/types';
import { Board } from './Board';

const label = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`;
const fmtDate = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function gameLink(it: GameOpening, ply: number) {
  return it.game.site === 'lichess' ? `${it.game.url}#${ply + 1}` : it.game.url;
}

export function Openings({ items, onDrill }: { items: GameOpening[]; onDrill: (item: DrillItem) => void }) {
  const [color, setColor] = useState<Color>(() => (sessionStorage.getItem('tree-color') as Color) || 'w');
  const [line, setLine] = useState<string[]>([]);
  const { verdicts, done, total, running } = useSyncExternalStore(analysis.subscribe, analysis.getSnapshot);
  const root = useMemo(() => buildTree(items, color), [items, color]);
  // ← / Backspace: back one move.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'Backspace') setLine((l) => l.slice(0, -1));
      if (e.key === 'Home') setLine([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Test hook for the headless screenshot run: jump to a line.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__openLine = (c: Color, l: string[]) => {
      setColor(c);
      setLine(l);
    };
  }, []);
  const baseline = score(root);
  const node = findNode(root, line) ?? root;

  const verdictOf = (n: TreeNode) => (plyColor(n.ply) === color ? verdicts.get(n.key) : undefined);
  const mistakeOf = (n: TreeNode) => {
    const v = verdictOf(n);
    return v && v.drop >= LEAK_DROP ? v : undefined;
  };
  const here = mistakeOf(node);

  const chess = useMemo(() => {
    const c = new Chess();
    for (const s of line) c.move(s);
    return c;
  }, [line]);
  const last = chess.history({ verbose: true }).at(-1);
  const boardConfig: Config = {
    fen: chess.fen(),
    orientation: color === 'w' ? 'white' : 'black',
    viewOnly: true,
    lastMove: last ? [last.from as Key, last.to as Key] : undefined,
    drawable: {
      enabled: false,
      visible: true,
      autoShapes: here ? [{ orig: here.bestUci.slice(0, 2) as Key, dest: here.bestUci.slice(2, 4) as Key, brush: 'green' }] : [],
    },
    coordinates: false,
  };

  const switchColor = (c: Color) => {
    setColor(c);
    setLine([]);
    try {
      sessionStorage.setItem('tree-color', c);
    } catch {
      /* ignore */
    }
  };

  return (
    <main className="screen openings">
      <header className="row">
        <h1 className="tight">My openings</h1>
        <div className="seg" role="tablist" aria-label="Colour">
          <button role="tab" aria-selected={color === 'w'} onClick={() => switchColor('w')}>White</button>
          <button role="tab" aria-selected={color === 'b'} onClick={() => switchColor('b')}>Black</button>
        </div>
      </header>
      <p className="hint">
        {root.n} games as {color === 'w' ? 'White' : 'Black'}, you score {pct(baseline)}.{' '}
        {running ? `Engine checking your moves: ${done}/${total}.` : total ? `Engine checked your ${total} most-played moves.` : ''}
      </p>
      <div className="split">
      <div className="explorer split-main">
        <div className="mini-board"><Board config={boardConfig} /></div>
        <div className="crumbs">
          <button className={line.length ? 'crumb' : 'crumb on'} onClick={() => setLine([])}>Start</button>
          {line.map((s, i) => (
            <button key={i} className={i === line.length - 1 ? 'crumb on' : 'crumb'} onClick={() => setLine(line.slice(0, i + 1))}>
              {i % 2 === 0 || i === 0 ? label(i, s) : s}
            </button>
          ))}
        </div>
        {node.opening && <p className="opening-name">{node.opening}</p>}
      </div>
      <div className="split-side">

      {here && node !== root && (
        <section className="mistake-panel">
          <h2>You keep getting this wrong</h2>
          <p>
            You played <b className="bad">{label(node.ply, node.san)}</b> in {node.n} game{node.n === 1 ? '' : 's'} and scored {pct(score(node))}. Better:{' '}
            <b className="good">{label(node.ply, here.best)}</b>.
          </p>
          <p className="hint">{verdictReason(here, color)}</p>
          <button
            className="primary"
            onClick={() =>
              onDrill({
                id: drillId(color, [...line.slice(0, -1), here.best]), kind: 'mistake', color,
                family: node.items.find((i) => i.opening)?.opening?.family ?? 'Unknown', opening: node.opening ?? undefined,
                line: [...line.slice(0, -1), here.best], focusPly: node.ply, played: node.san, reason: verdictReason(here, color),
                games: node.n, createdAt: Date.now(), box: 0, due: Date.now(), reps: 0, lapses: 0,
              })
            }
          >
            Drill this line
          </button>
          <h3>Games where it went wrong</h3>
          <ul className="games">
            {node.items
              .filter((it) => it.game.score < 1)
              .sort((a, b) => b.game.playedAt - a.game.playedAt)
              .slice(0, 8)
              .map((it) => (
                <li key={it.game.id}>
                  <a href={gameLink(it, node.ply)} target="_blank" rel="noreferrer">
                    <span className={it.game.score === 0 ? 'bad' : 'muted'}>{it.game.score === 0 ? 'Lost' : 'Draw'}</span> vs {it.game.opponent}
                    {it.game.oppRating ? ` (${it.game.oppRating})` : ''} · {it.game.speed} · {fmtDate(it.game.playedAt)}
                  </a>
                </li>
              ))}
          </ul>
        </section>
      )}

      {node.children.length ? (
        <ul className="move-list">
          {node.children.map((c) => {
            const t = tone(c, baseline);
            const m = mistakeOf(c);
            const v = verdictOf(c);
            return (
              <li key={c.san}>
                <button className={`move-row ${m ? 'lose' : t}`} onClick={() => setLine(c.line)}>
                  <span className="mv">{label(c.ply, c.san)}</span>
                  <span className="mv-n">{c.n}</span>
                  <span className="mv-score">{pct(score(c))}</span>
                  <span className="mv-diff">{c.n >= 3 ? signedPct(score(c) - baseline) : ''}</span>
                  <span className="mv-tags">
                    {c.exits > 0 && c.exits * 2 >= c.n && <i className="tag grey">book ends</i>}
                    {m && <i className="tag red">better: {m.best}</i>}
                    {!m && v && plyColor(c.ply) === color && <i className="tag ok">engine ok</i>}
                  </span>
                  <span className="op-meter" aria-hidden>
                    <i style={{ width: `${(c.wins / c.n) * 100}%` }} className="w" />
                    <i style={{ width: `${(c.draws / c.n) * 100}%` }} className="d" />
                    <i style={{ width: `${(c.losses / c.n) * 100}%` }} className="l" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint">No more games past this move.</p>
      )}
      <p className="hint">Green: you score at least 5 points above your average here. Red: 5 below, or the engine found a better move. Grey tag: most games leave the opening book with this move. On a keyboard, ← goes back one move.</p>
      </div>
      </div>
    </main>
  );
}
