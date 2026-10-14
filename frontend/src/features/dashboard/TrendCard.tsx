import { Alert, Box, Card, LinearProgress, Stack, Typography } from '@mui/material';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';
import type { DeviceDto, SensorDataDto } from '../../types/api';
import { ErrorState } from '../../components/feedback';
import { tokens } from '../../theme/theme';
import { toSeries } from '../analytics/charts';
import { InteractiveTrendChart } from './InteractiveTrendChart';
import { DeviceSelect, RangePicker, type Range } from '../analytics/useSeries';
import { useMemo } from 'react';

interface Props {
  devices: DeviceDto[]; deviceId: string; onDevice: (id: string) => void; range: Range; onRange: (r: Range) => void;
  rows: SensorDataDto[] | null; truncated: boolean; loading: boolean; error: unknown; onRetry: () => void;
}

/** Chart section: the device and range controls are part of the card header, so they read as one unit with the chart. */
export function TrendCard({ devices, deviceId, onDevice, range, onRange, rows, truncated, loading, error, onRetry }: Props) {
  const data = useMemo(() => toSeries(rows ?? []), [rows]);
  const invalid = !!range.to && range.from > range.to;
  return (
    <Card sx={{ p: 0, overflow: 'hidden' }}>
      <Stack direction="row" flexWrap="wrap" useFlexGap justifyContent="space-between" alignItems="center" spacing={1.5} sx={{ p: 2.25, pb: 1.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 40, height: 40, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: tokens.mint, color: tokens.action }}><InsightsOutlined /></Box>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.2 }}>Air Quality Trends</Typography>
            <Typography sx={{ fontSize: 11.5, color: tokens.muted }}>Sensor readings over time for the selected device · device time (IST)</Typography>
          </Box>
        </Stack>
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.25} alignItems="center">
          <DeviceSelect devices={devices} value={deviceId} onChange={onDevice} label="Trend device" disabled={loading} />
          <RangePicker value={range} onChange={onRange} disabled={loading} />
        </Stack>
      </Stack>
      {loading ? <LinearProgress sx={{ height: 2 }} /> : <Box sx={{ height: 2 }} />}
      <Box sx={{ p: 2.25, pt: 1.5 }}>
        {invalid && <Alert severity="warning" sx={{ mb: 1.5 }}>“To” must be after “From”.</Alert>}
        {error ? <ErrorState error={error} onRetry={onRetry} /> : <InteractiveTrendChart data={data} truncated={truncated} />}
      </Box>
    </Card>
  );
}
