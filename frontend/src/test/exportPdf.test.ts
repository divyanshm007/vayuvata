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

  it('file names use the .pdf extension', () => {
    expect(exportFileName(['Vayu_004', '2026-11-01'], 'pdf')).toMatch(/^vayuvata-Vayu_004-2026-11-01-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});
