import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { drillable, families, judgeBookMove, learnedLines, pickTarget, recordLine, type BookLine } from '../src/lib/learn';

const L = (index: number, family: string, s: string): BookLine => ({ index, eco: 'X', name: family, family, sans: s.split(' ') });
const sic = [
  L(1, 'Sicilian Defense', 'e4 c5'),
  L(2, 'Sicilian Defense', 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'),
  L(3, 'Sicilian Defense', 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6'),
  L(4, 'Sicilian Defense', 'e4 c5 c3 d5 exd5 Qxd5'),
];

describe('learn mode', () => {
  it('only drills lines with enough of your own moves', () => {
    expect(drillable(sic, 'b').map((l) => l.index)).toEqual([2, 3, 4]);
    expect(families([...sic, L(5, 'Amar Opening', 'Nh3')], 'w').map((f) => f.family)).toEqual(['Sicilian Defense']);
  });
  it('prefers lines not learned yet', () => {
    const t = pickTarget(drillable(sic, 'b'), new Set([2, 3]), () => 0.99);
    expect(t.index).toBe(4);
    expect(pickTarget(drillable(sic, 'b'), new Set([2, 3, 4]), () => 0).index).toBe(2); // all learned: any
  });
  it('accepts the target move, or another book line of the family; rejects the rest', () => {
    const fam = drillable(sic, 'b');
    const target = fam[0]; // Najdorf-ish
    expect(judgeBookMove(fam, target, ['e4', 'c5', 'Nf3'], 'd6', new Set())).toMatchObject({ ok: true, target });
    const sw = judgeBookMove(fam, target, ['e4', 'c5', 'Nf3'], 'Nc6', new Set());
    expect(sw.ok).toBe(true);
    expect(sw.target.index).toBe(3);
    expect(judgeBookMove(fam, target, ['e4', 'c5', 'Nf3'], 'h6', new Set())).toMatchObject({ ok: false, target });
  });
  it('records learned lines per colour', async () => {
    await recordLine('b', 2, false);
    expect((await learnedLines('b')).has(2)).toBe(false);
    await recordLine('b', 2, true);
    await recordLine('b', 2, false); // a later slip doesn't unlearn it
    expect((await learnedLines('b')).has(2)).toBe(true);
    expect((await learnedLines('w')).size).toBe(0);
  });
});
