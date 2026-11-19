import { useMemo, useState } from 'react';
import { db } from '../lib/db';
import type { Account } from '../lib/importer';
import { mostCommonPlayer, parsePgn, toGames } from '../lib/pgn';

/** Paste or open a PGN file (one or many games) and add your games to the device. */
export function PgnImport({ onImported, onClose }: { onImported: (a: Account) => Promise<void>; onClose: () => void }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const parsed = useMemo(() => (text.trim() ? parsePgn(text) : null), [text]);
  const guess = useMemo(() => (parsed ? mostCommonPlayer(parsed.games) : null), [parsed]);
  const who = name || guess || '';
  const conv = useMemo(() => (parsed && who ? toGames(parsed.games, who) : null), [parsed, who]);

  async function save() {
    if (!conv || !conv.games.length) return;
    setBusy(true);
    try {
      const user = who.trim().toLowerCase();
      await db.games.bulkPut(conv.games);
      const newest = Math.max(...conv.games.map((g) => g.playedAt));
      const prev = await db.profiles.get(`pgn:${user}`);
      await db.profiles.put({ key: `pgn:${user}`, site: 'pgn', user, lastImportAt: Date.now(), newestPlayedAt: Math.max(newest, prev?.newestPlayedAt ?? 0) });
      await onImported({ site: 'pgn', user: who.trim() });
      setMsg(`Imported ${conv.games.length} game${conv.games.length === 1 ? '' : 's'}.`);
      setText('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="verdict pgn-import">
      <div className="row">
        <p className="verdict-title">Import PGN</p>
        <button className="link" onClick={onClose}>Close</button>
      </div>
      <p className="hint">Paste one or many games, or open a .pgn file, for example games against bots that the public APIs don’t list. Everything stays on this device.</p>
      <textarea rows={6} placeholder={'[Event "…"]\n[White "…"]\n…\n1. e4 e5 2. Nf3 …'} value={text} onChange={(e) => setText(e.target.value)} />
      <input type="file" accept=".pgn,application/x-chess-pgn,text/plain" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (f) setText(await f.text());
      }} />
      {parsed && (
        <>
          <label>
            <span>Your name in these games</span>
            <input value={who} onChange={(e) => setName(e.target.value)} autoCapitalize="off" spellCheck={false} />
          </label>
          <p className="hint">
            Found {parsed.games.length} game{parsed.games.length === 1 ? '' : 's'}
            {conv ? `, ${conv.games.length} with “${who}” and a result` : ''}
            {parsed.skipped ? `; skipped ${parsed.skipped} (custom start position, variant or unreadable)` : ''}.
          </p>
          <button className="primary" disabled={busy || !conv?.games.length} onClick={save}>
            {busy ? 'Importing…' : `Import ${conv?.games.length ?? 0} game${conv?.games.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
      {msg && <p className="hint">{msg}</p>}
    </section>
  );
}
