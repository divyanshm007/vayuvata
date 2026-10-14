import type { DeviceDto } from '../../../types/api';
import type { DeviceLocation, GpsDiagnostics, GpsLocationDto, GpsProblem, GpsReport, InvalidRow, LocationSummary } from '../types';

export type Classified =
  | { kind: 'position'; report: GpsReport }
  | { kind: 'nofix'; report: GpsReport }
  | { kind: 'invalid'; reason: GpsProblem };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validates one raw row. A report is only a "position" when it says fix=true AND carries finite, in-range coordinates.
 * Missing coordinates are never replaced by 0; (0, 0) is rejected as "null island" because it is what a zero-filled
 * missing value looks like. Reports with fix=false are valid "no fix" reports that simply carry no position.
 */
export function classify(dto: GpsLocationDto): Classified {
  const recordedMs = Date.parse(dto.recordedAt);
  if (!Number.isFinite(recordedMs)) return { kind: 'invalid', reason: 'bad_timestamp' };
  const report: GpsReport = { ...dto, recordedMs };
  if (dto.fix === false) return { kind: 'nofix', report: { ...report, lat: null, lon: null } };
  if (!finite(dto.lat) || !finite(dto.lon)) return { kind: 'invalid', reason: 'missing_coordinates' };
  if (dto.lat < -90 || dto.lat > 90 || dto.lon < -180 || dto.lon > 180) return { kind: 'invalid', reason: 'out_of_range' };
  if (dto.lat === 0 && dto.lon === 0) return { kind: 'invalid', reason: 'null_island' };
  return { kind: 'position', report };
}

/** Parsed report for a usable row (position or no-fix), else null. */
export function toReport(dto: GpsLocationDto): GpsReport | null {
  const c = classify(dto);
  return c.kind === 'invalid' ? null : c.report;
}

/**
 * Ordering of two reports of the same device: the GPS timestamp decides; identical timestamps fall back to the larger id
 * (the database identity, which grows with insertion). Returns > 0 when `a` is newer than `b`.
 */
export const compareReports = (a: GpsReport, b: GpsReport): number => a.recordedMs - b.recordedMs || a.id - b.id;

const key = (deviceId: string) => deviceId.trim().toLowerCase();

export interface BuildOptions { now: number; staleMs: number }

/**
 * Turns raw GPS history into exactly one entry per AUTHORISED device.
 *  - `devices` must be the caller's authorised device list (GET /devices is scoped by the backend); GPS rows for any other
 *    device are counted but never exposed, because the GPS endpoints themselves are public.
 *  - Rows are grouped by device id; the latest report is chosen by recordedAt (not by response order).
 *  - The marker position is the newest report that has a valid position; invalid rows are ignored and counted.
 */
export function buildLocations(rows: GpsLocationDto[], devices: DeviceDto[], opts: BuildOptions): { locations: DeviceLocation[]; diagnostics: GpsDiagnostics } {
  const byDevice = new Map<string, DeviceDto>();
  for (const d of devices) byDevice.set(key(d.deviceId), d);

  const latest = new Map<string, GpsReport>();
  const position = new Map<string, GpsReport>();
  const invalidRows: InvalidRow[] = [];
  let outOfScopeRows = 0;
  let noFixRows = 0;

  for (const dto of rows) {
    const k = key(dto.deviceId ?? '');
    if (!byDevice.has(k)) { outOfScopeRows++; continue; }
    const c = classify(dto);
    if (c.kind === 'invalid') { invalidRows.push({ id: dto.id, deviceId: dto.deviceId, reason: c.reason }); continue; }
    if (c.kind === 'nofix') noFixRows++;
    const l = latest.get(k);
    if (!l || compareReports(c.report, l) > 0) latest.set(k, c.report);
    if (c.kind === 'position') {
      const p = position.get(k);
      if (!p || compareReports(c.report, p) > 0) position.set(k, c.report);
    }
  }

  const locations: DeviceLocation[] = devices.map((device) => {
    const k = key(device.deviceId);
    const pos = position.get(k) ?? null;
    const lat = latest.get(k) ?? null;
    const ageMs = pos ? Math.max(0, opts.now - pos.recordedMs) : null;
    return {
      device, latest: lat, position: pos,
      stale: ageMs !== null && ageMs > opts.staleMs,
      ageMs,
      noFixNewer: !!pos && !!lat && lat.recordedMs > pos.recordedMs,
    };
  });

  return { locations, diagnostics: { totalRows: rows.length, invalidRows, outOfScopeRows, noFixRows } };
}

export function summarize(locations: DeviceLocation[]): LocationSummary {
  const withPosition = locations.filter((l) => l.position).length;
  return {
    total: locations.length,
    withPosition,
    withoutGps: locations.length - withPosition,
    stale: locations.filter((l) => l.stale).length,
  };
}

/* ---------- formatting ---------- */

/** GPS times are IST. The report carries its own +05:30 offset, so format in Asia/Kolkata explicitly. */
export function fmtGpsTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtAge(ms: number | null): string {
  if (ms === null) return '—';
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/** 5 decimals ≈ 1 m; the full value stays on the report. */
export const fmtCoord = (v: number | null | undefined): string => (typeof v === 'number' ? v.toFixed(5) : '—');
