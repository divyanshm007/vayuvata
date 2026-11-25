import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> { data: T | null; error: unknown; loading: boolean; reload: () => void; setData: (d: T | null) => void }

/** Default auto-refresh period for pages that show live data: 2 minutes. */
export const AUTO_REFRESH_MS = 120_000;

/**
 * Runs `fn` whenever `deps` change; ignores stale responses.
 * With `refreshMs` it also re-runs quietly in the background (no spinner, the old data stays if a refresh fails; paused while the tab is hidden).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true, refreshMs = 0): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const id = ++seq.current;
    setLoading(true); setError(null);
    fnRef.current()
      .then((d) => { if (id === seq.current) setData(d); })
      .catch((e) => { if (id === seq.current) { setError(e); setData(null); } })
      .finally(() => { if (id === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  useEffect(() => {
    if (!enabled || !refreshMs) return;
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const id = ++seq.current;
      fnRef.current().then((d) => { if (id === seq.current) { setData(d); setError(null); } }).catch(() => { /* keep what is shown */ });
    }, refreshMs);
    return () => clearInterval(t);
  }, [enabled, refreshMs]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
