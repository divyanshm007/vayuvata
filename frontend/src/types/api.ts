// Contracts mirroring the VayuVata backend DTOs (backend/DTOs/*). Do not add fields the API does not return.
export type Role = 'SuperAdmin' | 'Admin' | 'User';

export interface LoginResponse {
  accessToken: string; expiresAt: string; refreshToken: string; refreshTokenExpiresAt: string;
  userId: number; name: string; email: string; role: Role;
}
export interface Profile {
  id: number; name: string; email: string; role: Role; managerId: number | null; isActive: boolean; lastLoginAt: string | null;
}

export interface PagedResult<T> {
  items: T[]; page: number; pageSize: number; totalCount: number | null; totalPages: number | null; hasNextPage: boolean;
}
export interface PageParams { page?: number; pageSize?: number; includeTotal?: boolean }

export interface ApiErrorBody {
  status: number; code: string; message: string; errors?: Record<string, string[]> | null; traceId?: string | null;
}

export interface UserDto {
  id: number; name: string; email: string; role: Role;
  managerId: number | null; managerName: string | null; managerRole: 'Admin' | 'SuperAdmin' | null;
  assignmentType: 'Standalone' | 'AdminManaged' | null;
  isActive: boolean; createdAt: string; updatedAt: string | null; lastLoginAt: string | null;
  mobile?: string | null;
  /** Active | Pending activation (approved, link not used yet) | Inactive (disabled) */
  activationStatus?: 'Active' | 'Pending activation' | 'Inactive';
}
export interface UserQuery extends PageParams { search?: string; role?: string; managerId?: number; standalone?: boolean; isActive?: boolean }
export interface CreateUserRequest { name: string; email: string; password: string; role: 'Admin' | 'User'; managerId?: number | null }
export interface CreateManagedUserRequest { name: string; email: string; password: string }
export interface UpdateUserRequest { name: string; email: string }
export interface AdminUsersPage extends PagedResult<UserDto> { adminId: number; adminName: string }

export interface DeviceDto {
  id: number; deviceId: string; deviceName: string; description: string | null; isActive: boolean;
  createdAt: string; updatedAt: string | null;
  assignedUserId: number | null; assignedUserName: string | null; assignedAt: string | null;
  /** Newest position of the device (IST wall-clock time), or null when it never reported one. */
  lastLocation?: DeviceLastLocation | null;
}
export interface DeviceLastLocation { latitude: number; longitude: number; recordedAt: string; source: 'gps' | 'cell' | string; /** place name (area, city, state) once looked up */ name?: string | null }
export interface DeviceWithKeyDto extends DeviceDto { apiKey: string }
export interface DeviceQuery extends PageParams { search?: string; isActive?: boolean; assigned?: boolean }
export interface CreateDeviceRequest { deviceId: string; deviceName: string; description?: string | null }
export interface UpdateDeviceRequest { deviceName: string; description?: string | null }
export interface AssignmentDto {
  id: number; deviceRecordId: number; deviceId: string; userId: number; userName: string;
  assignedByUserId: number; assignedByName: string; assignedAt: string; unassignedAt: string | null; isActive: boolean; notes: string | null;
}

export interface SensorDataDto {
  id: number; deviceId: string; dataDate: string; dataTime: string; recordedAt: string;
  aqi: number | null; aqiStatus: string | null;
  pm10: number | null; pm25: number | null; no2Ppm: number | null; so2Ppm: number | null; coPpm: number | null; tvocPpb: number | null;
  humidity: number | null; temperature: number | null; outerTemperature: number | null; outerHumidity: number | null;
  createdAt: string;
}
export interface SensorDataQuery extends PageParams {
  deviceId?: string; from?: string; to?: string; sortBy?: 'recordedAt' | 'createdAt' | 'aqi'; sortDir?: 'asc' | 'desc';
}
export interface HistoryQuery extends PageParams { from?: string; to?: string; sortDir?: 'asc' | 'desc' }

export interface DeviceHealth {
  id: number; deviceId: string; deviceName: string; status: 'ok' | 'warning' | 'failing' | 'offline'; message: string | null;
  readingsLastHour: number; outerMissingLastHour: number; outerMissingPercent: number; lastReadingAt: string | null;
}

// ---- Registration, approval, invitations
export interface RegisterRequest { fullName: string; email: string; mobile: string; requestedRole: 'Admin' | 'User'; adminEmail?: string | null; deviceId?: string | null }
export interface RegisterResponse { requestId: number; status: string; message: string }
export type RegistrationStatus = 'Pending' | 'Approved' | 'Rejected';
export interface RegistrationRequestDto {
  id: number; fullName: string; email: string; mobile: string; requestedRole: 'Admin' | 'User'; adminEmail: string | null; adminUserId: number | null; adminName: string | null;
  status: RegistrationStatus; createdAt: string; decidedAt: string | null; decidedByName: string | null; decisionNote: string | null; approvedRole: string | null;
  userId: number | null; activationStatus: string | null;
  /** The Device ID the applicant entered, and what it is: NotRegistered | Free | Assigned | Inactive. */
  deviceId: string | null; deviceStatus: 'NotRegistered' | 'Free' | 'Assigned' | 'Inactive' | null; deviceOwnerName: string | null;
}
export interface ApproveRegistrationRequest { role?: 'Admin' | 'User'; adminId?: number | null; deviceIds: number[]; assignRequestedDevice?: boolean; reassign?: boolean; note?: string | null }
export interface InviteUserRequest { name: string; email: string; mobile: string; role: 'Admin' | 'User'; adminEmail?: string | null; deviceIds: number[]; reassign?: boolean }
export interface EmailOutcome { to: string; template: string; status: string }
export interface InviteResult { userId: number; email: string; role: string; activationStatus: string; invitationExpiresAt: string; emails: EmailOutcome[] }
export interface ActivationCheck { valid: boolean; name?: string | null; email?: string | null; role?: string | null }
export interface AccountHistoryItem { id: number; at: string; action: string; actorName: string | null; requestId: number | null; targetUserId: number | null; targetName: string | null; detail: string | null }
export interface EmailLogItem { id: number; at: string; toEmail: string; subject: string; template: string; status: string; error: string | null }
export interface MappedUser { id: number; name: string; email: string; activationStatus: string; devices: string[] }
export interface AdminMapping { adminId: number | null; adminName: string; adminEmail: string | null; adminStatus: string | null; users: MappedUser[] }
export interface RegistrationLink { url: string; emailConfigured: boolean }

// ---- Video management
export interface VideoSubscription { status: 'Active' | 'NotStarted' | 'Expired' | 'NotSet'; startsAt: string | null; expiresAt: string | null; active: boolean; message: string | null }
export interface VideoCapabilities { canView: boolean; canUpload: boolean; uploadBlockedReason: string | null; canControlPlayback: boolean; controlMessage: string | null; canConfigure: boolean }
export interface VideoConfig {
  /** Admin = settings come from the device's owner Admin (edit under Admin accounts); Device = the device has no owner Admin. */
  scope: 'Admin' | 'Device'; adminId: number | null; adminName: string | null;
  adminControlEnabled: boolean; forcedOff: boolean; deviceForcedOff: boolean; adminCanUpload: boolean; adminCanDeleteOwn: boolean; userCanView: boolean;
}
export interface AdminVideoSettings { adminId: number; adminName: string; adminEmail: string; deviceIds: string[]; subscription: VideoSubscription; config: VideoConfig }
export interface VideoOverview {
  deviceId: string; deviceName: string; subscription: VideoSubscription; playbackEnabled: boolean; effective: { allowed: boolean; reason: string | null };
  activeVideoId: number | null; activeVideoName: string | null; deviceStatus: { state: string; message: string | null; reportedAt: string; videoId: number | null } | null;
  capabilities: VideoCapabilities; config: VideoConfig | null; maxSizeMb: number; allowedFormats: string[];
}
export interface VideoItemDto { id: number; deviceId: string; fileName: string; sizeBytes: number; uploadedAt: string; uploadedByName: string; uploadedByUserId: number; processingStatus: string; isActive: boolean; playbackStatus: string; canDelete: boolean }
export interface VideoHistoryItem { id: number; at: string; action: string; source: string; userName: string | null; videoId: number | null; success: boolean; detail: string | null }
export interface UpdateVideoConfigRequest {
  adminControlEnabled: boolean; forcedOff: boolean; adminCanUpload: boolean; adminCanDeleteOwn: boolean; userCanView: boolean;
  subscriptionStartsAt: string | null; subscriptionExpiresAt: string | null;
}

// ---- Shelly smart switches
export interface ShellyDevice {
  id: number; name: string; shellyId: string; cloudHost: string; channel: number; deviceId: string | null; deviceName: string | null;
  isActive: boolean; authKeyHint: string | null; createdAt: string; lastCommandAt: string | null; lastCommandOn: boolean | null; lastCommandBy: string | null;
  /** SuperAdmin override is on: Admins cannot switch and the daily schedule is paused. */
  overrideActive: boolean;
  /** Whether the CALLER may switch it now (SuperAdmin always, Admin without override, User never). */
  canControl: boolean;
  /** Schedule and override details: SuperAdmin only (null for Admin and User). */
  config: ShellyConfig | null;
}
export interface ShellyConfig {
  scheduleEnabled: boolean; dailyOnTime: string | null; dailyOffTime: string | null; overrideActive: boolean;
  overrideSetAt: string | null; overrideBy: string | null; updatedAt: string | null; updatedBy: string | null;
}
export interface UpdateShellyConfigRequest { scheduleEnabled: boolean; dailyOnTime: string | null; dailyOffTime: string | null; overrideActive: boolean }
export interface ShellyStatus {
  id: number; online: boolean; on: boolean | null; powerW: number | null; voltageV: number | null; currentA: number | null; temperatureC: number | null;
  wifiRssi: number | null; ssid: string | null; energyTotalWh: number | null; cloudUpdatedAt: string | null; checkedAt: string;
  /** Protection errors the Shelly reports; SuperAdmin only (empty for others). */
  errors: string[];
}
export interface ShellyCommand { id: number; turnOn: boolean; succeeded: boolean; error: string | null; userName: string; source: 'Manual' | 'Schedule'; at: string }
export interface CreateShellyRequest { name: string; shellyId: string; authKey: string; cloudHost?: string | null; channel: number; deviceId?: string | null }
export interface UpdateShellyRequest { name: string; cloudHost?: string | null; channel: number; deviceId?: string | null; authKey?: string | null; isActive: boolean }

export interface SensorSeriesResult { points: SensorDataDto[]; bucketMinutes: number; totalReadings: number; aggregated: boolean }

export interface HealthResponse { status: string; database: string; timeUtc: string }

export interface DeviceKeyHashDto { id: number; deviceId: string; apiKeyHash: string | null }

// ---- Government (CPCB) comparison, SuperAdmin only ----
export interface GovStationDto {
  id: number; name: string; city: string; state: string; latitude: number; longitude: number;
  observedAt: string | null; distanceKm: number | null; pm25: number | null; pm10: number | null;
  calculatedAqi: number | null; calculatedAqiStatus: string | null;
}
export interface GovPollutantDto { pollutant: string; avg: number | null; min: number | null; max: number | null; unit: string }
export interface GovComparisonRow {
  parameter: string; unit: string; device: number | null; government: number | null;
  difference: number | null; percentDifference: number | null; comparable: boolean; note: string | null;
}
export interface GovDeviceSide {
  deviceId: string; deviceName: string | null; location: { latitude: number; longitude: number } | null;
  locationRecordedAt: string | null; locationSource: string | null; latestReadingAt: string | null; isLastKnown: boolean;
  latestAqi: number | null; latestAqiStatus: string | null; windowSamples: number; windowFrom: string | null; windowTo: string | null;
  pm25: number | null; pm10: number | null; no2Ppm: number | null; so2Ppm: number | null; coPpm: number | null; tvocPpb: number | null;
  temperature: number | null; humidity: number | null; outerTemperature: number | null; outerHumidity: number | null;
  aqi: number | null; aqiStatus: string | null;
}
export interface GovDeviceComparison {
  device: GovDeviceSide;
  government: { station: GovStationDto | null; mappedAt: string | null; pollutants: GovPollutantDto[] };
  rows: GovComparisonRow[]; status: 'ok' | 'stale' | 'device_offline' | 'no_location' | 'no_station' | 'no_government_data'; statusMessage: string;
  governmentAgeMinutes: number | null; timeGapMinutes: number | null; nearbyStations: GovStationDto[];
}
export interface GovStatus {
  apiKeyConfigured: boolean; stationCount: number; mappedDevices: number; lastSyncAt: string | null; lastSyncStatus: string | null;
  lastSyncError: string | null; lastSyncRecords: number; latestObservedAt: string | null; source: string;
}
export interface GovSyncResult { status: string; recordsFetched: number; stationsAdded: number; readingsAdded: number; devicesMatched: number; devicesSwitched: number; error: string | null }
