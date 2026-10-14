import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, CircularProgress } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { sensorApi } from '../../api/services';
import { AqiBadge, PageHeader, PaginationBar } from '../../components/ui';
import { EmptyState, ErrorState, TableSkeleton, useToast } from '../../components/feedback';
import { useDevices } from '../devices/useDevices';
import { DeviceSelect, RangePicker, fetchSeries, useRange } from './useSeries';
import { fmtNum, fmtWallClock, toApiDateTime } from '../../utils/format';
import { useAsync } from '../../utils/useAsync';
import { errorMessage } from '../../utils/errors';
import { MEASURES } from '../sensor-data/ReadingParts';
import type { SensorDataDto } from '../../types/api';

function toCsv(rows: SensorDataDto[]): string {
  const head = ['deviceId', 'recordedAt', 'aqi', 'aqiStatus', ...MEASURES.map((m) => m.key)];
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [head.join(','), ...rows.map((r) => head.map((k) => esc((r as unknown as Record<string, unknown>)[k])).join(','))].join('\n');
}

export default function ReportsPage() {
  const dev = useDevices();
  const toast = useToast();
  const [range, setRange] = useRange('30d');
  const [deviceId, setDeviceId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { if (!deviceId && dev.devices.length) setDeviceId(dev.devices[0].deviceId); }, [dev.devices, deviceId]);
  const device = useMemo(() => dev.devices.find((d) => d.deviceId === deviceId), [dev.devices, deviceId]);
  const invalid = !!range.to && range.from > range.to;

  const s = useAsync(
    () => sensorApi.history(device!.id, { from: toApiDateTime(range.from), to: toApiDateTime(range.to), sortDir: 'desc', page, pageSize }),
    [device?.id, range.from, range.to, page, pageSize], !!device && !invalid,
  );

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { rows, truncated } = await fetchSeries(deviceId, range);
      const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `vayuvata-${deviceId}-${range.from.slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(a.href);
      toast(truncated ? `Exported the latest ${rows.length} readings (export is capped).` : `Exported ${rows.length} readings.`, truncated ? 'info' : 'success');
    } catch (e) { toast(errorMessage(e), 'error'); } finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader title="Historical Reports" subtitle="Browse a device's reading history for any period" crumbs={[{ label: 'Home', to: '/' }, { label: 'Historical Reports' }]}
        actions={<Button variant="outlined" startIcon={exporting ? <CircularProgress size={16} /> : <DownloadIcon />} disabled={!device || exporting || invalid} onClick={exportCsv}>Export CSV</Button>} />
      {!!dev.error && <ErrorState error={dev.error} onRetry={dev.reload} />}
      {!dev.loading && !dev.error && dev.devices.length === 0 && <Card><EmptyState title="No devices available" /></Card>}
      {dev.devices.length > 0 && (
        <Card>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ lg: 'center' }} sx={{ p: 2 }}>
            <DeviceSelect devices={dev.devices} value={deviceId} onChange={(v) => { setDeviceId(v); setPage(1); }} />
            <RangePicker value={range} onChange={(r) => { setRange(r); setPage(1); }} />
          </Stack>
          {invalid && <Alert severity="warning" sx={{ mx: 2, mb: 2 }}>“To” must be after “From”.</Alert>}
          <TableContainer>
            <Table size="small" aria-label="Historical readings">
              <TableHead><TableRow>
                <TableCell>Recorded (IST)</TableCell><TableCell>AQI</TableCell><TableCell align="right">PM2.5</TableCell><TableCell align="right">PM10</TableCell>
                <TableCell align="right">NO₂</TableCell><TableCell align="right">SO₂</TableCell><TableCell align="right">CO</TableCell><TableCell align="right">TVOC</TableCell>
                <TableCell align="right">Temp</TableCell><TableCell align="right">Humidity</TableCell><TableCell align="right">Outer temp</TableCell><TableCell align="right">Outer hum.</TableCell>
              </TableRow></TableHead>
              <TableBody>
                {s.data?.items.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>{fmtWallClock(r.recordedAt, true)}</TableCell><TableCell><AqiBadge aqi={r.aqi} status={r.aqiStatus} /></TableCell>
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
          {!s.loading && !s.error && s.data?.items.length === 0 && <EmptyState title="No readings in this period" />}
          <PaginationBar page={page} result={s.data} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
        </Card>
      )}
    </>
  );
}
