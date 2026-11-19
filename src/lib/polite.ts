// Polite fetching: one request at a time per host, backoff on 429/5xx.
const queues = new Map<string, Promise<unknown>>();

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

export interface PoliteOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onWait?: (seconds: number) => void;
  maxAttempts?: number;
}

/** fetch() serialised per host. Retries 429 (waits ≥60 s, as Lichess asks) and 5xx with backoff. */
export async function politeFetch(url: string, opts: PoliteOptions = {}): Promise<Response> {
  const host = new URL(url).host;
  const prev = queues.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  queues.set(host, prev.then(() => mine));
  await prev.catch(() => undefined);
  try {
    const max = opts.maxAttempts ?? 4;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, { headers: opts.headers, signal: opts.signal });
      if (res.ok || res.status === 304) return res;
      if (res.status === 404) throw new HttpError('not found', 404);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= max) throw new HttpError(`HTTP ${res.status}`, res.status);
      const after = Number(res.headers.get('retry-after')) || 0;
      const wait = res.status === 429 ? Math.max(60, after) : Math.min(30, 2 ** attempt);
      opts.onWait?.(wait);
      await sleep(wait * 1000, opts.signal);
    }
  } finally {
    release();
  }
}
