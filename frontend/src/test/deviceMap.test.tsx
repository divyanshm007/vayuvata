import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import type L from 'leaflet';
import { theme } from '../theme/theme';
import type { DeviceDto } from '../types/api';
import type { DeviceLocation, GpsLocationDto } from '../features/device-map/types';
import { devicesApi, sensorApi } from '../api/services';
import { gpsDataService } from '../features/device-map/services/gpsDataService';
import type { DeviceMap as DeviceMapType } from '../features/device-map/components/DeviceMap';
import { useDeviceLocations } from '../features/device-map/hooks/useDeviceLocations';
import LiveDeviceMapPage from '../features/device-map/pages/LiveDeviceMapPage';
import { buildLocations } from '../features/device-map/utils/locations';

vi.mock('../api/services', () => ({
  devicesApi: { list: vi.fn() },
  sensorApi: { latest: vi.fn() },
  authApi: {}, usersApi: {}, healthApi: {},
}));
vi.mock('../features/device-map/services/gpsDataService', () => ({ gpsDataService: { list: vi.fn(), current: vi.fn(), history: vi.fn() } }));

let role: 'SuperAdmin' | 'Admin' | 'User' = 'Admin';
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ role, user: { id: 1, name: 'Tester', email: 't@x.io', role } }) }));

// The Leaflet map is replaced by a probe for the PAGE tests; it is exercised for real in the DeviceMap tests below.
vi.mock('../features/device-map/components/DeviceMap', async (orig) => {
  const actual = await orig<typeof import('../features/device-map/components/DeviceMap')>();
  return {
    ...actual,
    DeviceMap: (p: import('../features/device-map/components/DeviceMap').DeviceMapProps) => (
      <div data-testid="map" data-markers={p.locations.filter((l) => l.position).length} data-selected={p.selectedId ?? ''} data-focus={p.focus ? `${p.focus.id}#${p.focus.token}` : ''} data-fit={p.fitToken} />
    ),
  };
});

const dev = (id: number, deviceId: string, over: Partial<DeviceDto> = {}): DeviceDto => ({
  id, deviceId, deviceName: `Name ${deviceId}`, description: null, isActive: true, createdAt: '2026-10-01T00:00:00', updatedAt: null,
  assignedUserId: null, assignedUserName: null, assignedAt: null, ...over,
});
let rid = 1;
const gps = (deviceId: string, recordedAt: string, over: Partial<GpsLocationDto> = {}): GpsLocationDto => ({
  id: rid++, deviceId, recordedAt, receivedAt: recordedAt, fix: true, source: 'gps', lat: 28.5, lon: 77.4, altM: 1, speedKmh: 0, signalPct: 50, ...over,
});
const recent = () => new Date(Date.now() - 60_000).toISOString();
const paged = (items: DeviceDto[]) => ({ items, page: 1, pageSize: 100, totalCount: items.length, totalPages: 1, hasNextPage: false });

const mount = () => render(<ThemeProvider theme={theme}><MemoryRouter><LiveDeviceMapPage /></MemoryRouter></ThemeProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  role = 'Admin';
  vi.mocked(sensorApi.latest).mockResolvedValue(null);
  vi.mocked(gpsDataService.current).mockResolvedValue({ kind: 'none' });
  vi.mocked(gpsDataService.history).mockResolvedValue({ items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0, hasNextPage: false });
});

describe('Live Device Map page', () => {
  it('five devices with valid positions produce five markers', async () => {
    const ids = ['A', 'B', 'C', 'D', 'E'];
    vi.mocked(devicesApi.list).mockResolvedValue(paged(ids.map((d, i) => dev(i + 1, d))));
    vi.mocked(gpsDataService.list).mockResolvedValue(ids.map((d, i) => gps(d, recent(), { lat: 10 + i, lon: 70 + i })));
    mount();
    await waitFor(() => expect(screen.getByTestId('map')).toHaveAttribute('data-markers', '5'));
    expect(screen.getByText('With GPS position').closest('div')!.parentElement).toHaveTextContent('5');
  });

  it('shows a Location history section after the data notes, listing the reports returned for the signed-in user', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'A')]));
    vi.mocked(gpsDataService.list).mockResolvedValue([gps('A', recent())]);
    vi.mocked(gpsDataService.history).mockResolvedValue({
      items: [{ id: 7, deviceId: 'A', recordedAt: '2026-10-17T20:06:54+05:30', receivedAt: '2026-10-17T20:06:55+05:30', fix: true, source: 'gps', lat: 28.58, lon: 77.39, altM: 200, speedKmh: 0, signalPct: 80 }],
      page: 1, pageSize: 20, totalCount: 1, totalPages: 1, hasNextPage: false,
    });
    mount();
    expect(await screen.findByText('Location history')).toBeInTheDocument();
    expect(await screen.findByText('2026-10-17 20:06:54')).toBeInTheDocument();      // IST wall-clock text, not shifted by the browser time zone
    const notes = screen.getByText('Data notes'), history = screen.getByText('Location history');
    expect(notes.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gpsDataService.history).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20, sortDir: 'desc' }));
  });

  it('devices without GPS data are listed but not on the map', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'A'), dev(2, 'B')]));
    vi.mocked(gpsDataService.list).mockResolvedValue([gps('A', recent())]);
    mount();
    await waitFor(() => expect(screen.getByTestId('map')).toHaveAttribute('data-markers', '1'));
    expect(screen.getByText('Name B')).toBeInTheDocument();
    expect(screen.getByText('No GPS data')).toBeInTheDocument();
  });

  it('Admin/User see only authorised devices; GPS rows of other devices are not shown or named', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'MINE')]));
    vi.mocked(gpsDataService.list).mockResolvedValue([gps('MINE', recent()), gps('SECRET-1', recent()), gps('SECRET-2', recent())]);
    const { container } = mount();
    await waitFor(() => expect(screen.getByTestId('map')).toHaveAttribute('data-markers', '1'));
    expect(container.textContent).not.toContain('SECRET');
    await userEvent.click(screen.getByText('Data notes'));
    expect(await screen.findByText(/2 from devices outside your permitted scope/)).toBeInTheDocument();
  });

  it('distinguishes "no devices available"', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([]));
    vi.mocked(gpsDataService.list).mockResolvedValue([gps('X', recent())]);
    mount();
    expect(await screen.findByText(/No devices available/)).toBeInTheDocument();
  });

  it('distinguishes "devices available but no GPS reports"', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'A')]));
    vi.mocked(gpsDataService.list).mockResolvedValue([]);
    mount();
    expect(await screen.findByText(/No GPS reports yet/)).toBeInTheDocument();
    expect(screen.getByText('Name A')).toBeInTheDocument();
  });

  it('distinguishes "GPS reports exist but outside the permitted scope"', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'MINE')]));
    vi.mocked(gpsDataService.list).mockResolvedValue([gps('SOMEONE-ELSE', recent())]);
    mount();
    expect(await screen.findByText(/GPS reports are outside your permitted scope/)).toBeInTheDocument();
  });

  it('a GPS API failure shows "GPS service unavailable", not an empty device list', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'A')]));
    vi.mocked(gpsDataService.list).mockRejectedValue(new Error('boom'));
    mount();
    expect(await screen.findByText(/GPS service unavailable/)).toBeInTheDocument();
    expect(screen.getByText('Name A')).toBeInTheDocument();           // devices are still listed
    expect(screen.queryByText(/No devices available/)).not.toBeInTheDocument();
  });

  it('a device-list failure is an error state, not "no devices"', async () => {
    vi.mocked(devicesApi.list).mockRejectedValue(new Error('403'));
    vi.mocked(gpsDataService.list).mockResolvedValue([]);
    mount();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/No devices available/)).not.toBeInTheDocument();
  });

  it('selecting a device from the list centres the map on it and refreshes it via /gps-data/current', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'A'), dev(2, 'B')]));
    vi.mocked(gpsDataService.list).mockResolvedValue([gps('A', recent()), gps('B', recent())]);
    mount();
    await waitFor(() => expect(screen.getByTestId('map')).toHaveAttribute('data-markers', '2'));
    await userEvent.click(screen.getByRole('button', { name: 'Select device B' }));
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', 'B');
    expect(screen.getByTestId('map').getAttribute('data-focus')).toMatch(/^B#/);
    expect(gpsDataService.current).toHaveBeenCalledWith('B');
  });

  it('Refresh reloads the data without clearing the selection', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'A')]));
    vi.mocked(gpsDataService.list).mockResolvedValue([gps('A', recent())]);
    mount();
    await waitFor(() => expect(screen.getByTestId('map')).toHaveAttribute('data-markers', '1'));
    await userEvent.click(screen.getByRole('button', { name: 'Select device A' }));
    const before = vi.mocked(gpsDataService.list).mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: /^refresh$/i }));
    await waitFor(() => expect(vi.mocked(gpsDataService.list).mock.calls.length).toBe(before + 1));
    expect(screen.getByTestId('map')).toHaveAttribute('data-selected', 'A');
  });

  it('Fit all markers asks the map to refit', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'A')]));
    vi.mocked(gpsDataService.list).mockResolvedValue([gps('A', recent())]);
    mount();
    await waitFor(() => expect(screen.getByTestId('map')).toHaveAttribute('data-markers', '1'));
    await userEvent.click(screen.getByRole('button', { name: /fit all markers/i }));
    expect(screen.getByTestId('map')).toHaveAttribute('data-fit', '1');
  });

  it('small screens can collapse the device list', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'A')]));
    vi.mocked(gpsDataService.list).mockResolvedValue([gps('A', recent())]);
    mount();
    await screen.findByText('Name A');
    await userEvent.click(screen.getByRole('button', { name: /hide device list/i }));
    expect(screen.getByRole('button', { name: /show device list/i })).toBeInTheDocument();
  });
});

describe('automatic refresh', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it('polls on the interval, never overlaps requests, and stops on unmount', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'A')]));
    let release: (v: GpsLocationDto[]) => void = () => undefined;
    vi.mocked(gpsDataService.list).mockImplementationOnce(() => new Promise((r) => { release = r; })); // first read stays pending
    const { unmount } = renderHook(() => useDeviceLocations());
    expect(gpsDataService.list).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });  // interval fires while the first call is still pending
    expect(gpsDataService.list).toHaveBeenCalledTimes(1);                    // ...so no second request starts

    vi.mocked(gpsDataService.list).mockResolvedValue([gps('A', recent())]);
    await act(async () => { release([]); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(gpsDataService.list).toHaveBeenCalledTimes(2);                    // the next interval polls again

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(gpsDataService.list).toHaveBeenCalledTimes(2);                    // nothing after unmount
  });

  it('keeps the last good data when a later refresh fails', async () => {
    vi.mocked(devicesApi.list).mockResolvedValue(paged([dev(1, 'A')]));
    vi.mocked(gpsDataService.list).mockResolvedValueOnce([gps('A', recent())]).mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useDeviceLocations());
    await waitFor(() => expect(result.current.summary.withPosition).toBe(1));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.gpsError).toBeTruthy();
    expect(result.current.summary.withPosition).toBe(1);   // last good position is still shown
  });
});

/* ---------- the real Leaflet map (jsdom) ---------- */

const locationsOf = (lat: number, lon: number): DeviceLocation[] =>
  buildLocations([gps('A', recent(), { lat, lon })], [dev(1, 'A')], { now: Date.now(), staleMs: 600_000 }).locations;

describe('DeviceMap camera', () => {
  // the REAL map component (the page tests above replace it with a probe)
  let RealMap: typeof DeviceMapType;
  beforeAll(async () => { RealMap = (await vi.importActual<typeof import('../features/device-map/components/DeviceMap')>('../features/device-map/components/DeviceMap')).DeviceMap; });
  const renderMap = (props: Partial<React.ComponentProps<typeof DeviceMapType>>, onMapReady: (m: L.Map) => void) => (
    <RealMap locations={locationsOf(28.5, 77.4)} selectedId={null} focus={null} fitToken={0} onSelect={() => undefined} renderPopup={() => null} animate={false} onMapReady={onMapReady} {...props} />
  );

  it('a data refresh moves the marker but does not reset the user’s zoom or centre', async () => {
    let map!: L.Map;
    const { rerender } = render(renderMap({}, (m) => { map = m; }));
    await waitFor(() => expect(map).toBeTruthy());
    map.setView([12, 34], 7, { animate: false });                         // the user pans and zooms
    rerender(renderMap({ locations: locationsOf(28.6, 77.5) }, (m) => { map = m; })); // a refresh delivers a new position
    expect(map.getZoom()).toBe(7);
    expect(map.getCenter().lat).toBeCloseTo(12, 3);
    expect(map.getCenter().lng).toBeCloseTo(34, 3);
  });

  it('selecting a device centres the map on its marker', async () => {
    let map!: L.Map;
    const { rerender } = render(renderMap({}, (m) => { map = m; }));
    await waitFor(() => expect(map).toBeTruthy());
    map.setView([12, 34], 5, { animate: false });
    rerender(renderMap({ selectedId: 'A', focus: { id: 'A', token: 1 } }, (m) => { map = m; }));
    expect(map.getCenter().lat).toBeCloseTo(28.5, 3);
    expect(map.getCenter().lng).toBeCloseTo(77.4, 3);
    expect(map.getZoom()).toBeGreaterThanOrEqual(15);
  });

  it('Fit all markers refits only when asked', async () => {
    let map!: L.Map;
    const { rerender } = render(renderMap({}, (m) => { map = m; }));
    await waitFor(() => expect(map).toBeTruthy());
    map.setView([12, 34], 5, { animate: false });
    rerender(renderMap({ fitToken: 0 }, (m) => { map = m; }));            // same token: stays where the user left it
    expect(map.getZoom()).toBe(5);
    rerender(renderMap({ fitToken: 1 }, (m) => { map = m; }));            // explicit fit
    expect(map.getCenter().lat).toBeCloseTo(28.5, 3);
  });
});
