// Stockfish 19 lite (single-threaded WASM, GPLv3) running in a Web Worker, spoken to over UCI.
export interface EngineResult {
  bestmove: string; // UCI
  /** Centipawns from White's point of view (mate mapped to ±10000 ∓ distance). */
  cp: number;
  mate: number | null;
  depth: number;
  pv: string[];
}

export interface SearchLimits {
  depth: number;
  movetime: number; // ms cap, whichever comes first
}

export class Engine {
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  readonly ready: Promise<void>;

  constructor(url = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`) {
    this.worker = new Worker(url);
    this.worker.onmessage = (e: MessageEvent) => {
      const text = typeof e.data === 'string' ? e.data : String(e.data);
      for (const line of text.split('\n')) for (const l of this.listeners) l(line);
    };
    this.ready = this.until('uciok', 'uci').then(async () => {
      await this.until('readyok', 'isready');
    });
  }

  private until(token: string, send: string): Promise<string[]> {
    return new Promise((resolve) => {
      const lines: string[] = [];
      const fn = (line: string) => {
        lines.push(line);
        if (line.startsWith(token)) {
          this.listeners.delete(fn);
          resolve(lines);
        }
      };
      this.listeners.add(fn);
      this.worker.postMessage(send);
    });
  }

  /** Searches one position (FEN). Calls are queued, one search at a time. */
  analyse(fen: string, limits: SearchLimits): Promise<EngineResult> {
    const run = async () => {
      await this.ready;
      this.worker.postMessage(`position fen ${fen}`);
      const lines = await this.until('bestmove', `go depth ${limits.depth} movetime ${limits.movetime}`);
      return parseSearch(lines, fen.split(' ')[1] === 'w');
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  terminate() {
    this.worker.terminate();
  }
}

export function parseSearch(lines: string[], whiteToMove: boolean): EngineResult {
  let last: EngineResult = { bestmove: '', cp: 0, mate: null, depth: 0, pv: [] };
  for (const line of lines) {
    if (line.startsWith('info') && / pv /.test(line) && !/multipv [2-9]/.test(line)) {
      const depth = Number(/ depth (\d+)/.exec(line)?.[1] ?? 0);
      const cpM = / score cp (-?\d+)/.exec(line);
      const mateM = / score mate (-?\d+)/.exec(line);
      const pv = line.split(' pv ')[1].trim().split(' ');
      let cp = cpM ? Number(cpM[1]) : 0;
      let mate: number | null = null;
      if (mateM) {
        mate = Number(mateM[1]);
        cp = mate > 0 ? 10000 - mate : -10000 - mate;
      }
      const sign = whiteToMove ? 1 : -1;
      last = { bestmove: pv[0], cp: cp * sign, mate: mate === null ? null : mate * sign, depth, pv };
    }
    if (line.startsWith('bestmove')) last.bestmove = line.split(' ')[1];
  }
  return last;
}

/** Lichess win% formula: chance of winning for White from a centipawn score. */
export const winPct = (cp: number) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
