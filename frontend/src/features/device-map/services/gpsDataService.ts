import axios from 'axios';
import { http } from '../../../api/client';
import type { CurrentGps, GpsLocationDto } from '../types';
import type { PagedResult } from '../../../types/api';
import { clean } from '../../../api/client';

export interface GpsHistoryQuery { deviceId?: string; from?: string; to?: string; fixOnly?: boolean; sortDir?: 'asc' | 'desc'; page?: number; pageSize?: number }
import { toReport } from '../utils/locations';

/**
 * GPS reads. POST /gps-data (device upload with X-Device-Key) is intentionally NOT here: the admin panel never sends device keys.
 * Both reads are public on the backend, so callers must still restrict what they show to the caller's authorised devices.
 */
export const gpsDataService = {
  /** Position history of the caller's own devices (login required, scoped and paged by the backend). */
  history: (q: GpsHistoryQuery) => http.get<PagedResult<GpsLocationDto>>('/gps-data/history', { params: clean(q) }).then((r) => r.data),

  /** Newest 5,000 reports, newest first, all devices. */
  list: (signal?: AbortSignal) => http.get<GpsLocationDto[]>('/gps-data', { signal }).then((r) => r.data),

  /** Latest report of one device (query parameter `deviceId`, per the backend contract). 404 and 409 are expected outcomes, not failures. */
  async current(deviceId: string, signal?: AbortSignal): Promise<CurrentGps> {
    try {
      const { data } = await http.get<GpsLocationDto>('/gps-data/current', { params: { deviceId }, signal });
      const report = toReport(data);
      return report ? { kind: 'ok', report } : { kind: 'none' };
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) return { kind: 'none' };
      if (axios.isAxiosError(e) && e.response?.status === 409) return { kind: 'inactive' };
      throw e;
    }
  },
};
