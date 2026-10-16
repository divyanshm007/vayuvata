import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import {
  Alert, Box, Button, Card, Chip, CircularProgress, MenuItem, Select, Stack, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tabs, Typography,
} from '@mui/material';
import Sync from '@mui/icons-material/Sync';
import { PageHeader } from '../../components/ui';
import { ErrorState } from '../../components/feedback';
import { governmentApi } from '../../api/services';
import { useAsync } from '../../utils/useAsync';
import { fmtNum, fmtWallClock } from '../../utils/format';
import { toAppError } from '../../utils/errors';
import type { GovDeviceComparison, GovStationDto } from '../../types/api';

const PIN_CSS = `
.gc-pin{width:26px;height:26px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);display:grid;place-items:center;color:#fff;font:700 11px sans-serif}
.gc-device{background:#15803D}.gc-station{background:#1D4ED8}.gc-near{background:#64748B;width:18px;height:18px}
`;
const icon = (cls: string, text = '') => L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12], html: `<div class="gc-pin ${cls}">${text}</div>` });
const DEVICE_ICON = icon('gc-device', 'V');
const STATION_ICON = icon('gc-station', 'G');
const NEAR_ICON = icon('gc-near');

type Pt = [number, number];

function Fit({ points }: { points: Pt[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 14);
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
  }, [map, JSON.stringify(points)]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function GovMap({ cmp, mode }: { cmp: GovDeviceComparison; mode: 'device' | 'government' }) {
  const loc = cmp.device.location;
  const dev: Pt | null = loc ? [loc.latitude, loc.longitude] : null;
  const st = cmp.government.station;
  const stPt: Pt | null = st ? [st.latitude, st.longitude] : null;
  const near = cmp.nearbyStations.filter((n) => n.id !== st?.id);
  const points: Pt[] = mode === 'device' ? (dev ? [dev] : []) : [...(stPt ? [stPt] : []), ...(dev ? [dev] : [])];
  if (points.length === 0) return <Alert severity="info">No location is available yet.</Alert>;
  return (
    <Box sx={{ height: 420, borderRadius: 2, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
      <style>{PIN_CSS}</style>
      <MapContainer center={points[0]} zoom={13} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fit points={points} />
        {dev && (
          <Marker position={dev} icon={DEVICE_ICON}>
            <Popup><b>{cmp.device.deviceId}</b> (VayuVata)<br />{dev[0].toFixed(5)}, {dev[1].toFixed(5)}<br />AQI {fmtNum(cmp.device.latestAqi, 0)} · latest reading {fmtWallClock(cmp.device.latestReadingAt)}</Popup>
          </Marker>
        )}
        {mode === 'government' && stPt && st && (
          <>
            <Marker position={stPt} icon={STATION_ICON}>
              <Popup><b>{st.name}</b><br />{st.city}, {st.state}<br />PM2.5 {fmtNum(st.pm25, 0)} · PM10 {fmtNum(st.pm10, 0)} µg/m³<br />Observed {fmtWallClock(st.observedAt)}</Popup>
            </Marker>
            {dev && <Polyline positions={[dev, stPt]} pathOptions={{ color: '#1D4ED8', weight: 3, dashArray: '6 6' }} />}
            {near.map((n) => (
              <Marker key={n.id} position={[n.latitude, n.longitude]} icon={NEAR_ICON}>
                <Popup><b>{n.name}</b><br />{fmtNum(n.distanceKm)} km away<br />PM2.5 {fmtNum(n.pm25, 0)} · PM10 {fmtNum(n.pm10, 0)} µg/m³</Popup>
              </Marker>
            ))}
          </>
        )}
      </MapContainer>
    </Box>
  );
}

const Stat = ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
  <Box sx={{ minWidth: 120 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography fontWeight={700}>{value} {unit && <Typography component="span" variant="caption" color="text.secondary">{unit}</Typography>}</Typography>
  </Box>
);

function DeviceTab({ cmp }: { cmp: GovDeviceComparison }) {
  const d = cmp.device;
  return (
    <Stack spacing={2}>
      <Card sx={{ p: 2 }}>
        <Typography fontWeight={700} sx={{ mb: 1 }}>{d.deviceId} <Typography component="span" color="text.secondary">{d.deviceName}</Typography></Typography>
        <Stack direction="row" flexWrap="wrap" gap={3}>
          <Stat label="Location" value={d.location ? `${d.location.latitude.toFixed(5)}, ${d.location.longitude.toFixed(5)}` : '—'} />
          <Stat label="Position reported (IST)" value={d.locationRecordedAt ? fmtWallClock(d.locationRecordedAt, true) : '—'} unit={d.locationSource ?? ''} />
          <Stat label="Latest reading (IST)" value={d.latestReadingAt ? fmtWallClock(d.latestReadingAt, true) : '—'} />
          <Stat label="Latest AQI" value={fmtNum(d.latestAqi, 0)} unit={d.latestAqiStatus ?? ''} />
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          {d.isLastKnown
            ? `The device is offline: these are its last known values from ${fmtWallClock(d.latestReadingAt, true)}. They are shown for reference and are not compared.`
            : `Compared values are the average of ${d.windowSamples} reading(s) in the hour ending at the government observation${d.windowFrom && d.windowTo ? ` (${fmtWallClock(d.windowFrom)} to ${fmtWallClock(d.windowTo)})` : ''}.`}
        </Typography>
        <Stack direction="row" flexWrap="wrap" gap={3} sx={{ mt: 1.5 }}>
          <Stat label="PM2.5" value={fmtNum(d.pm25)} unit="µg/m³" /><Stat label="PM10" value={fmtNum(d.pm10)} unit="µg/m³" />
          <Stat label="AQI (from PM)" value={fmtNum(d.aqi, 0)} unit={d.aqiStatus ?? ''} />
          <Stat label="NO₂" value={fmtNum(d.no2Ppm, 3)} /><Stat label="SO₂" value={fmtNum(d.so2Ppm, 3)} /><Stat label="CO" value={fmtNum(d.coPpm, 2)} />
          <Stat label="TVOC" value={fmtNum(d.tvocPpb, 0)} unit="ppb" />
          <Stat label="Temperature" value={fmtNum(d.temperature)} unit="°C" /><Stat label="Humidity" value={fmtNum(d.humidity)} unit="%" />
          <Stat label="Outer temperature" value={fmtNum(d.outerTemperature)} unit="°C" /><Stat label="Outer humidity" value={fmtNum(d.outerHumidity)} unit="%" />
        </Stack>
      </Card>
      <GovMap cmp={cmp} mode="device" />
    </Stack>
  );
}

function GovernmentTab({ cmp }: { cmp: GovDeviceComparison }) {
  const s = cmp.government.station;
  if (!s) return <Alert severity="warning">{cmp.statusMessage}</Alert>;
  return (
    <Stack spacing={2}>
      <Card sx={{ p: 2 }}>
        <Typography fontWeight={700}>{s.name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{s.city}, {s.state} · CPCB / state pollution control board station</Typography>
        <Stack direction="row" flexWrap="wrap" gap={3}>
          <Stat label="Station position" value={`${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}`} />
          <Stat label="Distance from device" value={fmtNum(s.distanceKm)} unit="km" />
          <Stat label="Observed (IST)" value={s.observedAt ? fmtWallClock(s.observedAt, true) : '—'} />
          <Stat label="AQI (calculated from PM)" value={fmtNum(s.calculatedAqi, 0)} unit={s.calculatedAqiStatus ?? ''} />
        </Stack>
        <TableContainer sx={{ mt: 2 }}>
          <Table size="small" aria-label="Government pollutants">
            <TableHead><TableRow><TableCell>Pollutant</TableCell><TableCell align="right">Average</TableCell><TableCell align="right">Min</TableCell><TableCell align="right">Max</TableCell><TableCell>Unit</TableCell></TableRow></TableHead>
            <TableBody>
              {cmp.government.pollutants.map((p) => (
                <TableRow key={p.pollutant}><TableCell>{p.pollutant}</TableCell><TableCell align="right">{fmtNum(p.avg)}</TableCell>
                  <TableCell align="right">{fmtNum(p.min)}</TableCell><TableCell align="right">{fmtNum(p.max)}</TableCell><TableCell>{p.unit}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Source: data.gov.in · CPCB Real time Air Quality Index (hourly, unreviewed live data). The feed has no official AQI, so the AQI shown is calculated from the station's PM2.5 and PM10 averages.
        </Typography>
      </Card>
      <GovMap cmp={cmp} mode="government" />
      {cmp.nearbyStations.length > 0 && (
        <Card sx={{ p: 2 }}>
          <Typography fontWeight={700} sx={{ mb: 1 }}>Other stations nearby</Typography>
          <NearbyTable list={cmp.nearbyStations.filter((n) => n.id !== s.id)} />
        </Card>
      )}
    </Stack>
  );
}

function NearbyTable({ list }: { list: GovStationDto[] }) {
  return (
    <TableContainer>
      <Table size="small" aria-label="Nearby stations">
        <TableHead><TableRow><TableCell>Station</TableCell><TableCell align="right">Distance (km)</TableCell><TableCell align="right">PM2.5</TableCell><TableCell align="right">PM10</TableCell><TableCell align="right">AQI (calc.)</TableCell></TableRow></TableHead>
        <TableBody>
          {list.map((n) => (
            <TableRow key={n.id}><TableCell>{n.name}</TableCell><TableCell align="right">{fmtNum(n.distanceKm)}</TableCell>
              <TableCell align="right">{fmtNum(n.pm25, 0)}</TableCell><TableCell align="right">{fmtNum(n.pm10, 0)}</TableCell><TableCell align="right">{fmtNum(n.calculatedAqi, 0)}</TableCell></TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function CompareTable({ cmp }: { cmp: GovDeviceComparison }) {
  if (cmp.rows.length === 0) return null;
  return (
    <Card>
      <Typography fontWeight={700} sx={{ p: 2, pb: 1 }}>Comparison · {cmp.device.deviceId} vs {cmp.government.station?.name}</Typography>
      <TableContainer>
        <Table size="small" aria-label="Comparison">
          <TableHead><TableRow>
            <TableCell>Parameter</TableCell><TableCell align="right">VayuVata</TableCell><TableCell align="right">Government</TableCell>
            <TableCell align="right">Difference</TableCell><TableCell align="right">% diff.</TableCell><TableCell>Unit / note</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {cmp.rows.map((r) => (
              <TableRow key={r.parameter} hover>
                <TableCell sx={{ fontWeight: 600 }}>{r.parameter}</TableCell>
                <TableCell align="right">{fmtNum(r.device, r.parameter.startsWith('NO') || r.parameter.startsWith('SO') ? 3 : 1)}</TableCell>
                <TableCell align="right">{fmtNum(r.government, 1)}</TableCell>
                <TableCell align="right" sx={{ color: r.comparable ? 'text.primary' : 'text.disabled' }}>{r.comparable ? fmtNum(r.difference, 1) : 'n/a'}</TableCell>
                <TableCell align="right" sx={{ color: r.comparable ? 'text.primary' : 'text.disabled' }}>{r.comparable && r.percentDifference != null ? `${fmtNum(r.percentDifference, 1)}%` : 'n/a'}</TableCell>
                <TableCell><Typography variant="caption" color="text.secondary">{r.unit}{r.note ? ` · ${r.note}` : ''}</Typography></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}

export default function GovComparisonPage() {
  const status = useAsync(() => governmentApi.status(), []);
  const cmps = useAsync(() => governmentApi.comparison(25), []);
  const [deviceId, setDeviceId] = useState<string>('');
  const [tab, setTab] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const list = cmps.data ?? [];
  const withLocation = useMemo(() => list.filter((c) => c.status !== 'no_location'), [list]);
  useEffect(() => { if (!deviceId && list.length > 0) setDeviceId((withLocation[0] ?? list[0]).device.deviceId); }, [list, withLocation, deviceId]);
  const cmp = list.find((c) => c.device.deviceId === deviceId) ?? null;

  const sync = async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await governmentApi.sync();
      setSyncMsg(r.status === 'ok'
        ? { ok: true, text: `Synced ${r.recordsFetched} records (${r.readingsAdded} new readings, ${r.devicesMatched} device(s) matched).` }
        : { ok: false, text: r.error ?? 'Sync failed.' });
      status.reload(); cmps.reload();
    } catch (e) { setSyncMsg({ ok: false, text: toAppError(e).message }); }
    finally { setSyncing(false); }
  };

  const st = status.data;
  const stale = cmp?.status === 'stale';
  return (
    <>
      <PageHeader
        title="Government Comparison"
        subtitle="Each VayuVata device against the nearest CPCB / state monitoring station (data.gov.in). SuperAdmin only."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Gov Comparison' }]}
        actions={<Button variant="contained" startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <Sync />} onClick={sync} disabled={syncing}>Sync now</Button>}
      />
      {syncMsg && <Alert severity={syncMsg.ok ? 'success' : 'error'} sx={{ mb: 2 }} onClose={() => setSyncMsg(null)}>{syncMsg.text}</Alert>}
      {st && (
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
          <Chip size="small" label={`${st.stationCount} stations`} />
          <Chip size="small" label={`${st.mappedDevices} device(s) matched`} />
          <Chip size="small" color={st.lastSyncStatus === 'ok' ? 'success' : 'warning'} label={`Last sync: ${st.lastSyncStatus ?? 'never'}${st.lastSyncAt ? ` · ${new Date(st.lastSyncAt).toLocaleString()}` : ''}`} />
          <Chip size="small" label={`Newest official reading (IST): ${st.latestObservedAt ? fmtWallClock(st.latestObservedAt) : '—'}`} />
          {!st.apiKeyConfigured && <Chip size="small" color="error" label="API key not configured" />}
        </Stack>
      )}
      {cmps.error ? <ErrorState error={cmps.error} onRetry={cmps.reload} /> : cmps.loading && !cmps.data ? <CircularProgress aria-label="Loading" /> : (
        <Stack spacing={2}>
          {list.length > 1 && (
            <Select size="small" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} sx={{ maxWidth: 320 }} inputProps={{ 'aria-label': 'Device' }}>
              {list.map((c) => <MenuItem key={c.device.deviceId} value={c.device.deviceId}>{c.device.deviceId}{c.status === 'no_location' ? ' (no location yet)' : ''}</MenuItem>)}
            </Select>
          )}
          {cmp && (
            <>
              <Alert severity={cmp.status === 'ok' ? 'success' : cmp.status === 'stale' || cmp.status === 'device_offline' ? 'warning' : 'info'}>
                {cmp.statusMessage}
                {cmp.governmentAgeMinutes != null && ` Government observation is ${Math.round(cmp.governmentAgeMinutes)} min old.`}
                {cmp.government.station && cmp.device.latestReadingAt && cmp.device.windowSamples === 0 &&
                  ` The device's latest reading is from ${fmtWallClock(cmp.device.latestReadingAt)}.`}
              </Alert>
              {stale && <Alert severity="warning">The official data is older than 3 hours; do not treat it as live.</Alert>}
              <CompareTable cmp={cmp} />
              <Tabs value={tab} onChange={(_, v) => setTab(v)} aria-label="Data source">
                <Tab label="VayuVata (our device)" /><Tab label="Government (CPCB station)" />
              </Tabs>
              {tab === 0 ? <DeviceTab cmp={cmp} /> : <GovernmentTab cmp={cmp} />}
            </>
          )}
          {list.length === 0 && <Alert severity="info">No active devices.</Alert>}
        </Stack>
      )}
    </>
  );
}
