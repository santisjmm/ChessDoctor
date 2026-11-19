import { APP_NAME, SOURCE_URL } from '../config';

export function About({ onBack }: { onBack: () => void }) {
  return (
    <main className="screen about">
      <button className="link" onClick={onBack}>← Back</button>
      <h1>About &amp; licences</h1>
      <p>
        {APP_NAME} runs entirely in your browser. Your games are fetched from the public Lichess and Chess.com APIs, analysed on this device and stored in
        its local database. Nothing is sent to our servers.
      </p>
      <h2>Privacy</h2>
      <p>
        No account, no cookies, no ads. We count visits with Cloudflare Web Analytics, which is cookieless and does not track you across sites. Your
        usernames, games and training stay on this device; you can delete them by clearing this site’s data in your browser.
      </p>
      <h2>Licence</h2>
      <p>
        {APP_NAME} is free software under the <a href="https://www.gnu.org/licenses/gpl-3.0.html">GNU GPL v3 or later</a>. Source code: <a href={SOURCE_URL}>{SOURCE_URL}</a>.
      </p>
      <h2>Third-party software and data</h2>
      <ul>
        <li>
          <b>Stockfish 19</b> (lite, WebAssembly build by Nathan Rugg), GPLv3. <a href="engine/Copying.txt">Licence</a> ·{' '}
          <a href="https://github.com/official-stockfish/Stockfish">Stockfish source</a> · <a href="https://github.com/nmrugg/stockfish.js">stockfish.js source</a>
        </li>
        <li><b>chessground</b> board and cburnett pieces, GPLv3 / GPLv2+.</li>
        <li><b>chess.js</b>, BSD-2-Clause.</li>
        <li><b>lichess-org/chess-openings</b> opening names, CC0.</li>
        <li><b>Inter</b> typeface, SIL Open Font License 1.1.</li>
        <li>React, Dexie, Workbox: MIT / Apache-2.0.</li>
      </ul>
      <p className="hint">Lichess and Chess.com are trademarks of their owners. This app is not affiliated with either; it only imports your public games.</p>
    </main>
  );
}
