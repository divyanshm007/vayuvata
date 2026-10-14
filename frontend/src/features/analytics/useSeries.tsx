import { useState } from 'react';
import { Stack, TextField, ToggleButton, ToggleButtonGroup, MenuItem } from '@mui/material';
import { sensorApi } from '../../api/services';
import type { DeviceDto, SensorDataDto } from '../../types/api';
import { toApiDateTime } from '../../utils/format';
import { useAsync } from '../../utils/useAsync';

export const MAX_POINTS_PER_PAGE = 100;
export const MAX_PAGES = 3; // never pull unbounded history into the browser

/** Device wall-clock "now" (IST = UTC+5:30) as a datetime-local string, shifted by `hours`. */
export function istLocalInput(hours = 0): string {
  const d = new Date(Date.now() + 330 * 60_000 + hours * 3_600_000);
  return d.toISOString().slice(0, 16);
}

export type RangeKey = '24h' | '7d' | '30d' | 'custom';
export interface Range { key: RangeKey; from: string; to: string }

export function presetRange(key: Exclude<RangeKey, 'custom'>): Range {
  const h = key === '24h' ? -24 : key === '7d' ? -168 : -720;
  return { key, from: istLocalInput(h), to: '' };
}

export function RangePicker({ value, onChange, disabled }: { value: Range; onChange: (r: Range) => void; disabled?: boolean }) {
  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
      <ToggleButtonGroup size="small" exclusive disabled={disabled} value={value.key} aria-label="Date range"
        onChange={(_, k: RangeKey | null) => { if (!k) return; onChange(k === 'custom' ? { key: 'custom', from: value.from || istLocalInput(-24), to: value.to } : presetRange(k)); }}>
        <ToggleButton value="24h">24 h</ToggleButton><ToggleButton value="7d">7 days</ToggleButton>
        <ToggleButton value="30d">30 days</ToggleButton><ToggleButton value="custom">Custom</ToggleButton>
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

export interface SeriesResult { rows: SensorDataDto[]; truncated: boolean }

/** Latest readings in the range (bounded to MAX_PAGES pages), via the scoped GET /sensor-data endpoint. */
export async function fetchSeries(deviceId: string | undefined, range: Range): Promise<SeriesResult> {
  const rows: SensorDataDto[] = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await sensorApi.list({
      deviceId: deviceId || undefined, from: toApiDateTime(range.from), to: toApiDateTime(range.to),
      sortBy: 'recordedAt', sortDir: 'desc', page, pageSize: MAX_POINTS_PER_PAGE, includeTotal: false,
    });
    rows.push(...res.items);
    if (!res.hasNextPage) break;
    if (page === MAX_PAGES) truncated = true;
  }
  return { rows, truncated };
}

export function useSeries(deviceId: string | undefined, range: Range, enabled = true) {
  const key = `${deviceId ?? ''}|${range.from}|${range.to}`;
  const state = useAsync(() => fetchSeries(deviceId, range), [key], enabled);
  return state;
}

export function useRange(initial: Exclude<RangeKey, 'custom'> = '7d') {
  return useState<Range>(() => presetRange(initial));
}
