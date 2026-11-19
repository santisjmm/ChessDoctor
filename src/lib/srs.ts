// Leitner spaced repetition (same boxes as the Review app): a clean run moves a line up a box
// and pushes it further out; a slip sends it back to box 0 and brings it back in 10 minutes.
import type { DrillItem } from './db';

const DAY = 86_400_000;
export const INTERVALS_DAYS: Record<number, number> = { 1: 1, 2: 3, 3: 7, 4: 16, 5: 35 };
export const RELEARN_MS = 10 * 60_000;
export const MASTERED_BOX = 5;

export function schedule(item: DrillItem, success: boolean, now = Date.now()): DrillItem {
  if (!success) return { ...item, box: 0, due: now + RELEARN_MS, reps: item.reps + 1, lapses: item.lapses + 1, lastAt: now };
  const box = Math.min(MASTERED_BOX, item.box + 1);
  return { ...item, box, due: now + INTERVALS_DAYS[box] * DAY, reps: item.reps + 1, lastAt: now };
}

export const isDue = (item: DrillItem, now = Date.now()) => item.due <= now;
export const isMastered = (item: DrillItem) => item.box >= MASTERED_BOX;

/** Local calendar day key (YYYY-MM-DD) of a timestamp. */
export function dayKey(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Consecutive days with at least one finished drill, ending today (or yesterday, if not trained yet today). */
export function streak(attemptTimes: number[], now = Date.now()): number {
  const days = new Set(attemptTimes.map(dayKey));
  let d = new Date(now);
  if (!days.has(dayKey(d.getTime()))) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d.getTime()))) {
    n++;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  }
  return n;
}

/**
 * Today's session (about 10 minutes): due mistakes first (most-played first), then one due or new
 * plain opening line, capped at `max` items.
 */
export function todaysSession(items: DrillItem[], now = Date.now(), max = 8): DrillItem[] {
  const due = items.filter((i) => isDue(i, now));
  const mistakes = due.filter((i) => i.kind === 'mistake').sort((a, b) => a.due - b.due || b.games - a.games);
  const line = due.filter((i) => i.kind === 'line').sort((a, b) => b.games - a.games)[0];
  const out = mistakes.slice(0, line ? max - 1 : max);
  if (line) out.push(line);
  return out;
}
