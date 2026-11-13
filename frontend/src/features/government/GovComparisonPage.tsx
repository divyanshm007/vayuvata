import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import {
  Alert, Box, Button, Card, Chip, CircularProgress, MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography,
} from '@mui/material';
import Sync from '@mui/icons-material/Sync';
import { PageHeader } from '../../components/ui';
import { ErrorState } from '../../components/feedback';
import { governmentApi } from '../../api/services';
import { useAsync } from '../../utils/useAsync';
import { useAuth } from '../auth/AuthContext';
import { MAP_ATTRIBUTION, MAP_MAX_ZOOM, MAP_TILE_URL } from '../../config/mapTiles';
import { fmtGov, fmtNum, fmtWallClock, NOT_AVAILABLE } from '../../utils/format';
import { toAppError } from '../../utils/errors';
import { useTempView } from '../../utils/temperature';
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

function Fit({ points, circle }: { points: Pt[]; circle?: { center: Pt; radiusM: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    // the radius circle is part of what must be visible
    const bounds = L.latLngBounds(points);
    if (circle) bounds.extend(L.latLng(circle.center).toBounds(circle.radiusM * 2));   // square around the circle (a circle not yet on a map has no bounds)
    if (points.length === 1 && !circle) map.setView(points[0], 14);
    else map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [map, JSON.stringify(points), circle?.radiusM]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function GovMap({ cmp, mode, radiusKm }: { cmp: GovDeviceComparison; mode: 'device' | 'government'; radiusKm: number }) {
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
        <TileLayer url={MAP_TILE_URL} maxZoom={MAP_MAX_ZOOM} attribution={MAP_ATTRIBUTION} />
        <Fit points={points} circle={dev ? { center: dev, radiusM: radiusKm * 1000 } : null} />
        {/* radius view: the area searched for nearby government stations, centred on the device */}
        {dev && <Circle center={dev} radius={radiusKm * 1000} pathOptions={{ color: '#15803D', weight: 2, fillColor: '#16A34A', fillOpacity: 0.07, dashArray: '6 6' }} />}
        {dev && (
          <Marker position={dev} icon={DEVICE_ICON}>
            <Popup><b>{cmp.device.deviceId}</b> (VayuVata)<br />{dev[0].toFixed(5)}, {dev[1].toFixed(5)}<br />AQI {fmtNum(cmp.device.latestAqi, 0)} · latest reading {fmtWallClock(cmp.device.latestReadingAt)}</Popup>
          </Marker>
        )}
        {mode === 'government' && stPt && st && (
          <>
            <Marker position={stPt} icon={STATION_ICON}>
              <Popup><b>{st.name}</b><br />{st.city}, {st.state}<br />PM2.5 {fmtGov(st.pm25, 0)} · PM10 {fmtGov(st.pm10, 0)} µg/m³<br />Observed {fmtWallClock(st.observedAt)}</Popup>
            </Marker>
            {dev && <Polyline positions={[dev, stPt]} pathOptions={{ color: '#1D4ED8', weight: 3, dashArray: '6 6' }} />}
            {near.map((n) => (
              <Marker key={n.id} position={[n.latitude, n.longitude]} icon={NEAR_ICON}>
                <Popup><b>{n.name}</b><br />{fmtNum(n.distanceKm)} km away<br />PM2.5 {fmtGov(n.pm25, 0)} · PM10 {fmtGov(n.pm10, 0)} µg/m³</Popup>
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

function DevicePanel({ cmp, radiusKm }: { cmp: GovDeviceComparison; radiusKm: number }) {
  const { isSA, tempLabel } = useTempView();
  const d = cmp.device;
  const rows: Array<[string, string, string]> = [
    ['PM2.5', fmtNum(d.pm25), 'µg/m³'], ['PM10', fmtNum(d.pm10), 'µg/m³'], ['AQI (calculated from PM)', `${fmtNum(d.aqi, 0)}${d.aqiStatus ? ` · ${d.aqiStatus}` : ''}`, ''],
    ['NO₂', fmtNum(d.no2Ppm, 3), 'device raw'], ['SO₂', fmtNum(d.so2Ppm, 3), 'device raw'], ['CO', fmtNum(d.coPpm, 2), 'ppm'],
    ['TVOC', fmtNum(d.tvocPpb, 0), 'ppb'], [tempLabel, fmtNum(d.temperature), '°C'], ['Humidity', fmtNum(d.humidity), '%'],
    ...(isSA ? [['Outer temperature', fmtNum(d.outerTemperature), '°C'] as [string, string, string]] : []), ['Outer humidity', fmtNum(d.outerHumidity), '%'],
  ];
  return (
    <Stack spacing={2}>
      <Card sx={{ p: 2 }}>
        <Typography fontWeight={700}>{d.deviceId} <Typography component="span" color="text.secondary">{d.deviceName}</Typography></Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>VayuVata device · our sensors</Typography>
        <Stack direction="row" flexWrap="wrap" gap={3}>
          <Stat label="Device position" value={d.location ? `${d.location.latitude.toFixed(5)}, ${d.location.longitude.toFixed(5)}` : '—'} />
          <Stat label="Distance to station" value={fmtGov(cmp.government.station?.distanceKm)} unit={cmp.government.station?.distanceKm == null ? '' : 'km'} />
          <Stat label="Latest reading (IST)" value={d.latestReadingAt ? fmtWallClock(d.latestReadingAt, true) : '—'} />
          <Stat label="Position reported (IST)" value={d.locationRecordedAt ? fmtWallClock(d.locationRecordedAt, true) : '—'} unit={d.locationSource ?? ''} />
        </Stack>
        <TableContainer sx={{ mt: 2 }}>
          <Table size="small" aria-label="VayuVata readings">
            <TableHead><TableRow><TableCell>Parameter</TableCell><TableCell align="right">Value</TableCell><TableCell>Unit</TableCell></TableRow></TableHead>
            <TableBody>
              {rows.map(([k, v, u]) => <TableRow key={k}><TableCell>{k}</TableCell><TableCell align="right">{v}</TableCell><TableCell>{u}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Latest reading from the device ({fmtWallClock(d.latestReadingAt, true)} IST). It is compared as it is with the government's latest observation; the two times are shown above.
        </Typography>
      </Card>
      <GovMap cmp={cmp} mode="device" radiusKm={radiusKm} />
    </Stack>
  );
}

function GovernmentPanel({ cmp, radiusKm }: { cmp: GovDeviceComparison; radiusKm: number }) {
  const s = cmp.government.station;
  if (!s) return <Alert severity="warning">{cmp.statusMessage}</Alert>;
  return (
    <Stack spacing={2}>
      <Card sx={{ p: 2 }}>
        <Typography fontWeight={700}>{s.name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{s.city}, {s.state} · CPCB / state pollution control board station</Typography>
        <Stack direction="row" flexWrap="wrap" gap={3}>
          <Stat label="Station position" value={`${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}`} />
          <Stat label="Distance from device" value={fmtGov(s.distanceKm)} unit={s.distanceKm == null ? '' : 'km'} />
          <Stat label="Observed (IST)" value={s.observedAt ? fmtWallClock(s.observedAt, true) : NOT_AVAILABLE} />
          <Stat label="AQI (calculated from PM)" value={fmtGov(s.calculatedAqi, 0)} unit={s.calculatedAqi == null ? '' : s.calculatedAqiStatus ?? ''} />
        </Stack>
        <TableContainer sx={{ mt: 2 }}>
          <Table size="small" aria-label="Government pollutants">
            <TableHead><TableRow><TableCell>Pollutant</TableCell><TableCell align="right">Average</TableCell><TableCell align="right">Min</TableCell><TableCell align="right">Max</TableCell><TableCell>Unit</TableCell></TableRow></TableHead>
            <TableBody>
              {cmp.government.pollutants.map((p) => (
                <TableRow key={p.pollutant}><TableCell>{p.pollutant}</TableCell><TableCell align="right">{fmtGov(p.avg)}</TableCell>
                  <TableCell align="right">{fmtGov(p.min)}</TableCell><TableCell align="right">{fmtGov(p.max)}</TableCell><TableCell>{p.unit}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Source: data.gov.in · CPCB Real time Air Quality Index (hourly, unreviewed live data). The feed has no official AQI, so the AQI shown is calculated from the station's PM2.5 and PM10 averages.
        </Typography>
      </Card>
      <GovMap cmp={cmp} mode="government" radiusKm={radiusKm} />
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
              <TableCell align="right">{fmtGov(n.pm25, 0)}</TableCell><TableCell align="right">{fmtGov(n.pm10, 0)}</TableCell><TableCell align="right">{fmtGov(n.calculatedAqi, 0)}</TableCell></TableRow>
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
                <TableCell align="right">{fmtGov(r.government, 1)}</TableCell>
                <TableCell align="right" sx={{ color: r.comparable ? 'text.primary' : 'text.disabled' }}>{r.comparable ? fmtNum(r.difference, 1) : r.government == null ? NOT_AVAILABLE : 'n/a'}</TableCell>
                <TableCell align="right" sx={{ color: r.comparable ? 'text.primary' : 'text.disabled' }}>{r.comparable && r.percentDifference != null ? `${fmtNum(r.percentDifference, 1)}%` : r.government == null ? NOT_AVAILABLE : 'n/a'}</TableCell>
                <TableCell><Typography variant="caption" color="text.secondary">{r.unit}{r.note ? ` · ${r.note}` : ''}</Typography></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
  );
}

const RADIUS_OPTIONS = [1, 5, 10, 25, 50];

export default function GovComparisonPage() {
  const { role } = useAuth();
  const status = useAsync(() => governmentApi.status(), []);
  const [radiusKm, setRadiusKm] = useState(25);
  const cmps = useAsync(() => governmentApi.comparison(radiusKm), [radiusKm]);
  const [deviceId, setDeviceId] = useState<string>('');
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
        subtitle="Each VayuVata device against the nearest CPCB / state monitoring station (data.gov.in). Shows your assigned devices."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Gov Comparison' }]}
        actions={role === 'SuperAdmin' ? <Button variant="contained" startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <Sync />} onClick={sync} disabled={syncing}>Sync now</Button> : undefined}
      />
      {syncMsg && <Alert severity={syncMsg.ok ? 'success' : 'error'} sx={{ mb: 2 }} onClose={() => setSyncMsg(null)}>{syncMsg.text}</Alert>}
      {st && (
        <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
          <Chip size="small" label={`${st.stationCount} stations`} />
          <Chip size="small" label={`${st.mappedDevices} device(s) matched`} />
          <Chip size="small" color={st.lastSyncStatus === 'ok' ? 'success' : 'warning'} label={`Last sync: ${st.lastSyncStatus ?? 'never'}${st.lastSyncAt ? ` · ${new Date(st.lastSyncAt).toLocaleString()}` : ''}`} />
          <Chip size="small" label={`Newest official reading (IST): ${st.latestObservedAt ? fmtWallClock(st.latestObservedAt) : NOT_AVAILABLE}`} />
          {role === 'SuperAdmin' && !st.apiKeyConfigured && <Chip size="small" color="error" label="API key not configured" />}
        </Stack>
      )}
      {cmps.error ? <ErrorState error={cmps.error} onRetry={cmps.reload} /> : cmps.loading && !cmps.data ? <CircularProgress aria-label="Loading" /> : (
        <Stack spacing={2}>
          <Stack direction="row" flexWrap="wrap" gap={2} alignItems="center">
          {list.length > 1 && (
            <Select size="small" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} sx={{ maxWidth: 320 }} inputProps={{ 'aria-label': 'Device' }}>
              {list.map((c) => <MenuItem key={c.device.deviceId} value={c.device.deviceId}>{c.device.deviceId}{c.status === 'no_location' ? ' (no location yet)' : ''}</MenuItem>)}
            </Select>
          )}
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="body2" color="text.secondary" id="radius-label">Search radius</Typography>
            <Select size="small" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} sx={{ minWidth: 110 }} inputProps={{ 'aria-label': 'Search radius' }}>
              {RADIUS_OPTIONS.map((r) => <MenuItem key={r} value={r}>{r} km</MenuItem>)}
            </Select>
          </Stack>
          </Stack>
          {cmp && (
            <>
              <Alert severity={cmp.status === 'ok' ? 'success' : cmp.status === 'stale' ? 'warning' : 'info'}>
                {cmp.statusMessage}
                {cmp.governmentAgeMinutes != null && ` Government observation is ${Math.round(cmp.governmentAgeMinutes)} min old.`}
              </Alert>
              {stale && <Alert severity="warning">The official data is older than 3 hours; do not treat it as live.</Alert>}
              <CompareTable cmp={cmp} />
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'start' }}>
                <Box>
                  <Typography fontWeight={800} sx={{ mb: 1, color: 'primary.main' }}>VayuVata (our device)</Typography>
                  <DevicePanel cmp={cmp} radiusKm={radiusKm} />
                </Box>
                <Box>
                  <Typography fontWeight={800} sx={{ mb: 1, color: '#1D4ED8' }}>Government (CPCB station)</Typography>
                  <GovernmentPanel cmp={cmp} radiusKm={radiusKm} />
                </Box>
              </Box>
              <Card sx={{ p: 2 }}>
                <Typography fontWeight={700} sx={{ mb: 1 }}>Other government stations within the {radiusKm} km radius</Typography>
                {cmp.nearbyStations.filter((n) => n.id !== cmp.government.station?.id).length > 0
                  ? <NearbyTable list={cmp.nearbyStations.filter((n) => n.id !== cmp.government.station?.id)} />
                  : <Typography variant="body2" color="text.secondary">No other station within this radius. Choose a larger radius.</Typography>}
              </Card>
            </>
          )}
          {list.length === 0 && <Alert severity="info">No active devices.</Alert>}
        </Stack>
      )}
    </>
  );
}
