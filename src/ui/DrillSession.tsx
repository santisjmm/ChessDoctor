import { useCallback, useState } from 'react';
import type { DrillItem } from '../lib/db';
import { recordAttempt } from '../lib/drills';
import { LineDrill } from './LineDrill';

/** Runs a list of drills one after another and records each result. */
export function DrillSession({ items, onExit }: { items: DrillItem[]; onExit: () => void }) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState<number | null>(null); // misses of the current item once finished
  const [slips, setSlips] = useState(0);
  const item = items[i];
  const finish = useCallback(
    (misses: number) => {
      setDone(misses);
      setSlips((s) => s + misses);
      recordAttempt(item, misses).catch(() => undefined);
    },
    [item],
  );
  if (!item) {
    return (
      <main className="screen drill-end">
        <h1>Training done</h1>
        <p className="lede">{items.length} line{items.length === 1 ? '' : 's'}, {slips ? `${slips} slip${slips === 1 ? '' : 's'}` : 'no slips'}.</p>
        <p className="hint">Lines you got right come back in a few days; slips come back in 10 minutes.</p>
        <button className="primary" onClick={onExit}>Back home</button>
      </main>
    );
  }
  return (
    <main className="screen train">
      <header className="row">
        <button className="link" onClick={onExit}>✕ Stop</button>
        <span className="muted">{i + 1} / {items.length}</span>
      </header>
      <div>
        <p className="eyebrow tight">{item.kind === 'mistake' ? 'Fix a mistake' : 'Your main line'} · {item.color === 'w' ? 'White' : 'Black'}</p>
        <h2 className="tight">{item.family}</h2>
        {item.kind === 'mistake' && item.played && <p className="hint">You played the wrong move here in {item.games} games.</p>}
      </div>
      <LineDrill key={item.id + i} item={item} onFinish={finish} />
      {done !== null && (
        <button
          className="primary"
          onClick={() => {
            setDone(null);
            setI((k) => k + 1);
          }}
        >
          {i + 1 < items.length ? 'Next line' : 'Finish'}
        </button>
      )}
    </main>
  );
}
