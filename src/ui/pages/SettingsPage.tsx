import { useLiveQuery } from 'dexie-react-hooks';
import { Download, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { APP_NAME, SOURCE_URL } from '../../config';
import { deleteAllData, exportData, importData } from '../../lib/backup';
import { downloadBlob } from '../../lib/card';
import { db } from '../../lib/db';
import { siteName } from '../../lib/importer';
import { getBoard, getTheme, setBoard, setTheme, type BoardTheme, type Theme } from '../../lib/prefs';
import { relativeTime } from '../Layout';

const BOARDS: [BoardTheme, string, string][] = [['green', '#ebecd0', '#739552'], ['brown', '#f0d9b5', '#b58863'], ['blue', '#dee3e6', '#8ca2ad'], ['slate', '#c9cfd6', '#6b7a8a']];

export function SettingsPage({ busy, onSync, onChangeAccounts, onImported }: { busy: string | null; onSync: () => void; onChangeAccounts: () => void; onImported: () => void }) {
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);
  const [theme, setT] = useState<Theme>(getTheme);
  const [board, setB] = useState<BoardTheme>(getBoard);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div>
      <div className="page-head"><div><h1>Settings</h1><div className="sub">Everything is stored on this device</div></div></div>
      <div className="settings">
        <div className="card card-pad">
          <h2>Accounts</h2>
          <p className="muted" style={{ margin: '0 0 6px', fontSize: 13.5 }}>Games are fetched by this device from the public Lichess and Chess.com APIs.</p>
          {profiles.map((p) => (
            <div key={p.key} className="platform-card">
              <div className="row"><span className="dot ok" /><b>{siteName(p.site)}</b><span className="muted">· {p.user}</span></div>
              <dl className="kv">
                <dt>{p.site === 'pgn' ? 'Imported' : 'Last sync'}</dt><dd>{relativeTime(p.lastImportAt)}</dd>
                <dt>Newest game</dt><dd>{p.newestPlayedAt ? new Date(p.newestPlayedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–'}</dd>
              </dl>
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={!!busy} onClick={onSync}><RefreshCw size={15} className={busy ? 'spin' : ''} /> {busy ?? 'Sync now'}</button>
            <button className="btn" onClick={onChangeAccounts}>Change usernames</button>
          </div>
        </div>

        <div className="card card-pad">
          <h2>Appearance</h2>
          <div className="setting-row">
            <div><div className="lbl">Theme</div><div className="help">Follow the system, or always dark or light.</div></div>
            <div className="segmented" role="group" aria-label="Theme">
              {(['system', 'dark', 'light'] as Theme[]).map((t) => <button key={t} aria-pressed={theme === t} onClick={() => { setTheme(t); setT(t); }} style={{ textTransform: 'capitalize' }}>{t}</button>)}
            </div>
          </div>
          <div className="setting-row">
            <div><div className="lbl">Board colours</div><div className="help">Used on every board.</div></div>
            <div className="row">
              {BOARDS.map(([b, l, d]) => (
                <button key={b} className="board-swatch" aria-label={`${b} board`} aria-pressed={board === b} onClick={() => { setBoard(b); setB(b); }}
                  style={{ backgroundImage: `conic-gradient(${d} 0 25%, ${l} 0 50%, ${d} 0 75%, ${l} 0)` }} />
              ))}
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <h2>Your data</h2>
          <div className="setting-row">
            <div><div className="lbl">Export</div><div className="help">Games, training, reviews and progress as one file, to keep or move to another device.</div></div>
            <button className="btn" onClick={async () => downloadBlob(await exportData(), `chessdoctor-${new Date().toISOString().slice(0, 10)}.json`)}><Download size={15} /> Export</button>
          </div>
          <div className="setting-row">
            <div><div className="lbl">Import</div><div className="help">Merge a ChessDoctor export into this device.</div></div>
            <label className="btn"><Upload size={15} /> Import<input type="file" accept="application/json,.json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const r = await importData(await f.text());
                setMsg(`Imported ${r.games} games and ${r.drills} drills.`);
                onImported();
              } catch (err) {
                setMsg((err as Error).message);
              }
            }} /></label>
          </div>
          <div className="setting-row">
            <div><div className="lbl">Delete everything</div><div className="help">Removes all games, training and settings from this device.</div></div>
            <button className="btn danger" onClick={async () => {
              if (!confirm('Delete all ChessDoctor data on this device? This cannot be undone.')) return;
              await deleteAllData();
              location.href = '/';
            }}><Trash2 size={15} /> Delete</button>
          </div>
          {msg && <p className="muted" style={{ fontSize: 13.5 }}>{msg}</p>}
        </div>

        <div className="card card-pad about-card">
          <h2>About &amp; licences</h2>
          <p>{APP_NAME} runs entirely in your browser: your games are fetched from the public Lichess and Chess.com APIs, analysed on this device and stored in its local database. No account, no cookies, no ads; visits are counted with cookieless Cloudflare Web Analytics.</p>
          <p>Free software under the <a href="https://www.gnu.org/licenses/gpl-3.0.html">GNU GPL v3 or later</a>. Source: <a href={SOURCE_URL}>{SOURCE_URL}</a>.</p>
          <ul>
            <li><b>Stockfish 19</b> (lite WebAssembly build by Nathan Rugg), GPLv3: <a href="engine/Copying.txt">licence</a>, <a href="https://github.com/official-stockfish/Stockfish">source</a>.</li>
            <li><b>chessground</b> board and cburnett pieces, GPLv3 / GPLv2+. <b>chess.js</b>, BSD-2-Clause.</li>
            <li><b>lichess-org/chess-openings</b>, CC0. <b>lucide</b> icons, ISC. <b>Inter</b> (report card), SIL OFL 1.1.</li>
            <li>Look and analysis rules from the Review app (GPLv3) by the same author.</li>
          </ul>
          <p className="muted" style={{ fontSize: 13 }}>Lichess and Chess.com are trademarks of their owners; {APP_NAME} is not affiliated with either.</p>
        </div>
      </div>
    </div>
  );
}
