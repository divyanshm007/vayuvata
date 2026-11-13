import writeXlsxFile from 'write-excel-file';
import { sensorApi } from '../api/services';
import type { SensorDataDto, SensorDataQuery } from '../types/api';

/** Upper bound of rows in one export (50 requests of 100). The backend caps a page at 100 rows. */
export const EXPORT_MAX_ROWS = 5000;
const PAGE = 100;

export interface ExportResult { rows: SensorDataDto[]; truncated: boolean }

/**
 * Fetches every reading matching the filters, newest first, through the scoped GET /sensor-data endpoint
 * (so a User only ever exports their own devices). Stops at EXPORT_MAX_ROWS and says so.
 */
export async function fetchReadingsForExport(q: Omit<SensorDataQuery, 'page' | 'pageSize' | 'includeTotal'>, max = EXPORT_MAX_ROWS): Promise<ExportResult> {
  const rows: SensorDataDto[] = [];
  for (let page = 1; rows.length < max; page++) {
    const res = await sensorApi.list({ ...q, page, pageSize: PAGE, includeTotal: false });
    rows.push(...res.items);
    if (!res.hasNextPage || res.items.length === 0) return { rows, truncated: false };
  }
  return { rows: rows.slice(0, max), truncated: true };
}

/** "2026-10-17T14:26:58Z" -> "2026-10-17 14:26:58". Sensor times are IST wall-clock labelled Z, so no zone conversion is done. */
const wall = (iso: string | null | undefined) => (iso ? iso.replace('T', ' ').replace(/(\.\d+)?Z?$/, '') : '');

/** Builds and downloads a real .xlsx file of the readings. Times are IST wall-clock text, numbers stay numeric (empty when the device did not send the value). */
export async function downloadReadingsXlsx(rows: SensorDataDto[], fileName: string, inner = false): Promise<void> {
  const num = (get: (r: SensorDataDto) => number | null | undefined, decimals: number) => ({
    type: Number as NumberConstructor, format: decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`,
    value: (r: SensorDataDto) => { const v = get(r); return v === null || v === undefined ? undefined : v; },
  });
  const schema = [
    { column: 'Device', type: String, width: 14, value: (r: SensorDataDto) => r.deviceId },
    { column: 'Recorded (IST)', type: String, width: 20, value: (r: SensorDataDto) => wall(r.recordedAt) },
    { column: 'AQI', width: 8, ...num((r) => r.aqi, 0) },
    { column: 'AQI status', type: String, width: 14, value: (r: SensorDataDto) => r.aqiStatus ?? undefined },
    { column: 'PM2.5 (µg/m³)', width: 14, ...num((r) => r.pm25, 1) },
    { column: 'PM10 (µg/m³)', width: 14, ...num((r) => r.pm10, 1) },
    { column: 'NO₂', width: 10, ...num((r) => r.no2Ppm, 3) },
    { column: 'SO₂', width: 10, ...num((r) => r.so2Ppm, 3) },
    { column: 'CO (ppm)', width: 10, ...num((r) => r.coPpm, 2) },
    { column: 'TVOC (ppb)', width: 11, ...num((r) => r.tvocPpb, 0) },
    { column: inner ? 'Inner temperature (°C)' : 'Temperature (°C)', width: 20, ...num((r) => r.temperature, 1) },
    { column: 'Humidity (%)', width: 13, ...num((r) => r.humidity, 1) },
    ...(inner ? [{ column: 'Outer temperature (°C)', width: 21, ...num((r) => r.outerTemperature, 1) }] : []),
    { column: 'Outer humidity (%)', width: 18, ...num((r) => r.outerHumidity, 1) },
  ];
  await writeXlsxFile(rows, { schema, fileName, headerStyle: { fontWeight: 'bold', backgroundColor: '#E8F3EC' }, stickyRowsCount: 1 } as never);
}

/**
 * Builds and downloads a PDF table of the readings (A4 landscape, header repeated on every page, page numbers).
 * The PDF library is loaded only when this is called, so it adds nothing to the normal page load.
 * Same columns and wall-clock times as the Excel export; the standard PDF font has no subscripts, so NO2 / SO2 are written plainly.
 */
export async function buildReadingsPdf(rows: SensorDataDto[], opts: { title: string; subtitle?: string; inner?: boolean }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  doc.setFontSize(14); doc.setTextColor(20);
  doc.text(opts.title, 40, 36);
  doc.setFontSize(9); doc.setTextColor(90);
  doc.text([opts.subtitle ?? '', `${rows.length} reading${rows.length === 1 ? '' : 's'} · generated ${new Date().toLocaleString()}`].filter(Boolean), 40, 52);
  const n = (v: number | null | undefined, d: number) => (v === null || v === undefined ? '' : v.toFixed(d));
  autoTable(doc, {
    startY: opts.subtitle ? 82 : 72,
    head: [['Device', 'Recorded (IST)', 'AQI', 'AQI status', 'PM2.5 (µg/m³)', 'PM10 (µg/m³)', 'NO2', 'SO2', 'CO (ppm)', 'TVOC (ppb)', opts.inner ? 'Inner temp (°C)' : 'Temp (°C)', 'Humidity (%)', ...(opts.inner ? ['Outer temp (°C)'] : []), 'Outer hum. (%)']],
    body: rows.map((r) => [r.deviceId, wall(r.recordedAt), n(r.aqi, 0), r.aqiStatus ?? '', n(r.pm25, 1), n(r.pm10, 1), n(r.no2Ppm, 3), n(r.so2Ppm, 3), n(r.coPpm, 2), n(r.tvocPpb, 0), n(r.temperature, 1), n(r.humidity, 1), ...(opts.inner ? [n(r.outerTemperature, 1)] : []), n(r.outerHumidity, 1)]),
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [22, 101, 52], textColor: 255 },
    alternateRowStyles: { fillColor: [243, 248, 245] },
    margin: { left: 40, right: 40, bottom: 30 },
    didDrawPage: () => {
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`Page ${doc.getNumberOfPages()}`, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 14, { align: 'right' });
    },
  });
  return doc;
}

/** Builds the PDF and starts the download. */
export async function downloadReadingsPdf(rows: SensorDataDto[], fileName: string, opts: { title: string; subtitle?: string; inner?: boolean }): Promise<void> {
  (await buildReadingsPdf(rows, opts)).save(fileName);
}

export const exportFileName = (parts: Array<string | undefined>, ext = 'xlsx') =>
  `vayuvata-${parts.filter(Boolean).join('-').replace(/[^A-Za-z0-9._-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.${ext}`;
