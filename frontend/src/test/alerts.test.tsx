import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../theme/theme';
import { ToastProvider } from '../components/feedback';
import { AlertsPanel } from '../features/alerts/AlertsPanel';
import AlertsPage from '../features/alerts/AlertsPage';
import AlertConfigPage from '../features/alerts/AlertConfigPage';
import { alertsApi } from '../api/services';
import type { AlertConfig, AlertItem, DeviceMaintenance } from '../types/api';

vi.setConfig({ testTimeout: 20000 });
configure({ asyncUtilTimeout: 8000 });

let role = 'SuperAdmin';
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ role, user: { id: 1, name: 'T', email: 't@x.io', role } }), useMaybeAuth: () => ({ role }) }));
vi.mock('../api/services', () => ({ alertsApi: { list: vi.fn(), summary: vi.fn(), history: vi.fn(), maintenance: vi.fn(), done: vi.fn(), config: vi.fn(), updateConfig: vi.fn() } }));

const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 20, totalCount: items.length, totalPages: 1, hasNextPage: false });
const alert = (over: Partial<AlertItem> = {}): AlertItem => ({
  id: 1, deviceId: 'Vayu_004', deviceName: 'Vayu_004', category: 'AbnormalReading', alertType: 'AqiAbnormal', status: 'Critical', startedAt: '2026-11-12T08:00:00Z', warningAt: '2026-11-12T15:00:00Z',
  criticalAt: '2026-11-13T08:00:00Z', resolvedAt: null, value: 650, baseline: 150, detail: 'AQI 650 vs 5-day average 150', ...over,
});
const maint = (): DeviceMaintenance => ({
  deviceId: 'Vayu_004', deviceName: 'Vayu_004 (UAT)',
  filter: { alertType: 'FilterReplacement', lastDoneAt: null, fromRegistration: true, dueAt: '2026-11-25T00:00:00Z', daysLeft: 12, status: 'Warning' },
  bin: { alertType: 'BinCleaning', lastDoneAt: '2026-10-20T00:00:00Z', fromRegistration: false, dueAt: '2027-01-18T00:00:00Z', daysLeft: 66, status: 'Normal' },
});
const cfg = (): AlertConfig => ({ filterIntervalDays: 45, binIntervalDays: 90, maintenanceWarnDaysBefore: 7, maintenanceCriticalOverdueDays: 7, maintenanceRepeatDays: 7, baselineDays: 5, recentWindowMinutes: 60,
  aqiChangePercent: 50, aqiMinChange: 40, tempChangeDegrees: 8, minBaselineSamples: 200, warningAfterHours: 7, criticalAfterHours: 24, resolveGraceMinutes: 60, offlineAfterMinutes: 60, outerMissingPercent: 50, emailEnabled: true });
const wrap = (ui: React.ReactNode) => render(<ThemeProvider theme={theme}><MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter></ThemeProvider>);

beforeEach(() => {
  vi.clearAllMocks(); role = 'SuperAdmin';
  vi.mocked(alertsApi.summary).mockResolvedValue({ normalDevices: 1, warningAlerts: 2, criticalAlerts: 1, resolvedLast7Days: 4, maintenanceOpen: 1, machineErrorsOpen: 1, abnormalReadingsOpen: 1, totalDevices: 3 });
  vi.mocked(alertsApi.list).mockResolvedValue(page([alert(), alert({ id: 2, category: 'Maintenance', alertType: 'FilterReplacement', status: 'Warning', detail: 'Filter replacement due in 6 day(s)' })]) as never);
  vi.mocked(alertsApi.history).mockResolvedValue(page([{ id: 9, alertId: 1, at: '2026-11-13T08:00:00Z', deviceId: 'Vayu_004', category: 'AbnormalReading', alertType: 'AqiAbnormal', status: 'Critical', detail: 'x' }]) as never);
  vi.mocked(alertsApi.maintenance).mockResolvedValue([maint()]);
  vi.mocked(alertsApi.done).mockResolvedValue(maint());
  vi.mocked(alertsApi.config).mockResolvedValue(cfg());
  vi.mocked(alertsApi.updateConfig).mockResolvedValue(cfg());
});

describe('dashboard alerts panel', () => {
  it('shows Normal / Warning / Critical / Resolved counts and the alerts with their category kept separate', async () => {
    wrap(<AlertsPanel />);
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    for (const l of ['Normal devices', 'Warning', 'Critical', 'Resolved (7 days)']) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    const table = await screen.findByRole('table', { name: 'Active alerts' });
    expect(within(table).getByText('Abnormal reading')).toBeInTheDocument();
    expect(within(table).getByText('Maintenance')).toBeInTheDocument();
    expect(within(table).getByText('Abnormal AQI')).toBeInTheDocument();
    expect(within(table).getByText('Filter replacement')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configure' })).toBeInTheDocument();            // Super Admin only
  });

  it('a User sees the panel without the Configure link and without the per-category counts', async () => {
    role = 'User';
    wrap(<AlertsPanel />);
    expect(await screen.findByText('Serious air-quality changes on your devices.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configure' })).toBeNull();
    expect(screen.queryByText(/maintenance ·/)).toBeNull();
  });

  it('says so when nothing needs attention', async () => {
    vi.mocked(alertsApi.list).mockResolvedValue(page([]) as never);
    wrap(<AlertsPanel />);
    expect(await screen.findByText('No alerts need attention.')).toBeInTheDocument();
  });
});

describe('Alerts page', () => {
  it('lists the alerts, the maintenance schedule (Super Admin / Admin) and the history with date, time, device ID and type', async () => {
    wrap(<AlertsPage />);
    expect(await screen.findByRole('table', { name: 'Alerts' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Maintenance' }));
    expect(await screen.findByRole('table', { name: 'Maintenance' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'History' }));
    const h = await screen.findByRole('table', { name: 'Alert history' });
    for (const col of ['Date and time', 'Device ID', 'Category', 'Alert type', 'Status']) expect(within(h).getByRole('columnheader', { name: col })).toBeInTheDocument();
    expect(within(h).getByText('Vayu_004')).toBeInTheDocument();
  });

  it('marks the filter replaced and the bin cleaned', async () => {
    wrap(<AlertsPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Maintenance' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark replaced Vayu_004' }));
    await waitFor(() => expect(alertsApi.done).toHaveBeenCalledWith('Vayu_004', 'FilterReplacement'));
    await userEvent.click(screen.getByRole('button', { name: 'Mark cleaned Vayu_004' }));
    await waitFor(() => expect(alertsApi.done).toHaveBeenCalledWith('Vayu_004', 'BinCleaning'));
  });

  it('a User has no Maintenance tab', async () => {
    role = 'User';
    wrap(<AlertsPage />);
    await screen.findByRole('tab', { name: 'Alerts' });
    expect(screen.queryByRole('tab', { name: 'Maintenance' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
  });

  it('filters the alert list by category', async () => {
    wrap(<AlertsPage />);
    await screen.findByRole('table', { name: 'Alerts' });
    await userEvent.click(screen.getAllByRole('combobox', { name: 'Category' })[0]);
    await userEvent.click(await screen.findByRole('option', { name: 'Maintenance' }));
    await waitFor(() => expect(alertsApi.list).toHaveBeenCalledWith(expect.objectContaining({ category: 'Maintenance' })));
  });
});

describe('Alert configuration page', () => {
  it('shows the intervals (45 days = 1.5 months, 90 days = 3 months) and the timings, and saves changes', async () => {
    wrap(<AlertConfigPage />);
    const filter = await screen.findByLabelText('Filter replacement every (days)');
    expect(filter).toHaveValue(45);
    expect(screen.getByLabelText('Bin cleaning every (days)')).toHaveValue(90);
    expect(screen.getByLabelText('Warning for the Super Admin after (hours)')).toHaveValue(7);
    expect(screen.getByLabelText('Critical, also to Admin and User, after (hours)')).toHaveValue(24);
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    fireEvent.change(filter, { target: { value: '30' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(alertsApi.updateConfig).toHaveBeenCalledWith(expect.objectContaining({ filterIntervalDays: 30, binIntervalDays: 90 })));
  });

  it('shows the server message when a value is refused', async () => {
    vi.mocked(alertsApi.updateConfig).mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { code: 'validation_failed', message: "'Critical after' must be longer than 'Warning after'." } } });
    wrap(<AlertConfigPage />);
    fireEvent.change(await screen.findByLabelText('Critical, also to Admin and User, after (hours)'), { target: { value: '5' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    expect(await screen.findByText("'Critical after' must be longer than 'Warning after'.")).toBeInTheDocument();
  });
});
