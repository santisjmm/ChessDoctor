// Share links that rebuild a report card on the viewer's device: /r/l/<lichess>[/c/<chesscom>].
// Nothing is stored on a server; the link only carries public usernames.
import { APP_URL } from '../config';
import type { Account } from './importer';
import type { Site } from './types';

const USER = /^[A-Za-z0-9_-]{2,30}$/;
const SITE: Record<string, Site> = { l: 'lichess', lichess: 'lichess', c: 'chesscom', chesscom: 'chesscom' };
const CODE: Partial<Record<Site, string>> = { lichess: 'l', chesscom: 'c' };

/** Accounts a share link can carry (PGN imports live only on the device). */
export const shareable = (accounts: Account[]) => accounts.filter((a) => a.site !== 'pgn');

/** Accounts encoded in a share path, or null if the path is not a valid share link. */
export function parseSharePath(pathname: string): Account[] | null {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').map(decodeURIComponent);
  if (parts[0] !== 'r' || parts.length < 3 || parts.length % 2 === 0 || parts.length > 5) return null;
  const out: Account[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const site = SITE[parts[i].toLowerCase()];
    if (!site || !USER.test(parts[i + 1]) || out.some((a) => a.site === site)) return null;
    out.push({ site, user: parts[i + 1] });
  }
  return out;
}

export function sharePath(accounts: Account[]): string {
  const order: Site[] = ['lichess', 'chesscom'];
  return (
    '/r/' +
    shareable(accounts)
      .sort((a, b) => order.indexOf(a.site) - order.indexOf(b.site))
      .map((a) => `${CODE[a.site]}/${encodeURIComponent(a.user.trim())}`)
      .join('/')
  );
}

export const shareUrl = (accounts: Account[]) => `https://${APP_URL}${sharePath(accounts)}`;
