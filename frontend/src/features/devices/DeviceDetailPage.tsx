import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Box, Card, Grid, LinearProgress, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { devicesApi, sensorApi } from '../../api/services';
import { ActiveChip, AqiBadge, AssignedChip, PageHeader, PaginationBar, ReportingChip } from '../../components/ui';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback';
import { useAsync } from '../../utils/useAsync';
import { fmtNum, fmtUtc, fmtWallClock, isRecentlyReporting, toApiDateTime } from '../../utils/format';
import { useAuth } from '../auth/AuthContext';
import { AqiLegend, AqiTrendChart, ChartCard, PmChart, TempHumChart, toSeries } from '../analytics/charts';
import { RangePicker, useRange, useSeries } from '../analytics/useSeries';
import { ReadingDetail } from '../sensor-data/ReadingParts';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <Box><Typography variant="caption" color="text.secondary">{label}</Typography><Box sx={{ fontWeight: 600, mt: 0.25, wordBreak: 'break-word' }}>{children}</Box></Box>;
}

export default function DeviceDetailPage() {
  const id = Number(useParams().id);
  const { role } = useAuth();
  const canHistory = role === 'SuperAdmin' || role === 'Admin';
  const dev = useAsync(() => devicesApi.get(id), [id], Number.isFinite(id));
  const latest = useAsync(() => sensorApi.latest(id), [id], Number.isFinite(id));
  const [range, setRange] = useRange('7d');
  const series = useSeries(dev.data?.deviceId, range, !!dev.data);
  const data = useMemo(() => toSeries(series.data?.rows ?? []), [series.data]);

  const [aPage, setAPage] = useState(1);
  const [aSize, setASize] = useState(10);
  const assignments = useAsync(() => devicesApi.assignments(id, { page: aPage, pageSize: aSize }), [id, aPage, aSize], canHistory);

  const [rPage, setRPage] = useState(1);
  const [rSize, setRSize] = useState(10);
  const readings = useAsync(
    () => sensorApi.history(id, { from: toApiDateTime(range.from), to: toApiDateTime(range.to), sortDir: 'desc', page: rPage, pageSize: rSize }),
    [id, range.from, range.to, rPage, rSize], !!dev.data,
  );

  if (dev.error) return <ErrorState error={dev.error} onRetry={dev.reload} />;
  const d = dev.data;
  const r = latest.data;

  return (
    <>
      <PageHeader title={d?.deviceName ?? 'Device'} subtitle={d?.deviceId}
        crumbs={[{ label: 'Home', to: '/' }, { label: role === 'User' ? 'My Devices' : 'Devices', to: '/devices' }, { label: d?.deviceName ?? '…' }]} />
      {(dev.loading || latest.loading) && <LinearProgress sx={{ mb: 2 }} />}
      {d && (
        <Grid container spacing={2}>
          <Grid item xs={12} lg={5}>
            <Card sx={{ p: 2.5, height: '100%' }}>
              <Typography fontWeight={700} sx={{ mb: 2 }}>Device information</Typography>
              <Grid container spacing={2}>
                <Grid item xs={6}><Field label="Status"><ActiveChip active={d.isActive} /></Field></Grid>
                <Grid item xs={6}><Field label="Reporting"><ReportingChip known={!!r} reporting={isRecentlyReporting(r?.recordedAt)} /></Field></Grid>
                <Grid item xs={6}><Field label="Assigned to"><AssignedChip name={d.assignedUserName} /></Field></Grid>
                <Grid item xs={6}><Field label="Assigned since">{fmtUtc(d.assignedAt)}</Field></Grid>
                <Grid item xs={6}><Field label="Registered">{fmtUtc(d.createdAt)}</Field></Grid>
                <Grid item xs={6}><Field label="Last updated">{fmtUtc(d.updatedAt)}</Field></Grid>
                <Grid item xs={12}><Field label="Description">{d.description || '—'}</Field></Grid>
              </Grid>
            </Card>
          </Grid>
          <Grid item xs={12} lg={7}>
            <Card sx={{ p: 2.5, height: '100%' }}>
              <Typography fontWeight={700} sx={{ mb: 2 }}>Latest reading</Typography>
              {!!latest.error && <ErrorState error={latest.error} onRetry={latest.reload} />}
              {!latest.loading && !latest.error && !r && <EmptyState title="No readings yet" hint="This device has not reported data." />}
              {r && <ReadingDetail r={r} />}
            </Card>
          </Grid>

          <Grid item xs={12}>
            <Card sx={{ p: 2 }}><RangePicker value={range} onChange={(v) => { setRange(v); setRPage(1); }} /></Card>
          </Grid>
          {series.data?.truncated && <Grid item xs={12}><Alert severity="info">Charts show the latest 300 readings in this range.</Alert></Grid>}
          <Grid item xs={12}><ChartCard title="AQI trend" subtitle="Device local time (IST)" action={<AqiLegend />} height={280}><AqiTrendChart data={data} /></ChartCard></Grid>
          <Grid item xs={12} lg={6}><ChartCard title="PM2.5 vs PM10"><PmChart data={data} /></ChartCard></Grid>
          <Grid item xs={12} lg={6}><ChartCard title="Temperature & humidity"><TempHumChart data={data} /></ChartCard></Grid>

          <Grid item xs={12}>
            <Card>
              <Typography fontWeight={700} sx={{ p: 2.5, pb: 1 }}>Reading history</Typography>
              <TableContainer>
                <Table size="small" aria-label="Reading history">
                  <TableHead><TableRow><TableCell>Recorded (IST)</TableCell><TableCell>AQI</TableCell><TableCell align="right">PM2.5</TableCell><TableCell align="right">PM10</TableCell><TableCell align="right">Temp</TableCell><TableCell align="right">Humidity</TableCell></TableRow></TableHead>
                  <TableBody>
                    {readings.data?.items.map((x) => (
                      <TableRow key={x.id} hover>
                        <TableCell>{fmtWallClock(x.recordedAt, true)}</TableCell><TableCell><AqiBadge aqi={x.aqi} status={x.aqiStatus} /></TableCell>
                        <TableCell align="right">{fmtNum(x.pm25)}</TableCell><TableCell align="right">{fmtNum(x.pm10)}</TableCell>
                        <TableCell align="right">{fmtNum(x.temperature)}°C</TableCell><TableCell align="right">{fmtNum(x.humidity)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {readings.loading && <TableSkeleton cols={6} rows={4} />}
              {!!readings.error && <ErrorState error={readings.error} onRetry={readings.reload} />}
              {!readings.loading && !readings.error && readings.data?.items.length === 0 && <EmptyState title="No readings in this range" />}
              <PaginationBar page={rPage} result={readings.data} pageSize={rSize} onPage={setRPage} onPageSize={setRSize} />
            </Card>
          </Grid>

          {canHistory && (
            <Grid item xs={12}>
              <Card>
                <Typography fontWeight={700} sx={{ p: 2.5, pb: 1 }}>Assignment history</Typography>
                <TableContainer>
                  <Table size="small" aria-label="Assignment history">
                    <TableHead><TableRow><TableCell>User</TableCell><TableCell>Assigned</TableCell><TableCell>Released</TableCell><TableCell>By</TableCell><TableCell>Notes</TableCell><TableCell>State</TableCell></TableRow></TableHead>
                    <TableBody>
                      {assignments.data?.items.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell sx={{ fontWeight: 600 }}>{a.userName}</TableCell><TableCell>{fmtUtc(a.assignedAt)}</TableCell><TableCell>{fmtUtc(a.unassignedAt)}</TableCell>
                          <TableCell>{a.assignedByName}</TableCell><TableCell>{a.notes || '—'}</TableCell><TableCell><ActiveChip active={a.isActive} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {assignments.loading && <TableSkeleton cols={6} rows={3} />}
                {!!assignments.error && <ErrorState error={assignments.error} onRetry={assignments.reload} />}
                {!assignments.loading && !assignments.error && assignments.data?.items.length === 0 && <EmptyState title="This device has never been assigned" />}
                <PaginationBar page={aPage} result={assignments.data} pageSize={aSize} onPage={setAPage} onPageSize={setASize} />
              </Card>
            </Grid>
          )}
        </Grid>
      )}
      {!d && !dev.loading && <Stack><EmptyState title="Device not available" /></Stack>}
    </>
  );
}
