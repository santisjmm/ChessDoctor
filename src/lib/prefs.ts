// Per-device appearance preferences (theme, board colours), like the Review app's settings.
export type Theme = 'system' | 'dark' | 'light';
export type BoardTheme = 'green' | 'brown' | 'blue' | 'slate';

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

export const getTheme = (): Theme => (get('theme') as Theme) || 'system';
export const getBoard = (): BoardTheme => (get('board') as BoardTheme) || 'green';

export function applyPrefs(theme = getTheme(), board = getBoard()) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  if (board === 'green') root.removeAttribute('data-board');
  else root.setAttribute('data-board', board);
}

export function setTheme(t: Theme) {
  set('theme', t);
  applyPrefs(t, getBoard());
}
export function setBoard(b: BoardTheme) {
  set('board', b);
  applyPrefs(getTheme(), b);
}
