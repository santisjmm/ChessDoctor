import { useEffect, useRef, useState } from 'react';
import type { Account } from './lib/importer';
import { runReport, type ReportResult, type Stage } from './lib/pipeline';
import { About } from './ui/About';
import { ReportView } from './ui/ReportView';
import { Start } from './ui/Start';
import { TrainLine } from './ui/TrainLine';
import { Working } from './ui/Working';
import { DEFAULT_GAMES } from './config';

type View = 'start' | 'working' | 'report' | 'train' | 'about';
const route = (): View => {
  const v = location.hash.replace(/^#\/?/, '').split('?')[0];
  return (['report', 'train', 'about'] as const).includes(v as never) ? (v as View) : 'start';
};

export function App() {
  const [view, setView] = useState<View>('start');
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const abort = useRef<AbortController | null>(null);

  const go = (v: View) => {
    location.hash = v === 'start' ? '/' : `/${v}`;
  };
  useEffect(() => {
    const onHash = () => {
      const v = route();
      // Report/train need a computed report; after a reload, start again (games are cached on the device).
      setView((cur) => (v === 'report' || v === 'train' ? (result ? v : 'start') : v === 'start' && cur === 'working' ? cur : v));
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [result]);

  async function build(accounts: Account[]) {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setError(null);
    setStage(null);
    setView('working');
    try {
      localStorage.setItem('accounts', JSON.stringify(accounts));
    } catch {
      /* private mode */
    }
    try {
      const r = await runReport(accounts, DEFAULT_GAMES, setStage, ac.signal);
      if (ac.signal.aborted) return;
      (window as unknown as Record<string, unknown>).__report = r; // for the headless check
      setResult(r);
      setView('report');
      go('report');
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      setView('start');
    }
  }

  return (
    <div className="app">
      {view === 'start' && <Start onSubmit={build} error={error} onAbout={() => go('about')} />}
      {view === 'working' && (
        <Working
          stage={stage}
          onCancel={() => {
            abort.current?.abort();
            setView('start');
            go('start');
          }}
        />
      )}
      {view === 'report' && result && <ReportView result={result} onTrain={() => go('train')} onRestart={() => go('start')} onAbout={() => go('about')} />}
      {view === 'train' && result && <TrainLine result={result} onBack={() => go('report')} />}
      {view === 'about' && <About onBack={() => history.back()} />}
    </div>
  );
}
