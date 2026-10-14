import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { devicesApi } from '../../../api/services';
import type { DeviceDto } from '../../../types/api';
import { GPS_REFRESH_SECONDS, GPS_STALE_MINUTES } from '../config';
import { gpsDataService } from '../services/gpsDataService';
import type { CurrentGps, DeviceLocation, GpsDiagnostics, GpsLocationDto, LocationSummary } from '../types';
import { buildLocations, summarize } from '../utils/locations';

const PAGE_SIZE = 100;
const MAX_PAGES = 5; // up to 500 authorised devices

async function fetchAuthorisedDevices(): Promise<{ devices: DeviceDto[]; truncated: boolean }> {
  const devices: DeviceDto[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await devicesApi.list({ page, pageSize: PAGE_SIZE, includeTotal: false });
    devices.push(...res.items);
    if (!res.hasNextPage) return { devices, truncated: false };
  }
  return { devices, truncated: true };
}

export interface DeviceLocationsState {
  devices: DeviceDto[] | null;
  deviceError: unknown;
  gpsError: unknown;
  locations: DeviceLocation[];
  diagnostics: GpsDiagnostics | null;
  summary: LocationSummary;
  gpsRowCount: number | null;
  devicesTruncated: boolean;
  loading: boolean;
  refreshing: boolean;
  /** time of the last SUCCESSFUL GPS read (epoch ms) */
  lastOk: number | null;
  refresh: () => Promise<void>;
  loadCurrent: (deviceId: string) => Promise<CurrentGps>;
}

/**
 * Loads the caller's authorised devices and the GPS history, and keeps them fresh.
 *  - one request cycle at a time (no overlap); the poll skips while the tab is hidden and catches up when it becomes visible
 *  - a failed refresh keeps the last good data and exposes the error separately (an API failure is never shown as "no devices")
 *  - the interval comes from config (default 60 s, floor 30 s) because the Pi reports about once a minute
 */
export function useDeviceLocations(): DeviceLocationsState {
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [devicesTruncated, setDevicesTruncated] = useState(false);
  const [deviceError, setDeviceError] = useState<unknown>(null);
  const [rows, setRows] = useState<GpsLocationDto[] | null>(null);
  const [gpsError, setGpsError] = useState<unknown>(null);
  const [extra, setExtra] = useState<GpsLocationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const seq = useRef(0);
  const inflight = useRef(false);
  const lastRun = useRef(0);
  const alive = useRef(true);

  const load = useCallback(async (force: boolean) => {
    if (inflight.current && !force) return;
    const token = ++seq.current;
    inflight.current = true;
    lastRun.current = Date.now();
    setRefreshing(true);
    const [d, g] = await Promise.allSettled([fetchAuthorisedDevices(), gpsDataService.list()]);
    if (!alive.current || token !== seq.current) return; // superseded or unmounted: ignore the obsolete response
    if (d.status === 'fulfilled') { setDevices(d.value.devices); setDevicesTruncated(d.value.truncated); setDeviceError(null); }
    else if (!(axios.isAxiosError(d.reason) && axios.isCancel(d.reason))) setDeviceError(d.reason);
    if (g.status === 'fulfilled') { setRows(g.value); setGpsError(null); setExtra([]); setLastOk(Date.now()); }
    else setGpsError(g.reason);
    inflight.current = false;
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    void load(false);
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (!document.hidden) await load(false);
        schedule();
      }, GPS_REFRESH_SECONDS * 1000);
    };
    schedule();
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastRun.current >= GPS_REFRESH_SECONDS * 1000) void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000); // re-evaluate "stale" between polls
    return () => {
      alive.current = false;
      inflight.current = false;
      clearTimeout(timer);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  /** Latest report of one device via GET /gps-data/current; a usable report is merged into the shown data. */
  const loadCurrent = useCallback(async (deviceId: string): Promise<CurrentGps> => {
    const res = await gpsDataService.current(deviceId);
    if (res.kind === 'ok' && alive.current) setExtra((prev) => [...prev.filter((r) => r.id !== res.report.id), res.report]);
    return res;
  }, []);

  const built = useMemo(
    () => (devices ? buildLocations([...(rows ?? []), ...extra], devices, { now, staleMs: GPS_STALE_MINUTES * 60_000 }) : null),
    [devices, rows, extra, now],
  );
  const locations = built?.locations ?? [];

  return {
    devices, deviceError, gpsError, locations, diagnostics: built?.diagnostics ?? null, summary: summarize(locations),
    gpsRowCount: rows ? rows.length : null, devicesTruncated, loading, refreshing, lastOk, refresh, loadCurrent,
  };
}
