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

/** Checks health on mount and every 60s while healthy. A failing endpoint is NOT re-polled; the user retries manually. */
export function useHealth(autoRefresh = true) {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const check = useCallback(async () => {
    clearTimeout(timer.current);
    setState({ kind: 'loading' });
    try {
      const data = await healthApi.get();
      const ok = data.status === 'Healthy';
      setState(ok ? { kind: 'ok', data, at: new Date() } : { kind: 'db_down', data, at: new Date() });
      if (ok && autoRefresh) timer.current = setTimeout(check, 60_000);
    } catch (e) {
      setState({ kind: 'unreachable', message: toAppError(e).message, at: new Date() });
    }
  }, [autoRefresh]);

  useEffect(() => { void check(); return () => clearTimeout(timer.current); }, [check]);
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
