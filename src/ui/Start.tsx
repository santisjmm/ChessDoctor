import { useState } from 'react';
import type { Account } from '../lib/importer';
import { DEFAULT_GAMES } from '../config';

function saved(): Account[] {
  try {
    return JSON.parse(localStorage.getItem('accounts') ?? '[]') as Account[];
  } catch {
    return [];
  }
}

export function Start({ onSubmit, error, onAbout }: { onSubmit: (a: Account[]) => void; error: string | null; onAbout: () => void }) {
  const prev = saved();
  const [lichess, setLichess] = useState(prev.find((a) => a.site === 'lichess')?.user ?? '');
  const [chesscom, setChesscom] = useState(prev.find((a) => a.site === 'chesscom')?.user ?? '');
  const valid = (s: string) => /^[A-Za-z0-9_-]{2,30}$/.test(s.trim());
  const accounts: Account[] = [
    ...(valid(lichess) ? [{ site: 'lichess' as const, user: lichess.trim() }] : []),
    ...(valid(chesscom) ? [{ site: 'chesscom' as const, user: chesscom.trim() }] : []),
  ];
  return (
    <main className="screen start">
      <p className="eyebrow">Free · no sign-up</p>
      <h1>Your opening report card</h1>
      <p className="lede">
        Where your openings win you games, where they leak points, and the exact move to fix. Built from your last {DEFAULT_GAMES} games.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (accounts.length) onSubmit(accounts);
        }}
      >
        <label>
          <span>Lichess username</span>
          <input value={lichess} onChange={(e) => setLichess(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="text" placeholder="optional" />
        </label>
        <label>
          <span>Chess.com username</span>
          <input value={chesscom} onChange={(e) => setChesscom(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="text" placeholder="optional" />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={!accounts.length}>
          Build my report card
        </button>
      </form>
      <ul className="facts">
        <li>Your games are fetched by your browser from the public APIs and analysed on this device. Nothing is uploaded.</li>
        <li>Import from Lichess and Chess.com. Fill in one or both.</li>
      </ul>
      <button className="link" onClick={onAbout}>About &amp; licences</button>
    </main>
  );
}
