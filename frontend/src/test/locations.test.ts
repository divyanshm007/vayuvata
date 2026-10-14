import { buildLocations, classify, summarize } from '../features/device-map/utils/locations';
import type { GpsLocationDto } from '../features/device-map/types';
import type { DeviceDto } from '../types/api';

// Fixtures only: these never touch the real database.
const dev = (id: number, deviceId: string, over: Partial<DeviceDto> = {}): DeviceDto => ({
  id, deviceId, deviceName: `Device ${deviceId}`, description: null, isActive: true, createdAt: '2026-10-01T00:00:00', updatedAt: null,
  assignedUserId: null, assignedUserName: null, assignedAt: null, ...over,
});
let nextId = 1;
const gps = (deviceId: string, recordedAt: string, over: Partial<GpsLocationDto> = {}): GpsLocationDto => ({
  id: nextId++, deviceId, recordedAt, receivedAt: recordedAt, fix: true, source: 'gps', lat: 28.58, lon: 77.39, altM: 200, speedKmh: 0, signalPct: 80, ...over,
});
const NOW = Date.parse('2026-10-14T12:00:00+05:30');
const opts = { now: NOW, staleMs: 10 * 60_000 };

describe('buildLocations', () => {
  it('one GPS report produces one marker position', () => {
    const { locations } = buildLocations([gps('A', '2026-10-14T11:59:00+05:30', { lat: 28.1, lon: 77.2 })], [dev(1, 'A')], opts);
    expect(locations).toHaveLength(1);
    expect(locations[0].position).toMatchObject({ lat: 28.1, lon: 77.2 });
  });

  it('many historical reports of one device give a single latest marker, chosen by GPS time not by response order', () => {
    const rows = [
      gps('A', '2026-10-14T11:00:00+05:30', { lat: 10, lon: 10 }),
      gps('A', '2026-10-14T11:58:00+05:30', { lat: 20, lon: 20 }),   // newest, but not first in the response
      gps('A', '2026-10-14T11:30:00+05:30', { lat: 30, lon: 30 }),
    ];
    const { locations } = buildLocations(rows, [dev(1, 'A')], opts);
    expect(locations).toHaveLength(1);
    expect(locations[0].position).toMatchObject({ lat: 20, lon: 20 });
  });

  it('five different devices produce five markers when each has a valid latest position', () => {
    const ids = ['A', 'B', 'C', 'D', 'E'];
    const rows = ids.flatMap((d, i) => [gps(d, '2026-10-14T11:00:00+05:30', { lat: 1, lon: 1 }), gps(d, '2026-10-14T11:50:00+05:30', { lat: 10 + i, lon: 70 + i })]);
    const { locations } = buildLocations(rows, ids.map((d, i) => dev(i + 1, d)), opts);
    const markers = locations.filter((l) => l.position);
    expect(markers).toHaveLength(5);
    expect(markers.map((m) => m.position!.lat).sort((a, b) => a! - b!)).toEqual([10, 11, 12, 13, 14]);
  });

  it('identical timestamps use the larger report id as a stable tie-break', () => {
    const t = '2026-10-14T11:00:00+05:30';
    const a = gps('A', t, { lat: 1, lon: 1 });
    const b = gps('A', t, { lat: 2, lon: 2 });
    expect(buildLocations([a, b], [dev(1, 'A')], opts).locations[0].position!.lat).toBe(b.lat);
    expect(buildLocations([b, a], [dev(1, 'A')], opts).locations[0].position!.lat).toBe(b.lat);
  });

  it('excludes invalid coordinates and reports them in diagnostics, never substituting zero', () => {
    const rows = [
      gps('A', '2026-10-14T11:00:00+05:30', { lat: 91, lon: 10 }),          // out of range
      gps('A', '2026-10-14T11:01:00+05:30', { lat: 10, lon: 181 }),         // out of range
      gps('A', '2026-10-14T11:02:00+05:30', { lat: null, lon: 10 }),        // fix=true but no latitude
      gps('A', '2026-10-14T11:03:00+05:30', { lat: 0, lon: 0 }),            // zero-filled
      gps('A', '2026-10-14T11:04:00+05:30', { recordedAt: 'not-a-date' }),  // unreadable time
    ];
    const { locations, diagnostics } = buildLocations(rows, [dev(1, 'A')], opts);
    expect(locations[0].position).toBeNull();
    expect(diagnostics.invalidRows.map((r) => r.reason).sort()).toEqual(['bad_timestamp', 'missing_coordinates', 'null_island', 'out_of_range', 'out_of_range']);
  });

  it('a valid older position survives newer invalid rows', () => {
    const rows = [gps('A', '2026-10-14T11:00:00+05:30', { lat: 5, lon: 6 }), gps('A', '2026-10-14T11:30:00+05:30', { lat: 999, lon: 6 })];
    expect(buildLocations(rows, [dev(1, 'A')], opts).locations[0].position).toMatchObject({ lat: 5, lon: 6 });
  });

  it('devices without GPS data stay in the list but have no map position', () => {
    const { locations } = buildLocations([gps('A', '2026-10-14T11:00:00+05:30')], [dev(1, 'A'), dev(2, 'B')], opts);
    expect(locations.map((l) => l.device.deviceId)).toEqual(['A', 'B']);
    expect(locations[1].position).toBeNull();
    expect(locations[1].latest).toBeNull();
  });

  it('a newer no-fix report keeps the last known position and flags it', () => {
    const rows = [gps('A', '2026-10-14T11:00:00+05:30', { lat: 7, lon: 8 }), gps('A', '2026-10-14T11:50:00+05:30', { fix: false, lat: null, lon: null, altM: null, speedKmh: null })];
    const { locations, diagnostics } = buildLocations(rows, [dev(1, 'A')], opts);
    expect(locations[0].position).toMatchObject({ lat: 7, lon: 8 });
    expect(locations[0].noFixNewer).toBe(true);
    expect(diagnostics.noFixRows).toBe(1);
  });

  it('marks positions older than the threshold as stale', () => {
    const rows = [gps('A', '2026-10-14T11:55:00+05:30'), gps('B', '2026-10-14T10:00:00+05:30')];
    const { locations } = buildLocations(rows, [dev(1, 'A'), dev(2, 'B')], opts);
    expect(locations.map((l) => l.stale)).toEqual([false, true]);
    expect(summarize(locations)).toEqual({ total: 2, withPosition: 2, withoutGps: 0, stale: 1 });
  });

  describe('role scope: only authorised devices are ever exposed', () => {
    const allRows = [gps('MINE-1', '2026-10-14T11:00:00+05:30'), gps('MINE-2', '2026-10-14T11:00:00+05:30'), gps('OTHER-1', '2026-10-14T11:00:00+05:30'), gps('OTHER-2', '2026-10-14T11:00:00+05:30')];

    it('Admin / User view contains only the devices the device API returned', () => {
      const authorised = [dev(1, 'MINE-1'), dev(2, 'MINE-2')]; // what GET /devices returns for that caller
      const { locations, diagnostics } = buildLocations(allRows, authorised, opts);
      expect(locations.map((l) => l.device.deviceId)).toEqual(['MINE-1', 'MINE-2']);
      expect(JSON.stringify(locations)).not.toContain('OTHER');
      expect(diagnostics.outOfScopeRows).toBe(2);
      expect(JSON.stringify(diagnostics)).not.toContain('OTHER'); // out-of-scope ids are not even kept
    });

    it('an empty authorised list shows nothing, even though GPS rows exist', () => {
      const { locations, diagnostics } = buildLocations(allRows, [], opts);
      expect(locations).toEqual([]);
      expect(diagnostics.outOfScopeRows).toBe(4);
    });

    it('device ids match case-insensitively', () => {
      expect(buildLocations([gps('vayu_004', '2026-10-14T11:00:00+05:30')], [dev(1, 'Vayu_004')], opts).locations[0].position).not.toBeNull();
    });
  });
});

describe('classify', () => {
  it('treats fix=false as a valid no-fix report without a position', () => {
    const c = classify(gps('A', '2026-10-14T11:00:00+05:30', { fix: false, lat: null, lon: null }));
    expect(c.kind).toBe('nofix');
  });
});
