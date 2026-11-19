import { describe, expect, it } from 'vitest';
import { parseSharePath, sharePath, shareUrl } from '../src/lib/share';

describe('share links', () => {
  it('round-trips one or two accounts', () => {
    const one = [{ site: 'lichess' as const, user: 'Penguin_GM1' }];
    expect(sharePath(one)).toBe('/r/l/Penguin_GM1');
    expect(parseSharePath('/r/l/Penguin_GM1')).toEqual(one);
    const two = [{ site: 'chesscom' as const, user: 'hikaru' }, { site: 'lichess' as const, user: 'dr-x' }];
    expect(sharePath(two)).toBe('/r/l/dr-x/c/hikaru');
    expect(parseSharePath('/r/l/dr-x/c/hikaru/')).toEqual([two[1], two[0]]);
    expect(shareUrl(one)).toBe('https://chessdoctor.app/r/l/Penguin_GM1');
  });
  it('accepts long site names', () => {
    expect(parseSharePath('/r/chesscom/hikaru')).toEqual([{ site: 'chesscom', user: 'hikaru' }]);
  });
  it('rejects anything else', () => {
    for (const p of ['/', '/r', '/r/l', '/r/x/abc', '/r/l/a', '/r/l/abc/l/def', '/r/l/ab cd', '/r/l/<script>', '/about', '/r/l/abc/c'])
      expect(parseSharePath(p), p).toBeNull();
  });
});
