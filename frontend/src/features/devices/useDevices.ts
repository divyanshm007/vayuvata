import { devicesApi } from '../../api/services';
import type { DeviceDto } from '../../types/api';
import { useAsync } from '../../utils/useAsync';

/** Devices visible to the caller (the backend scopes the list). Bounded to one page of 100. */
export function useDevices(enabled = true) {
  const s = useAsync(() => devicesApi.list({ page: 1, pageSize: 100, includeTotal: true }), [], enabled);
  const devices: DeviceDto[] = s.data?.items ?? [];
  return { ...s, devices, total: s.data?.totalCount ?? devices.length, more: s.data?.hasNextPage ?? false };
}
