import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_GAMES } from './config';
import { analysis } from './lib/analysis';
import { db, type DrillItem } from './lib/db';
import { drillsFromVerdicts, mainLineDrill, mistakeDrill, upsertDrills } from './lib/drills';
import type { Account } from './lib/importer';
import { saveAccounts, savedAccounts } from './lib/library';
import { parseSharePath } from './lib/share';
import { reportFromDevice, runReport, type ReportResult, type Stage } from './lib/pipeline';
import { About } from './ui/About';
import { DrillSession } from './ui/DrillSession';
import { Games } from './ui/Games';
import { Home } from './ui/Home';
import { Openings } from './ui/Openings';
import { Progress } from './ui/Progress';
import { SharedIntro } from './ui/SharedIntro';
import { ReportView } from './ui/ReportView';
import { Start } from './ui/Start';
import { TabBar, type Tab } from './ui/TabBar';
import { Working } from './ui/Working';

type View = 'boot' | 'start' | 'working' | 'home' | 'openings' | 'games' | 'progress' | 'report' | 'drill' | 'about' | 'shared' | 'shared-report';
const ROUTES: View[] = ['start', 'home', 'openings', 'games', 'progress', 'report', 'drill', 'about', 'shared', 'shared-report'];
const routeView = (): View | null => {
  const v = location.hash.replace(/^#\/?/, '').split('?')[0] as View;
  return ROUTES.includes(v) ? v : null;
};

/** Hands a fresh report to the trainer: engine verdicts, drills and the background queue. */
async function adopt(r: ReportResult) {
  (window as unknown as Record<string, unknown>).__report = r; // for the headless check
  analysis.seed(r.verdicts);
  const lines = (['w', 'b'] as const).map((c) => mainLineDrill(r.items, c)).filter((d): d is DrillItem => !!d);
  await upsertDrills([...drillsFromVerdicts(r.verdicts), ...lines]).catch(() => undefined);
  void analysis.start(r.items);
}

export function App() {
  const [view, setView] = useState<View>('boot');
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

  const go = useCallback((v: View) => {
    setView(v);
    const hash = `#/${v}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
  }, []);

  // Back button / manual hash changes.
  useEffect(() => {
    const onPop = () => {
      const v = routeView();
      if (!v) return;
      if (['report', 'openings', 'home', 'games', 'progress'].includes(v) && !result) return;
      if (v === 'drill' && !session.length) return;
      if ((v === 'shared' || v === 'shared-report') && !shared) return;
      if (v === 'shared-report' && !sharedResult) return;
      setView(v);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [result, session, shared, sharedResult]);

  // Boot: returning users go straight to Today, built from the games on this device.
  useEffect(() => {
    (async () => {
      if (shared) {
        setView('shared');
        return;
      }
      const acc = savedAccounts();
      const haveGames = acc.length > 0 && (await db.games.count().catch(() => 0)) > 0;
      if (!haveGames) {
        setView('start');
        return;
      }
      const wanted = routeView();
      setView(wanted === 'about' ? 'about' : 'home');
      try {
        const r = await reportFromDevice(acc, DEFAULT_GAMES, () => undefined);
        setResult(r);
        await adopt(r);
        if (wanted && ['openings', 'report', 'games', 'progress'].includes(wanted)) setView(wanted);
      } catch {
        setView('start');
      }
    })();
  }, []);

  async function build(acc: Account[], after: View = 'report') {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setError(null);
    setStage(null);
    if (after === 'report') go('working');
    else setBusy('Fetching…');
    saveAccounts(acc);
    setAccounts(acc);
    try {
      const r = await runReport(acc, DEFAULT_GAMES, (s) => {
        setStage(s);
        if (after !== 'report') setBusy(s.kind === 'import' ? 'Fetching…' : 'Analysing…');
      }, ac.signal);
      if (ac.signal.aborted) return;
      setResult(r);
      await adopt(r);
      go(after);
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      if (after === 'report') go('start');
    } finally {
      setBusy(null);
    }
  }

  /** Builds a shared card on this device without touching the viewer's own accounts or drills. */
  async function buildShared(acc: Account[]) {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setError(null);
    setStage(null);
    go('working');
    try {
      const r = await runReport(acc, DEFAULT_GAMES, setStage, ac.signal);
      if (ac.signal.aborted) return;
      (window as unknown as Record<string, unknown>).__report = r; // for the headless check
      setSharedResult(r);
      go('shared-report');
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      go('shared');
    }
  }

  /** Leaves a share link for the app proper (own card or Today). */
  const leaveShared = () => {
    history.pushState(null, '', '/');
    location.reload();
  };

  const drill = (items: DrillItem[]) => {
    if (!items.length) return;
    setSession(items);
    go('drill');
  };

  const tab = (['home', 'openings', 'games', 'progress', 'report'].includes(view) ? view : null) as Tab | null;

  return (
    <div className={`app ${tab ? 'with-tabs' : ''}`}>
      {view === 'boot' && <main className="screen"><p className="hint">Loading…</p></main>}
      {view === 'shared' && shared && <SharedIntro accounts={shared} error={error} onBuild={() => buildShared(shared)} onOwn={leaveShared} />}
      {view === 'shared-report' && sharedResult && (
        <ReportView result={sharedResult} shared onTrain={leaveShared} onRestart={leaveShared} onAbout={() => go('about')} />
      )}
      {view === 'start' && <Start onSubmit={(a) => build(a, 'report')} error={error} onAbout={() => go('about')} />}
      {view === 'working' && (
        <Working
          stage={stage}
          onCancel={() => {
            abort.current?.abort();
            go(shared && !sharedResult ? 'shared' : result ? 'home' : 'start');
          }}
        />
      )}
      {view === 'home' && (
        <Home
          accounts={accounts}
          result={result}
          busy={busy}
          onStart={drill}
          onRefresh={() => build(accounts, 'home')}
          onCard={() => go('report')}
          onChangeAccounts={() => go('start')}
        />
      )}
      {view === 'openings' && result && (
        <Openings
          items={result.items}
          onDrill={async (item) => {
            await upsertDrills([item]);
            drill([(await db.drills.get(item.id)) ?? item]);
          }}
        />
      )}
      {view === 'games' && result && (
        <Games
          items={result.items}
          onDrill={async (item) => {
            await upsertDrills([item]);
            drill([(await db.drills.get(item.id)) ?? item]);
          }}
        />
      )}
      {view === 'progress' && result && <Progress items={result.items} />}
      {view === 'report' && result && (
        <ReportView
          result={result}
          onTrain={async () => {
            const { mistake, report } = result;
            const node = mistake && result.verdicts.find((p) => p.v === mistake)?.node;
            const item = node ? mistakeDrill(node, mistake) : report.leak ? mainLineFromLeak(result) : null;
            if (!item) return;
            await upsertDrills([item]);
            drill([(await db.drills.get(item.id)) ?? item]);
          }}
          onRestart={() => go('start')}
          onAbout={() => go('about')}
        />
      )}
      {view === 'drill' && <DrillSession key={session.map((s) => s.id).join()} items={session} onExit={() => go(result ? 'home' : 'start')} />}
      {view === 'about' && <About onBack={() => go(shared ? (sharedResult ? 'shared-report' : 'shared') : result ? 'home' : 'start')} />}
      {tab && <TabBar tab={tab} onTab={(t) => go(t)} />}
    </div>
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
