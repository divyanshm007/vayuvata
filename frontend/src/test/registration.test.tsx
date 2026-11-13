import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../theme/theme';
import { ToastProvider } from '../components/feedback';
import RegisterPage from '../features/registration/RegisterPage';
import ActivatePage from '../features/registration/ActivatePage';
import { RegistrationLinkCard } from '../features/registration/RegistrationLinkCard';
import UserManagementPage from '../features/registration/UserManagementPage';
import { registrationApi, userMgmtApi, usersApi } from '../api/services';
import type { RegistrationRequestDto } from '../types/api';

vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ role: 'SuperAdmin', user: { id: 1, name: 'SA', email: 'sa@x.io', role: 'SuperAdmin' } }), useMaybeAuth: () => ({ role: 'SuperAdmin' }) }));
vi.mock('../api/services', () => ({
  registrationApi: { register: vi.fn(), checkActivation: vi.fn(), activate: vi.fn() },
  userMgmtApi: { requests: vi.fn(), approve: vi.fn(), reject: vi.fn(), invite: vi.fn(), resend: vi.fn(), mapping: vi.fn(), history: vi.fn(), emailLog: vi.fn(), link: vi.fn(), sendLink: vi.fn() },
  usersApi: { list: vi.fn() },
  devicesApi: { list: vi.fn().mockResolvedValue({ items: [{ id: 9, deviceId: 'Vayu_002', deviceName: 'Vayu_002', assignedUserName: null }], page: 1, pageSize: 100, totalCount: 1, totalPages: 1, hasNextPage: false }) },
}));

const wrap = (ui: React.ReactNode, path = '/') => render(<ThemeProvider theme={theme}><MemoryRouter initialEntries={[path]}><ToastProvider>{ui}</ToastProvider></MemoryRouter></ThemeProvider>);
const page = <T,>(items: T[]) => ({ items, page: 1, pageSize: 20, totalCount: items.length, totalPages: 1, hasNextPage: false });
const reqDto = (over: Partial<RegistrationRequestDto> = {}): RegistrationRequestDto => ({
  id: 5, fullName: 'Asha Rao', email: 'asha@example.com', mobile: '+919876543210', requestedRole: 'User', adminEmail: 'boss@example.com', adminUserId: 2, adminName: 'Boss',
  status: 'Pending', createdAt: '2026-11-13T10:00:00Z', decidedAt: null, decidedByName: null, decisionNote: null, approvedRole: null, userId: null, activationStatus: null, deviceId: 'Vayu_002', deviceStatus: 'Free', deviceOwnerName: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(registrationApi.register).mockResolvedValue({ requestId: 1, status: 'Pending', message: 'Thank you. Your registration is waiting for approval.' });
});

describe('public registration page', () => {
  it('asks for name, email, mobile and role; a User must give an Admin email', async () => {
    wrap(<RegisterPage />);
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument();
    expect(screen.getByLabelText(/Your Admin's email address/)).toBeInTheDocument();           // User is the default role
    expect(screen.queryByRole('radio', { name: /Super/i })).toBeNull();                         // no Super Admin option, ever
    await userEvent.type(screen.getByLabelText('Full name'), 'Asha Rao');
    await userEvent.type(screen.getByLabelText('Email address'), 'asha@example.com');
    await userEvent.type(screen.getByLabelText('Mobile number'), '+91 98765 43210');
    await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
    expect(await screen.findByText('Enter the email address of your Admin.')).toBeInTheDocument();
    expect(registrationApi.register).not.toHaveBeenCalled();
  });

  it('submits a User registration with the Admin email', async () => {
    wrap(<RegisterPage />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Asha Rao');
    await userEvent.type(screen.getByLabelText('Email address'), 'asha@example.com');
    await userEvent.type(screen.getByLabelText('Mobile number'), '9876543210');
    await userEvent.type(screen.getByLabelText(/Your Admin's email address/), 'boss@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
    await waitFor(() => expect(registrationApi.register).toHaveBeenCalledWith({ fullName: 'Asha Rao', email: 'asha@example.com', mobile: '9876543210', requestedRole: 'User', adminEmail: 'boss@example.com', deviceId: null }));
    expect(await screen.findByText('Registration received')).toBeInTheDocument();
  });

  it('the registration form has an optional Device ID that is sent with the request', async () => {
    wrap(<RegisterPage />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Asha Rao');
    await userEvent.type(screen.getByLabelText('Email address'), 'asha@example.com');
    await userEvent.type(screen.getByLabelText('Mobile number'), '9876543210');
    await userEvent.type(screen.getByLabelText(/Your Admin's email address/), 'boss@example.com');
    await userEvent.type(screen.getByLabelText('Device ID (optional)'), 'Vayu_004');
    await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
    await waitFor(() => expect(registrationApi.register).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'Vayu_004' })));
  });

  it('an Admin registration needs no Admin email and sends none', async () => {
    wrap(<RegisterPage />);
    await userEvent.click(screen.getByRole('radio', { name: 'Admin' }));
    expect(screen.queryByLabelText(/Your Admin's email address/)).toBeNull();
    await userEvent.type(screen.getByLabelText('Full name'), 'Ravi Kumar');
    await userEvent.type(screen.getByLabelText('Email address'), 'ravi@example.com');
    await userEvent.type(screen.getByLabelText('Mobile number'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
    await waitFor(() => expect(registrationApi.register).toHaveBeenCalledWith(expect.objectContaining({ requestedRole: 'Admin', adminEmail: null, deviceId: null })));
  });

  it('shows the server message, e.g. an unknown Admin', async () => {
    vi.mocked(registrationApi.register).mockRejectedValue({ isAxiosError: true, response: { status: 400, data: { code: 'admin_not_found', message: 'No approved Admin account was found for that email address.' } } });
    wrap(<RegisterPage />);
    await userEvent.type(screen.getByLabelText('Full name'), 'Asha Rao');
    await userEvent.type(screen.getByLabelText('Email address'), 'asha@example.com');
    await userEvent.type(screen.getByLabelText('Mobile number'), '9876543210');
    await userEvent.type(screen.getByLabelText(/Your Admin's email address/), 'nobody@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Submit registration' }));
    expect(await screen.findByText(/No approved Admin account was found/)).toBeInTheDocument();
  });
});

describe('activation page', () => {
  const at = (q: string) => wrap(<Routes><Route path="/activate" element={<ActivatePage />} /><Route path="/login" element={<div>login page</div>} /></Routes>, `/activate${q}`);

  it('a link that is invalid, used or expired says so', async () => {
    vi.mocked(registrationApi.checkActivation).mockResolvedValue({ valid: false });
    at('?token=abc');
    expect(await screen.findByText('This link cannot be used')).toBeInTheDocument();
  });

  it('a missing token is invalid without calling the server', async () => {
    at('');
    expect(await screen.findByText('This link cannot be used')).toBeInTheDocument();
    expect(registrationApi.checkActivation).not.toHaveBeenCalled();
  });

  it('a valid link names the owner and sets the password (strong, confirmed)', async () => {
    vi.mocked(registrationApi.checkActivation).mockResolvedValue({ valid: true, name: 'Asha Rao', email: 'asha@example.com', role: 'User' });
    vi.mocked(registrationApi.activate).mockResolvedValue(undefined);
    at('?token=abc');
    expect(await screen.findByText(/Welcome Asha Rao/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByText('At least 10 characters.')).toBeInTheDocument();
    expect(registrationApi.activate).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText('New password')); await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('New password'), 'Strong#Pass2026');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'Different#Pass2026');
    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Confirm password')); await userEvent.type(screen.getByLabelText('Confirm password'), 'Strong#Pass2026');
    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    await waitFor(() => expect(registrationApi.activate).toHaveBeenCalledWith('abc', 'Strong#Pass2026'));
    expect(await screen.findByText('Account activated')).toBeInTheDocument();
  });
});

describe('registration link card (Super Admin)', () => {
  beforeEach(() => {
    vi.mocked(userMgmtApi.link).mockResolvedValue({ url: 'https://panel.example/register', emailConfigured: true });
    vi.mocked(userMgmtApi.sendLink).mockResolvedValue({ to: 'friend@example.com', template: 'RegistrationLink', status: 'Sent' });
  });

  it('shows the link and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    wrap(<RegistrationLinkCard />);
    await waitFor(() => expect(screen.getByLabelText('Registration link')).toHaveValue('https://panel.example/register'));
    await userEvent.click(screen.getByRole('button', { name: /Copy link/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://panel.example/register'));
    expect(await screen.findByText('Registration link copied.')).toBeInTheDocument();
  });

  it('emails the link to any address (only a valid address enables the button)', async () => {
    wrap(<RegistrationLinkCard />);
    const send = await screen.findByRole('button', { name: /Send link/ });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Email address to send the link to'), 'friend@example.com');
    expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() => expect(userMgmtApi.sendLink).toHaveBeenCalledWith('friend@example.com'));
    expect(await screen.findByText(/The registration link was sent to friend@example.com/)).toBeInTheDocument();
  });
});

describe('User Management (Super Admin)', () => {
  beforeEach(() => {
    vi.mocked(userMgmtApi.link).mockResolvedValue({ url: 'https://panel.example/register', emailConfigured: true });
    vi.mocked(userMgmtApi.requests).mockImplementation(async (q) => page(q.status === 'Pending' ? [reqDto()] : []) as never);
    vi.mocked(usersApi.list).mockResolvedValue(page([{ id: 2, name: 'Boss', email: 'boss@example.com', role: 'Admin', isActive: true, activationStatus: 'Active' }]) as never);
    vi.mocked(userMgmtApi.approve).mockResolvedValue(reqDto({ status: 'Approved' }));
    vi.mocked(userMgmtApi.reject).mockResolvedValue(reqDto({ status: 'Rejected' }));
  });

  it('has every section: users, admins, requests, pending, approved, rejected, mapping, history, email log', async () => {
    wrap(<UserManagementPage />);
    for (const n of ['All Users', 'All Admins', 'Registration Requests', /Pending Approvals/, 'Approved Accounts', 'Rejected Requests', 'Admin–User Mapping', 'History', 'Email log'])
      expect(await screen.findByRole('tab', { name: n })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create User/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Admin/ })).toBeInTheDocument();
  });

  it('approves a pending request: role, Admin and devices are chosen, then the API is called', async () => {
    wrap(<UserManagementPage />);
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('boss@example.com', { selector: 'td' })).toBeInTheDocument();                // the Admin the applicant entered is visible
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and send activation link' }));
    await waitFor(() => expect(userMgmtApi.approve).toHaveBeenCalledWith(5, { role: 'User', adminId: 2, deviceIds: [], assignRequestedDevice: true, reassign: false, note: null }));
  });

  it('rejects a request with a reason', async () => {
    wrap(<UserManagementPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), { target: { value: 'unknown person' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(userMgmtApi.reject).toHaveBeenCalledWith(5, 'unknown person'));
  });

  it('Create User needs the associated Admin before it can be sent', async () => {
    wrap(<UserManagementPage />);
    await userEvent.click(await screen.findByRole('button', { name: /Create User/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'Meera Das');
    await userEvent.type(within(dialog).getByLabelText('Email address'), 'meera@example.com');
    await userEvent.type(within(dialog).getByLabelText('Mobile number'), '9876543210');
    expect(within(dialog).getByRole('button', { name: /Create User and send invitation/ })).toBeDisabled();   // no Admin chosen yet
  });

  it('shows the Device ID the applicant entered with its status, and the approval assigns it automatically', async () => {
    vi.mocked(userMgmtApi.requests).mockImplementation(async (q) => page(q.status === 'Pending' ? [reqDto({ deviceId: 'Vayu_004', deviceStatus: 'Free' })] : []) as never);
    wrap(<UserManagementPage />);
    expect(await screen.findByText('Vayu_004')).toBeInTheDocument();
    expect(screen.getByText('Free: assigned on approval')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Assign this device to the new account automatically' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and send activation link' }));
    await waitFor(() => expect(userMgmtApi.approve).toHaveBeenCalledWith(5, expect.objectContaining({ assignRequestedDevice: true, reassign: false })));
  });

  it('a Device ID that is not registered yet is flagged and not assigned by default', async () => {
    vi.mocked(userMgmtApi.requests).mockImplementation(async (q) => page(q.status === 'Pending' ? [reqDto({ deviceId: 'Nope_001', deviceStatus: 'NotRegistered' })] : []) as never);
    wrap(<UserManagementPage />);
    expect(await screen.findByText('Not registered: create it first')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Assign this device to the new account automatically' })).not.toBeChecked();
    expect(within(dialog).getByText(/not registered yet/)).toBeInTheDocument();
  });

  it('a device that belongs to someone else offers Reassign', async () => {
    vi.mocked(userMgmtApi.requests).mockImplementation(async (q) => page(q.status === 'Pending' ? [reqDto({ deviceId: 'Vayu_002', deviceStatus: 'Assigned', deviceOwnerName: 'Reg User' })] : []) as never);
    wrap(<UserManagementPage />);
    expect(await screen.findByText('Assigned to Reg User')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Reassign it if it belongs to someone else' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and send activation link' }));
    await waitFor(() => expect(userMgmtApi.approve).toHaveBeenCalledWith(5, expect.objectContaining({ reassign: true })));
  });
});
