import { useCallback, useMemo, useState } from 'react';
import { Alert, Accordion, AccordionDetails, AccordionSummary, Box, Button, Card, CircularProgress, Collapse, LinearProgress, Stack, Typography } from '@mui/material';
import Refresh from '@mui/icons-material/Refresh';
import FitScreen from '@mui/icons-material/FitScreen';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ListAlt from '@mui/icons-material/ListAlt';
import SensorsOutlined from '@mui/icons-material/SensorsOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import LocationOffOutlined from '@mui/icons-material/LocationOffOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import type { DeviceDto } from '../../../types/api';
import { PageHeader } from '../../../components/ui';
import { ErrorState } from '../../../components/feedback';
import { tokens } from '../../../theme/theme';
import { toAppError } from '../../../utils/errors';
import { useAuth } from '../../auth/AuthContext';
import { OpCard } from '../../dashboard/widgets';
import { useLatest } from '../../sensor-data/useLatest';
import { GPS_REFRESH_SECONDS, GPS_STALE_MINUTES } from '../config';
import { DeviceListPanel } from '../components/DeviceListPanel';
import { DeviceLocationPopup } from '../components/DeviceLocationPopup';
import { DeviceMap } from '../components/DeviceMap';
import { GpsDetailsDialog } from '../components/GpsDetailsDialog';
import { useDeviceLocations } from '../hooks/useDeviceLocations';
import type { DeviceLocation } from '../types';

const REASONS: Record<string, string> = {
  bad_timestamp: 'unreadable time', missing_coordinates: 'missing coordinates', out_of_range: 'coordinates out of range', null_island: 'zero coordinates (0, 0)',
};

export default function LiveDeviceMapPage() {
  const { role } = useAuth();
  const d = useDeviceLocations();
  const latest = useLatest(d.devices ?? [], !!d.devices);
  const readingByDeviceId = useMemo(() => new Map(latest.items.map((i) => [i.device.deviceId, i.latest])), [latest.items]);
  const readingFor = useCallback((l: DeviceLocation) => readingByDeviceId.get(l.device.deviceId), [readingByDeviceId]);

  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; token: number } | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [details, setDetails] = useState<DeviceDto | null>(null);
  const [listOpen, setListOpen] = useState(true);

  const showAssignment = role === 'SuperAdmin' || role === 'Admin';
  const markers = useMemo(() => d.locations.filter((l) => l.position), [d.locations]);

  /** From the list: centre on the device and open its popup. */
  const pickFromList = useCallback((id: string) => {
    setSelected(id);
    setFocus((f) => ({ id, token: (f?.token ?? 0) + 1 }));
    void d.loadCurrent(id).catch(() => undefined); // refresh this device individually; failures are shown in the details dialog
  }, [d]);
  /** From the map: the popup opens by itself, the camera stays where the user put it. */
  const pickFromMap = useCallback((id: string) => {
    setSelected(id);
    void d.loadCurrent(id).catch(() => undefined);
  }, [d]);

  const refreshAll = () => { void d.refresh(); latest.reload(); };

  /* ---- what to tell the user when there is nothing to draw ---- */
  const noMarkerNotice = ((): { severity: 'info' | 'warning'; title: string; text: string } | null => {
    if (d.loading || d.deviceError || !d.devices || markers.length > 0) return null;
    if (d.devices.length === 0) return { severity: 'info', title: 'No devices available', text: role === 'User' ? 'No devices are assigned to you yet.' : 'There are no devices in your scope yet.' };
    if (d.gpsError && d.gpsRowCount === null) return null; // handled by the GPS-unavailable alert
    if (d.gpsRowCount === 0) return { severity: 'info', title: 'No GPS reports yet', text: 'The GPS service has not received any position reports.' };
    const matched = d.diagnostics ? d.diagnostics.totalRows - d.diagnostics.outOfScopeRows : 0;
    if (matched === 0 && d.diagnostics && d.diagnostics.outOfScopeRows > 0)
      return { severity: 'warning', title: 'GPS reports are outside your permitted scope', text: 'GPS reports exist, but none belong to devices you are permitted to see.' };
    return { severity: 'info', title: 'No GPS positions for your devices', text: 'Your devices are available but none has a usable GPS position yet.' };
  })();

  const dg = d.diagnostics;
  const stamp = d.lastOk ? new Date(d.lastOk).toLocaleTimeString('en-GB', { hour12: false }) : null;

  return (
    <>
      <PageHeader
        title="Live Device Map" subtitle="Monitor device locations and latest GPS reports"
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Live Device Map' }]}
        actions={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontSize: 12, color: tokens.muted }} aria-live="polite">
              {stamp ? `Last refreshed ${stamp}` : d.loading ? 'Loading…' : 'Not refreshed yet'} · auto every {GPS_REFRESH_SECONDS}s
            </Typography>
            <Button variant="outlined" startIcon={d.refreshing ? <CircularProgress size={14} /> : <Refresh />} onClick={refreshAll} disabled={d.refreshing}>Refresh</Button>
            <Button variant="contained" startIcon={<FitScreen />} onClick={() => setFitToken((t) => t + 1)} disabled={markers.length === 0} sx={{ bgcolor: tokens.forest, '&:hover': { bgcolor: '#14532d' } }}>Fit all markers</Button>
          </Stack>
        }
      />

      {d.refreshing && !d.loading && <LinearProgress sx={{ mb: 1, height: 2 }} />}
      {d.deviceError ? (
        <Card sx={{ mb: 2 }}><ErrorState error={d.deviceError} onRetry={refreshAll} /></Card>
      ) : (
        <>
          {!!d.gpsError && (
            <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={refreshAll}>Retry</Button>}>
              <b>GPS service unavailable.</b> {toAppError(d.gpsError).message}{d.lastOk ? ' Showing the last successful reading.' : ''}
            </Alert>
          )}
          {d.devicesTruncated && <Alert severity="info" sx={{ mb: 2 }}>Showing the first 500 devices in your scope.</Alert>}

          {/* summary: counts come from the data above, nothing is invented */}
          <Box sx={{ display: 'grid', gap: 2, mb: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } }}>
            <OpCard label="Visible devices" icon={SensorsOutlined} loading={d.loading} value={d.summary.total} sub="in your scope" />
            <OpCard label="With GPS position" icon={PlaceOutlined} loading={d.loading} value={d.summary.withPosition} sub={`${d.summary.total ? Math.round((d.summary.withPosition / d.summary.total) * 100) : 0}% of devices`} />
            <OpCard label="Without GPS data" icon={LocationOffOutlined} loading={d.loading} value={d.summary.withoutGps} sub="never reported or no fix" />
            <OpCard label="Stale positions" icon={ScheduleOutlined} loading={d.loading} value={d.summary.stale} sub={`older than ${GPS_STALE_MINUTES} min`} />
          </Box>

          <Button startIcon={<ListAlt />} size="small" onClick={() => setListOpen((o) => !o)} sx={{ display: { xs: 'inline-flex', lg: 'none' }, mb: 1, color: tokens.forest }}>
            {listOpen ? 'Hide device list' : `Show device list (${d.locations.length})`}
          </Button>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: '360px minmax(0, 1fr)' }, alignItems: 'stretch' }}>
            <Box sx={{ display: { xs: 'block', lg: 'block' } }}>
              <Collapse in={listOpen} unmountOnExit={false} sx={{ '@media (min-width: 1200px)': { height: 'auto !important', visibility: 'visible !important' } }}>
                <DeviceListPanel
                  locations={d.locations} selectedId={selected} onSelect={pickFromList} readingFor={readingFor}
                  showAssignment={showAssignment} loading={d.loading} maxHeight={{ xs: 340, lg: 'calc(100dvh - 380px)' } as unknown as number}
                />
              </Collapse>
            </Box>

            <Card sx={{ position: 'relative', p: 0.75, height: { xs: 420, md: 520, lg: 'calc(100dvh - 380px)' }, minHeight: { lg: 520 } }}>
              <DeviceMap locations={d.locations} selectedId={selected} focus={focus} fitToken={fitToken} onSelect={pickFromMap}
                renderPopup={(loc) => <DeviceLocationPopup loc={loc} reading={readingFor(loc)} showAssignment={showAssignment} onDetails={() => setDetails(loc.device)} />} />
              {d.loading && <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, zIndex: 700, bgcolor: 'rgba(255,255,255,.6)' }}><CircularProgress aria-label="Loading device locations" /></Stack>}
              {noMarkerNotice && (
                <Box sx={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 700, width: 'min(92%, 440px)' }}>
                  <Alert severity={noMarkerNotice.severity} variant="filled" sx={{ boxShadow: 3 }}>
                    <b>{noMarkerNotice.title}.</b> {noMarkerNotice.text}
                  </Alert>
                </Box>
              )}
            </Card>
          </Box>

          <Accordion disableGutters elevation={0} sx={{ mt: 2, border: `1px solid ${tokens.cardBorder}`, borderRadius: '12px !important', '&:before': { display: 'none' }, background: tokens.cardBg }}>
            <AccordionSummary expandIcon={<ExpandMore />}><Typography sx={{ fontSize: 13, fontWeight: 700 }}>Data notes</Typography></AccordionSummary>
            <AccordionDetails>
              <Stack spacing={0.75}>
                <Typography sx={{ fontSize: 12.5 }}>
                  {dg ? `${dg.totalRows} GPS rows read · ${dg.invalidRows.length} invalid (ignored) · ${dg.noFixRows} no-fix reports · ${dg.outOfScopeRows} from devices outside your permitted scope (not shown)` : 'No GPS data loaded yet.'}
                </Typography>
                {dg && dg.invalidRows.length > 0 && (
                  <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: 12, color: tokens.muted }}>
                    {dg.invalidRows.slice(0, 10).map((r) => <li key={r.id}>Report #{r.id} ({r.deviceId}): {REASONS[r.reason]}</li>)}
                    {dg.invalidRows.length > 10 && <li>…and {dg.invalidRows.length - 10} more</li>}
                  </Box>
                )}
                <Typography sx={{ fontSize: 11.5, color: tokens.muted }}>
                  Markers show each device’s latest report by GPS time. The GPS read endpoints are public on the server, so this page restricts what it shows to the devices you are authorised to see; this is a presentation safeguard, not server-enforced privacy.
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: tokens.muted }}>Map data © OpenStreetMap contributors.</Typography>
              </Stack>
            </AccordionDetails>
          </Accordion>
        </>
      )}

      <GpsDetailsDialog device={details} load={d.loadCurrent} onClose={() => setDetails(null)} />
    </>
  );
}
