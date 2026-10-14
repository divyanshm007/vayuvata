import { Box, Card, Stack, Typography, Chip } from '@mui/material';
import {
  Area, AreaChart, Bar, BarChart, ComposedChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import type { SensorDataDto } from '../../types/api';
import { AQI_LEGEND, aqiCategory } from '../../utils/aqi';
import { fmtShortTime, fmtWallClock, parseApiDate } from '../../utils/format';
import { EmptyState } from '../../components/feedback';

const AXIS = { fontSize: 11, fill: '#64748b' };
const GRID = '#e8eef5';
// Series colours (distinct per pollutant). AQI uses the brand green for the line only; severity colours are applied by aqiCategory().
export const C = { aqi: '#15803D', pm25: '#F59E0B', pm10: '#8B5CF6', temp: '#2563EB', hum: '#14B8A6' };

export function ChartCard({ title, subtitle, children, height = 280, action }: { title: string; subtitle?: string; children: ReactNode; height?: number; action?: ReactNode }) {
  return (
    <Card sx={{ p: 2.5, height: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }} spacing={1}>
        <Box>
          <Typography fontWeight={700}>{title}</Typography>
          {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
        </Box>
        {action}
      </Stack>
      <Box sx={{ height }}>{children}</Box>
    </Card>
  );
}

export function AqiLegend() {
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap aria-label="AQI categories">
      {AQI_LEGEND.map((l) => (
        <Chip key={l.range} size="small" label={`${l.range} ${l.cat.label}`} sx={{ bgcolor: l.cat.bg, color: l.cat.color, fontSize: 11 }} />
      ))}
    </Stack>
  );
}

/** Oldest → newest, with a numeric time axis so uneven sampling is plotted truthfully. */
export function toSeries(rows: SensorDataDto[]) {
  return [...rows]
    .map((r) => ({ ...r, t: parseApiDate(r.recordedAt)?.getTime() ?? 0 }))
    .filter((r) => r.t > 0)
    .sort((a, b) => a.t - b.t);
}
type Row = ReturnType<typeof toSeries>[number];

const tickFmt = (t: number) => fmtShortTime(new Date(t).toISOString());
const tooltipLabel = (t: number) => fmtWallClock(new Date(t).toISOString());

function Frame({ data, children }: { data: Row[]; children: ReactNode }) {
  if (data.length === 0) return <EmptyState title="No readings available" hint="There are no readings for the selected device or time range. Try a wider range or another device." />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      {children as React.ReactElement}
    </ResponsiveContainer>
  );
}

const xAxis = <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tickFmt} tick={AXIS} minTickGap={48} />;

export function AqiTrendChart({ data }: { data: Row[] }) {
  const max = Math.max(0, ...data.map((d) => d.aqi ?? 0));
  return (
    <Frame data={data}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <defs><linearGradient id="aqiFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.aqi} stopOpacity={0.35} /><stop offset="1" stopColor={C.aqi} stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        {xAxis}
        <YAxis tick={AXIS} width={44} />
        <Tooltip labelFormatter={tooltipLabel} formatter={(v: number) => [`${v} · ${aqiCategory(v).label}`, 'AQI']} />
        {max > 100 && <ReferenceLine y={100} stroke="#ca8a04" strokeDasharray="4 4" />}
        {max > 200 && <ReferenceLine y={200} stroke="#dc2626" strokeDasharray="4 4" />}
        <Area type="monotone" dataKey="aqi" name="AQI" stroke={C.aqi} strokeWidth={2.2} fill="url(#aqiFill)" connectNulls dot={data.length < 40} />
      </AreaChart>
    </Frame>
  );
}

export function PmChart({ data }: { data: Row[] }) {
  return (
    <Frame data={data}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        {xAxis}
        <YAxis tick={AXIS} width={44} unit="" />
        <Tooltip labelFormatter={tooltipLabel} formatter={(v: number, n: string) => [`${v} µg/m³`, n]} />
        <Legend />
        <Line type="monotone" dataKey="pm25" name="PM2.5" stroke={C.pm25} strokeWidth={2} dot={false} connectNulls />
        <Line type="monotone" dataKey="pm10" name="PM10" stroke={C.pm10} strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </Frame>
  );
}

export function TempHumChart({ data }: { data: Row[] }) {
  return (
    <Frame data={data}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        {xAxis}
        <YAxis yAxisId="t" tick={AXIS} width={44} unit="°" />
        <YAxis yAxisId="h" orientation="right" tick={AXIS} width={44} unit="%" />
        <Tooltip labelFormatter={tooltipLabel} formatter={(v: number, n: string) => [n === 'Humidity' ? `${v} %` : `${v} °C`, n]} />
        <Legend />
        <Line yAxisId="t" type="monotone" dataKey="temperature" name="Temperature" stroke={C.temp} strokeWidth={2} dot={false} connectNulls />
        <Line yAxisId="h" type="monotone" dataKey="humidity" name="Humidity" stroke={C.hum} strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </Frame>
  );
}

export function DeviceAqiBars({ items }: { items: Array<{ name: string; aqi: number | null }> }) {
  const data = items.filter((i) => i.aqi !== null);
  if (data.length === 0) return <EmptyState title="No device readings yet" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={AXIS} interval={0} />
        <YAxis tick={AXIS} width={44} />
        <Tooltip formatter={(v: number) => [`${v} · ${aqiCategory(v).label}`, 'Latest AQI']} />
        <Bar dataKey="aqi" radius={[6, 6, 0, 0]}>
          {data.map((d) => <Cell key={d.name} fill={aqiCategory(d.aqi).color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const UNIT: Record<string, string> = { PM10: ' µg/m³', 'PM2.5': ' µg/m³', Temperature: ' °C', Humidity: ' %' };

/** AQI, PM2.5 and PM10 on the left axis; temperature and humidity on the right. Real readings only: gaps stay gaps. */
export function CombinedTrendChart({ data }: { data: Row[] }) {
  const grad = (id: string, color: string) => (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.28} /><stop offset="1" stopColor={color} stopOpacity={0.02} /></linearGradient>
  );
  const axisTitle = { fill: '#64748b', fontSize: 11 };
  return (
    <Frame data={data}>
      <ComposedChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>{grad('gAqi', C.aqi)}{grad('gPm25', C.pm25)}{grad('gPm10', C.pm10)}</defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        {xAxis}
        <YAxis yAxisId="l" tick={AXIS} width={52} label={{ value: 'AQI / PM (µg/m³)', angle: -90, position: 'insideLeft', style: axisTitle, offset: 4 }} />
        <YAxis yAxisId="r" orientation="right" tick={AXIS} width={52} label={{ value: 'Temp (°C) / Humidity (%)', angle: 90, position: 'insideRight', style: axisTitle, offset: 4 }} />
        <Tooltip
          labelFormatter={tooltipLabel}
          formatter={(v: number, n: string) => [n === 'AQI' ? `${v} · ${aqiCategory(v).label}` : `${v}${UNIT[n] ?? ''}`, n]}
        />
        <Legend verticalAlign="top" height={32} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Area yAxisId="l" type="monotone" dataKey="pm10" name="PM10" stroke={C.pm10} fill="url(#gPm10)" strokeWidth={1.6} dot={false} connectNulls />
        <Area yAxisId="l" type="monotone" dataKey="pm25" name="PM2.5" stroke={C.pm25} fill="url(#gPm25)" strokeWidth={1.6} dot={false} connectNulls />
        <Area yAxisId="l" type="monotone" dataKey="aqi" name="AQI" stroke={C.aqi} fill="url(#gAqi)" strokeWidth={2.2} dot={data.length < 30} connectNulls />
        <Line yAxisId="r" type="monotone" dataKey="temperature" name="Temperature" stroke={C.temp} strokeWidth={1.8} dot={false} connectNulls />
        <Line yAxisId="r" type="monotone" dataKey="humidity" name="Humidity" stroke={C.hum} strokeWidth={1.8} dot={false} connectNulls />
      </ComposedChart>
    </Frame>
  );
}

/** Tiny area chart for metric cards. Draws only the supplied real values. */
export function Sparkline({ values, color }: { values: Array<number | null | undefined>; color: string }) {
  const pts = values.map((v, i) => ({ i, v: v ?? null }));
  if (pts.filter((p) => p.v !== null).length < 2) return null;
  const id = `spark-${color.replace('#', '')}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={pts} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.3} /><stop offset="1" stopColor={color} stopOpacity={0} /></linearGradient></defs>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.6} fill={`url(#${id})`} dot={false} connectNulls isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
