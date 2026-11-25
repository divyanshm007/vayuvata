import { describe, expect, it } from 'vitest';
import { buildReadingsPdf, exportFileName } from '../utils/exportExcel';
import type { SensorDataDto } from '../types/api';

const reading = (i: number, over: Partial<SensorDataDto> = {}): SensorDataDto => ({
  id: i, deviceId: 'Vayu_004', dataDate: '2026-11-12', dataTime: '10:00:00', recordedAt: '2026-11-12T10:00:00Z', aqi: 120 + i, aqiStatus: 'Moderate',
  pm10: 80.5, pm25: 45.2, no2Ppm: 0.93, so2Ppm: 1.09, coPpm: 4.99, tvocPpb: 310, humidity: 47.7, temperature: 32.4, outerTemperature: 29.4, outerHumidity: 52.1, createdAt: '2026-11-12T10:00:30Z', ...over,
} as SensorDataDto);

async function build(rows: SensorDataDto[]) {
  const doc = await buildReadingsPdf(rows, { title: 'Sensor readings · Vayu_004', subtitle: 'From 2026-11-01 to now · times are IST' });
  return doc.output('arraybuffer');
}

describe('PDF export of readings', () => {
  it('produces a real PDF document', async () => {
    const pdf = await build([reading(1), reading(2)]);
    expect(new TextDecoder().decode(new Uint8Array(pdf).slice(0, 5))).toBe('%PDF-');
  });

  it('handles empty values (a reading without outer temperature / humidity) and many rows over several pages', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => reading(i, i % 3 === 0 ? { outerTemperature: null, outerHumidity: null, aqi: null, aqiStatus: null } : {}));
    const pdf = await build(rows);
    const text = new TextDecoder('latin1').decode(new Uint8Array(pdf));
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(2);               // 150 rows do not fit on one page
  });

  it('builds a dynamic report: several devices, one reading, no readings and identical times do not break it', async () => {
    const pages = async (rows: SensorDataDto[], inner = false) => (await buildReadingsPdf(rows, { title: 'T', inner })).getNumberOfPages();
    const multi = [...Array.from({ length: 30 }, (_, i) => reading(i, { recordedAt: `2026-11-12T${String(i % 24).padStart(2, '0')}:00:00Z` })), ...Array.from({ length: 30 }, (_, i) => reading(100 + i, { deviceId: 'Vayu_005', recordedAt: `2026-11-13T${String(i % 24).padStart(2, '0')}:00:00Z` }))];
    expect(await pages(multi, true)).toBeGreaterThan(3);                                  // cover + a block per device
    expect(await pages([reading(1)])).toBeGreaterThan(0);
    expect(await pages([])).toBe(1);
    expect(await pages(Array.from({ length: 10 }, (_, i) => reading(i)))).toBeGreaterThan(0);   // all at the same time
  });

  it('buckets many rows into at most 96 chart points', async () => {
    const { bucketRows } = await import('../utils/reportPdf');
    const rows = Array.from({ length: 5000 }, (_, i) => reading(i, { recordedAt: `2026-11-12T10:00:00Z` }));
    expect(bucketRows(rows).length).toBeLessThanOrEqual(96);
  });

  it('file names use the .pdf extension', () => {
    expect(exportFileName(['Vayu_004', '2026-11-01'], 'pdf')).toMatch(/^vayuvata-Vayu_004-2026-11-01-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
