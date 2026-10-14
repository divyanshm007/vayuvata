import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Skeleton, Snackbar, Stack, Typography,
} from '@mui/material';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import { toAppError, type AppError } from '../utils/errors';

/* ---------- Toasts ---------- */
type Sev = 'success' | 'error' | 'info' | 'warning';
const ToastCtx = createContext<(msg: string, sev?: Sev) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; sev: Sev; key: number } | null>(null);
  const push = useCallback((msg: string, sev: Sev = 'success') => setT({ msg, sev, key: Date.now() }), []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <Snackbar key={t?.key} open={!!t} autoHideDuration={5000} onClose={() => setT(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        {t ? <Alert onClose={() => setT(null)} severity={t.sev} variant="filled" sx={{ width: '100%' }}>{t.msg}</Alert> : undefined}
      </Snackbar>
    </ToastCtx.Provider>
  );
}

/* ---------- Confirm dialog ---------- */
interface ConfirmProps {
  open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onClose: () => void;
}
export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose }: ConfirmProps) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent><DialogContentText component="div">{body}</DialogContentText></DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} color="inherit">Cancel</Button>
        <Button onClick={onConfirm} disabled={busy} variant="contained" color={danger ? 'error' : 'primary'}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------- States ---------- */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 7, px: 2, textAlign: 'center', color: 'text.secondary' }}>
      <InboxOutlined sx={{ fontSize: 44, opacity: 0.5 }} />
      <Typography fontWeight={600} color="text.primary">{title}</Typography>
      {hint && <Typography variant="body2">{hint}</Typography>}
      {action}
    </Stack>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e: AppError = toAppError(error);
  const title = e.status === 403 ? 'Access denied' : e.status === 404 ? 'Not found' : e.status === 0 ? 'Cannot reach server' : 'Something went wrong';
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 6, px: 2, textAlign: 'center' }} role="alert">
      <ErrorOutline color="error" sx={{ fontSize: 44 }} />
      <Typography fontWeight={700}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>{e.message}</Typography>
      {e.traceId && <Typography variant="caption" color="text.disabled">Reference: {e.traceId}</Typography>}
      {onRetry && e.status !== 403 && e.status !== 404 && <Button variant="outlined" onClick={onRetry}>Retry</Button>}
    </Stack>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <Box sx={{ p: 2 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <Stack key={r} direction="row" spacing={2} sx={{ py: 1 }}>
          {Array.from({ length: cols }).map((__, c) => <Skeleton key={c} variant="text" sx={{ flex: 1, height: 28 }} />)}
        </Stack>
      ))}
    </Box>
  );
}
