import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Card, CircularProgress, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, Button } from '@mui/material';
import TableViewOutlined from '@mui/icons-material/TableViewOutlined';
import { sensorApi } from '../../api/services';
import { AqiBadge, PageHeader, PaginationBar } from '../../components/ui';
import { EmptyState, ErrorState, TableSkeleton, useToast } from '../../components/feedback';
import { downloadReadingsXlsx, exportFileName, fetchReadingsForExport, EXPORT_MAX_ROWS } from '../../utils/exportExcel';
import { errorMessage } from '../../utils/errors';
import { fmtNum, fmtWallClock, toApiDateTime, toApiDateTimeEnd } from '../../utils/format';
import { useAsync } from '../../utils/useAsync';
import { useDevices } from '../devices/useDevices';
import { HISTORY_PRESETS, RangePicker, presetRange, useRange } from '../analytics/useSeries';
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
  const [range, setRange] = useRange('all');
  const from = range.from, to = range.to;
  const [sortBy, setSortBy] = useState<Sort>('recordedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [openId, setOpenId] = useState<number | null>(null);
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  const invalidRange = !!from && !!to && from > to;
  const s = useAsync(
    () => sensorApi.list({ deviceId: deviceId || undefined, from: toApiDateTime(from), to: toApiDateTimeEnd(to), sortBy, sortDir, page, pageSize }),
    [deviceId, from, to, sortBy, sortDir, page, pageSize], !invalidRange,
  );
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const sort = (k: Sort) => { if (sortBy === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); else { setSortBy(k); setSortDir('desc'); } setPage(1); };
  const dir = (k: Sort) => (sortBy === k ? sortDir : false);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const { rows, truncated } = await fetchReadingsForExport({ deviceId: deviceId || undefined, from: toApiDateTime(from), to: toApiDateTimeEnd(to), sortBy, sortDir });
      if (rows.length === 0) { toast('There are no readings to export for these filters.', 'info'); return; }
      await downloadReadingsXlsx(rows, exportFileName([deviceId || 'all-devices', from ? from.slice(0, 10) : undefined]));
      toast(truncated ? `Exported the latest ${rows.length} readings (export is capped at ${EXPORT_MAX_ROWS}).` : `Exported ${rows.length} readings.`, truncated ? 'info' : 'success');
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader title={title} subtitle="Readings from devices in your scope. Times are device local time (IST)."
        crumbs={[{ label: 'Home', to: '/' }, { label: title }]}
        actions={<Button variant="contained" startIcon={exporting ? <CircularProgress size={16} color="inherit" /> : <TableViewOutlined />} disabled={exporting || invalidRange} onClick={exportExcel}>Export Excel</Button>} />
      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }} alignItems={{ md: 'center' }}>
          <TextField select label="Device" value={deviceId} onChange={(e) => reset(setDeviceId)(e.target.value)} sx={{ maxWidth: { md: 280 } }}>
            <MenuItem value="">All devices</MenuItem>
            {devices.map((d) => <MenuItem key={d.id} value={d.deviceId}>{d.deviceName} ({d.deviceId})</MenuItem>)}
          </TextField>
          <RangePicker value={range} onChange={(r) => { setRange(r); setPage(1); }} presets={HISTORY_PRESETS} />
          {(deviceId || range.key !== 'all') && <Button onClick={() => { setDeviceId(''); setRange(presetRange('all')); setPage(1); }}>Clear</Button>}
        </Stack>
        {invalidRange && <Alert severity="warning" sx={{ mx: 2, mb: 2 }}>“To” must be after “From”.</Alert>}
        <TableContainer>
          <Table size="small" aria-label="Sensor readings">
            <TableHead>
              <TableRow>
                <TableCell>Device</TableCell>
                <TableCell sortDirection={dir('recordedAt')}><TableSortLabel active={sortBy === 'recordedAt'} direction={sortBy === 'recordedAt' ? sortDir : 'desc'} onClick={() => sort('recordedAt')}>Recorded (IST)</TableSortLabel></TableCell>
                <TableCell sortDirection={dir('aqi')}><TableSortLabel active={sortBy === 'aqi'} direction={sortBy === 'aqi' ? sortDir : 'desc'} onClick={() => sort('aqi')}>AQI</TableSortLabel></TableCell>
                <TableCell align="right">PM2.5</TableCell><TableCell align="right">PM10</TableCell>
                <TableCell align="right">NO₂</TableCell><TableCell align="right">SO₂</TableCell><TableCell align="right">CO</TableCell>
                <TableCell align="right">TVOC</TableCell><TableCell align="right">Temp</TableCell><TableCell align="right">Humidity</TableCell><TableCell align="right">Outer temp</TableCell><TableCell align="right">Outer hum.</TableCell>
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
                  <TableCell align="right">{fmtNum(r.temperature)}°C</TableCell><TableCell align="right">{fmtNum(r.humidity)}%</TableCell><TableCell align="right">{fmtNum(r.outerTemperature)}°C</TableCell><TableCell align="right">{fmtNum(r.outerHumidity)}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {s.loading && <TableSkeleton cols={10} />}
        {!!s.error && <ErrorState error={s.error} onRetry={s.reload} />}
        {!s.loading && !s.error && s.data?.items.length === 0 && <EmptyState title="No readings found" hint="Adjust the filters, or wait for devices to report." />}
        <PaginationBar page={page} result={s.data} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
        <Stack sx={{ px: 2, pb: 1.5 }}><span style={{ fontSize: 12, color: '#64748b' }}>Units: PM µg/m³ · NO₂/SO₂/CO ppm · TVOC ppb. Click a row for details.</span></Stack>
      </Card>
      <ReadingDialog id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
