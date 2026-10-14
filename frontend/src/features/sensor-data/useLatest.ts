import { sensorApi } from '../../api/services';
import type { DeviceDto, SensorDataDto } from '../../types/api';
import { useAsync } from '../../utils/useAsync';

export const MAX_LATEST_DEVICES = 24;

export interface DeviceLatest { device: DeviceDto; latest: SensorDataDto | null }

/** Latest reading for each device (bounded). `latest` is null when the device has never reported. */
export function useLatest(devices: DeviceDto[], enabled = true) {
  const ids = devices.slice(0, MAX_LATEST_DEVICES).map((d) => d.id).join(',');
  const s = useAsync<DeviceLatest[]>(
    () => Promise.all(devices.slice(0, MAX_LATEST_DEVICES).map(async (device) => ({ device, latest: await sensorApi.latest(device.id) }))),
    [ids], enabled && devices.length > 0,
  );
  return { ...s, items: s.data ?? [], capped: devices.length > MAX_LATEST_DEVICES };
}
