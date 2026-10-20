import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Card, Stack, Typography } from '@mui/material';
import EnergySavingsLeafOutlined from '@mui/icons-material/EnergySavingsLeafOutlined';
import GrainOutlined from '@mui/icons-material/GrainOutlined';
import BlurOnOutlined from '@mui/icons-material/BlurOnOutlined';
import ThermostatOutlined from '@mui/icons-material/ThermostatOutlined';
import WaterDropOutlined from '@mui/icons-material/WaterDropOutlined';
import SensorsOutlined from '@mui/icons-material/SensorsOutlined';
import WifiTetheringOutlined from '@mui/icons-material/WifiTetheringOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import PeopleOutline from '@mui/icons-material/PeopleOutline';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import { devicesApi, usersApi } from '../../api/services';
import { EmptyState, ErrorState } from '../../components/feedback';
import { useAuth } from '../auth/AuthContext';
import { useDevices } from '../devices/useDevices';
import { useLatest } from '../sensor-data/useLatest';
import { presetRange, useRange, useSeries } from '../analytics/useSeries';
import { DeviceHealthAlerts, useDeviceHealth } from '../devices/useDeviceHealth';
import { toSeries, C } from '../analytics/charts';
import { fmtNum, fmtWallClock, isRecentlyReporting, parseApiDate } from '../../utils/format';
import { aqiCategory } from '../../utils/aqi';
import { useAsync } from '../../utils/useAsync';
import { tokens } from '../../theme/theme';
import { MetricCard, OpCard, RecentReadings, StatusDonut, WelcomeBanner, deltaVsAverage } from './widgets';
import { TrendCard } from './TrendCard';

const count = (p: Promise<{ totalCount: number | null }>) => p.then((r) => r.totalCount);

function useCounts(role: 'SuperAdmin' | 'Admin' | 'User') {
  return useAsync(async () => {
    const dev = (f: object) => count(devicesApi.list({ page: 1, pageSize: 1, ...f }));
    const base = await Promise.all([dev({}), dev({ isActive: true }), dev({ assigned: true })]);
    const out: Record<string, number | null> = { devices: base[0], activeDevices: base[1], assignedDevices: base[2] };
    if (role === 'SuperAdmin') {
      const u = (f: object) => count(usersApi.list({ page: 1, pageSize: 1, ...f }));
      const [users, activeUsers, admins, standalone] = await Promise.all([u({}), u({ isActive: true }), u({ role: 'Admin' }), u({ standalone: true, role: 'User' })]);
      Object.assign(out, { users, activeUsers, admins, standalone });
    } else if (role === 'Admin') {
      const u = (f: object) => count(usersApi.list({ page: 1, pageSize: 1, ...f }));
      const [users, activeUsers] = await Promise.all([u({}), u({ isActive: true })]);
      Object.assign(out, { users, activeUsers });
    }
    return out;
  }, [role]);
}

const grid = (cols: Record<string, string>) => ({ display: 'grid', gap: 2, gridTemplateColumns: cols });

export default function DashboardPage() {
  const { user, role } = useAuth();
  const r = role ?? 'User';
  const counts = useCounts(r);
  const dev = useDevices();
  const health = useDeviceHealth();
  const latest = useLatest(dev.devices, !dev.loading);
  const [range, setRange] = useRange('7d');
  const [deviceId, setDeviceId] = useState('');

  // The device that reported most recently drives the headline cards and the default trend device.
  const freshest = useMemo(() => {
    const withData = latest.items.filter((i) => i.latest);
    withData.sort((a, b) => (parseApiDate(b.latest!.recordedAt)?.getTime() ?? 0) - (parseApiDate(a.latest!.recordedAt)?.getTime() ?? 0));
    return withData[0];
  }, [latest.items]);
  useEffect(() => {
    // wait until the latest readings have actually loaded (latest.data), otherwise the first device is picked by mistake
    if (!deviceId && latest.data && dev.devices.length) setDeviceId(freshest?.device.deviceId ?? dev.devices[0].deviceId);
  }, [deviceId, freshest, latest.data, dev.devices]);

  const trend = useSeries(deviceId, range, !!deviceId);

  // Sparklines and "vs 7-day average" on the headline cards come from that same device's real readings.
  const cardRange = useMemo(() => presetRange('7d'), []);
  const cardSeries = useSeries(freshest?.device.deviceId, cardRange, !!freshest);
  const spark = useMemo(() => toSeries(cardSeries.data?.rows ?? []), [cardSeries.data]);

  const cur = freshest?.latest ?? null;
  const cat = aqiCategory(cur?.aqi);
  const reporting = latest.items.filter((i) => isRecentlyReporting(i.latest?.recordedAt)).length;
  const known = latest.items.filter((i) => i.latest).length;
  const c = counts.data;
  const total = c?.devices ?? dev.total;
  const active = c?.activeDevices ?? 0;
  const busy = dev.loading || latest.loading;
  const stale = !!cur && !isRecentlyReporting(cur.recordedAt);
  const col = (k: 'aqi' | 'pm25' | 'pm10' | 'temperature' | 'humidity' | 'outerTemperature' | 'outerHumidity') => spark.map((p) => p[k]);

  const opCards: Array<Parameters<typeof OpCard>[0]> = [
    { label: r === 'User' ? 'My Devices' : 'Accessible Devices', icon: SensorsOutlined, loading: counts.loading, value: fmtNum(c?.devices, 0), to: '/devices',
      sub: r === 'User' ? undefined : `${active} active · ${Math.max(0, total - active)} inactive`,
      ring: r === 'User' || !total ? undefined : { pct: (active / total) * 100, label: 'Active' } },
    { label: 'Recently Reporting', icon: WifiTetheringOutlined, loading: busy, value: fmtNum(reporting, 0),
      sub: `${known} of ${dev.devices.length} devices have data · last 30 min`,
      ring: dev.devices.length ? { pct: (reporting / dev.devices.length) * 100, label: 'Reporting', color: '#15803D' } : undefined },
    { label: 'Latest Reading', icon: ScheduleOutlined, loading: busy, value: <span style={{ fontSize: 15 }}>{cur ? fmtWallClock(cur.recordedAt) : '—'}</span>, sub: 'Device time (IST)', to: r === 'User' ? '/latest' : '/readings' },
  ];
  if (r === 'SuperAdmin') {
    opCards.push(
      { label: 'Users', icon: PeopleOutline, loading: counts.loading, value: fmtNum(c?.users, 0), sub: `${c?.activeUsers ?? 0} active · ${Math.max(0, (c?.users ?? 0) - (c?.activeUsers ?? 0))} inactive`, to: '/users' },
      { label: 'Admins', icon: AdminPanelSettingsOutlined, loading: counts.loading, value: fmtNum(c?.admins, 0), sub: `${c?.standalone ?? 0} standalone users`, to: '/admins' },
      { label: 'Device Assignments', icon: LinkOutlined, loading: counts.loading, value: `${c?.assignedDevices ?? 0} / ${c?.devices ?? 0}`, sub: `${Math.max(0, (c?.devices ?? 0) - (c?.assignedDevices ?? 0))} unassigned`, to: '/assignments' },
    );
  } else if (r === 'Admin') {
    opCards.push(
      { label: 'Managed Users', icon: PeopleOutline, loading: counts.loading, value: fmtNum(c?.users, 0), sub: `${c?.activeUsers ?? 0} active · ${Math.max(0, (c?.users ?? 0) - (c?.activeUsers ?? 0))} inactive`, to: '/users' },
      { label: 'Assigned Devices', icon: LinkOutlined, loading: counts.loading, value: `${c?.assignedDevices ?? 0} / ${c?.devices ?? 0}`, sub: `${Math.max(0, (c?.devices ?? 0) - (c?.assignedDevices ?? 0))} unassigned`, to: '/devices' },
    );
  }

  const notReporting = Math.max(0, dev.devices.length - reporting);

  return (
    <>
      <WelcomeBanner
        name={user?.name ?? r}
        subtitle={r === 'SuperAdmin' ? 'Your overview of air quality, connected devices, and environmental operations.'
          : r === 'Admin' ? 'Air quality across the users and devices you manage.' : 'Air quality from the devices assigned to you.'}
        actionLabel={r === 'User' ? 'View Latest Readings' : 'View Sensor Readings'} actionTo={r === 'User' ? '/latest' : '/readings'}
      />

      {!!dev.error && <ErrorState error={dev.error} onRetry={dev.reload} />}
      {!dev.loading && !dev.error && dev.devices.length === 0 && (
        <Card sx={{ mb: 2 }}><EmptyState title={r === 'User' ? 'No devices assigned to you yet' : 'No devices to show yet'} hint={r === 'User' ? 'Ask your administrator to assign a device.' : r === 'SuperAdmin' ? 'Register a device to start receiving data.' : 'Devices appear here once assigned to your users.'} /></Card>
      )}
      {!!counts.error && <Alert severity="warning" sx={{ mb: 2 }}>Some summary figures could not be loaded.</Alert>}
      <DeviceHealthAlerts problems={health.problems} />

      {/* air-quality metrics (latest reading of the most recently reporting device) */}
      <Box sx={{ ...grid({ xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }), mb: 2 }}>
        <Box sx={{ gridColumn: { xs: 'span 2', md: 'span 1' } }}>
          <MetricCard label="Current AQI" icon={EnergySavingsLeafOutlined} accent={cat.color} tint={cat.bg} loading={busy} value={fmtNum(cur?.aqi, 0)}
            sub={cur ? <>{freshest?.device.deviceName}{stale && <Box component="span" sx={{ ml: 0.75, color: '#b45309', fontWeight: 600 }}>· stale</Box>}</> : 'No readings yet'}
            badge={cur ? <Box component="span" sx={{ display: 'inline-block', px: 1.25, py: 0.25, borderRadius: '8px', bgcolor: cat.bg, color: cat.color, fontWeight: 700, fontSize: 12 }}>{cat.label}</Box> : undefined}
            spark={col('aqi')} />
        </Box>
        <MetricCard label="PM2.5" unit="µg/m³" icon={GrainOutlined} accent={C.pm25} tint="#FDE9A8" loading={busy} value={fmtNum(cur?.pm25, 0)} delta={deltaVsAverage(col('pm25'), 'down')} spark={col('pm25')} />
        <MetricCard label="PM10" unit="µg/m³" icon={BlurOnOutlined} accent={C.pm10} tint="#E4DBFF" loading={busy} value={fmtNum(cur?.pm10, 0)} delta={deltaVsAverage(col('pm10'), 'down')} spark={col('pm10')} />
        <MetricCard label="Temperature" unit="°C" icon={ThermostatOutlined} accent="#EA580C" tint="#FFDDBA" loading={busy} value={fmtNum(cur?.temperature)} delta={deltaVsAverage(col('temperature'), 'neutral')} spark={col('temperature')} />
        <MetricCard label="Humidity" unit="%" icon={WaterDropOutlined} accent={C.hum} tint="#BDF3E6" loading={busy} value={fmtNum(cur?.humidity, 0)} delta={deltaVsAverage(col('humidity'), 'neutral')} spark={col('humidity')} />
        <MetricCard label="Outer temperature" unit="°C" icon={ThermostatOutlined} accent="#C2410C" tint="#FFE4CC" loading={busy} value={fmtNum(cur?.outerTemperature)} delta={deltaVsAverage(col('outerTemperature'), 'neutral')} spark={col('outerTemperature')} />
        <MetricCard label="Outer humidity" unit="%" icon={WaterDropOutlined} accent="#0E7490" tint="#CFF3F8" loading={busy} value={fmtNum(cur?.outerHumidity, 0)} delta={deltaVsAverage(col('outerHumidity'), 'neutral')} spark={col('outerHumidity')} />
      </Box>

      {/* operations */}
      <Box sx={{ ...grid({ xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }), '@media (min-width: 1600px)': { gridTemplateColumns: `repeat(${Math.min(opCards.length, 6)}, minmax(0, 1fr))` }, mb: 2 }}>
        {opCards.map((o) => <OpCard key={o.label} {...o} />)}
      </Box>

      {dev.devices.length > 0 && (
        <Box sx={grid({ xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 390px' })}>
          <TrendCard
            devices={dev.devices} deviceId={deviceId} onDevice={setDeviceId} range={range} onRange={setRange}
            rows={trend.data?.rows ?? null} bucketMinutes={trend.data?.bucketMinutes} loading={trend.loading} error={trend.error} onRetry={trend.reload}
          />
          <Stack spacing={2}>
            <StatusDonut
              loading={counts.loading || latest.loading} total={total} viewAllTo="/devices"
              slices={[{ name: 'Active', value: active, color: '#16A34A' }, { name: 'Inactive', value: Math.max(0, total - active), color: '#9CA3AF' }]}
              rows={[
                { label: 'Active', value: active, color: '#16A34A' },
                { label: 'Inactive', value: Math.max(0, total - active), color: '#9CA3AF' },
                { label: 'Reporting (30 min)', value: reporting, color: '#15803D' },
                { label: 'Not reporting', value: notReporting, color: '#D1D5DB' },
              ]}
            />
            <RecentReadings />
          </Stack>
        </Box>
      )}
      <Typography sx={{ mt: 2, fontSize: 11, color: tokens.muted }}>Cards show the latest reading of the most recently reporting device. Trend percentages compare it with that device’s 7-day average. Times are device time (IST).</Typography>
    </>
  );
}
