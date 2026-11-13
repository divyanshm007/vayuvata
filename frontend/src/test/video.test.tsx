import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../theme/theme';
import { ToastProvider } from '../components/feedback';
import VideoManagementPage from '../features/video/VideoManagementPage';
import { videoApi } from '../api/services';
import type { AdminVideoSettings } from '../types/api';
import type { VideoItemDto, VideoOverview } from '../types/api';

// The first render of this large page is slow under the full suite's load; give the file more time than the 5 s default.
vi.setConfig({ testTimeout: 20000 });
configure({ asyncUtilTimeout: 8000 });                       // the page chains three requests (devices, overview, list)

let role = 'SuperAdmin';
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ role, user: { id: 1, name: 'T', email: 't@x.io', role } }), useMaybeAuth: () => ({ role }) }));
vi.mock('../api/services', () => ({
  videoApi: { overview: vi.fn(), list: vi.fn(), history: vi.fn(), upload: vi.fn(), remove: vi.fn(), playback: vi.fn(), setActive: vi.fn(), config: vi.fn(), admins: vi.fn(), adminConfig: vi.fn() },
  devicesApi: { list: vi.fn().mockResolvedValue({ items: [{ id: 9, deviceId: 'Vayu_002', deviceName: 'Vayu_002' }], page: 1, pageSize: 100, totalCount: 1, totalPages: 1, hasNextPage: false }) },
}));

const SUB_MSG = 'Your subscription has expired. Please contact Super Admin.';
const ov = (over: Partial<VideoOverview> = {}): VideoOverview => ({
  deviceId: 'Vayu_002', deviceName: 'Vayu_002', subscription: { status: 'Active', startsAt: '2026-11-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', active: true, message: null }, playbackEnabled: false,
  effective: { allowed: false, reason: 'Playback is switched off.' }, activeVideoId: 1, activeVideoName: 'promo.mp4', deviceStatus: null,
  capabilities: { canView: true, canUpload: true, uploadBlockedReason: null, canControlPlayback: true, controlMessage: null, canConfigure: true },
  config: { scope: 'Device', adminId: null, adminName: null, adminControlEnabled: false, forcedOff: false, deviceForcedOff: false, adminCanUpload: true, adminCanDeleteOwn: true, userCanView: false }, maxSizeMb: 500, allowedFormats: ['.mp4', '.webm'], ...over,
});
const vid = (over: Partial<VideoItemDto> = {}): VideoItemDto => ({
  id: 1, deviceId: 'Vayu_002', fileName: 'promo.mp4', sizeBytes: 3 * 1024 * 1024, uploadedAt: '2026-11-13T10:00:00Z', uploadedByName: 'divyansh', uploadedByUserId: 624, processingStatus: 'Ready', isActive: true, playbackStatus: 'Blocked: Playback is switched off.', canDelete: true, ...over,
});
const mount = () => render(<ThemeProvider theme={theme}><MemoryRouter><ToastProvider><VideoManagementPage /></ToastProvider></MemoryRouter></ThemeProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  role = 'SuperAdmin';
  vi.mocked(videoApi.overview).mockResolvedValue(ov());
  vi.mocked(videoApi.list).mockResolvedValue([vid()]);
  vi.mocked(videoApi.history).mockResolvedValue([]);
  vi.mocked(videoApi.playback).mockResolvedValue(ov({ playbackEnabled: true, effective: { allowed: true, reason: null } }));
  vi.mocked(videoApi.upload).mockResolvedValue(vid({ id: 2 }));
  vi.mocked(videoApi.remove).mockResolvedValue(undefined);
  vi.mocked(videoApi.config).mockResolvedValue(ov());
  vi.mocked(videoApi.admins).mockResolvedValue([]);
});

describe('Settings > Video Management', () => {
  it('shows the device, subscription, the video list with name, size, time, uploader, processing and playback status', async () => {
    mount();
    expect(await screen.findByRole('cell', { name: /promo.mp4/ })).toBeInTheDocument();
    for (const h of ['Video name', 'File size', 'Uploaded', 'Uploaded by', 'Processing', 'Playback']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.getByText('3.0 MB')).toBeInTheDocument();
    expect(screen.getByText('divyansh')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText(/From .* to /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload Video' })).toBeEnabled();
  });

  it('Super Admin turns playback ON and sees the Admin override, force OFF and subscription controls', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Turn ON' }));
    await waitFor(() => expect(videoApi.playback).toHaveBeenCalledWith('Vayu_002', true));
    expect(screen.getByRole('checkbox', { name: 'Admin Video Control Permission' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Force playback OFF' })).toBeInTheDocument();
    expect(screen.getByLabelText('Subscription from')).toBeInTheDocument();
    expect(screen.getByLabelText('Subscription to')).toBeInTheDocument();
  });

  it('Super Admin saves the Admin permission flag for this device', async () => {
    mount();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Admin Video Control Permission' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save video settings' }));
    await waitFor(() => expect(videoApi.config).toHaveBeenCalledWith('Vayu_002', expect.objectContaining({ adminControlEnabled: true, forcedOff: false })));
  });

  it('an expired subscription shows the standard message and blocks upload', async () => {
    vi.mocked(videoApi.overview).mockResolvedValue(ov({ subscription: { status: 'Expired', startsAt: null, expiresAt: '2026-10-01T00:00:00Z', active: false, message: SUB_MSG },
      capabilities: { canView: true, canUpload: false, uploadBlockedReason: SUB_MSG, canControlPlayback: true, controlMessage: null, canConfigure: true } }));
    mount();
    expect((await screen.findAllByText(SUB_MSG)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Upload Video' })).toBeDisabled();
  });

  it('Admin without the permission sees the lock message and no ON/OFF buttons, and no Super Admin controls', async () => {
    role = 'Admin';
    vi.mocked(videoApi.overview).mockResolvedValue(ov({ config: null, capabilities: { canView: true, canUpload: true, uploadBlockedReason: null, canControlPlayback: false, controlMessage: 'Video playback control is currently managed by Super Admin.', canConfigure: false } }));
    mount();
    expect(await screen.findByText('Video playback control is currently managed by Super Admin.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn ON' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn OFF' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Admin Video Control Permission' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload Video' })).toBeEnabled();                 // uploading stays possible
  });

  it('Admin with the permission can switch playback', async () => {
    role = 'Admin';
    vi.mocked(videoApi.overview).mockResolvedValue(ov({ config: null, capabilities: { canView: true, canUpload: true, uploadBlockedReason: null, canControlPlayback: true, controlMessage: null, canConfigure: false } }));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Turn ON' }));
    await waitFor(() => expect(videoApi.playback).toHaveBeenCalledWith('Vayu_002', true));
  });

  it('a refused switch shows the server message', async () => {
    vi.mocked(videoApi.playback).mockRejectedValue({ isAxiosError: true, response: { status: 403, data: { code: 'control_locked', message: 'Video playback control is currently managed by Super Admin.' } } });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Turn ON' }));
    expect(await screen.findByText('Video playback control is currently managed by Super Admin.')).toBeInTheDocument();
  });

  it('User sees a view-only list: no upload, no controls, no delete', async () => {
    role = 'User';
    vi.mocked(videoApi.overview).mockResolvedValue(ov({ config: null, capabilities: { canView: true, canUpload: false, uploadBlockedReason: null, canControlPlayback: false, controlMessage: null, canConfigure: false } }));
    vi.mocked(videoApi.list).mockResolvedValue([vid({ canDelete: false })]);
    mount();
    expect(await screen.findByRole('cell', { name: /promo.mp4/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload Video' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn ON' })).toBeNull();
    expect(screen.getByText('View only.')).toBeInTheDocument();
  });

  it('a User who may not view the list is told so', async () => {
    role = 'User';
    vi.mocked(videoApi.overview).mockResolvedValue(ov({ config: null, capabilities: { canView: false, canUpload: false, uploadBlockedReason: null, canControlPlayback: false, controlMessage: null, canConfigure: false } }));
    mount();
    expect(await screen.findByText('The video list is not available to you for this device.')).toBeInTheDocument();
    expect(videoApi.list).not.toHaveBeenCalled();
  });

  it('uploads a chosen file; a too-large file is refused before sending', async () => {
    mount();
    const input = await screen.findByLabelText('Video file');
    fireEvent.change(input, { target: { files: [new File(['x'], 'clip.mp4', { type: 'video/mp4' })] } });
    await waitFor(() => expect(videoApi.upload).toHaveBeenCalledWith('Vayu_002', expect.objectContaining({ name: 'clip.mp4' }), expect.any(Function)));
    const big = new File(['x'], 'big.mp4', { type: 'video/mp4' }); Object.defineProperty(big, 'size', { value: 600 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText('The video is larger than 500 MB.')).toBeInTheDocument();
    expect(videoApi.upload).toHaveBeenCalledTimes(1);
  });

  it('deleting asks first', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /^Delete$/ }));
    expect(await screen.findByText('Delete this video?')).toBeInTheDocument();
    await userEvent.click((() => { const b = screen.getAllByRole('button', { name: 'Delete' }); return b[b.length - 1]; })());
    await waitFor(() => expect(videoApi.remove).toHaveBeenCalledWith(1));
  });

  it('Super Admin sees one row per Admin with the devices, the period (from to) and status, and saves the Admin settings once for all devices', async () => {
    const a: AdminVideoSettings = {
      adminId: 624, adminName: 'divyansh', adminEmail: 'd@x.io', deviceIds: ['Vayu_002', 'Vayu_004'],
      subscription: { status: 'Active', startsAt: '2026-11-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', active: true, message: null },
      config: { scope: 'Admin', adminId: 624, adminName: 'divyansh', adminControlEnabled: false, forcedOff: false, deviceForcedOff: false, adminCanUpload: true, adminCanDeleteOwn: true, userCanView: false },
    };
    vi.mocked(videoApi.admins).mockResolvedValue([a]);
    vi.mocked(videoApi.adminConfig).mockResolvedValue(a);
    mount();
    const row = within(await screen.findByRole('table', { name: 'Admin video settings' })).getByRole('row', { name: /d@x.io/ });
    expect(row).toHaveTextContent('Vayu_002, Vayu_004');
    expect(row).toHaveTextContent('Active');
    await userEvent.click(screen.getByRole('button', { name: 'Edit video settings of divyansh' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Vayu_002, Vayu_004');
    fireEvent.change(within(dialog).getByLabelText('Subscription to'), { target: { value: '2027-06-30T10:00' } });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Admin Video Control Permission' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save for this Admin' }));
    await waitFor(() => expect(videoApi.adminConfig).toHaveBeenCalledWith(624, expect.objectContaining({ adminControlEnabled: true, subscriptionStartsAt: expect.any(String), subscriptionExpiresAt: expect.stringContaining('2027-06-30') })));
  });

  it("a device that belongs to an Admin only offers its own force-OFF and points to the Admin accounts for the rest", async () => {
    vi.mocked(videoApi.overview).mockResolvedValue(ov({ config: { scope: 'Admin', adminId: 624, adminName: 'divyansh', adminControlEnabled: true, forcedOff: false, deviceForcedOff: false, adminCanUpload: true, adminCanDeleteOwn: true, userCanView: false } }));
    mount();
    expect(await screen.findByText(/come from its Admin/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Subscription from')).toBeNull();                          // no per-device subscription for an Admin's device
    await userEvent.click(screen.getByRole('checkbox', { name: 'Force playback OFF' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save video settings' }));
    await waitFor(() => expect(videoApi.config).toHaveBeenCalledWith('Vayu_002', expect.objectContaining({ forcedOff: true })));
  });

  it("'From' must be before 'To'", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Subscription from'), { target: { value: '2027-02-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Subscription to'), { target: { value: '2027-01-01T10:00' } });
    expect(await screen.findByText("'From' must be before 'To'.")).toBeInTheDocument();
  });
});
