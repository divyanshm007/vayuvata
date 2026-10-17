import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Grid, LinearProgress, Stack, Typography } from '@mui/material';
import { PageHeader, StatCard } from '../../components/ui';
import { EmptyState, ErrorState } from '../../components/feedback';
import { useDevices } from '../devices/useDevices';
import { useLatest } from '../sensor-data/useLatest';
import { DeviceSelect, RangePicker, useRange, useSeries } from './useSeries';
import { AqiLegend, AqiTrendChart, ChartCard, DeviceAqiBars, PmChart, TempHumChart, toSeries } from './charts';
import { fmtNum } from '../../utils/format';
import { aqiCategory } from '../../utils/aqi';
import AirOutlined from '@mui/icons-material/AirOutlined';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import Numbers from '@mui/icons-material/Numbers';

export default function AnalyticsPage() {
  const dev = useDevices();
  const [range, setRange] = useRange('7d');
  const [deviceId, setDeviceId] = useState('');
  useEffect(() => { if (!deviceId && dev.devices.length) setDeviceId(dev.devices[0].deviceId); }, [dev.devices, deviceId]);

  const invalid = !!range.to && range.from > range.to;
  const series = useSeries(deviceId, range, !!deviceId && !invalid);
  const data = useMemo(() => toSeries(series.data?.rows ?? []), [series.data]);
  const latest = useLatest(dev.devices, !dev.loading);

  const aqis = data.map((d) => d.aqi).filter((v): v is number => v !== null);
  const avg = aqis.length ? aqis.reduce((a, b) => a + b, 0) / aqis.length : null;

  return (
    <>
      <PageHeader title="AQI Analytics" subtitle="Trends and pollutant breakdown for a device" crumbs={[{ label: 'Home', to: '/' }, { label: 'AQI Analytics' }]} />
      {!!dev.error && <ErrorState error={dev.error} onRetry={dev.reload} />}
      {!dev.loading && !dev.error && dev.devices.length === 0 && <Card><EmptyState title="No devices available" hint="Analytics appear once a device is visible to you." /></Card>}
      {dev.devices.length > 0 && (
        <>
          <Card sx={{ p: 2, mb: 2 }}>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ lg: 'center' }}>
              <DeviceSelect devices={dev.devices} value={deviceId} onChange={setDeviceId} />
              <RangePicker value={range} onChange={setRange} />
            </Stack>
            {invalid && <Alert severity="warning" sx={{ mt: 1.5 }}>“To” must be after “From”.</Alert>}
          </Card>
          {series.loading && <LinearProgress sx={{ mb: 2 }} />}
          {!!series.error && <ErrorState error={series.error} onRetry={series.reload} />}
          {!!series.data && series.data.bucketMinutes > 1 && <Alert severity="info" sx={{ mb: 2 }}>The whole range is shown: each point is the average of {series.data.bucketMinutes} minutes ({series.data.totalReadings} readings). Narrow the range for more detail.</Alert>}
          {!series.error && (
            <Grid container spacing={2}>
              <Grid item xs={6} md={3}><StatCard label="Readings" value={data.length} icon={Numbers} accent="#0ea5e9" loading={series.loading} /></Grid>
              <Grid item xs={6} md={3}><StatCard label="Average AQI" value={fmtNum(avg, 0)} icon={AirOutlined} loading={series.loading}
                footer={avg !== null && <Typography variant="caption" sx={{ color: aqiCategory(avg).color, fontWeight: 600 }}>{aqiCategory(avg).label}</Typography>} /></Grid>
              <Grid item xs={6} md={3}><StatCard label="Peak AQI" value={fmtNum(aqis.length ? Math.max(...aqis) : null, 0)} icon={ArrowUpward} accent="#dc2626" loading={series.loading} /></Grid>
              <Grid item xs={6} md={3}><StatCard label="Lowest AQI" value={fmtNum(aqis.length ? Math.min(...aqis) : null, 0)} icon={ArrowDownward} accent="#16a34a" loading={series.loading} /></Grid>
              <Grid item xs={12}><ChartCard title="AQI trend" subtitle="Device local time (IST)" action={<AqiLegend />} height={300}><AqiTrendChart data={data} /></ChartCard></Grid>
              <Grid item xs={12} lg={6}><ChartCard title="PM2.5 vs PM10" subtitle="µg/m³"><PmChart data={data} /></ChartCard></Grid>
              <Grid item xs={12} lg={6}><ChartCard title="Temperature & humidity"><TempHumChart data={data} /></ChartCard></Grid>
              {dev.devices.length > 1 && (
                <Grid item xs={12}>
                  <ChartCard title="Device comparison" subtitle="Latest AQI per device">
                    <DeviceAqiBars items={latest.items.map((i) => ({ name: i.device.deviceName, aqi: i.latest?.aqi ?? null }))} />
                  </ChartCard>
                </Grid>
              )}
            </Grid>
          )}
        </>
      )}
    </>
  );
}
