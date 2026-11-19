import { siteName } from '../lib/importer';
import type { Stage } from '../lib/pipeline';
import type { Site } from '../lib/types';

function Bar({ value, label, note }: { value: number; label: string; note?: string }) {
  return (
    <div className="bar">
      <div className="bar-label">
        <span>{label}</span>
        <span>{note}</span>
      </div>
      <div className="bar-track" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="bar-fill" style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );
}

export function Working({ stage, onCancel }: { stage: Stage | null; onCancel: () => void }) {
  const sites = stage?.kind === 'import' ? stage.sites : null;
  const step = !stage || stage.kind === 'import' ? 1 : stage.kind === 'openings' ? 2 : 3;
  return (
    <main className="screen working">
      <h1>Building your report…</h1>
      <ol className="steps">
        <li className={step === 1 ? 'on' : step > 1 ? 'done' : ''}>Fetching your games</li>
        <li className={step === 2 ? 'on' : step > 2 ? 'done' : ''}>Matching them against the opening book</li>
        <li className={step === 3 ? 'on' : ''}>Checking your most-played moves with Stockfish</li>
      </ol>
      {sites &&
        (Object.entries(sites) as [Site, NonNullable<(typeof sites)[Site]>][]).map(([site, p]) => (
          <Bar key={site} label={siteName(site)} value={p.target ? p.fetched / p.target : 0} note={p.note === 'done' ? `${p.fetched} games ✓` : p.note ?? `${p.fetched} / ${p.target}`} />
        ))}
      {stage?.kind === 'openings' && <Bar label="Openings" value={stage.done / stage.total} note={`${stage.done} / ${stage.total}`} />}
      {stage?.kind === 'engine' && stage.total > 0 && <Bar label="Engine" value={stage.done / stage.total} note={`${stage.done} / ${stage.total} positions`} />}
      <p className="hint">Everything runs on this device. Lichess sends about 20 games a second, so 300 games take around 15 seconds.</p>
      <button className="secondary" onClick={onCancel}>Cancel</button>
    </main>
  );
}
