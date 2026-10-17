import { useCallback, useEffect, useRef, useState } from 'react';
import { Chip, CircularProgress } from '@mui/material';
import CircleIcon from '@mui/icons-material/Circle';
import { healthApi } from '../../api/services';
import type { HealthResponse } from '../../types/api';
import { toAppError } from '../../utils/errors';
import { useAuth } from '../auth/AuthContext';

export type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: HealthResponse; at: Date }
  | { kind: 'db_down'; data: HealthResponse; at: Date }
  | { kind: 'unreachable'; message: string; at: Date };

const POLL_MS = 15_000;

/**
 * Checks health on mount and then every 15 s - also after a failure, so the chip recovers by itself.
 * It re-checks immediately when the browser goes online/offline or the tab becomes visible again, and treats a timeout or network error as "unreachable".
 * Background re-checks do not flash the "Checking" state; only a manual click does.
 */
export function useHealth(autoRefresh = true) {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const seq = useRef(0);

  const run = useCallback(async (showLoading: boolean) => {
    clearTimeout(timer.current);
    const my = ++seq.current;
    if (showLoading) setState({ kind: 'loading' });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setState({ kind: 'unreachable', message: 'This device is offline.', at: new Date() });
    } else {
      try {
        const data = await healthApi.get();
        if (my !== seq.current) return;
        setState(data.status === 'Healthy' ? { kind: 'ok', data, at: new Date() } : { kind: 'db_down', data, at: new Date() });
      } catch (e) {
        if (my !== seq.current) return;
        setState({ kind: 'unreachable', message: toAppError(e).message, at: new Date() });
      }
    }
    if (autoRefresh && my === seq.current) timer.current = setTimeout(() => void run(false), POLL_MS);
  }, [autoRefresh]);

  const check = useCallback(() => run(true), [run]);

  useEffect(() => {
    void run(true);
    const recheck = () => void run(false);
    const onVisible = () => { if (document.visibilityState === 'visible') recheck(); };
    window.addEventListener('online', recheck);
    window.addEventListener('offline', recheck);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer.current); seq.current++;
      window.removeEventListener('online', recheck);
      window.removeEventListener('offline', recheck);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [run]);
  return { state, check };
}

export function HealthIndicator() {
  const { role } = useAuth();
  const { state, check } = useHealth();
  if (role !== 'SuperAdmin' && role !== 'Admin') return null;
  const map = {
    loading: { label: 'Checking API…', color: 'default' as const },
    ok: { label: 'API online', color: 'success' as const },
    db_down: { label: 'Database unavailable', color: 'error' as const },
    unreachable: { label: 'API unreachable · retry', color: 'error' as const },
  }[state.kind];
  return (
    <Chip
      size="small" variant="outlined" color={map.color} label={map.label} onClick={() => void check()}
      icon={state.kind === 'loading' ? <CircularProgress size={12} /> : <CircleIcon sx={{ fontSize: '10px !important' }} />}
      sx={{ display: { xs: 'none', sm: 'inline-flex' }, fontWeight: 600, ...(state.kind === 'ok' ? { bgcolor: '#ECFDF5', color: '#166534', borderColor: '#BBF7D0' } : {}) }}
      aria-live="polite"
    />
  );
}
