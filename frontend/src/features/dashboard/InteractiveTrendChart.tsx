import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Box, Button, IconButton, Slider, Stack, Tooltip, Typography } from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import ZoomIn from '@mui/icons-material/ZoomIn';
import ZoomOut from '@mui/icons-material/ZoomOut';
import LastPage from '@mui/icons-material/LastPage';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { C, toSeries } from '../analytics/charts';
import { EmptyState } from '../../components/feedback';
import { aqiCategory } from '../../utils/aqi';
import { fmtNum, fmtShortTime, fmtWallClock } from '../../utils/format';
import { tokens } from '../../theme/theme';

type Pt = ReturnType<typeof toSeries>[number];

const PAD_L = 52;          // width of the left Y axis; used to map pointer x to a time
const PAD_R = 52;          // width of the right Y axis
const DEFAULT_SPAN = 96;   // readings visible at once (the chart size never changes)
const MIN_SPAN = 8;
const AXIS = { fontSize: 11, fill: '#64748b' };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const SERIES = [
  { key: 'aqi', label: 'AQI', color: C.aqi, unit: '', axis: 'l' },
  { key: 'pm25', label: 'PM2.5', color: C.pm25, unit: ' µg/m³', axis: 'l' },
  { key: 'pm10', label: 'PM10', color: C.pm10, unit: ' µg/m³', axis: 'l' },
  { key: 'temperature', label: 'Temp', color: C.temp, unit: ' °C', axis: 'r' },
  { key: 'humidity', label: 'Humidity', color: C.hum, unit: ' %', axis: 'r' },
  { key: 'outerTemperature', label: 'Outer temp', color: '#C2410C', unit: ' °C', axis: 'r' },
  { key: 'outerHumidity', label: 'Outer hum.', color: '#0E7490', unit: ' %', axis: 'r' },
] as const;

/**
 * Fixed-size trend chart over the loaded readings. Drag (or swipe) to move through time; the vertical cursor and the readout bar
 * follow the pointer and show the exact time and values at that point. Also: slider, arrow and zoom buttons, Shift/horizontal
 * wheel to pan, Ctrl + wheel to zoom. Only real readings are drawn.
 */
export function InteractiveTrendChart({ data, truncated }: { data: Pt[]; truncated?: boolean }) {
  const n = data.length;
  const initialSpan = Math.min(DEFAULT_SPAN, n);
  const [span, setSpan] = useState(initialSpan);
  const [start, setStart] = useState(Math.max(0, n - initialSpan));
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: number } | null>(null);

  // A new device or range starts at the latest readings again.
  useEffect(() => {
    const sp = Math.min(DEFAULT_SPAN, n);
    setSpan(sp); setStart(Math.max(0, n - sp)); setHoverT(null);
  }, [data, n]);

  const view = useMemo(() => data.slice(start, start + span), [data, start, span]);
  const active = (hoverT !== null ? view.find((p) => p.t === hoverT) : undefined) ?? view[view.length - 1];

  const moveTo = useCallback((s: number, sp = span) => setStart(clamp(Math.round(s), 0, Math.max(0, n - sp))), [n, span]);
  const panBy = useCallback((pts: number) => moveTo(start + pts), [moveTo, start]);
  const zoomBy = useCallback((factor: number) => {
    const next = clamp(Math.round(span * factor), Math.min(MIN_SPAN, n), n);
    const centre = start + span / 2;
    setSpan(next);
    setStart(clamp(Math.round(centre - next / 2), 0, Math.max(0, n - next)));
  }, [n, span, start]);

  const plot = () => {
    const r = box.current!.getBoundingClientRect();
    return { left: r.left + PAD_L, width: Math.max(1, r.width - PAD_L - PAD_R) };
  };
  const nearestT = (clientX: number): number => {
    const { left, width } = plot();
    const f = clamp((clientX - left) / width, 0, 1);
    const tc = view[0].t + f * (view[view.length - 1].t - view[0].t);
    let best = view[0];
    for (const p of view) if (Math.abs(p.t - tc) < Math.abs(best.t - tc)) best = p;
    return best.t;
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { box.current?.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    drag.current = { x: e.clientX, start };
    setDragging(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (view.length === 0) return;
    setHoverT(nearestT(e.clientX));
    if (drag.current && span > 1) {
      const perPoint = plot().width / Math.max(1, span - 1);
      const shift = Math.round((e.clientX - drag.current.x) / perPoint); // dragging right shows earlier readings
      setStart(clamp(drag.current.start - shift, 0, Math.max(0, n - span)));
    }
  };
  const onUp = () => { drag.current = null; setDragging(false); };
  const onLeave = () => { if (!drag.current) setHoverT(null); };

  // Wheel needs a non-passive listener so Ctrl+wheel zoom and horizontal pan do not also scroll the page.
  // Plain vertical wheel is left alone so the page still scrolls normally.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.18 : 0.85); return; }
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (e.shiftKey || horizontal) {
        e.preventDefault();
        const d = horizontal ? e.deltaX : e.deltaY;
        panBy(Math.sign(d) * Math.max(1, Math.round(span * 0.06)));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [panBy, zoomBy, span]);

  if (n === 0) {
    return <EmptyState title="No readings available" hint="There are no readings for the selected device or time range. Try a wider range or another device." />;
  }

  const cat = aqiCategory(active?.aqi);
  const atLatest = start + span >= n;

  return (
    <Box>
      {/* readout: updates with the pointer; shows the latest visible reading when the pointer is away */}
      <Stack direction="row" flexWrap="wrap" useFlexGap alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
        <Stack direction="row" flexWrap="wrap" useFlexGap alignItems="center" spacing={1} aria-live="polite">
          <Box sx={{ pr: 1, mr: 0.25, borderRight: `1px solid ${tokens.border}` }}>
            <Typography sx={{ fontSize: 10.5, color: tokens.muted, lineHeight: 1.1 }}>{hoverT !== null ? 'At cursor' : 'Latest in view'} · IST</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{active ? fmtWallClock(active.recordedAt, true) : '—'}</Typography>
          </Box>
          {SERIES.map((s) => {
            const v = active ? (active[s.key] as number | null) : null;
            const aqi = s.key === 'aqi';
            return (
              <Box key={s.key} sx={{ px: 1, py: 0.35, borderRadius: '8px', bgcolor: aqi ? cat.bg : '#fff', border: `1px solid ${aqi ? 'transparent' : tokens.border}` }}>
                <Typography component="span" sx={{ fontSize: 10.5, color: aqi ? cat.color : tokens.muted, fontWeight: 600 }}>
                  <Box component="span" sx={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', bgcolor: s.color, mr: 0.5 }} />{s.label}
                </Typography>
                <Typography component="span" sx={{ ml: 0.75, fontSize: 12.5, fontWeight: 700, color: aqi ? cat.color : tokens.text }}>
                  {v === null ? '—' : `${fmtNum(v, s.key === 'aqi' || s.key === 'pm25' || s.key === 'pm10' ? 0 : 1)}${s.unit}`}
                </Typography>
                {aqi && v !== null && <Typography component="span" sx={{ ml: 0.5, fontSize: 10.5, color: cat.color }}>{cat.label}</Typography>}
              </Box>
            );
          })}
        </Stack>
        <Stack direction="row" spacing={0.25} alignItems="center">
          <Tooltip title="Earlier"><span><IconButton size="small" onClick={() => panBy(-Math.max(1, Math.round(span / 2)))} disabled={start <= 0} aria-label="Move to earlier readings"><ChevronLeft fontSize="small" /></IconButton></span></Tooltip>
          <Tooltip title="Later"><span><IconButton size="small" onClick={() => panBy(Math.max(1, Math.round(span / 2)))} disabled={atLatest} aria-label="Move to later readings"><ChevronRight fontSize="small" /></IconButton></span></Tooltip>
          <Tooltip title="Zoom in"><span><IconButton size="small" onClick={() => zoomBy(0.7)} disabled={span <= Math.min(MIN_SPAN, n)} aria-label="Zoom in"><ZoomIn fontSize="small" /></IconButton></span></Tooltip>
          <Tooltip title="Zoom out"><span><IconButton size="small" onClick={() => zoomBy(1.4)} disabled={span >= n} aria-label="Zoom out"><ZoomOut fontSize="small" /></IconButton></span></Tooltip>
          <Button size="small" startIcon={<LastPage fontSize="small" />} onClick={() => moveTo(n - span)} disabled={atLatest} sx={{ ml: 0.5, color: tokens.forest }}>Latest</Button>
        </Stack>
      </Stack>

      {/* fixed-size chart surface: drag to move through time */}
      <Box
        ref={box} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave}
        role="img" aria-label="Air quality trend chart. Drag left or right to move through time."
        sx={{ height: { xs: 290, md: 350 }, cursor: dragging ? 'grabbing' : 'grab', touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none', borderRadius: '14px', outline: 'none', p: 1, pt: 0.5, boxSizing: 'border-box', background: 'linear-gradient(180deg, #E6F6EC 0%, #F2FAF5 55%, #FBFEFC 100%)', border: `1px solid ${tokens.cardBorder}` }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={view} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <defs><linearGradient id="aqiFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.aqi} stopOpacity={0.28} /><stop offset="100%" stopColor={C.aqi} stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke="#C9E2D0" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t: number) => fmtShortTime(new Date(t).toISOString())} tick={AXIS} minTickGap={52} axisLine={false} tickLine={false} tickMargin={8} />
            <YAxis yAxisId="l" tick={AXIS} width={PAD_L} axisLine={false} tickLine={false} label={{ value: 'AQI / PM (µg/m³)', angle: -90, position: 'insideLeft', style: { fill: '#64748b', fontSize: 11 }, offset: 4 }} />
            <YAxis yAxisId="r" orientation="right" tick={AXIS} width={PAD_R} axisLine={false} tickLine={false} label={{ value: 'Temp (°C) / Humidity (%)', angle: 90, position: 'insideRight', style: { fill: '#64748b', fontSize: 11 }, offset: 4 }} />
            <Legend verticalAlign="top" height={30} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="l" type="monotone" dataKey="pm10" name="PM10" stroke={C.pm10} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" dot={view.length <= 40 ? { r: 2.2, strokeWidth: 0 } : false} connectNulls isAnimationActive={false} />
            <Line yAxisId="l" type="monotone" dataKey="pm25" name="PM2.5" stroke={C.pm25} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" dot={view.length <= 40 ? { r: 2.2, strokeWidth: 0 } : false} connectNulls isAnimationActive={false} />
            <Area yAxisId="l" type="monotone" dataKey="aqi" name="AQI" stroke={C.aqi} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="url(#aqiFill)" dot={view.length <= 40 ? { r: 2.2, strokeWidth: 0 } : false} connectNulls isAnimationActive={false} />
            <Line yAxisId="r" type="monotone" dataKey="temperature" name="Temperature" stroke={C.temp} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" dot={view.length <= 40 ? { r: 2.2, strokeWidth: 0 } : false} connectNulls isAnimationActive={false} />
            <Line yAxisId="r" type="monotone" dataKey="humidity" name="Humidity" stroke={C.hum} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" dot={view.length <= 40 ? { r: 2.2, strokeWidth: 0 } : false} connectNulls isAnimationActive={false} />
            {hoverT !== null && <ReferenceLine yAxisId="l" x={hoverT} stroke="#334e43" strokeDasharray="4 3" strokeWidth={1} />}
            {hoverT !== null && active && SERIES.map((s) => {
              const v = active[s.key] as number | null;
              return v === null ? null : <ReferenceDot key={s.key} yAxisId={s.axis} x={active.t} y={v} r={4} fill={s.color} stroke="#fff" strokeWidth={1.5} ifOverflow="extendDomain" />;
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>

      {/* overview slider: the same window, as a scrollbar */}
      {n > MIN_SPAN && (
        <Box sx={{ px: 1.5, pt: 0.5 }}>
          <Slider
            size="small" min={0} max={n - 1} step={1} disableSwap value={[start, start + span - 1]} aria-label="Visible time range"
            onChange={(_, v) => {
              const [a, b] = v as number[];
              const sp = Math.max(Math.min(MIN_SPAN, n), b - a + 1);
              setSpan(sp); setStart(clamp(a, 0, Math.max(0, n - sp)));
            }}
            valueLabelDisplay="auto" valueLabelFormat={(i: number) => (data[i] ? fmtShortTime(data[i].recordedAt) : '')}
            sx={{ color: tokens.action, '& .MuiSlider-rail': { opacity: 0.25 } }}
          />
        </Box>
      )}
      <Typography sx={{ fontSize: 11, color: tokens.muted, mt: 0.25 }}>
        Showing {view.length} of {n} loaded readings{truncated ? ' (the latest 300 in this range)' : ''} · drag the chart or use the slider to move through time · Ctrl + scroll to zoom
      </Typography>
    </Box>
  );
}
