import { useEffect, useRef, useState } from 'react';
import { canvasToBlob, drawCard, pct, shareOrDownload, downloadBlob, signedPct, type CardFormat } from '../lib/card';
import { moveLabel, type ReportResult } from '../lib/pipeline';
import { moveNumber } from '../lib/openings';
import { score } from '../lib/report';
import { APP_NAME, APP_URL } from '../config';
import { shareUrl } from '../lib/share';

export function ReportView({
  result, onTrain, onRestart, onAbout, shared = false,
}: { result: ReportResult; onTrain: () => void; onRestart: () => void; onAbout: () => void; shared?: boolean }) {
  const [format, setFormat] = useState<CardFormat>('portrait');
  const [png, setPng] = useState<{ url: string; blob: Blob } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const { report, mistake, card } = result;

  useEffect(() => {
    let live = true;
    (async () => {
      await drawCard(canvas.current, card, format);
      const blob = await canvasToBlob(canvas.current);
      if (!live) return;
      // Revoke the previous image only once the new one replaces it.
      setPng((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url: URL.createObjectURL(blob), blob };
      });
    })();
    return () => {
      live = false;
    };
  }, [card, format]);

  const filename = `opening-report-${card.name.replace(/[^A-Za-z0-9_-]+/g, '_')}-${format}.png`;
  const link = shareUrl(result.accounts);
  const shareText = shared
    ? `${card.name}’s ${APP_NAME} opening report card: ${link}`
    : `My ${APP_NAME} opening report card: ${link}\nGet yours free at https://${APP_URL}`;

  return (
    <main className="screen report">
      <header className="row">
        <button className="link" onClick={onRestart}>{shared ? '← Make my own' : '← New report'}</button>
        <div className="seg" role="tablist" aria-label="Card size">
          <button role="tab" aria-selected={format === 'portrait'} onClick={() => setFormat('portrait')}>Phone</button>
          <button role="tab" aria-selected={format === 'wide'} onClick={() => setFormat('wide')}>Wide</button>
        </div>
      </header>

      <div className={`card-preview ${format}`}>{png ? <img src={png.url} alt="Your opening report card" /> : <div className="card-skeleton" />}</div>

      <div className="actions">
        <button
          className="secondary"
          disabled={!png}
          onClick={async () => {
            if (!png) return;
            const r = await shareOrDownload(png.blob, filename, shareText);
            setMsg(r === 'downloaded' ? 'Saved as PNG.' : r === 'shared' ? 'Shared.' : null);
          }}
        >
          Share card
        </button>
        <button className="secondary" disabled={!png} onClick={() => png && downloadBlob(png.blob, filename)}>
          Download PNG
        </button>
      </div>
      <button
        className="link center-self"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setMsg('Link copied. It rebuilds this card on the viewer’s device.');
          } catch {
            setMsg(link);
          }
        }}
      >
        Copy link to this card
      </button>
      {msg && <p className="hint center">{msg}</p>}

      {shared && (
        <section className="cta">
          <h2>What’s your leak?</h2>
          <p>Get your own card in about 20 seconds, then train the line you keep getting wrong. Free, no sign-up, runs on your phone.</p>
          <button className="primary" onClick={onRestart}>Get my own report card</button>
        </section>
      )}

      {!shared && report.leak && (
        <section className="cta">
          <h2>Fix your leak</h2>
          <p>
            {report.leak.stat.family} as {report.leak.stat.color === 'w' ? 'White' : 'Black'}:{' '}
            {mistake ? (
              <>
                you play <b className="bad">{moveLabel(mistake.ply, mistake.played)}</b>, the engine prefers <b className="good">{moveLabel(mistake.ply, mistake.best)}</b>.
              </>
            ) : (
              <>the trouble starts once you leave book at move {moveNumber(report.leak.exitPly)}.</>
            )}
          </p>
          <button className="primary" onClick={onTrain}>Fix your leak: train this line</button>
        </section>
      )}

      <section>
        <h2>{shared ? 'Openings' : 'Your openings'}</h2>
        <p className="hint">Score compared with {shared ? 'their' : 'your'} average as that colour (White {pct(score(report.byColor.w))}, Black {pct(score(report.byColor.b))}).</p>
        {(['w', 'b'] as const).map((c) => (
          <div key={c} className="op-group">
            <h3>As {c === 'w' ? 'White' : 'Black'}</h3>
            <ul className="op-list">
              {report.openings
                .filter((o) => o.color === c && o.family !== 'Unknown')
                .slice(0, 6)
                .map((o) => {
                  const cls = o.n < report.minGames ? 'few' : o.diff >= 0.03 ? 'up' : o.diff <= -0.03 ? 'down' : 'flat';
                  return (
                    <li key={o.family} className={cls}>
                      <span className="op-name">{o.family}</span>
                      <span className="op-n">{o.n}</span>
                      <span className="op-score">{pct(score(o))}</span>
                      <span className="op-diff">{signedPct(o.diff)}</span>
                      <span className="op-meter" aria-hidden>
                        <i style={{ width: `${o.wins / o.n * 100}%` }} className="w" />
                        <i style={{ width: `${o.draws / o.n * 100}%` }} className="d" />
                        <i style={{ width: `${o.losses / o.n * 100}%` }} className="l" />
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
        <p className="hint">
          Openings with fewer than {report.minGames} games are shown faded and are never picked as your best or your leak. Book: lichess chess-openings (CC0). Engine: Stockfish 19, on this device.
        </p>
      </section>
      <button className="link" onClick={onAbout}>About &amp; licences</button>
    </main>
  );
}
