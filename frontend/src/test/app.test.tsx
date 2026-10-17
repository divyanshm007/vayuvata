import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios, { AxiosError } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import { theme } from '../theme/theme';
import { ToastProvider } from '../components/feedback';
import { AuthProvider } from '../features/auth/AuthContext';
import AppRoutes from '../routes/AppRoutes';
import { ApiKeyDialog } from '../features/devices/DeviceDialogs';
import { authApi, devicesApi, usersApi, sensorApi, healthApi } from '../api/services';
import { tokenStore } from '../api/tokenStore';
import type { Profile, Role } from '../types/api';

vi.mock('../api/services', () => ({
  authApi: { login: vi.fn(), me: vi.fn(), logout: vi.fn(), changePassword: vi.fn() },
  devicesApi: { list: vi.fn(), get: vi.fn(), assignments: vi.fn() },
  usersApi: { list: vi.fn() },
  sensorApi: { latest: vi.fn(), list: vi.fn(), history: vi.fn(), get: vi.fn() },
  healthApi: { get: vi.fn() },
}));

const empty = { items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0, hasNextPage: false };
const profile = (role: Role): Profile => ({ id: 1, name: `${role} Person`, email: 'p@x.io', role, managerId: null, isActive: true, lastLoginAt: null });
const session = (role: Role) => ({ accessToken: 'a', refreshToken: 'r', expiresAt: '', refreshTokenExpiresAt: '', userId: 1, name: 'x', email: 'p@x.io', role });

function renderApp(path = '/') {
  return render(
    <ThemeProvider theme={theme}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  );
}

// Load the heavy lazy route modules once up front so the first test is not charged for compiling recharts/MUI.
beforeAll(async () => {
  await import('../features/dashboard/DashboardPage');
  await import('../features/devices/DevicesPage');
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks(); tokenStore.clear(); sessionStorage.clear(); localStorage.clear();
  vi.mocked(devicesApi.list).mockResolvedValue(empty);
  vi.mocked(usersApi.list).mockResolvedValue(empty);
  vi.mocked(sensorApi.latest).mockResolvedValue(null);
  vi.mocked(healthApi.get).mockResolvedValue({ status: 'Healthy', database: 'Connected', timeUtc: '2026-01-01T00:00:00Z' });
});

async function signIn(role: Role) {
  vi.mocked(authApi.login).mockResolvedValue(session(role));
  vi.mocked(authApi.me).mockResolvedValue(profile(role));
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/email/i), 'p@x.io');
  await user.type(screen.getByLabelText(/^password/i), 'Whatever123');
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('unified login and role-based navigation', () => {
  it('redirects anonymous visitors to the login page', async () => {
    renderApp('/devices');
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  });

  it('validates the login form inline without calling the API', async () => {
    renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/enter your email/i)).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });

  it('shows a friendly message for invalid credentials', async () => {
    const e = new AxiosError('x');
    e.response = { status: 401, data: { message: 'Invalid' }, headers: {}, statusText: '', config: {} as never };
    vi.mocked(authApi.login).mockRejectedValue(e);
    renderApp('/login');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/email/i), 'p@x.io');
    await user.type(screen.getByLabelText(/^password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect email or password/i);
  });

  it.each([
    ['SuperAdmin', ['Admin Management', 'Device Assignments', 'Historical Reports'], []],
    ['Admin', ['My Users', 'Historical Reports', 'Gov Comparison'], ['Admin Management', 'Device Assignments']],
    ['User', ['My Devices', 'Latest Sensor Readings', 'Reading History', 'Historical Reports', 'Gov Comparison'], ['My Users', 'Admin Management', 'System Health', 'Device Assignments']],
  ] as const)('%s sees only their own navigation (role taken from /auth/me)', async (role, shown, hidden) => {
    renderApp('/login');
    await signIn(role);
    const nav = await screen.findByRole('navigation', { name: /main navigation/i }, { timeout: 8000 });
    await waitFor(() => expect(nav).toHaveTextContent('Dashboard'), { timeout: 8000 });
    for (const l of shown) expect(nav).toHaveTextContent(l);
    for (const l of hidden) expect(nav).not.toHaveTextContent(l);
    expect(nav).toHaveTextContent('Change Password');
    expect(authApi.me).toHaveBeenCalled();
  });
});

describe('route guards', () => {
  it('shows access denied to a User opening an admin-only page', async () => {
    vi.mocked(authApi.me).mockResolvedValue(profile('User'));
    tokenStore.setRefresh('r', false);
    const spy = vi.spyOn(axios, 'post').mockResolvedValue({ data: session('User') });
    renderApp('/admins');
    expect(await screen.findByText(/access denied/i)).toBeInTheDocument();
    spy.mockRestore();
  });

  it('shows a 404 screen for unknown pages', async () => {
    vi.mocked(authApi.me).mockResolvedValue(profile('Admin'));
    tokenStore.setRefresh('r', false);
    const spy = vi.spyOn(axios, 'post').mockResolvedValue({ data: session('Admin') });
    renderApp('/nope');
    expect(await screen.findByText(/page not found/i)).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('ApiKeyDialog', () => {
  it('shows the one-time key with a warning, never persists it, and needs acknowledgement', async () => {
    const onClose = vi.fn();
    const device = {
      id: 1, deviceId: 'ESP32-1', deviceName: 'Lab', description: null, isActive: true, createdAt: '', updatedAt: null,
      assignedUserId: null, assignedUserName: null, assignedAt: null, apiKey: 'vv_secret_key_123',
    };
    render(<ThemeProvider theme={theme}><ApiKeyDialog device={device} title="Device registered" onClose={onClose} /></ThemeProvider>);
    expect(screen.getByDisplayValue('vv_secret_key_123')).toBeInTheDocument();
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    expect(JSON.stringify({ ...localStorage })).not.toContain('vv_secret_key_123');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('vv_secret_key_123');
    const done = screen.getByRole('button', { name: /done/i });
    expect(done).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(done);
    expect(onClose).toHaveBeenCalled();
  });
});
