import { useEffect } from 'react';
import { Alert, Box, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { devicesApi } from '../../api/services';
import type { DeviceHealth } from '../../types/api';
import { useAsync } from '../../utils/useAsync';

const REFRESH_MS = 60_000;

/** Health of the signed-in user's devices (last hour of readings). Refreshes every minute; a failed refresh keeps the last result. */
export function useDeviceHealth() {
  const s = useAsync(() => devicesApi.health(), []);
  const reload = s.reload;
  useEffect(() => { const t = setInterval(reload, REFRESH_MS); return () => clearInterval(t); }, [reload]);
  const items: DeviceHealth[] = s.data ?? [];
  return { ...s, items, byDevice: new Map(items.map((h) => [h.deviceId, h])), problems: items.filter((h) => h.status !== 'ok') };
}

const SEVERITY = { failing: 'error', warning: 'warning', offline: 'warning', ok: 'success' } as const;
const TITLE = { failing: 'Outer sensor failing', warning: 'Outer sensor unreliable', offline: 'Device offline', ok: 'OK' } as const;

/** One alert per device that needs attention (nothing is rendered when all devices are healthy). */
export function DeviceHealthAlerts({ problems }: { problems: DeviceHealth[] }) {
  if (problems.length === 0) return null;
  return (
    <Stack spacing={1} sx={{ mb: 2 }} aria-label="Device health warnings">
      {problems.map((h) => (
        <Alert key={h.deviceId} severity={SEVERITY[h.status]}>
          <Typography component="span" fontWeight={700}>{TITLE[h.status]} · </Typography>
          <Link component={RouterLink} to={`/devices/${h.id}`} underline="hover" fontWeight={700}>{h.deviceName || h.deviceId}</Link>
          <Box component="span"> — {h.message}</Box>
        </Alert>
      ))}
    </Stack>
  );
}
