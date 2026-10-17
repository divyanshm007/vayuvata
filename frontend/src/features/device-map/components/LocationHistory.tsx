import { useState } from 'react';
import {
  Card, Chip, FormControlLabel, IconButton, Link, MenuItem, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel, TextField, Tooltip, Typography, Button,
} from '@mui/material';
import OpenInNew from '@mui/icons-material/OpenInNew';
import { PaginationBar } from '../../../components/ui';
import { EmptyState, ErrorState, TableSkeleton } from '../../../components/feedback';
import { tokens } from '../../../theme/theme';
import { fmtNum, toApiDateTime, toApiDateTimeEnd } from '../../../utils/format';
import { useAsync } from '../../../utils/useAsync';
import { gpsDataService } from '../services/gpsDataService';
import type { DeviceDto } from '../../../types/api';

/** The backend returns GPS times as IST with a +05:30 offset; show that wall-clock text as it is (no browser time-zone shift). */
const istText = (s: string) => s.slice(0, 19).replace('T', ' ');

/**
 * Position history of the devices the signed-in user may see (the backend scopes it: SuperAdmin all, Admin own + their Users', User own).
 * Filter by device, from/to and "fix only"; newest first by default; paged on the server.
 */
export function LocationHistory({ devices }: { devices: DeviceDto[] }) {
  const [deviceId, setDeviceId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fixOnly, setFixOnly] = useState(false);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const invalid = !!from && !!to && from > to;

  const s = useAsync(
    () => gpsDataService.history({ deviceId: deviceId || undefined, from: toApiDateTime(from), to: toApiDateTimeEnd(to), fixOnly: fixOnly || undefined, sortDir, page, pageSize }),
    [deviceId, from, to, fixOnly, sortDir, page, pageSize], !invalid,
  );
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <Card sx={{ mt: 2 }}>
      <Stack sx={{ p: 2, pb: 0 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700 }}>Location history</Typography>
        <Typography variant="body2" color="text.secondary">Where your devices have been reported. Times are device local time (IST).</Typography>
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }} alignItems={{ md: 'center' }} flexWrap="wrap">
        <TextField select label="Device" value={deviceId} onChange={(e) => reset(setDeviceId)(e.target.value)} sx={{ minWidth: 220, maxWidth: { md: 280 } }}>
          <MenuItem value="">All devices</MenuItem>
          {devices.map((d) => <MenuItem key={d.id} value={d.deviceId}>{d.deviceName} ({d.deviceId})</MenuItem>)}
        </TextField>
        <TextField type="datetime-local" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => reset(setFrom)(e.target.value)} sx={{ maxWidth: { md: 230 } }} />
        <TextField type="datetime-local" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => reset(setTo)(e.target.value)}
          error={invalid} helperText={invalid ? '“To” must be after “From”.' : undefined} sx={{ maxWidth: { md: 230 } }} />
        <FormControlLabel control={<Switch checked={fixOnly} onChange={(e) => reset(setFixOnly)(e.target.checked)} />} label="Only reports with a position" />
        {(deviceId || from || to || fixOnly) && <Button onClick={() => { setDeviceId(''); setFrom(''); setTo(''); setFixOnly(false); setPage(1); }}>Clear</Button>}
      </Stack>
      <TableContainer>
        <Table size="small" aria-label="Location history">
          <TableHead>
            <TableRow>
              <TableCell>Device</TableCell>
              <TableCell sortDirection={sortDir}>
                <TableSortLabel active direction={sortDir} onClick={() => { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); setPage(1); }}>Reported (IST)</TableSortLabel>
              </TableCell>
              <TableCell align="right">Latitude</TableCell><TableCell align="right">Longitude</TableCell>
              <TableCell>Source</TableCell><TableCell>Position</TableCell>
              <TableCell align="right">Speed (km/h)</TableCell><TableCell align="right">Altitude (m)</TableCell><TableCell align="right">Signal</TableCell>
              <TableCell align="right">Map</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {s.data?.items.map((r) => (
              <TableRow key={r.id} hover>
                <TableCell sx={{ fontWeight: 600 }}>{r.deviceId}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{istText(r.recordedAt)}</TableCell>
                <TableCell align="right">{r.lat != null ? r.lat.toFixed(6) : '—'}</TableCell>
                <TableCell align="right">{r.lon != null ? r.lon.toFixed(6) : '—'}</TableCell>
                <TableCell>{r.source === 'cell' ? 'Cell tower' : 'GPS'}</TableCell>
                <TableCell>{r.fix ? <Chip size="small" label="Fix" color="success" variant="outlined" /> : <Chip size="small" label="No fix" variant="outlined" />}</TableCell>
                <TableCell align="right">{fmtNum(r.speedKmh)}</TableCell>
                <TableCell align="right">{fmtNum(r.altM)}</TableCell>
                <TableCell align="right">{r.signalPct != null ? `${r.signalPct}%` : '—'}</TableCell>
                <TableCell align="right">
                  {r.lat != null && r.lon != null ? (
                    <Tooltip title="Open this position in OpenStreetMap">
                      <IconButton size="small" component={Link} href={`https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lon}#map=17/${r.lat}/${r.lon}`}
                        target="_blank" rel="noopener noreferrer" aria-label={`Open ${r.deviceId} position in OpenStreetMap`}><OpenInNew fontSize="small" /></IconButton>
                    </Tooltip>
                  ) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {s.loading && <TableSkeleton cols={10} />}
      {!!s.error && <ErrorState error={s.error} onRetry={s.reload} />}
      {!s.loading && !s.error && s.data?.items.length === 0 && <EmptyState title="No location reports found" hint="Try a wider time range or another device." />}
      <PaginationBar page={page} result={s.data} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
      <Typography sx={{ px: 2, pb: 2, fontSize: 11.5, color: tokens.muted }}>Only devices you are permitted to see are listed.</Typography>
    </Card>
  );
}
