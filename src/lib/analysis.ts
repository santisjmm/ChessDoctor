// Background engine work: judges the user's repeated out-of-book moves, a few at a time,
// only while the app is visible. Results feed the openings tree and the drill queue.
import { drillsFromVerdicts, upsertDrills } from './drills';
import { Engine } from './engine';
import { judgeMove, type MoveVerdict } from './leakcheck';
import type { GameOpening } from './openings';
import { decisionNodes, type DecisionNode } from './report';

let engine: Engine | null = null;
export const getEngine = () => (engine ??= new Engine());

export interface AnalysisState {
  verdicts: ReadonlyMap<string, MoveVerdict>; // key: `${color}|${line through the user's move}`
  done: number;
  total: number;
  running: boolean;
}

const nodeKey = (n: DecisionNode) => `${n.color}|${n.line.join(' ')}`;

class AnalysisService {
  private state: AnalysisState = { verdicts: new Map(), done: 0, total: 0, running: false };
  private listeners = new Set<() => void>();
  private generation = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;

  private set(patch: Partial<AnalysisState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Adds verdicts computed elsewhere (e.g. by the report). */
  seed(pairs: { node: DecisionNode; v: MoveVerdict }[]) {
    const verdicts = new Map(this.state.verdicts);
    for (const { node, v } of pairs) verdicts.set(nodeKey(node), v);
    this.set({ verdicts });
  }

  /** (Re)starts the queue for these games. Positions already judged are skipped. */
  async start(items: GameOpening[], { minSupport = 2, limit = 60 } = {}) {
    const gen = ++this.generation;
    const nodes = decisionNodes(items, minSupport, 20, limit);
    const todo = nodes.filter((n) => !this.state.verdicts.has(nodeKey(n)));
    this.set({ done: nodes.length - todo.length, total: nodes.length, running: todo.length > 0 });
    const batch: { node: DecisionNode; v: MoveVerdict }[] = [];
    for (const node of todo) {
      await visible();
      if (gen !== this.generation) return;
      const v = await judgeMove(getEngine(), node.line, node.ply);
      if (gen !== this.generation) return;
      const verdicts = new Map(this.state.verdicts).set(nodeKey(node), v);
      this.set({ verdicts, done: this.state.done + 1 });
      batch.push({ node, v });
      if (batch.length >= 5) await upsertDrills(drillsFromVerdicts(batch.splice(0)));
    }
    await upsertDrills(drillsFromVerdicts(batch));
    if (gen === this.generation) this.set({ running: false });
  }
}

const visible = () =>
  document.visibilityState === 'visible'
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const on = () => {
          if (document.visibilityState === 'visible') {
            document.removeEventListener('visibilitychange', on);
            resolve();
          }
        };
        document.addEventListener('visibilitychange', on);
      });

export const analysis = new AnalysisService();
