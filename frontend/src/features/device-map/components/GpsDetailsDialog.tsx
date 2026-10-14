import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Stack, Typography } from '@mui/material';
import type { DeviceDto } from '../../../types/api';
import { toAppError } from '../../../utils/errors';
import { tokens } from '../../../theme/theme';
import type { CurrentGps } from '../types';
import { fmtAge, fmtGpsTime } from '../utils/locations';

type State = { kind: 'loading' } | { kind: 'error'; message: string } | CurrentGps;

const Field = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <Grid item xs={6}>
    <Typography sx={{ fontSize: 11, color: tokens.muted }}>{k}</Typography>
    <Typography sx={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-word' }}>{v}</Typography>
  </Grid>
);

/** Full GPS details for one device, read with GET /gps-data/current (404 = no data yet, 409 = inactive). */
export function GpsDetailsDialog({ device, load, onClose }: { device: DeviceDto | null; load: (deviceId: string) => Promise<CurrentGps>; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const run = useCallback(async () => {
    if (!device) return;
    setState({ kind: 'loading' });
    try { setState(await load(device.deviceId)); }
    catch (e) { setState({ kind: 'error', message: toAppError(e).message }); }
  }, [device, load]);

  useEffect(() => { void run(); }, [run]);

  const r = state.kind === 'ok' ? state.report : null;
  return (
    <Dialog open={!!device} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>GPS details{device ? ` · ${device.deviceId}` : ''}</DialogTitle>
      <DialogContent>
        {state.kind === 'loading' && <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={26} aria-label="Loading GPS details" /></Stack>}
        {state.kind === 'error' && <Alert severity="error">{state.message}</Alert>}
        {state.kind === 'none' && <Alert severity="info">No GPS data for this device yet.</Alert>}
        {state.kind === 'inactive' && <Alert severity="warning">This device is inactive, so its current position is not available.</Alert>}
        {r && (
          <Box>
            {!r.fix && <Alert severity="warning" sx={{ mb: 1.5 }}>The latest report has no GPS fix, so it carries no position.</Alert>}
            <Grid container spacing={1.5}>
              <Field k="Latitude" v={r.lat ?? '—'} />
              <Field k="Longitude" v={r.lon ?? '—'} />
              <Field k="Altitude" v={r.altM !== null ? `${r.altM} m` : '—'} />
              <Field k="Speed" v={r.speedKmh !== null ? `${r.speedKmh} km/h` : '—'} />
              <Field k="Source" v={r.source === 'cell' ? 'Cell tower (approximate)' : r.source === 'gps' ? 'GPS satellite' : r.source} />
              <Field k="Signal" v={r.signalPct !== null ? `${r.signalPct}%` : '—'} />
              <Field k="Recorded (IST)" v={<>{fmtGpsTime(r.recordedMs)}<Box component="span" sx={{ display: 'block', fontWeight: 500, color: tokens.muted, fontSize: 11.5 }}>{fmtAge(Math.max(0, Date.now() - r.recordedMs))}</Box></>} />
              <Field k="Received (IST)" v={fmtGpsTime(Date.parse(r.receivedAt))} />
            </Grid>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => void run()} disabled={state.kind === 'loading'}>Refresh</Button>
        <Button variant="contained" onClick={onClose} sx={{ bgcolor: tokens.forest }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
