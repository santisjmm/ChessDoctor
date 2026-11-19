export type Tab = 'home' | 'openings' | 'games' | 'progress' | 'report';
export function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const items: [Tab, string, string][] = [
    ['home', 'Today', 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z'],
    ['openings', 'Openings', 'M5 3v6a3 3 0 0 0 3 3h3v3H8v6h8v-6h-3v-3h3a3 3 0 0 0 3-3V3h-2v6a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3z'],
    ['games', 'Games', 'M4 5h16v14H4zM4 9h16M9 9v10'],
    ['progress', 'Progress', 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
    ['report', 'Card', 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5'],
  ];
  return (
    <nav className="tabbar" aria-label="Sections">
      {items.map(([t, name, d]) => (
        <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => onTab(t)}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          <span>{name}</span>
        </button>
      ))}
    </nav>
  );
}
