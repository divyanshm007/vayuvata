import type { DeviceDto } from '../../types/api';

/** Mirrors backend DTOs/Gps/GpsDtos.cs (GpsLocationDto). Times carry the +05:30 (IST) offset. */
export interface GpsLocationDto {
  id: number;
  deviceId: string;
  recordedAt: string;
  receivedAt: string;
  fix: boolean;
  source: 'gps' | 'cell' | string;
  lat: number | null;
  lon: number | null;
  altM: number | null;
  speedKmh: number | null;
  signalPct: number | null;
}

/** A report whose timestamp has been parsed once. recordedMs is the authoritative GPS time (epoch ms). */
export interface GpsReport extends GpsLocationDto { recordedMs: number }

export type GpsProblem = 'bad_timestamp' | 'missing_coordinates' | 'out_of_range' | 'null_island';

export interface InvalidRow { id: number; deviceId: string; reason: GpsProblem }

export interface GpsDiagnostics {
  totalRows: number;
  invalidRows: InvalidRow[];
  /** rows whose device is not in the caller's authorised device list (their ids are deliberately not kept) */
  outOfScopeRows: number;
  /** "no fix" reports (valid, but carry no position) */
  noFixRows: number;
}

export interface DeviceLocation {
  device: DeviceDto;
  /** newest valid report of any kind (position or no-fix), or null when the device never reported */
  latest: GpsReport | null;
  /** newest report that carries a valid position: the marker location, or null */
  position: GpsReport | null;
  /** position is older than the stale threshold */
  stale: boolean;
  /** milliseconds since the position was recorded */
  ageMs: number | null;
  /** a newer no-fix report exists, so the marker is the last KNOWN position */
  noFixNewer: boolean;
}

export interface LocationSummary { total: number; withPosition: number; withoutGps: number; stale: number }

export type CurrentGps =
  | { kind: 'ok'; report: GpsReport }
  | { kind: 'none' }        // 404: unknown device or no GPS data yet
  | { kind: 'inactive' };   // 409 device_inactive
