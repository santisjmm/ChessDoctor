import { BarChart3, Cpu, GraduationCap, ListChecks, Monitor, Moon, RefreshCw, Settings, Sun } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { APP_NAME } from '../config';
import { analysis } from '../lib/analysis';
import { db } from '../lib/db';
import { siteName } from '../lib/importer';
import { getTheme, setTheme, type Theme } from '../lib/prefs';
import { LogoMark } from './Logo';

export type Tab = 'games' | 'train' | 'stats' | 'settings';
const TABS: [Tab, string, typeof ListChecks][] = [
  ['games', 'Games', ListChecks],
  ['train', 'Train', GraduationCap],
  ['stats', 'Stats', BarChart3],
  ['settings', 'Settings', Settings],
];

export function relativeTime(t: number | null | undefined): string {
  if (!t) return 'never';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function SyncIndicator({ busy, onSync }: { busy: string | null; onSync: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const profiles = useLiveQuery(() => db.profiles.toArray(), [], []);
  const counts = useLiveQuery(async () => {
    const out: Record<string, number> = {};
    for (const p of await db.profiles.toArray())
      out[p.key] = await db.games.where('[site+user+playedAt]').between([p.site, p.user, 0], [p.site, p.user, Infinity]).count();
    return out;
  }, [profiles.length], {} as Record<string, number>);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const last = Math.max(0, ...profiles.filter((p) => p.site !== 'pgn').map((p) => p.lastImportAt));
  const label = busy ? 'Syncing…' : last ? `Synced ${relativeTime(last)}` : 'Not synced';
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="indicator" aria-label="Sync status" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`dot ${busy ? 'busy' : last ? 'ok' : 'idle'}`} aria-hidden />
        <span className="hide-mobile">{label}</span>
      </button>
      {open && (
        <div className="popover" style={{ right: 0, top: 40 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <strong>Game sync</strong>
            {!profiles.length && <p>No accounts yet.</p>}
            {profiles.map((p) => (
              <div key={p.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div className="row">
                  <span className="dot ok" />
                  <b>{siteName(p.site)}</b>
                  <span className="muted">· {p.user}</span>
                  <span className="muted" style={{ marginLeft: 'auto', fontSize: 13 }}>{(counts[p.key] ?? 0).toLocaleString()} games</span>
                </div>
                <span className="muted" style={{ fontSize: 13 }}>{p.site === 'pgn' ? 'Imported' : 'Last sync'} {relativeTime(p.lastImportAt)}</span>
              </div>
            ))}
            <button className="btn sm primary" onClick={onSync} disabled={!!busy || !profiles.some((p) => p.site !== 'pgn')}>
              <RefreshCw size={14} className={busy ? 'spin' : ''} /> Sync now
            </button>
            <p className="muted" style={{ fontSize: 12.5 }}>Games are fetched by this device from the public Lichess and Chess.com APIs.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function EngineIndicator() {
  const s = useSyncExternalStore(analysis.subscribe, analysis.getSnapshot);
  if (!s.running) return null;
  const [done, total, what] = s.done < s.total ? [s.done, s.total, 'Checking your moves'] : [s.reviewsDone, s.reviewsTotal, 'Reviewing openings'];
  return (
    <span className="indicator" title={`${what} on this device`}>
      <Cpu size={16} className="spin" style={{ animationDuration: '3s' }} />
      <span className="nums">{total ? `${Math.round((done / total) * 100)}%` : ''}</span>
    </span>
  );
}

function ThemeButton() {
  const [theme, setT] = useState<Theme>(getTheme);
  const Icon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
  const next: Theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
  return (
    <button className="btn icon ghost" aria-label={`Theme: ${theme}. Click to change`} title={`Theme: ${theme}`} onClick={() => { setTheme(next); setT(next); }}>
      <Icon size={18} />
    </button>
  );
}

export function Layout({ tab, onTab, busy, onSync, children }: { tab: Tab | null; onTab: (t: Tab) => void; busy: string | null; onSync: () => void; children: ReactNode }) {
  const link = (t: Tab, name: string, Icon: typeof ListChecks, size: number) => (
    <a key={t} href={`#/${t}`} className={tab === t ? 'active' : ''} onClick={(e) => { e.preventDefault(); onTab(t); }}>
      <Icon size={size} /> {name}
    </a>
  );
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <header className="app-header">
        <a href="#/games" className="brand" aria-label={`${APP_NAME} home`} onClick={(e) => { e.preventDefault(); onTab('train'); }}>
          <span className="brand-mark" aria-hidden><LogoMark /></span>
          {APP_NAME}
        </a>
        <nav className="nav" aria-label="Main">{TABS.map(([t, n, I]) => link(t, n, I, 16))}</nav>
        <div className="header-right">
          <EngineIndicator />
          <SyncIndicator busy={busy} onSync={onSync} />
          <ThemeButton />
        </div>
      </header>
      <main id="main">{children}</main>
      <nav className="mobile-nav" aria-label="Main">{TABS.map(([t, n, I]) => link(t, n, I, 20))}</nav>
    </>
  );
}

/** Header-only shell for screens outside the tabs (start, drills, shared cards). */
export function Bare({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="app-header">
        <a href="#/" className="brand" aria-label={`${APP_NAME} home`}>
          <span className="brand-mark" aria-hidden><LogoMark /></span>
          {APP_NAME}
        </a>
        <div className="header-right"><ThemeButton /></div>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
