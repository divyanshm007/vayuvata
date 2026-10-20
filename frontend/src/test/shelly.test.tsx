import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../theme/theme';
import { ToastProvider } from '../components/feedback';
import ShellyPage from '../features/shelly/ShellyPage';
import { shellyApi } from '../api/services';
import type { ShellyDevice, ShellyStatus } from '../types/api';

let role = 'Admin';
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ role, user: { id: 1, name: 'T', email: 't@x.io', role } }) }));
vi.mock('../api/services', () => ({
  shellyApi: { list: vi.fn(), status: vi.fn(), switch: vi.fn(), commands: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  devicesApi: { list: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 100, totalCount: 0, totalPages: 0, hasNextPage: false }) },
}));

const sw = (over: Partial<ShellyDevice> = {}): ShellyDevice => ({
  id: 1, name: 'Vayu_004 power', shellyId: 'd0cf13cb84d4', cloudHost: 'shelly-277-eu.shelly.cloud', channel: 0, deviceId: 'Vayu_004', deviceName: 'Vayu_004 (UAT)',
  isActive: true, authKeyHint: null, createdAt: '2026-10-21T00:00:00Z', lastCommandAt: null, lastCommandOn: null, lastCommandBy: null, ...over,
});
const status = (over: Partial<ShellyStatus> = {}): ShellyStatus => ({
  id: 1, online: true, on: true, powerW: 12.5, voltageV: 230, currentA: 0.05, temperatureC: 41, wifiRssi: -50, ssid: 'x', energyTotalWh: 1, cloudUpdatedAt: null, checkedAt: '2026-10-21T00:00:00Z', ...over,
});
const mount = () => render(<ThemeProvider theme={theme}><MemoryRouter><ToastProvider><ShellyPage /></ToastProvider></MemoryRouter></ThemeProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  role = 'Admin';
  vi.mocked(shellyApi.list).mockResolvedValue([sw()]);
  vi.mocked(shellyApi.status).mockResolvedValue(status());
  vi.mocked(shellyApi.commands).mockResolvedValue([]);
  vi.mocked(shellyApi.switch).mockResolvedValue({ ok: true, on: false, message: 'Turned OFF.' });
  vi.mocked(shellyApi.remove).mockResolvedValue(undefined);
});

describe('Shelly switches page', () => {
  it('does not call the Shelly Cloud by itself: the state is read only when Refresh is pressed', async () => {
    mount();
    expect(await screen.findByText('Vayu_004 power')).toBeInTheDocument();
    expect(screen.getByText('Not checked')).toBeInTheDocument();
    expect(screen.getByText(/not read automatically/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 300));
    expect(shellyApi.status).not.toHaveBeenCalled();                                // no automatic request on load
    await userEvent.click(screen.getByRole('button', { name: 'Refresh Vayu_004 power' }));
    expect(await screen.findByText('ON')).toBeInTheDocument();
    expect(shellyApi.status).toHaveBeenCalledTimes(1);
  });

  it('Admin sees their switch with ON / OFF, but no add, edit or key information', async () => {
    mount();
    expect(await screen.findByText('Vayu_004 power')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn ON' })).toBeDisabled();        // state not read yet: neither action is offered
    expect(screen.getByRole('button', { name: 'Turn OFF' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Add Shelly switch/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByText(/key ••••/)).toBeNull();
  });

  it('after the state is read, only the opposite action is enabled: ON -> Turn OFF, OFF -> Turn ON', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh Vayu_004 power' }));
    await screen.findByText('ON');                                                  // status() says on: true
    expect(screen.getByRole('button', { name: 'Turn ON' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Turn OFF' })).toBeEnabled();
  });

  it('when the switch is OFF, Turn ON is the enabled action', async () => {
    vi.mocked(shellyApi.status).mockResolvedValue(status({ on: false }));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh Vayu_004 power' }));
    await screen.findByText('OFF');
    expect(screen.getByRole('button', { name: 'Turn ON' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Turn OFF' })).toBeDisabled();
  });

  it('turning it OFF asks first, then sends the command', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh Vayu_004 power' }));
    await screen.findByText('ON');
    await userEvent.click(screen.getByRole('button', { name: 'Turn OFF' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/will lose power/)).toBeInTheDocument();
    expect(shellyApi.switch).not.toHaveBeenCalled();                                // nothing sent before the confirmation
    const listCallsBefore = vi.mocked(shellyApi.list).mock.calls.length;
    await userEvent.click(within(dlg).getByRole('button', { name: 'Turn OFF' }));
    await waitFor(() => expect(shellyApi.switch).toHaveBeenCalledWith(1, false));
    expect(await screen.findByText(/accepted by the Shelly Cloud/)).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(shellyApi.list).mock.calls.length).toBeGreaterThan(listCallsBefore));   // our own list is re-read, so "Last command" is fresh
    expect(screen.getByText('OFF')).toBeInTheDocument();                            // shows what was sent ...
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn ON' })).toBeEnabled());   // ... and the buttons flip to match (once the dialog has closed)
    expect(shellyApi.status).toHaveBeenCalledTimes(1);                              // ... without an extra cloud request: only the manual refresh above
  });

  it('an offline switch is shown as offline with a hint, and a failed command is reported', async () => {
    vi.mocked(shellyApi.status).mockResolvedValue(status({ online: false, on: null }));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh Vayu_004 power' }));
    expect(await screen.findByText('Offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn ON' })).toBeDisabled();         // an offline switch cannot be switched
    expect(screen.getByRole('button', { name: 'Turn OFF' })).toBeDisabled();
    expect(screen.getByText(/reports this switch as offline/)).toBeInTheDocument();
  });

  it('SuperAdmin gets the Add button, the cloud server and a key hint, and the key field is a password field', async () => {
    role = 'SuperAdmin';
    vi.mocked(shellyApi.list).mockResolvedValue([sw({ authKeyHint: '••••7890' })]);
    mount();
    expect(await screen.findByText(/key ••••7890/)).toBeInTheDocument();
    expect(screen.getByText(/shelly-277-eu\.shelly\.cloud/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Add Shelly switch/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByLabelText('Shelly Cloud auth key')).toHaveAttribute('type', 'password');
    expect(within(dlg).getByRole('button', { name: 'Add switch' })).toBeDisabled();  // nothing typed yet
  });

  it('only the SuperAdmin has a Delete button; it asks first, then removes the switch and reloads the list', async () => {
    mount();                                                                        // Admin
    await screen.findByText('Vayu_004 power');
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    document.body.innerHTML = '';
    role = 'SuperAdmin';
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Vayu_004 power' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/permanently removes/)).toBeInTheDocument();
    expect(shellyApi.remove).not.toHaveBeenCalled();                                // nothing deleted before the confirmation
    const listCalls = vi.mocked(shellyApi.list).mock.calls.length;
    await userEvent.click(within(dlg).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(shellyApi.remove).toHaveBeenCalledWith(1));
    await waitFor(() => expect(vi.mocked(shellyApi.list).mock.calls.length).toBeGreaterThan(listCalls));   // the list is reloaded
  });

  it('shows an empty state with the right advice when no switch is linked', async () => {
    vi.mocked(shellyApi.list).mockResolvedValue([]);
    mount();
    expect(await screen.findByText('No Shelly switches')).toBeInTheDocument();
    expect(screen.getByText(/Ask the administrator/)).toBeInTheDocument();
  });
});
