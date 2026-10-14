import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Card, Grid, LinearProgress, Stack, Typography, Button } from '@mui/material';
import { AqiBadge, PageHeader, ReportingChip } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/feedback';
import { fmtNum, fmtWallClock, isRecentlyReporting } from '../../utils/format';
import { aqiCategory } from '../../utils/aqi';
import { useDevices } from '../devices/useDevices';
import { useLatest, MAX_LATEST_DEVICES } from './useLatest';

export default function LatestPage() {
  const dev = useDevices();
  const latest = useLatest(dev.devices, !dev.loading);
  const busy = dev.loading || latest.loading;
  return (
    <>
      <PageHeader title="Latest Sensor Readings" subtitle="Most recent reading from each of your devices" crumbs={[{ label: 'Home', to: '/' }, { label: 'Latest Sensor Readings' }]} />
      {busy && <LinearProgress sx={{ mb: 2 }} />}
      {!!dev.error && <ErrorState error={dev.error} onRetry={dev.reload} />}
      {!!latest.error && <ErrorState error={latest.error} onRetry={latest.reload} />}
      {!busy && !dev.error && dev.devices.length === 0 && <Card><EmptyState title="No devices assigned to you yet" hint="Ask your administrator to assign a device." /></Card>}
      {latest.capped && <Alert severity="info" sx={{ mb: 2 }}>Showing the first {MAX_LATEST_DEVICES} devices.</Alert>}
      <Grid container spacing={2}>
        {latest.items.map(({ device, latest: r }) => {
          const cat = aqiCategory(r?.aqi);
          return (
            <Grid item xs={12} md={6} xl={4} key={device.id}>
              <Card sx={{ p: 2.5, borderTop: `4px solid ${cat.color}`, height: '100%' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={700} noWrap>{device.deviceName}</Typography>
                    <Typography variant="caption" color="text.secondary">{device.deviceId}</Typography>
                  </Box>
                  <ReportingChip known={!!r} reporting={isRecentlyReporting(r?.recordedAt)} />
                </Stack>
                <Stack direction="row" alignItems="baseline" spacing={1.5} sx={{ my: 1.5 }}>
                  <Typography sx={{ fontWeight: 800, fontSize: 34, color: cat.color, lineHeight: 1 }}>{fmtNum(r?.aqi, 0)}</Typography>
                  <AqiBadge aqi={r?.aqi} status={r?.aqiStatus} />
                </Stack>
                {r ? (
                  <Grid container spacing={1}>
                    {[['PM2.5', r.pm25, 'µg/m³'], ['PM10', r.pm10, 'µg/m³'], ['Temp', r.temperature, '°C'], ['Humidity', r.humidity, '%']].map(([k, v, u]) => (
                      <Grid item xs={6} key={k as string}><Typography variant="caption" color="text.secondary">{k as string}</Typography>
                        <Typography fontWeight={600}>{fmtNum(v as number | null)} <Typography component="span" variant="caption" color="text.secondary">{u as string}</Typography></Typography></Grid>
                    ))}
                  </Grid>
                ) : <Typography variant="body2" color="text.secondary">This device has not reported any readings yet.</Typography>}
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">{r ? fmtWallClock(r.recordedAt) : '—'}</Typography>
                  <Button size="small" component={RouterLink} to={`/devices/${device.id}`}>Details</Button>
                </Stack>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </>
  );
}
