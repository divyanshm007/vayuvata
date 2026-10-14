import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import type { SensorDataDto } from '../../../types/api';
import { ActiveChip, AqiBadge } from '../../../components/ui';
import { tokens } from '../../../theme/theme';
import type { DeviceLocation } from '../types';
import { fmtAge, fmtCoord, fmtGpsTime } from '../utils/locations';

interface Props {
  loc: DeviceLocation;
  /** latest AQI reading from the authorised sensor API, when available */
  reading?: SensorDataDto | null;
  /** assignment is shown to SuperAdmin and Admin only */
  showAssignment: boolean;
  onDetails: () => void;
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <Stack direction="row" justifyContent="space-between" spacing={1.5} sx={{ py: 0.35 }}>
    <Typography sx={{ fontSize: 11.5, color: tokens.muted, flexShrink: 0 }}>{k}</Typography>
    <Typography component="div" sx={{ fontSize: 12, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{children}</Typography>
  </Stack>
);

/** Marker popup. Only shows what the data actually provides; actions use existing routes. */
export function DeviceLocationPopup({ loc, reading, showAssignment, onDetails }: Props) {
  const { device, position } = loc;
  if (!position) return null;
  return (
    <Box sx={{ minWidth: 224, color: tokens.text }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 0.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 14, lineHeight: 1.2 }} noWrap>{device.deviceName || device.deviceId}</Typography>
          <Typography sx={{ fontSize: 11.5, color: tokens.muted, fontFamily: 'ui-monospace, Consolas, monospace' }}>{device.deviceId}</Typography>
        </Box>
        <ActiveChip active={device.isActive} />
      </Stack>

      <Box sx={{ borderTop: `1px solid ${tokens.border}`, mt: 0.75, pt: 0.5 }}>
        <Row k="Latitude">{fmtCoord(position.lat)}</Row>
        <Row k="Longitude">{fmtCoord(position.lon)}</Row>
        <Row k="Last GPS report">{fmtGpsTime(position.recordedMs)} IST<Box component="span" sx={{ display: 'block', fontWeight: 500, color: tokens.muted }}>{fmtAge(loc.ageMs)}</Box></Row>
        {showAssignment && <Row k="Assigned to">{device.assignedUserName ?? 'Unassigned'}</Row>}
        {reading && reading.aqi !== null && <Row k="Latest AQI"><AqiBadge aqi={reading.aqi} status={reading.aqiStatus} /></Row>}
      </Box>

      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ my: 0.75 }}>
        {loc.stale && <Chip size="small" label="Stale position" sx={{ bgcolor: '#FEF3C7', color: '#92400E' }} />}
        {loc.noFixNewer && <Chip size="small" label="No fix since — last known position" sx={{ bgcolor: '#FEF3C7', color: '#92400E' }} />}
        {position.source === 'cell' && <Chip size="small" variant="outlined" label="Approximate (cell tower)" />}
      </Stack>

      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
        <Button size="small" variant="contained" component={RouterLink} to={`/devices/${device.id}`} sx={{ bgcolor: tokens.forest, color: '#fff !important', py: 0.25 }}>View Device</Button>
        <Button size="small" variant="outlined" component={RouterLink} to={`/readings?device=${encodeURIComponent(device.deviceId)}`} sx={{ py: 0.25 }}>View Sensor Readings</Button>
        <Button size="small" variant="text" onClick={onDetails} sx={{ py: 0.25 }}>View GPS Details</Button>
      </Stack>
    </Box>
  );
}
