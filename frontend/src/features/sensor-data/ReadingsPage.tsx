import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, Button } from '@mui/material';
import { sensorApi } from '../../api/services';
import { AqiBadge, PageHeader, PaginationBar } from '../../components/ui';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback';
import { fmtNum, fmtWallClock, toApiDateTime } from '../../utils/format';
import { useAsync } from '../../utils/useAsync';
import { useDevices } from '../devices/useDevices';
import { useAuth } from '../auth/AuthContext';
import { ReadingDialog } from './ReadingParts';
import type { SensorDataQuery } from '../../types/api';

type Sort = NonNullable<SensorDataQuery['sortBy']>;

export default function ReadingsPage() {
  const { role } = useAuth();
  const title = role === 'User' ? 'Reading History' : 'Sensor Readings';
  const { devices } = useDevices();
  const [params] = useSearchParams();
  const [deviceId, setDeviceId] = useState(params.get('device') ?? ''); // deep link from the device map
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sortBy, setSortBy] = useState<Sort>('recordedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [openId, setOpenId] = useState<number | null>(null);

  const invalidRange = !!from && !!to && from > to;
  const s = useAsync(
    () => sensorApi.list({ deviceId: deviceId || undefined, from: toApiDateTime(from), to: toApiDateTime(to), sortBy, sortDir, page, pageSize }),
    [deviceId, from, to, sortBy, sortDir, page, pageSize], !invalidRange,
  );
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const sort = (k: Sort) => { if (sortBy === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); else { setSortBy(k); setSortDir('desc'); } setPage(1); };
  const dir = (k: Sort) => (sortBy === k ? sortDir : false);

  return (
    <>
      <PageHeader title={title} subtitle="Readings from devices in your scope. Times are device local time (IST)."
        crumbs={[{ label: 'Home', to: '/' }, { label: title }]} />
      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }} alignItems={{ md: 'center' }}>
          <TextField select label="Device" value={deviceId} onChange={(e) => reset(setDeviceId)(e.target.value)} sx={{ maxWidth: { md: 280 } }}>
            <MenuItem value="">All devices</MenuItem>
            {devices.map((d) => <MenuItem key={d.id} value={d.deviceId}>{d.deviceName} ({d.deviceId})</MenuItem>)}
          </TextField>
          <TextField type="datetime-local" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => reset(setFrom)(e.target.value)} sx={{ maxWidth: { md: 230 } }} />
          <TextField type="datetime-local" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => reset(setTo)(e.target.value)}
            error={invalidRange} helperText={invalidRange ? '“To” must be after “From”.' : undefined} sx={{ maxWidth: { md: 230 } }} />
          {(deviceId || from || to) && <Button onClick={() => { setDeviceId(''); setFrom(''); setTo(''); setPage(1); }}>Clear</Button>}
        </Stack>
        <TableContainer>
          <Table size="small" aria-label="Sensor readings">
            <TableHead>
              <TableRow>
                <TableCell>Device</TableCell>
                <TableCell sortDirection={dir('recordedAt')}><TableSortLabel active={sortBy === 'recordedAt'} direction={sortBy === 'recordedAt' ? sortDir : 'desc'} onClick={() => sort('recordedAt')}>Recorded (IST)</TableSortLabel></TableCell>
                <TableCell sortDirection={dir('aqi')}><TableSortLabel active={sortBy === 'aqi'} direction={sortBy === 'aqi' ? sortDir : 'desc'} onClick={() => sort('aqi')}>AQI</TableSortLabel></TableCell>
                <TableCell align="right">PM2.5</TableCell><TableCell align="right">PM10</TableCell>
                <TableCell align="right">NO₂</TableCell><TableCell align="right">SO₂</TableCell><TableCell align="right">CO</TableCell>
                <TableCell align="right">TVOC</TableCell><TableCell align="right">Temp</TableCell><TableCell align="right">Humidity</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {s.data?.items.map((r) => (
                <TableRow key={r.id} hover tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === 'Enter' && setOpenId(r.id)} sx={{ cursor: 'pointer' }}>
                  <TableCell sx={{ fontWeight: 600 }}>{r.deviceId}</TableCell>
                  <TableCell>{fmtWallClock(r.recordedAt, true)}</TableCell>
                  <TableCell><AqiBadge aqi={r.aqi} status={r.aqiStatus} /></TableCell>
                  <TableCell align="right">{fmtNum(r.pm25)}</TableCell><TableCell align="right">{fmtNum(r.pm10)}</TableCell>
                  <TableCell align="right">{fmtNum(r.no2Ppm, 3)}</TableCell><TableCell align="right">{fmtNum(r.so2Ppm, 3)}</TableCell>
                  <TableCell align="right">{fmtNum(r.coPpm, 2)}</TableCell><TableCell align="right">{fmtNum(r.tvocPpb, 0)}</TableCell>
                  <TableCell align="right">{fmtNum(r.temperature)}°C</TableCell><TableCell align="right">{fmtNum(r.humidity)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {s.loading && <TableSkeleton cols={8} />}
        {!!s.error && <ErrorState error={s.error} onRetry={s.reload} />}
        {!s.loading && !s.error && s.data?.items.length === 0 && <EmptyState title="No readings found" hint="Adjust the filters, or wait for devices to report." />}
        <PaginationBar page={page} result={s.data} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
        <Stack sx={{ px: 2, pb: 1.5 }}><span style={{ fontSize: 12, color: '#64748b' }}>Units: PM µg/m³ · NO₂/SO₂/CO ppm · TVOC ppb. Click a row for details.</span></Stack>
      </Card>
      <ReadingDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
