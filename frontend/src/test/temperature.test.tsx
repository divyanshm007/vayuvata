import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../theme/theme';
import { ToastProvider } from '../components/feedback';
import ReadingsPage from '../features/sensor-data/ReadingsPage';
import { sensorApi } from '../api/services';
import type { SensorDataDto } from '../types/api';

let role = 'SuperAdmin';
vi.mock('../features/auth/AuthContext', () => {
  const ctx = () => ({ role, user: { id: 1, name: 'T', email: 't@x.io', role } });
  return { useAuth: ctx, useMaybeAuth: ctx };
});
vi.mock('../api/services', () => ({
  sensorApi: { list: vi.fn(), get: vi.fn() },
  devicesApi: { list: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 100, totalCount: 0, totalPages: 0, hasNextPage: false }) },
}));

const reading = (over: Partial<SensorDataDto> = {}): SensorDataDto => ({
  id: 1, deviceId: 'Vayu_004', dataDate: '2026-11-12', dataTime: '10:00:00', recordedAt: '2026-11-12T10:00:00Z', aqi: 120, aqiStatus: 'Moderate', pm10: 80, pm25: 45,
  no2Ppm: 0.9, so2Ppm: 1.1, coPpm: 5, tvocPpb: 300, humidity: 47, temperature: 33.61, outerTemperature: 30.8, outerHumidity: 52, createdAt: '2026-11-12T10:00:30Z', ...over,
} as SensorDataDto);
const mount = () => render(<ThemeProvider theme={theme}><MemoryRouter><ToastProvider><ReadingsPage /></ToastProvider></MemoryRouter></ThemeProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sensorApi.list).mockResolvedValue({ items: [reading()], page: 1, pageSize: 20, totalCount: 1, totalPages: 1, hasNextPage: false } as never);
});

describe('Temperature by role', () => {
  it('SuperAdmin sees both the inner and the outer temperature', async () => {
    role = 'SuperAdmin';
    mount();
    expect(await screen.findByText('33.6°C')).toBeInTheDocument();             // inner
    expect(screen.getByText('30.8°C')).toBeInTheDocument();                    // outer
    expect(screen.getByRole('columnheader', { name: 'Inner temp' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Outer temp' })).toBeInTheDocument();
  });

  it('Admin sees one temperature, named Temp (the server sends the outer value as "temperature" and no outer one)', async () => {
    role = 'Admin';
    vi.mocked(sensorApi.list).mockResolvedValue({ items: [reading({ temperature: 30.8, outerTemperature: null })], page: 1, pageSize: 20, totalCount: 1, totalPages: 1, hasNextPage: false } as never);
    mount();
    expect(await screen.findByText('30.8°C')).toBeInTheDocument();
    expect(screen.queryByText('33.6°C')).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Temp' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Inner temp' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Outer temp' })).toBeNull();
  });

  it('User sees the same single Temperature', async () => {
    role = 'User';
    vi.mocked(sensorApi.list).mockResolvedValue({ items: [reading({ temperature: 30.8, outerTemperature: null })], page: 1, pageSize: 20, totalCount: 1, totalPages: 1, hasNextPage: false } as never);
    mount();
    expect(await screen.findByText('30.8°C')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Outer temp' })).toBeNull();
  });
});
