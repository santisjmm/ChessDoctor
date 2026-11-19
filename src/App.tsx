import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_GAMES } from './config';
import { analysis } from './lib/analysis';
import { db, type DrillItem } from './lib/db';
import { drillsFromVerdicts, mainLineDrill, mistakeDrill, positionDrill, positionDrillsFrom, upsertDrills } from './lib/drills';
import type { Account } from './lib/importer';
import { saveAccounts, savedAccounts } from './lib/library';
import { reportFromDevice, runReport, type ReportResult, type Stage } from './lib/pipeline';
import { parseSharePath } from './lib/share';
import { DrillSession } from './ui/DrillSession';
import { Bare, Layout, type Tab } from './ui/Layout';
import { GamePage } from './ui/pages/GamePage';
import { GamesPage } from './ui/pages/GamesPage';
import { SettingsPage } from './ui/pages/SettingsPage';
import { StatsPage } from './ui/pages/StatsPage';
import { TrainPage, type TrainTab } from './ui/pages/TrainPage';
import { ReportView } from './ui/ReportView';
import { SharedIntro } from './ui/SharedIntro';
import { Start } from './ui/Start';
import { Working } from './ui/Working';

/** Where the app is: parsed from and written to the URL hash. */
type Route =
  | { v: 'boot' | 'start' | 'working' | 'drill' | 'card' | 'stats' | 'settings' | 'games' | 'shared' | 'shared-report' }
  | { v: 'game'; id: string }
  | { v: 'train'; tab: TrainTab };

const TRAIN_TABS: TrainTab[] = ['today', 'mistakes', 'openings', 'learn'];
function parseHash(): Route | null {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  if (a === 'games' && b) return { v: 'game', id: decodeURIComponent(b) };
  if (a === 'train') return { v: 'train', tab: TRAIN_TABS.includes(b as TrainTab) ? (b as TrainTab) : 'today' };
  if (a === 'report') return { v: 'card' }; // older links
  if (a === 'progress') return { v: 'stats' };
  if (a === 'openings') return { v: 'train', tab: 'openings' };
  if (a === 'home') return { v: 'train', tab: 'today' };
  if (a === 'about') return { v: 'settings' };
  if (['games', 'stats', 'settings', 'card', 'start', 'drill'].includes(a)) return { v: a } as Route;
  return null;
}
const hashOf = (r: Route) => (r.v === 'game' ? `#/games/${encodeURIComponent(r.id)}` : r.v === 'train' ? `#/train/${r.tab}` : `#/${r.v}`);
const NEEDS_RESULT = new Set(['games', 'game', 'train', 'stats', 'card']);

/** Hands a fresh report to the trainer: engine verdicts, drills and the background queue. */
async function adopt(r: ReportResult) {
  (window as unknown as Record<string, unknown>).__report = r; // for the headless check
  analysis.seed(r.verdicts);
  const lines = (['w', 'b'] as const).map((c) => mainLineDrill(r.items, c)).filter((d): d is DrillItem => !!d);
  await upsertDrills([...drillsFromVerdicts(r.verdicts), ...lines]).catch(() => undefined);
  void analysis.start(r.items);
}

export function App() {
  const [route, setRoute] = useState<Route>({ v: 'boot' });
  const [accounts, setAccounts] = useState<Account[]>(savedAccounts);
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [session, setSession] = useState<DrillItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  // Someone else's card opened from a share link: never saved, never trained.
  const [shared] = useState<Account[] | null>(() => parseSharePath(location.pathname));
  const [sharedResult, setSharedResult] = useState<ReportResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  const back = useRef<Route>({ v: 'train', tab: 'today' });

  const go = useCallback((r: Route) => {
    setRoute(r);
    const h = hashOf(r);
    if (location.hash !== h) history.pushState(null, '', h);
    window.scrollTo(0, 0);
  }, []);

  // Back button / manual hash changes.
  useEffect(() => {
    const onPop = () => {
      const r = parseHash();
      if (!r) return;
      if (NEEDS_RESULT.has(r.v) && !result) return;
      if (r.v === 'drill' && !session.length) return;
      setRoute(r);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [result, session]);

  // Boot: returning users open on Train > Today, built from the games on this device.
  useEffect(() => {
    (async () => {
      if (shared) return setRoute({ v: 'shared' });
      const acc = savedAccounts();
      const haveGames = acc.length > 0 && (await db.games.count().catch(() => 0)) > 0;
      if (!haveGames) return setRoute({ v: 'start' });
      const wanted = parseHash();
      try {
        const r = await reportFromDevice(acc, DEFAULT_GAMES, () => undefined);
        setResult(r);
        await adopt(r);
        setRoute(wanted && wanted.v !== 'start' && wanted.v !== 'drill' ? wanted : { v: 'train', tab: 'today' });
      } catch {
        setRoute({ v: 'start' });
      }
    })();
  }, [shared]);

  async function build(online: Account[], after: 'card' | 'stay' = 'card') {
    const acc = [...online, ...savedAccounts().filter((a) => a.site === 'pgn')];
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setError(null);
    setStage(null);
    if (after === 'card') go({ v: 'working' });
    else setBusy('Syncing…');
    saveAccounts(acc);
    setAccounts(acc);
    try {
      const r = await runReport(acc, DEFAULT_GAMES, (s) => {
        setStage(s);
        if (after !== 'card') setBusy(s.kind === 'import' ? 'Syncing…' : 'Analysing…');
      }, ac.signal);
      if (ac.signal.aborted) return;
      setResult(r);
      await adopt(r);
      if (after === 'card') go({ v: 'card' });
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      if (after === 'card') go({ v: 'start' });
    } finally {
      setBusy(null);
    }
  }

  async function reload(acc = savedAccounts()) {
    setAccounts(acc);
    const r = await reportFromDevice(acc, DEFAULT_GAMES, () => undefined);
    setResult(r);
    await adopt(r);
  }

  /** Builds a shared card on this device without touching the viewer's own accounts or drills. */
  async function buildShared(acc: Account[]) {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setError(null);
    setStage(null);
    go({ v: 'working' });
    try {
      const r = await runReport(acc, DEFAULT_GAMES, setStage, ac.signal);
      if (ac.signal.aborted) return;
      (window as unknown as Record<string, unknown>).__report = r;
      setSharedResult(r);
      go({ v: 'shared-report' });
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      go({ v: 'shared' });
    }
  }
  /** Leaves a share link for the app proper. */
  const leaveShared = () => {
    history.pushState(null, '', '/');
    location.reload();
  };

  const drill = async (items: DrillItem[]) => {
    if (!items.length) return;
    await upsertDrills(items).catch(() => undefined);
    const fresh = await Promise.all(items.map(async (i) => (await db.drills.get(i.id)) ?? i));
    back.current = route;
    setSession(fresh);
    go({ v: 'drill' });
  };

  const sync = () => void build(accounts.filter((a) => a.site !== 'pgn'), 'stay');
  const tab: Tab | null =
    route.v === 'games' || route.v === 'game' ? 'games' : route.v === 'train' ? 'train' : route.v === 'stats' || route.v === 'card' ? 'stats' : route.v === 'settings' ? 'settings' : null;
  const onTab = (t: Tab) => go(t === 'train' ? { v: 'train', tab: 'today' } : ({ v: t } as Route));
  const gameItem = route.v === 'game' ? result?.items.find((i) => i.game.id === route.id) : undefined;

  if (tab && result) {
    return (
      <Layout tab={tab} onTab={onTab} busy={busy} onSync={sync}>
        {route.v === 'games' && (
          <GamesPage
            items={result.items}
            onOpen={(id) => go({ v: 'game', id })}
            onImported={async (a) => {
              const acc = [...accounts.filter((x) => !(x.site === 'pgn' && x.user.toLowerCase() === a.user.toLowerCase())), a];
              saveAccounts(acc);
              await reload(acc);
            }}
          />
        )}
        {route.v === 'game' && gameItem && (
          <GamePage
            key={gameItem.game.id}
            item={gameItem}
            onBack={() => go({ v: 'games' })}
            onReviewed={(r) => void upsertDrills(positionDrillsFrom(r, gameItem.game.color, gameItem.opening?.family ?? 'Middlegame'))}
            onTrainMistake={(r, p) => void drill([positionDrill(r, p, gameItem.opening?.family ?? 'Middlegame')])}
          />
        )}
        {route.v === 'game' && !gameItem && <div className="empty"><h3>Game not found on this device</h3></div>}
        {route.v === 'train' && (
          <TrainPage tab={route.tab} onTab={(t) => go({ v: 'train', tab: t })} result={result} onStart={(i) => void drill(i)} onCard={() => go({ v: 'card' })} />
        )}
        {route.v === 'stats' && <StatsPage result={result} onOpenGame={(id) => go({ v: 'game', id })} onCard={() => go({ v: 'card' })} />}
        {route.v === 'card' && (
          <ReportView
            result={result}
            onTrain={async () => {
              const { mistake, report } = result;
              const node = mistake && result.verdicts.find((p) => p.v === mistake)?.node;
              const item = node ? mistakeDrill(node, mistake) : report.leak ? mainLineFromLeak(result) : null;
              if (item) await drill([item]);
            }}
            onRestart={() => go({ v: 'start' })}
            onAbout={() => go({ v: 'settings' })}
          />
        )}
        {route.v === 'settings' && <SettingsPage busy={busy} onSync={sync} onChangeAccounts={() => go({ v: 'start' })} onImported={() => void reload()} />}
      </Layout>
    );
  }

  return (
    <Bare>
      {route.v === 'boot' && <p className="muted">Loading…</p>}
      {route.v === 'start' && <Start onSubmit={(a) => build(a, 'card')} error={error} onAbout={() => go({ v: 'settings' })} />}
      {route.v === 'working' && (
        <Working
          stage={stage}
          onCancel={() => {
            abort.current?.abort();
            go(shared && !sharedResult ? { v: 'shared' } : result ? { v: 'train', tab: 'today' } : { v: 'start' });
          }}
        />
      )}
      {route.v === 'shared' && shared && <SharedIntro accounts={shared} error={error} onBuild={() => buildShared(shared)} onOwn={leaveShared} />}
      {route.v === 'shared-report' && sharedResult && <ReportView result={sharedResult} shared onTrain={leaveShared} onRestart={leaveShared} onAbout={() => undefined} />}
      {route.v === 'drill' && <DrillSession key={session.map((s) => s.id).join()} items={session} onExit={() => go(result ? back.current : { v: 'start' })} />}
      {NEEDS_RESULT.has(route.v) && !result && <p className="muted">Loading…</p>}
      {route.v === 'settings' && !result && <SettingsPage busy={busy} onSync={sync} onChangeAccounts={() => go({ v: 'start' })} onImported={() => void reload()} />}
    </Bare>
  );
}

/** When the engine found no concrete mistake, the leak's usual line becomes a plain line drill. */
function mainLineFromLeak(r: ReportResult): DrillItem | null {
  const leak = r.report.leak!;
  const color = leak.stat.color;
  const line = [...(r.leakLine ?? leak.path)];
  while (line.length && (line.length - 1) % 2 !== (color === 'w' ? 0 : 1)) line.pop();
  if (!line.length) return null;
  const now = Date.now();
  return {
    id: `${color}|${line.join(' ')}`, kind: 'line', color, family: leak.stat.family, line, focusPly: -1,
    games: leak.lineTally.n, createdAt: now, box: 0, due: now, reps: 0, lapses: 0,
  };
}
