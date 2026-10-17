import { useState } from 'react';
import { Stack, TextField, ToggleButton, ToggleButtonGroup, MenuItem } from '@mui/material';
import { sensorApi } from '../../api/services';
import type { DeviceDto, SensorDataDto } from '../../types/api';
import { toApiDateTime, toApiDateTimeEnd } from '../../utils/format';
import { useAsync } from '../../utils/useAsync';

export const MAX_POINTS_PER_PAGE = 100;
export const MAX_PAGES = 3; // never pull unbounded history into the browser

/** Device wall-clock "now" (IST = UTC+5:30) as a datetime-local string, shifted by `hours`. */
export function istLocalInput(hours = 0): string {
  const d = new Date(Date.now() + 330 * 60_000 + hours * 3_600_000);
  return d.toISOString().slice(0, 16);
}

export type RangeKey = '24h' | '5d' | '7d' | '15d' | '30d' | '3m' | '6m' | 'all' | 'custom';
export interface Range { key: RangeKey; from: string; to: string }

/** Hours back from now (device wall-clock, IST) for each preset. 'all' has no lower bound. */
const PRESET_HOURS: Record<Exclude<RangeKey, 'custom' | 'all'>, number> = {
  '24h': 24, '5d': 5 * 24, '7d': 7 * 24, '15d': 15 * 24, '30d': 30 * 24, '3m': 90 * 24, '6m': 180 * 24,
};
export const PRESET_LABELS: Record<RangeKey, string> = {
  '24h': '24 hours', '5d': '5 days', '7d': '7 days', '15d': '15 days', '30d': '1 month', '3m': '3 months', '6m': '6 months', all: 'All data', custom: 'Custom',
};
/** The compact set the charts use (unchanged). */
export const CHART_PRESETS: RangeKey[] = ['24h', '7d', '30d', 'custom'];
/** The full set for the history pages. */
export const HISTORY_PRESETS: RangeKey[] = ['24h', '5d', '15d', '30d', '3m', '6m', 'all', 'custom'];

export function presetRange(key: Exclude<RangeKey, 'custom'>): Range {
  return key === 'all' ? { key, from: '', to: '' } : { key, from: istLocalInput(-PRESET_HOURS[key]), to: '' };
}

export function RangePicker({ value, onChange, disabled, presets = CHART_PRESETS }: { value: Range; onChange: (r: Range) => void; disabled?: boolean; presets?: RangeKey[] }) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} flexWrap="wrap">
      <ToggleButtonGroup size="small" exclusive disabled={disabled} value={value.key} aria-label="Date range" sx={{ flexWrap: 'wrap' }}
        onChange={(_, k: RangeKey | null) => { if (!k) return; onChange(k === 'custom' ? { key: 'custom', from: value.from || istLocalInput(-24), to: value.to } : presetRange(k)); }}>
        {presets.map((k) => <ToggleButton key={k} value={k}>{PRESET_LABELS[k]}</ToggleButton>)}
      </ToggleButtonGroup>
      {value.key === 'custom' && (
        <>
          <TextField type="datetime-local" label="From" disabled={disabled} InputLabelProps={{ shrink: true }} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} sx={{ maxWidth: 220 }} />
          <TextField type="datetime-local" label="To" disabled={disabled} InputLabelProps={{ shrink: true }} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} sx={{ maxWidth: 220 }} />
        </>
      )}
    </Stack>
  );
}

export function DeviceSelect({ devices, value, onChange, label = 'Device', allowAll = false, disabled }: {
  devices: DeviceDto[]; value: string; onChange: (v: string) => void; label?: string; allowAll?: boolean; disabled?: boolean;
}) {
  return (
    <TextField select label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 220, maxWidth: 320 }}>
      {allowAll && <MenuItem value="">All devices</MenuItem>}
      {devices.map((d) => <MenuItem key={d.id} value={d.deviceId}>{d.deviceName} ({d.deviceId})</MenuItem>)}
    </TextField>
  );
}

/** rows: the chart points, oldest first. bucketMinutes > 1 means each point is the average of that many minutes. */
export interface SeriesResult { rows: SensorDataDto[]; truncated: boolean; bucketMinutes: number; totalReadings: number }

/** Latest readings in the range (bounded to MAX_PAGES pages), via the scoped GET /sensor-data endpoint. */
export async function fetchSeries(deviceId: string | undefined, range: Range): Promise<SeriesResult> {
  if (deviceId) {
    // The backend averages the readings into time buckets, so the points always span the WHOLE selected range.
    const r = await sensorApi.series({ deviceId, from: toApiDateTime(range.from), to: toApiDateTimeEnd(range.to), points: 300 });
    return { rows: r.points, truncated: false, bucketMinutes: r.bucketMinutes, totalReadings: r.totalReadings };
  }
  const rows: SensorDataDto[] = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await sensorApi.list({
      deviceId: deviceId || undefined, from: toApiDateTime(range.from), to: toApiDateTimeEnd(range.to),
      sortBy: 'recordedAt', sortDir: 'desc', page, pageSize: MAX_POINTS_PER_PAGE, includeTotal: false,
    });
    rows.push(...res.items);
    if (!res.hasNextPage) break;
    if (page === MAX_PAGES) truncated = true;
  }
  return { rows, truncated, bucketMinutes: 1, totalReadings: rows.length };
}

export function useSeries(deviceId: string | undefined, range: Range, enabled = true) {
  const key = `${deviceId ?? ''}|${range.from}|${range.to}`;
  const state = useAsync(() => fetchSeries(deviceId, range), [key], enabled);
  return state;
}

export function useRange(initial: Exclude<RangeKey, 'custom'> = '7d') {
  return useState<Range>(() => presetRange(initial));
}
