import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import { useEffect, useRef } from 'react';

/** Thin React wrapper around chessground (GPLv3, lichess). */
export function Board({ config }: { config: Config }) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  useEffect(() => {
    api.current = Chessground(el.current!, config);
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    api.current?.set(config);
  }, [config]);
  return <div className="board" ref={el} />;
}
