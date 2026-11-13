import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../theme/theme';
import { ToastProvider } from '../components/feedback';
import DeviceConfigurationPage from '../features/shelly/DeviceConfigurationPage';
import { shellyApi } from '../api/services';
import type { ShellyDevice, ShellyStatus } from '../types/api';

let role = 'SuperAdmin';
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ role, user: { id: 1, name: 'T', email: 't@x.io', role } }) }));
vi.mock('../api/services', () => ({
  shellyApi: { list: vi.fn(), status: vi.fn(), switch: vi.fn(), updateConfig: vi.fn() },
  devicesApi: {
    list: vi.fn().mockResolvedValue({
      items: [{ id: 12, deviceId: 'Vayu_004', deviceName: 'Vayu_004 (UAT)' }, { id: 9, deviceId: 'Vayu_002', deviceName: 'Vayu_002' }],
      page: 1, pageSize: 100, totalCount: 2, totalPages: 1, hasNextPage: false,
    }),
  },
}));

const sw = (over: Partial<ShellyDevice> = {}): ShellyDevice => ({
  id: 3, name: 'Vayu_004 Power Switch', shellyId: 'd0cf13cb84d4', cloudHost: 'shelly-277-eu.shelly.cloud', channel: 0, deviceId: 'Vayu_004', deviceName: 'Vayu_004 (UAT)',
  isActive: true, authKeyHint: null, createdAt: '2026-10-21T00:00:00Z', lastCommandAt: null, lastCommandOn: null, lastCommandBy: null,
  overrideActive: false, canControl: true,
  config: { scheduleEnabled: false, dailyOnTime: null, dailyOffTime: null, overrideActive: false, overrideSetAt: null, overrideBy: null, updatedAt: null, updatedBy: null },
  ...over,
});
const status = (over: Partial<ShellyStatus> = {}): ShellyStatus => ({
  id: 3, online: true, on: true, powerW: 1.2, voltageV: 234, currentA: 0.04, temperatureC: 70, wifiRssi: -55, ssid: 'x', energyTotalWh: 1, cloudUpdatedAt: null, checkedAt: '2026-11-12T00:00:00Z', errors: [], ...over,
});
const mount = () => render(<ThemeProvider theme={theme}><MemoryRouter><ToastProvider><DeviceConfigurationPage /></ToastProvider></MemoryRouter></ThemeProvider>);
const refresh = async () => { await userEvent.click(await screen.findByRole('button', { name: 'Refresh Shelly status' })); await screen.findByText(/^(ON|OFF)$/); };

beforeEach(() => {
  vi.clearAllMocks();
  role = 'SuperAdmin';
  vi.mocked(shellyApi.list).mockResolvedValue([sw()]);
  vi.mocked(shellyApi.status).mockResolvedValue(status());
  vi.mocked(shellyApi.switch).mockResolvedValue({ ok: true, on: false, message: 'Turned OFF.' });
  vi.mocked(shellyApi.updateConfig).mockResolvedValue(sw());
});

describe('Settings > Device Configuration', () => {
  it('SuperAdmin: device dropdown, ON/OFF time pickers, override toggle and Save Configuration', async () => {
    mount();
    expect(await screen.findByLabelText('Daily Shelly ON time')).toBeInTheDocument();
    expect(screen.getByLabelText('Daily Shelly OFF time')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Super Admin override' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save Configuration' })).toBeDisabled();       // nothing changed yet
    expect(screen.getByRole('combobox', { name: /Device/ })).toBeInTheDocument();
  });

  it('SuperAdmin saves the schedule and the override for this device', async () => {
    mount();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Daily schedule' }));
    fireEvent.change(screen.getByLabelText('Daily Shelly ON time'), { target: { value: '08:30' } });
    fireEvent.change(screen.getByLabelText('Daily Shelly OFF time'), { target: { value: '20:15' } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Super Admin override' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));
    await waitFor(() => expect(shellyApi.updateConfig).toHaveBeenCalledWith(3, { scheduleEnabled: true, dailyOnTime: '08:30', dailyOffTime: '20:15', overrideActive: true }));
  });

  it('Save stays disabled when the schedule is on but a time is missing or both times are equal', async () => {
    mount();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Daily schedule' }));
    expect(screen.getByText('Set both the ON time and the OFF time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Configuration' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Daily Shelly ON time'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('Daily Shelly OFF time'), { target: { value: '09:00' } });
    expect(screen.getByText('The ON time and the OFF time must be different.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Configuration' })).toBeDisabled();
  });

  it('SuperAdmin sees power, voltage, current, temperature and Wi-Fi after Refresh', async () => {
    mount();
    await refresh();
    for (const label of ['Power', 'Voltage', 'Current', 'Temperature', 'Wi-Fi']) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('Admin: ON/OFF only. No configuration, no electrical details, and the buttons work', async () => {
    role = 'Admin';
    vi.mocked(shellyApi.list).mockResolvedValue([sw({ config: null })]);
    vi.mocked(shellyApi.status).mockResolvedValue(status({ powerW: null, voltageV: null, currentA: null, temperatureC: null, wifiRssi: null, ssid: null }));
    mount();
    await refresh();
    expect(screen.queryByLabelText('Daily Shelly ON time')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save Configuration' })).toBeNull();
    for (const label of ['Power', 'Voltage', 'Current', 'Temperature', 'Wi-Fi']) expect(screen.queryByText(label)).toBeNull();
    expect(screen.getByRole('button', { name: 'Turn OFF' })).toBeEnabled();                    // status ON -> Turn OFF is offered
    await userEvent.click(screen.getByRole('button', { name: 'Turn OFF' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn OFF' }));
    await waitFor(() => expect(shellyApi.switch).toHaveBeenCalledWith(3, false));
  });

  it('Admin under SuperAdmin override: the message is shown and no switching is possible', async () => {
    role = 'Admin';
    vi.mocked(shellyApi.list).mockResolvedValue([sw({ config: null, overrideActive: true, canControl: false })]);
    mount();
    expect(await screen.findByText('Device control is currently managed by Super Admin.')).toBeInTheDocument();
    await refresh();
    expect(screen.getByRole('button', { name: 'Turn ON' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Turn OFF' })).toBeDisabled();
  });

  it('User: sees ON/OFF only, view-only, no buttons and no configuration', async () => {
    role = 'User';
    vi.mocked(shellyApi.list).mockResolvedValue([sw({ config: null, canControl: false })]);
    vi.mocked(shellyApi.status).mockResolvedValue(status({ powerW: null, voltageV: null, currentA: null, temperatureC: null, wifiRssi: null, ssid: null }));
    mount();
    await refresh();
    expect(screen.getByText(/View only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn ON' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn OFF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save Configuration' })).toBeNull();
    expect(screen.queryByText('Voltage')).toBeNull();
  });

  it('a device without a Shelly switch says so', async () => {
    vi.mocked(shellyApi.list).mockResolvedValue([]);
    mount();
    expect(await screen.findByText(/no Shelly switch linked/)).toBeInTheDocument();
  });
});
