import MockAdapter from 'axios-mock-adapter';
import { http } from '../api/client';
import { gpsDataService } from '../features/device-map/services/gpsDataService';

const dto = { id: 7, deviceId: 'Vayu_004', recordedAt: '2026-10-14T02:36:45+05:30', receivedAt: '2026-10-14T02:36:50+05:30', fix: true, source: 'gps', lat: 28.580742, lon: 77.398432, altM: 239.9, speedKmh: 0, signalPct: 83 };

describe('gpsDataService', () => {
  let api: MockAdapter;
  beforeEach(() => { api = new MockAdapter(http); });
  afterEach(() => api.restore());

  it('reads the GPS list from GET /gps-data', async () => {
    api.onGet('/gps-data').reply(200, [dto]);
    expect(await gpsDataService.list()).toHaveLength(1);
  });

  it('asks for the current position with the deviceId query parameter and parses the time', async () => {
    api.onGet('/gps-data/current').reply(200, dto);
    const res = await gpsDataService.current('Vayu_004');
    expect(api.history.get[0].params).toEqual({ deviceId: 'Vayu_004' });
    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.report.recordedMs).toBe(Date.parse('2026-10-14T02:36:45+05:30'));
  });

  it('maps 404 to "no data" and 409 to "inactive" instead of failing', async () => {
    api.onGet('/gps-data/current').replyOnce(404, { code: 'not_found' }).onGet('/gps-data/current').replyOnce(409, { code: 'device_inactive' });
    expect((await gpsDataService.current('X')).kind).toBe('none');
    expect((await gpsDataService.current('Y')).kind).toBe('inactive');
  });

  it('lets real failures (server error, network) propagate', async () => {
    api.onGet('/gps-data/current').replyOnce(500).onGet('/gps-data/current').networkErrorOnce();
    await expect(gpsDataService.current('X')).rejects.toBeTruthy();
    await expect(gpsDataService.current('X')).rejects.toBeTruthy();
  });
});
