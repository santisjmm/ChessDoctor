import { APP_NAME, DEFAULT_GAMES } from '../config';
import { siteName, type Account } from '../lib/importer';

/** Landing for a share link: says whose card it is and builds it only when asked. */
export function SharedIntro({ accounts, error, onBuild, onOwn }: { accounts: Account[]; error: string | null; onBuild: () => void; onOwn: () => void }) {
  const names = [...new Set(accounts.map((a) => a.user))].join(' · ');
  return (
    <main className="screen start">
      <p className="wordmark">{APP_NAME}</p>
      <p className="eyebrow tight">Shared report card</p>
      <h1>{names}’s opening report card</h1>
      <p className="lede">
        Best opening, biggest leak and the move to fix, from their last {DEFAULT_GAMES} public games on {accounts.map((a) => siteName(a.site)).join(' and ')}.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" onClick={onBuild}>Show the card</button>
      <ul className="facts">
        <li>The card is rebuilt here, on your device, from public games. Nothing is stored on a server, and nothing is saved to your own training.</li>
        <li>It takes a few seconds (Chess.com) to about 20 seconds (Lichess).</li>
      </ul>
      <button className="secondary" onClick={onOwn}>Make my own report card</button>
    </main>
  );
}
