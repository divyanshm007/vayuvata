import type { jsPDF } from 'jspdf';
import type { SensorDataDto } from '../types/api';

/**
 * Dynamic air-quality PDF built from whatever rows the current filters selected.
 * Summary tiles, vector charts (stay sharp when zoomed), a pollutant table, time per AQI category and a sampled readings table,
 * plus what a PDF can really do: clickable contents and bookmarks.
 * The standard PDF font has no subscripts, so NO2 / SO2 are written plainly.
 */
type RGB = [number, number, number];
export interface ReportOptions { title: string; subtitle?: string; inner?: boolean }

/** India AQI categories. */
export const AQI_BANDS: Array<[number, number, RGB, string]> = [
  [0, 50, [0, 176, 80], 'Good'], [50, 100, [146, 208, 80], 'Satisfactory'], [100, 200, [255, 192, 0], 'Moderate'],
  [200, 300, [255, 128, 0], 'Poor'], [300, 400, [220, 38, 38], 'Very Poor'], [400, Infinity, [136, 14, 79], 'Severe'],
];
export const aqiBand = (v: number) => AQI_BANDS.find(([lo, hi]) => v >= lo && v < hi) ?? AQI_BANDS[AQI_BANDS.length - 1];

const NA = '(Not Available)';
const GREEN: RGB = [22, 101, 52];
const GREY: RGB = [80, 80, 80];
const LINK: RGB = [30, 64, 175];
const MAX_POINTS = 96, MAX_TABLE_ROWS = 48, MAX_DEVICES = 8;

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const nums = (rows: SensorDataDto[], get: (r: SensorDataDto) => number | null | undefined) => rows.map(get).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
const fmt = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? NA : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d }));
const wall = (iso: string | null | undefined) => (iso ? iso.replace('T', ' ').replace(/(\.\d+)?Z?$/, '') : '');
const minute = (iso: string) => wall(iso).slice(0, 16);

type Metric = { key: string; get: (r: SensorDataDto) => number | null | undefined };
const FIELDS: Metric[] = [
  { key: 'aqi', get: (r) => r.aqi }, { key: 'pm25', get: (r) => r.pm25 }, { key: 'pm10', get: (r) => r.pm10 },
  { key: 'no2', get: (r) => r.no2Ppm }, { key: 'so2', get: (r) => r.so2Ppm }, { key: 'co', get: (r) => r.coPpm }, { key: 'tvoc', get: (r) => r.tvocPpb },
  { key: 'temp', get: (r) => r.temperature }, { key: 'hum', get: (r) => r.humidity ?? r.outerHumidity },
  { key: 'otemp', get: (r) => r.outerTemperature }, { key: 'ohum', get: (r) => r.outerHumidity },
];
type Point = { at: string } & Record<string, number | null | string>;

/** Averages equal-count chunks of the (oldest-first) rows into at most MAX_POINTS chart points. */
export function bucketRows(rows: SensorDataDto[], max = MAX_POINTS): Point[] {
  const size = Math.max(1, Math.ceil(rows.length / max));
  const out: Point[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const p: Point = { at: chunk[Math.floor(chunk.length / 2)].recordedAt };
    for (const f of FIELDS) p[f.key] = avg(nums(chunk, f.get));
    out.push(p);
  }
  return out;
}

const sample = <T,>(a: T[], max: number) => (a.length <= max ? a : Array.from({ length: max }, (_, i) => a[Math.round((i * (a.length - 1)) / (max - 1))]));

export async function buildReport(rows: SensorDataDto[], opts: ReportOptions): Promise<jsPDF> {
  const [{ jsPDF: PDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new PDF({ unit: 'pt', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const tableLook = { margin: { left: M, right: M, top: 70, bottom: 40 }, headStyles: { fillColor: GREEN }, alternateRowStyles: { fillColor: [243, 248, 245] as RGB }, didDrawPage: () => pageHeader() };

  const pageHeader = () => {
    doc.setFillColor(...GREEN); doc.rect(0, 0, W, 54, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('LIVVAir Protect', M, 34);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(opts.title, W - M, 34, { align: 'right', maxWidth: W - 2 * M - 130 });
    doc.setTextColor(30);
  };
  const newPage = () => { doc.addPage(); pageHeader(); return 80; };
  const ensure = (y: number, need: number) => (y + need > H - 40 ? newPage() : y);
  const section = (title: string, y: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...GREEN); doc.text(title, M, y);
    doc.setDrawColor(...GREEN); doc.setLineWidth(0.6); doc.line(M, y + 5, W - M, y + 5); doc.setTextColor(30); doc.setFont('helvetica', 'normal');
    return y + 22;
  };

  function lineChart(x: number, y: number, w: number, h: number, title: string, data: Point[], key: string, color: RGB, bands: boolean, second?: { key: string; color: RGB; label: string; first: string }) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30); doc.text(title, x, y - 6);
    const vals = ([] as number[]).concat(data.flatMap((p) => [p[key], second ? p[second.key] : null]).filter((v): v is number => typeof v === 'number'));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
    if (data.length < 2 || vals.length < 2) { doc.text('Not enough readings in this period to draw a chart.', x + 34, y + h / 2); return; }
    const lo = Math.min(0, ...vals), hi = Math.ceil((Math.max(...vals) * 1.1) / 50) * 50 || 50;
    const px = (i: number) => x + 34 + (i / Math.max(1, data.length - 1)) * (w - 40);
    const py = (v: number) => y + h - 18 - ((v - lo) / (hi - lo)) * (h - 26);
    if (bands) for (const [b0, b1, c] of AQI_BANDS) {
      const t0 = Math.max(b0, lo), t1 = Math.min(b1, hi);
      if (t1 > t0) { doc.setFillColor(...(c.map((v) => 255 - (255 - v) * 0.16) as RGB)); doc.rect(x + 34, py(t1), w - 40, py(t0) - py(t1), 'F'); }
    }
    doc.setDrawColor(210); doc.setLineWidth(0.4); doc.setFontSize(7);
    for (let i = 0; i <= 4; i++) { const v = lo + ((hi - lo) * i) / 4; doc.line(x + 34, py(v), x + w - 6, py(v)); doc.text(String(Math.round(v)), x + 30, py(v) + 2, { align: 'right' }); }
    const last = data.length - 1;
    [0, Math.floor(last / 2), last].forEach((i, n) => doc.text(minute(data[i].at).slice(5), px(i), y + h - 4, { align: n === 0 ? 'left' : n === 2 ? 'right' : 'center' }));
    const draw = (k: string, c: RGB) => {
      doc.setDrawColor(...c); doc.setLineWidth(1.4);
      let prev: [number, number] | null = null;
      data.forEach((p, i) => { const v = p[k]; if (typeof v !== 'number') { prev = null; return; } const cur: [number, number] = [px(i), py(v)]; if (prev) doc.line(prev[0], prev[1], cur[0], cur[1]); prev = cur; });
    };
    draw(key, color);
    if (second) {
      draw(second.key, second.color);
      doc.setFillColor(...color); doc.rect(x + w - 130, y - 12, 8, 3, 'F'); doc.text(second.first, x + w - 118, y - 9);
      doc.setFillColor(...second.color); doc.rect(x + w - 70, y - 12, 8, 3, 'F'); doc.text(second.label, x + w - 58, y - 9);
    }
    doc.setLineWidth(0.6);
  }

  function bandBar(x: number, y: number, w: number, h: number, counts: Record<string, number>) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    let cx = x;
    for (const [, , c, name] of AQI_BANDS) {
      const share = (counts[name] ?? 0) / total, bw = share * w;
      if (bw <= 0) continue;
      doc.setFillColor(...c); doc.rect(cx, y, bw, h, 'F');
      if (bw > 34) { doc.setTextColor(255); doc.setFontSize(7); doc.text(`${Math.round(share * 100)}%`, cx + bw / 2, y + h / 2 + 2.5, { align: 'center' }); }
      cx += bw;
    }
    doc.setTextColor(60); doc.setFontSize(7); let lx = x;
    for (const [, , c, name] of AQI_BANDS) { doc.setFillColor(...c); doc.rect(lx, y + h + 8, 7, 7, 'F'); doc.text(name, lx + 10, y + h + 14); lx += 78; }
  }

  // ---------------------------------------------------------------- group by device (oldest first inside a device)
  const byDevice = new Map<string, SensorDataDto[]>();
  for (const r of [...rows].sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0))) {
    const list = byDevice.get(r.deviceId); if (list) list.push(r); else byDevice.set(r.deviceId, [r]);
  }
  const allDevices = [...byDevice.entries()];
  const devices = allDevices.slice(0, MAX_DEVICES);
  const generated = new Date().toLocaleString('en-IN');
  const range = rows.length ? `${minute(allDevices.reduce((m, [, l]) => (l[0].recordedAt < m ? l[0].recordedAt : m), allDevices[0][1][0].recordedAt))} to ${minute(allDevices.reduce((m, [, l]) => (l[l.length - 1].recordedAt > m ? l[l.length - 1].recordedAt : m), ''))} (IST)` : '';
  const multi = devices.length > 1;

  pageHeader();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(30); doc.text('Air Quality Report', M, 92);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(90);
  const head = [opts.subtitle, range && `Data from ${range}`, `${rows.length.toLocaleString('en-IN')} reading${rows.length === 1 ? '' : 's'} · generated ${generated}`].filter(Boolean) as string[];
  doc.text(doc.splitTextToSize(head.join('\n'), W - 2 * M), M, 108);
  let y = 108 + head.length * 13 + 14;
  doc.outline.add(null, 'Summary', { pageNumber: 1 });

  if (!rows.length) {
    doc.setFontSize(11); doc.setTextColor(30); doc.text('No readings match the selected filters, so there is nothing to chart.', M, y + 10);
  }

  const rowSpots: Array<{ x: number; y: number; w: number; h: number; page: number }> = [];
  if (multi) {
    y = section('Devices in this report (click a row to jump)', y);
    autoTable(doc, {
      ...tableLook, startY: y, styles: { fontSize: 8.5, cellPadding: 4 },
      head: [['Device', 'Readings', 'Latest AQI', 'Average AQI', 'Highest AQI', 'Latest reading (IST)']],
      body: devices.map(([id, list]) => { const a = nums(list, (r) => r.aqi); return [id, fmt(list.length), fmt(list[list.length - 1].aqi), fmt(avg(a)), fmt(a.length ? Math.max(...a) : null), minute(list[list.length - 1].recordedAt)]; }),
      didDrawCell: (d) => { if (d.section === 'body' && d.column.index === 0) rowSpots[d.row.index] = { x: M, y: d.cell.y, w: W - 2 * M, h: d.cell.height, page: doc.getCurrentPageInfo().pageNumber }; },
    });
    y = finalY() + 14;
    if (allDevices.length > devices.length) { doc.setFontSize(8.5); doc.setTextColor(150, 60, 0); doc.text(`Only the first ${MAX_DEVICES} of ${allDevices.length} devices are detailed here; choose a device in the filter for the rest.`, M, y); y += 14; }
  }
  const deviceStart: number[] = [];

  // ---------------------------------------------------------------- one block per device
  devices.forEach(([id, list], di) => {
    const own = multi;
    if (own) { doc.addPage(); pageHeader(); y = 84; }
    deviceStart[di] = doc.getCurrentPageInfo().pageNumber;
    const pts = bucketRows(list);
    const aqiVals = nums(list, (r) => r.aqi), pmA = avg(nums(list, (r) => r.pm25)), pm10A = avg(nums(list, (r) => r.pm10));
    const latest = list[list.length - 1].aqi, aAvg = avg(aqiVals), aMax = aqiVals.length ? Math.max(...aqiVals) : null;
    const tone = (v: number | null | undefined): [RGB, string] => (v === null || v === undefined ? [GREY, '-'] : [aqiBand(v)[2], aqiBand(v)[3]]);
    if (own) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(30); doc.text(`Device ${id}`, M, y); y += 8;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text(`${minute(list[0].recordedAt)} to ${minute(list[list.length - 1].recordedAt)} (IST) · ${fmt(list.length)} readings`, M, y + 10); y += 22;
      doc.outline.add(null, `Device ${id}`, { pageNumber: deviceStart[di] });
    }
    const tiles: Array<[string, string, RGB, string]> = [
      ['Latest AQI', fmt(latest), ...tone(latest)], ['Average AQI', fmt(aAvg), ...tone(aAvg)], ['Highest AQI', fmt(aMax), ...tone(aMax)],
      ['PM2.5 average', pmA === null ? NA : `${fmt(pmA)} µg/m³`, GREY, 'particles'], ['PM10 average', pm10A === null ? NA : `${fmt(pm10A)} µg/m³`, GREY, 'particles'], ['Readings', fmt(list.length), GREY, 'in the period'],
    ];
    const tw = (W - 2 * M - 20) / 3;
    tiles.forEach(([label, value, c, sub], i) => {
      const tx = M + (i % 3) * (tw + 10), ty = y + Math.floor(i / 3) * 62;
      doc.setFillColor(246, 250, 247); doc.setDrawColor(220); doc.setLineWidth(0.6); doc.roundedRect(tx, ty, tw, 54, 5, 5, 'FD'); doc.setFillColor(...c); doc.rect(tx, ty + 6, 4, 42, 'F');
      doc.setFont('helvetica', 'normal'); doc.setTextColor(100); doc.setFontSize(8.5); doc.text(label, tx + 12, ty + 17);
      doc.setTextColor(30); doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(value, tx + 12, ty + 36);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...c); doc.text(sub, tx + 12, ty + 48);
    });
    y += 146;

    if (!own) {
      y = section('Contents (click to jump)', y + 8);
      const toc: Array<[string, number]> = [['1.  Charts: AQI and particles', 1], ['2.  Pollutant summary and readings', 2]];
      doc.setFontSize(10);
      toc.forEach(([label, pg], i) => { doc.setTextColor(...LINK); doc.text(label, M + 4, y + i * 15); doc.text(`page ${pg}`, W - M, y + i * 15, { align: 'right' }); doc.link(M, y + i * 15 - 10, W - 2 * M, 14, { pageNumber: pg }); });
      y += toc.length * 15;
      y += 22;
    }

    y = section('Charts: AQI and particles', y);
    if (!own) doc.outline.add(null, 'Charts: AQI and particles', { pageNumber: 1 });
    y = ensure(y, 190);
    lineChart(M, y + 12, W - 2 * M, 150, 'AQI over the period (coloured bands = India AQI categories)', pts, 'aqi', [20, 20, 20], true);
    y += 190;
    y = ensure(y, 160);
    lineChart(M, y + 12, W - 2 * M, 130, 'PM2.5 & PM10 (µg/m³)', pts, 'pm25', [217, 119, 6], false, { key: 'pm10', color: [37, 99, 235], label: 'PM10', first: 'PM2.5' });
    y += 170;
    y = ensure(y, 160);
    if (opts.inner) lineChart(M, y + 12, W - 2 * M, 130, 'Inner & outer temperature (°C)', pts, 'temp', [200, 60, 40], false, { key: 'otemp', color: [37, 99, 235], label: 'Outer', first: 'Inner' });
    else lineChart(M, y + 12, W - 2 * M, 130, 'Temperature (°C) & humidity (%)', pts, 'temp', [200, 60, 40], false, { key: 'hum', color: [37, 99, 235], label: 'Humidity', first: 'Temperature' });
    y += 170;

    // summary table
    y = ensure(y, 260);
    y = section('Pollutant summary', y);
    doc.outline.add(null, own ? `${id}: pollutant summary` : 'Pollutant summary', { pageNumber: doc.getCurrentPageInfo().pageNumber });
    const stat = (get: (r: SensorDataDto) => number | null | undefined, d: number) => {
      const v = nums(list, get); return v.length ? [fmt(Math.min(...v), d), fmt(avg(v), d), fmt(Math.max(...v), d)] : [NA, NA, NA];
    };
    const body: string[][] = [['PM2.5', 'µg/m³', ...stat((r) => r.pm25, 1)], ['PM10', 'µg/m³', ...stat((r) => r.pm10, 1)], ['NO2', 'ppm', ...stat((r) => r.no2Ppm, 3)], ['SO2', 'ppm', ...stat((r) => r.so2Ppm, 3)],
      ['CO', 'ppm', ...stat((r) => r.coPpm, 2)], ['TVOC', 'ppb', ...stat((r) => r.tvocPpb, 0)]];
    if (opts.inner) body.push(['Inner temperature', '°C', ...stat((r) => r.temperature, 1)], ['Outer temperature', '°C', ...stat((r) => r.outerTemperature, 1)], ['Inner humidity', '%', ...stat((r) => r.humidity, 1)], ['Outer humidity', '%', ...stat((r) => r.outerHumidity, 1)]);
    else body.push(['Temperature', '°C', ...stat((r) => r.temperature, 1)], ['Humidity', '%', ...stat((r) => r.humidity ?? r.outerHumidity, 1)]);
    autoTable(doc, { ...tableLook, startY: y, styles: { fontSize: 8.5, cellPadding: 4 }, head: [['Parameter', 'Unit', 'Minimum', 'Average', 'Maximum']], body });
    y = finalY() + 26;

    const counts: Record<string, number> = {};
    for (const v of aqiVals) { const n = aqiBand(v)[3]; counts[n] = (counts[n] ?? 0) + 1; }
    if (aqiVals.length) {
      y = ensure(y, 60);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30); doc.text('Share of readings in each AQI category', M, y);
      bandBar(M, y + 8, W - 2 * M, 22, counts); y += 64;
    }

    y = ensure(y, 80);
    const shown = sample(list, MAX_TABLE_ROWS);
    y = section(`Readings (${shown.length === list.length ? 'all' : `${shown.length} evenly spaced of ${fmt(list.length)}`})`, y);
    doc.outline.add(null, own ? `${id}: readings` : 'Readings', { pageNumber: doc.getCurrentPageInfo().pageNumber });
    autoTable(doc, {
      ...tableLook, startY: y, styles: { fontSize: 8, cellPadding: 3 },
      head: [['Time (IST)', 'AQI', 'Category', 'PM2.5', 'PM10', 'CO ppm', 'TVOC ppb', opts.inner ? 'Inner °C' : 'Temp °C', 'Hum. %']],
      body: shown.map((r) => [minute(r.recordedAt), fmt(r.aqi), r.aqi === null || r.aqi === undefined ? '' : aqiBand(r.aqi)[3], fmt(r.pm25), fmt(r.pm10), fmt(r.coPpm, 2), fmt(r.tvocPpb), fmt(r.temperature, 1), fmt(r.humidity ?? r.outerHumidity, 0)]),
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 2 && d.cell.raw) {
          const c = AQI_BANDS.find((b) => b[3] === d.cell.raw)?.[2];
          if (c) { d.cell.styles.textColor = c.map((v) => Math.round(v * 0.75)) as RGB; d.cell.styles.fontStyle = 'bold'; }
        }
      },
    });
    y = finalY() + 24;
  });

  // ---------------------------------------------------------------- notes
  y = ensure(y, 120);
  y = section('About this report', y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(50);
  const notes = doc.splitTextToSize('This report was built from the readings that match the filters you chose, so it changes with them. Charts are vector graphics: zoom in as far as you like. The bookmarks panel (left side of your PDF viewer) and the contents links jump between sections. AQI is calculated from PM2.5 and PM10 with the CPCB formula. Gases are shown in ppm and TVOC in ppb; the device values are uncalibrated sensor readings. Use the Excel export for every individual reading.', W - 2 * M);
  doc.text(notes, M, y);

  doc.outline.add(null, 'About this report', { pageNumber: doc.getCurrentPageInfo().pageNumber });

  // cover-page rows jump to their device
  if (multi) devices.forEach((_, i) => { const s = rowSpots[i]; if (s) { doc.setPage(s.page); doc.link(s.x, s.y, s.w, s.h, { pageNumber: deviceStart[i] }); } });

  doc.setProperties({ title: `Air Quality Report - ${opts.title}`, author: 'LIVVAir Protect', subject: 'Air quality report', keywords: 'AQI, PM2.5, PM10' });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130); doc.text(`Page ${i} of ${n}`, W - M, H - 20, { align: 'right' }); doc.text('LIVVAir Protect', M, H - 20); }
  return doc;
}
