import { http, clean, API_PREFIX } from './client';
import axios from 'axios';
import type {
  AdminUsersPage, AssignmentDto, CreateDeviceRequest, CreateManagedUserRequest, CreateUserRequest, DeviceDto, DeviceQuery,
  DeviceKeyHashDto, DeviceWithKeyDto, HealthResponse, HistoryQuery, LoginResponse, PageParams, PagedResult, Profile, SensorDataDto,
  SensorDataQuery, UpdateDeviceRequest, UpdateUserRequest, UserDto, UserQuery,
  GovDeviceComparison, GovStatus, GovSyncResult, SensorSeriesResult, DeviceHealth,
  ShellyDevice, ShellyStatus, ShellyCommand, CreateShellyRequest, UpdateShellyRequest,
} from '../types/api';

const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const authApi = {
  login: (email: string, password: string) => data(axios.post<LoginResponse>(`${API_PREFIX}/auth/login`, { email, password })),
  logout: (refreshToken: string) => http.post('/auth/logout', { refreshToken }).then(() => undefined),
  me: () => data(http.get<Profile>('/auth/me')),
  changePassword: (currentPassword: string, newPassword: string) =>
    data(http.post<LoginResponse>('/auth/change-password', { currentPassword, newPassword })),
};

export const usersApi = {
  list: (q: UserQuery) => data(http.get<PagedResult<UserDto>>('/users', { params: clean(q) })),
  standalone: (q: PageParams & { search?: string; isActive?: boolean }) =>
    data(http.get<PagedResult<UserDto>>('/superadmin/users', { params: clean(q) })),
  byAdmin: (adminId: number, q: PageParams & { search?: string; isActive?: boolean }) =>
    data(http.get<AdminUsersPage>(`/admins/${adminId}/users`, { params: clean(q) })),
  get: (id: number) => data(http.get<UserDto>(`/users/${id}`)),
  create: (b: CreateUserRequest) => data(http.post<UserDto>('/users', b)),
  createUnderAdmin: (adminId: number, b: CreateManagedUserRequest) => data(http.post<UserDto>(`/admins/${adminId}/users`, b)),
  update: (id: number, b: UpdateUserRequest) => data(http.put<UserDto>(`/users/${id}`, b)),
  setStatus: (id: number, isActive: boolean) => data(http.patch<UserDto>(`/users/${id}/status`, { isActive })),
  setManager: (id: number, managerId: number) => data(http.patch<UserDto>(`/users/${id}/admin-assignment`, { managerId })),
  resetPassword: (id: number, newPassword: string) => http.post(`/users/${id}/reset-password`, { newPassword }).then(() => undefined),
  devices: (id: number, q: PageParams = {}) => data(http.get<PagedResult<DeviceDto>>(`/users/${id}/devices`, { params: clean(q) })),
};

export const devicesApi = {
  /** Health of the caller's devices from their last hour of readings (offline, or the outer RS485 sensor missing). */
  health: () => data(http.get<DeviceHealth[]>('/devices/health')),
  list: (q: DeviceQuery) => data(http.get<PagedResult<DeviceDto>>('/devices', { params: clean(q) })),
  get: (id: number) => data(http.get<DeviceDto>(`/devices/${id}`)),
  create: (b: CreateDeviceRequest) => data(http.post<DeviceWithKeyDto>('/devices', b)),
  update: (id: number, b: UpdateDeviceRequest) => data(http.put<DeviceDto>(`/devices/${id}`, b)),
  setStatus: (id: number, isActive: boolean) => data(http.patch<DeviceDto>(`/devices/${id}/status`, { isActive })),
  keyHash: (id: number) => data(http.get<DeviceKeyHashDto>(`/devices/${id}/key-hash`)),
  rotateKey: (id: number) => data(http.post<DeviceWithKeyDto>(`/devices/${id}/rotate-key`)),
  assign: (id: number, userId: number, notes?: string) => data(http.post<DeviceDto>(`/devices/${id}/assign`, { userId, notes: notes || null })),
  unassign: (id: number, notes?: string) => data(http.post<DeviceDto>(`/devices/${id}/unassign`, { notes: notes || null })),
  assignments: (id: number, q: PageParams = {}) => data(http.get<PagedResult<AssignmentDto>>(`/devices/${id}/assignments`, { params: clean(q) })),
};

export const shellyApi = {
  list: () => data(http.get<ShellyDevice[]>('/shelly-devices')),
  create: (b: CreateShellyRequest) => data(http.post<ShellyDevice>('/shelly-devices', b)),
  update: (id: number, b: UpdateShellyRequest) => data(http.put<ShellyDevice>(`/shelly-devices/${id}`, b)),
  /** SuperAdmin only. Removes the switch and its command history for good. */
  remove: (id: number) => http.delete(`/shelly-devices/${id}`).then(() => undefined),
  /** Live state from the Shelly Cloud (can take a second or two). */
  status: (id: number) => data(http.get<ShellyStatus>(`/shelly-devices/${id}/status`, { timeout: 30_000 })),
  switch: (id: number, on: boolean) => data(http.post<{ ok: boolean; on: boolean; message: string }>(`/shelly-devices/${id}/switch`, { on }, { timeout: 30_000 })),
  commands: (id: number) => data(http.get<ShellyCommand[]>(`/shelly-devices/${id}/commands`)),
};

export const sensorApi = {
  /** Chart series of one device: raw points, or time-bucket averages covering the WHOLE range (computed in SQL). */
  series: (q: { deviceId: string; from?: string; to?: string; points?: number }) =>
    data(http.get<SensorSeriesResult>('/sensor-data/series', { params: clean(q) })),
  list: (q: SensorDataQuery) => data(http.get<PagedResult<SensorDataDto>>('/sensor-data', { params: clean(q) })),
  get: (id: number) => data(http.get<SensorDataDto>(`/sensor-data/${id}`)),
  /** Resolves to null when the device has no readings yet (404). */
  latest: (deviceRecordId: number) =>
    data(http.get<SensorDataDto>(`/devices/${deviceRecordId}/sensor-data/latest`)).catch((e) => {
      if (axios.isAxiosError(e) && e.response?.status === 404) return null;
      throw e;
    }),
  history: (deviceRecordId: number, q: HistoryQuery) =>
    data(http.get<PagedResult<SensorDataDto>>(`/devices/${deviceRecordId}/sensor-data/history`, { params: clean(q) })),
};

export const healthApi = {
  get: () =>
    axios
      .get<HealthResponse>(`${API_PREFIX}/health`, { timeout: 5_000, params: { _t: Date.now() }, validateStatus: (s) => s === 200 || s === 503 })
      .then((r) => r.data),
};

export const governmentApi = {
  status: () => data(http.get<GovStatus>('/government/status')),
  comparison: (radiusKm = 25) => data(http.get<GovDeviceComparison[]>('/government/comparison', { params: { radiusKm } })),
  sync: () => data(http.post<GovSyncResult>('/government/sync', undefined, { timeout: 180_000 })),
};
