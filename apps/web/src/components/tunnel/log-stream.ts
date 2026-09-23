import type { LogLine } from '@tm/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';

export type LevelFilter = 'all' | 'info' | 'warn' | 'error';
const RANK: Record<LogLine['level'], number> = { debug: 0, info: 1, warn: 2, error: 3, fatal: 4 };

export const appendCapped = (lines: LogLine[], incoming: LogLine[], cap = 1000) => [...lines, ...incoming].slice(-cap);

export const levelMatches = (l: LogLine, filter: LevelFilter) => filter === 'all' || RANK[l.level] >= RANK[filter];

/** Initial journal tail plus live lines over SSE; buffered while paused. */
export function useLogStream(id: string, { paused }: { paused: boolean }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const buffer = useRef<LogLine[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let alive = true;
    void api.get<LogLine[]>(`/tunnels/${id}/logs?lines=200`).then((l) => alive && setLines(l), () => undefined);
    const es = new EventSource(`/api/tunnels/${id}/logs/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const line = JSON.parse(e.data as string) as LogLine;
      if (pausedRef.current) buffer.current.push(line);
      else setLines((prev) => appendCapped(prev, [line]));
    };
    return () => {
      alive = false;
      es.close();
    };
  }, [id]);

  useEffect(() => {
    if (!paused && buffer.current.length) {
      const b = buffer.current;
      buffer.current = [];
      setLines((prev) => appendCapped(prev, b));
    }
  }, [paused]);

  return { lines, connected, clear: () => setLines([]) };
}
