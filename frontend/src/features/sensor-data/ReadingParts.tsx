import { Dialog, DialogContent, DialogTitle, Grid, IconButton, Stack, Typography, Box, Skeleton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { sensorApi } from '../../api/services';
import type { SensorDataDto } from '../../types/api';
import { AqiBadge } from '../../components/ui';
import { ErrorState } from '../../components/feedback';
import { fmtNum, fmtUtc, fmtWallClock } from '../../utils/format';
import { useAsync } from '../../utils/useAsync';

export const MEASURES: Array<{ key: keyof SensorDataDto; label: string; unit: string; digits?: number }> = [
  { key: 'pm25', label: 'PM2.5', unit: 'µg/m³' }, { key: 'pm10', label: 'PM10', unit: 'µg/m³' },
  { key: 'no2Ppm', label: 'NO₂', unit: 'ppm', digits: 3 }, { key: 'so2Ppm', label: 'SO₂', unit: 'ppm', digits: 3 },
  { key: 'coPpm', label: 'CO', unit: 'ppm', digits: 2 }, { key: 'tvocPpb', label: 'TVOC', unit: 'ppb', digits: 0 },
  { key: 'temperature', label: 'Temperature', unit: '°C' }, { key: 'humidity', label: 'Humidity', unit: '%' },
  { key: 'outerTemperature', label: 'Outer temperature', unit: '°C' }, { key: 'outerHumidity', label: 'Outer humidity', unit: '%' },
];

export function ReadingDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const s = useAsync(() => sensorApi.get(id!), [id], id !== null);
  const r = s.data;
  return (
    <Dialog open={id !== null} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Reading #{id}
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        {s.loading && <Skeleton variant="rounded" height={220} />}
        {!!s.error && <ErrorState error={s.error} onRetry={s.reload} />}
        {r && <ReadingDetail r={r} />}
      </DialogContent>
    </Dialog>
  );
}

export function ReadingDetail({ r }: { r: SensorDataDto }) {
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <AqiBadge aqi={r.aqi} status={r.aqiStatus} size="medium" />
        <Typography variant="body2" color="text.secondary">{r.deviceId} · {fmtWallClock(r.recordedAt, true)} (device time)</Typography>
      </Stack>
      <Grid container spacing={1.5}>
        {MEASURES.map((m) => (
          <Grid item xs={6} sm={4} key={m.key}>
            <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Typography variant="caption" color="text.secondary">{m.label}</Typography>
              <Typography fontWeight={700}>{fmtNum(r[m.key] as number | null, m.digits ?? 1)} <Typography component="span" variant="caption" color="text.secondary">{m.unit}</Typography></Typography>
            </Box>
          </Grid>
        ))}
      </Grid>
      <Typography variant="caption" color="text.secondary">Received by server {fmtUtc(r.createdAt)}</Typography>
    </Stack>
  );
}
