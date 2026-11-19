import { Chess, type Square } from 'chess.js';
import type { Config } from 'chessground/config';
import type { Key } from 'chessground/types';
import { useEffect, useMemo, useState } from 'react';
import { pct } from '../lib/card';
import { families, judgeBookMove, learnedLines, loadBookLines, pickTarget, recordLine, type BookLine, type FamilyInfo } from '../lib/learn';
import { plyColor, type GameOpening } from '../lib/openings';
import { buildTree } from '../lib/tree';
import type { Color } from '../lib/types';
import { Board } from './Board';

const label = (ply: number, san: string) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '...'}${san}`;

/** Pick an opening family to learn from the book; your own openings first. */
export function Learn({ items, color }: { items: GameOpening[]; color: Color }) {
  const [all, setAll] = useState<FamilyInfo[] | null>(null);
  const [learned, setLearned] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<FamilyInfo | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([loadBookLines(), learnedLines(color)]).then(([lines, l]) => {
      if (!live) return;
      setAll(families(lines, color));
      setLearned(l);
    });
    return () => {
      live = false;
    };
  }, [color, open]);

  const mine = useMemo(() => {
    const root = buildTree(items, color, 0);
    const byFam = new Map<string, { n: number; points: number }>();
    for (const it of root.items) {
      const f = it.opening?.family;
      if (!f) continue;
      const t = byFam.get(f) ?? { n: 0, points: 0 };
      byFam.set(f, { n: t.n + 1, points: t.points + it.game.score });
    }
    return byFam;
  }, [items, color]);

  if (open) return <BookDrill key={open.family + color} family={open} color={color} onBack={() => setOpen(null)} />;
  if (!all) return <p className="hint">Loading the book…</p>;
  const q = query.trim().toLowerCase();
  const yours = all.filter((f) => mine.has(f.family)).sort((a, b) => mine.get(b.family)!.n - mine.get(a.family)!.n);
  const rest = all.filter((f) => !mine.has(f.family) && (!q || f.family.toLowerCase().includes(q)));
  const row = (f: FamilyInfo) => {
    const done = f.lines.filter((l) => learned.has(l.index)).length;
    const m = mine.get(f.family);
    return (
      <li key={f.family}>
        <button className="move-row learn-row" onClick={() => setOpen(f)}>
          <span className="mv">{f.family}</span>
          <span className="muted">{m ? `${m.n} games · ${pct(m.points / m.n)}` : ''}</span>
          <span className="mv-score">{done}/{f.lines.length}</span>
          <span className="op-meter" aria-hidden><i className="w" style={{ width: `${(done / f.lines.length) * 100}%` }} /></span>
        </button>
      </li>
    );
  };
  return (
    <div className="cols">
      <div>
        <p className="hint">The computer plays book replies from the lichess opening list. Stay in book until the line ends; a line counts as learned when you finish it without a mistake.</p>
        {yours.length > 0 && (
          <section>
            <h3>Openings you play as {color === 'w' ? 'White' : 'Black'}</h3>
            <ul className="move-list">{yours.slice(0, 12).map(row)}</ul>
          </section>
        )}
      </div>
      <div>
        <section>
          <h3>All openings</h3>
          <input className="search" placeholder="Search, e.g. Caro-Kann" value={query} onChange={(e) => setQuery(e.target.value)} />
          <ul className="move-list">{rest.slice(0, q ? 60 : 30).map(row)}</ul>
          {!q && rest.length > 30 && <p className="hint">{rest.length - 30} more: search to find them.</p>}
        </section>
      </div>
    </div>
  );
}

function BookDrill({ family, color, onBack }: { family: FamilyInfo; color: Color; onBack: () => void }) {
  const [learned, setLearned] = useState<Set<number> | null>(null);
  const [target, setTarget] = useState<BookLine | null>(null);
  const [ply, setPly] = useState(0);
  const [moves, setMoves] = useState<string[]>([]);
  const [misses, setMisses] = useState(0);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'bad' | 'done'; text: string } | null>(null);
  const [shapes, setShapes] = useState<{ orig: Key; dest: Key; brush: string }[]>([]);
  const [round, setRound] = useState(0);

  useEffect(() => {
    learnedLines(color).then((l) => {
      setLearned(l);
      setTarget(pickTarget(family.lines, l));
    });
  }, [family, color, round]);

  const chess = useMemo(() => {
    const c = new Chess();
    for (const s of moves) c.move(s);
    return c;
  }, [moves]);
  const done = !!target && ply >= target.sans.length;

  // Computer plays the book reply.
  useEffect(() => {
    if (!target || done || plyColor(ply) === color) return;
    const t = setTimeout(() => {
      setMoves((m) => [...m, target.sans[ply]]);
      setPly((p) => p + 1);
    }, ply === 0 ? 500 : 400);
    return () => clearTimeout(t);
  }, [target, ply, color, done]);

  // Finished the line.
  useEffect(() => {
    if (!target || !done || feedback?.kind === 'done') return;
    void recordLine(color, target.index, misses === 0);
    setFeedback({ kind: 'done', text: misses ? `Line done with ${misses} slip${misses > 1 ? 's' : ''}. Play it again to learn it.` : `Learned: ${target.name}.` });
  }, [done, target, misses, color, feedback]);

  // Test hooks for the headless run (scripts/learn-check.mjs).
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__book = { target: target?.sans, ply, color, done };
    w.__sanToUci = (pre: string[], san: string) => {
      const c = new Chess();
      for (const s of pre) c.move(s);
      const m = c.move(san);
      return m.from + m.to;
    };
    w.__anyOtherUci = (pre: string[], san: string) => {
      const c = new Chess();
      for (const s of pre) c.move(s);
      const other = c.moves({ verbose: true }).find((m) => m.san !== san && !family.lines.some((l) => pre.every((s, i) => l.sans[i] === s) && l.sans[pre.length] === m.san))!;
      return other.from + other.to;
    };
  }, [target, ply, color, done, family]);

  if (!target || !learned) return <p className="hint">Loading…</p>;
  const myTurn = !done && plyColor(ply) === color;
  const dests = new Map<Key, Key[]>();
  if (myTurn) for (const m of chess.moves({ verbose: true })) dests.set(m.from as Key, [...(dests.get(m.from as Key) ?? []), m.to as Key]);
  const last = chess.history({ verbose: true }).at(-1);
  const config: Config = {
    fen: chess.fen(),
    orientation: color === 'w' ? 'white' : 'black',
    turnColor: chess.turn() === 'w' ? 'white' : 'black',
    lastMove: last ? [last.from as Key, last.to as Key] : undefined,
    movable: {
      free: false,
      color: myTurn ? (color === 'w' ? 'white' : 'black') : undefined,
      dests,
      showDests: true,
      events: {
        after: (from, to) => {
          let san = '';
          try {
            san = new Chess(chess.fen()).move({ from: from as Square, to: to as Square, promotion: 'q' }).san;
          } catch {
            return;
          }
          const r = judgeBookMove(family.lines, target, moves, san, learned);
          if (r.ok) {
            if (r.target !== target) setTarget(r.target);
            setFeedback({ kind: 'ok', text: `${label(ply, san)} ✓` });
            setShapes([]);
            setMoves((m) => [...m, san]);
            setPly((p) => p + 1);
          } else {
            const right = new Chess(chess.fen()).move(target.sans[ply]);
            setMisses((x) => x + 1);
            setFeedback({ kind: 'bad', text: `${san} is out of book here. The book move is ${label(ply, target.sans[ply])}.` });
            setShapes([{ orig: right.from as Key, dest: right.to as Key, brush: 'green' }]);
          }
        },
      },
    },
    drawable: { enabled: false, visible: true, autoShapes: shapes },
  };
  const total = family.lines.length;
  const doneCount = family.lines.filter((l) => learned.has(l.index)).length;
  return (
    <div className="drill split">
      <div className="split-main"><Board config={config} /></div>
      <div className="split-side">
        <button className="link" onClick={onBack}>← All openings</button>
        <div>
          <p className="eyebrow tight">Learn · {color === 'w' ? 'White' : 'Black'} · {doneCount}/{total} lines learned</p>
          <h2 className="tight">{family.family}</h2>
          <p className="hint">{done ? target.name : 'Play your side; the computer answers from the book.'}</p>
        </div>
        <p className={`feedback ${feedback?.kind ?? ''}`} aria-live="polite">{feedback?.text ?? (myTurn ? 'Your move.' : '…')}</p>
        <p className="moves">
          {moves.map((s, i) => (
            <span key={i} className={plyColor(i) === color ? 'mine' : ''}>{i % 2 === 0 ? `${i / 2 + 1}. ` : ''}{s} </span>
          ))}
        </p>
        {done && (
          <button
            className="primary"
            onClick={() => {
              setPly(0);
              setMoves([]);
              setMisses(0);
              setFeedback(null);
              setShapes([]);
              setTarget(null);
              setRound((r) => r + 1);
            }}
          >
            Next line
          </button>
        )}
      </div>
    </div>
  );
}

