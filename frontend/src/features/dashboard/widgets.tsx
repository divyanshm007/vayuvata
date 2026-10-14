import { useEffect, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Card, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';
import ArrowForward from '@mui/icons-material/ArrowForward';
import ChevronRight from '@mui/icons-material/ChevronRight';
import ArrowDropDown from '@mui/icons-material/ArrowDropDown';
import ArrowDropUp from '@mui/icons-material/ArrowDropUp';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { tokens } from '../../theme/theme';
import { aqiCategory } from '../../utils/aqi';
import { fmtNum, fmtShortTime } from '../../utils/format';
import { sensorApi } from '../../api/services';
import { useAsync } from '../../utils/useAsync';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/feedback';
import { Sparkline } from '../analytics/charts';

/* ---------- banner ---------- */

/** Current wall-clock time in IST (the devices' timezone), refreshed each minute. */
function useIstClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const ist = new Date(now + 330 * 60_000);
  const opt = { timeZone: 'UTC' } as const;
  return {
    date: ist.toLocaleDateString('en-GB', { ...opt, day: '2-digit', month: 'long', year: 'numeric' }),
    line: `${ist.toLocaleDateString('en-GB', { ...opt, weekday: 'long' })}, ${ist.toLocaleTimeString('en-GB', { ...opt, hour: '2-digit', minute: '2-digit', hour12: false })} IST`,
  };
}

export function WelcomeBanner({ name, subtitle, actionLabel, actionTo }: { name: string; subtitle: string; actionLabel: string; actionTo: string }) {
  const clock = useIstClock();
  return (
    <Box sx={{
      position: 'relative', overflow: 'hidden', borderRadius: '16px', border: `1px solid ${tokens.border}`, mb: 2,
      backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,.96) 0%, rgba(255,255,255,.82) 34%, rgba(255,255,255,.12) 72%, rgba(255,255,255,0) 100%), url(/topbar-sm.jpg)',
      '@media (min-width: 900px)': { backgroundImage: 'linear-gradient(90deg, rgba(255,255,255,.96) 0%, rgba(255,255,255,.82) 34%, rgba(255,255,255,.1) 72%, rgba(255,255,255,0) 100%), url(/topbar.jpg)' },
      backgroundSize: 'cover', backgroundPosition: 'center 55%', px: { xs: 2, md: 3.5 }, py: { xs: 2.5, md: 3.25 },
    }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={2}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: 21, md: 27 }, lineHeight: 1.15, letterSpacing: '-0.02em', color: tokens.text }}>
            Welcome back, <Box component="span" sx={{ color: tokens.action }}>{name}</Box>
          </Typography>
          <Typography sx={{ mt: 0.75, color: '#3f5a4d', fontSize: { xs: 12.5, md: 13.5 }, maxWidth: 560 }}>{subtitle}</Typography>
        </Box>
        <Stack alignItems={{ xs: 'flex-start', md: 'flex-end' }} spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ color: '#3f5a4d', display: { xs: 'none', md: 'flex' } }}>
            <CalendarMonthOutlined fontSize="small" />
            <Box sx={{ textAlign: 'right' }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>{clock.date}</Typography>
              <Typography sx={{ fontSize: 11, color: tokens.muted }}>{clock.line}</Typography>
            </Box>
          </Stack>
          <Button component={RouterLink} to={actionTo} variant="contained" endIcon={<ArrowForward />}
            sx={{ bgcolor: tokens.forest, px: 2.5, py: 1.1, borderRadius: '10px', '&:hover': { bgcolor: '#14532d' } }}>{actionLabel}</Button>
        </Stack>
      </Stack>
    </Box>
  );
}

/* ---------- metric cards ---------- */

export interface Delta { pct: number; goodWhen: 'down' | 'up' | 'neutral' }

/** Percent change of the latest value against the average of the earlier readings. Null when there is no honest baseline. */
export function deltaVsAverage(values: Array<number | null | undefined>, goodWhen: Delta['goodWhen']): Delta | null {
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (nums.length < 3) return null;
  const latest = nums[nums.length - 1];
  const rest = nums.slice(0, -1);
  const avg = rest.reduce((a, b) => a + b, 0) / rest.length;
  if (!(avg > 0)) return null;
  return { pct: ((latest - avg) / avg) * 100, goodWhen };
}

function DeltaLine({ delta }: { delta: Delta | null }) {
  if (!delta) return <Typography sx={{ fontSize: 11, color: tokens.muted }}>No trend yet</Typography>;
  const up = delta.pct >= 0;
  const rounded = Math.round(delta.pct);
  const flat = rounded === 0;
  const color = flat || delta.goodWhen === 'neutral' ? '#b45309' : (delta.goodWhen === 'down') === !up ? '#16a34a' : '#dc2626';
  const Arrow = up ? ArrowDropUp : ArrowDropDown;
  return (
    <Tooltip title="Latest reading compared with the average of the earlier readings in the last 7 days (up to 300 readings)">
      <Box sx={{ lineHeight: 1.25, cursor: 'help' }}>
        <Stack direction="row" alignItems="center" sx={{ color, ml: -0.5 }}>
          <Arrow sx={{ fontSize: 22 }} /><Typography sx={{ fontSize: 11.5, fontWeight: 700 }}>{up && !flat ? '+' : ''}{rounded}%</Typography>
        </Stack>
        <Typography sx={{ fontSize: 10.5, color: tokens.muted, mt: -0.25 }}>vs 7d avg</Typography>
      </Box>
    </Tooltip>
  );
}

interface MetricProps {
  label: string; value: ReactNode; unit?: string; icon: SvgIconComponent; accent: string; tint: string; loading?: boolean;
  sub?: ReactNode; badge?: ReactNode; delta?: Delta | null; spark?: Array<number | null | undefined>;
}
export function MetricCard({ label, value, unit, icon: Icon, accent, tint, loading, sub, badge, delta, spark }: MetricProps) {
  return (
    <Card sx={{ p: 1.75, height: '100%', display: 'flex', flexDirection: 'column', gap: 0.75, minHeight: 122, background: `linear-gradient(135deg, ${tint} 0%, ${tint}cc 45%, #FFFFFF 135%)`, borderColor: `${accent}40` }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box sx={{ width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: '#FFFFFF', color: accent, flexShrink: 0, boxShadow: `0 1px 4px ${accent}33` }}><Icon sx={{ fontSize: 20 }} /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, color: '#334e43', fontWeight: 600 }}>{label}</Typography>
          {loading ? <Skeleton width={80} height={32} /> : (
            <Typography sx={{ fontWeight: 800, fontSize: 23, lineHeight: 1.15, letterSpacing: '-0.02em', color: tokens.text }} noWrap>
              {value}{unit && value !== '—' && <Typography component="span" sx={{ ml: 0.5, fontSize: 11.5, fontWeight: 500, color: tokens.muted }}>{unit}</Typography>}
            </Typography>
          )}
        </Box>
      </Stack>
      {sub && <Typography sx={{ fontSize: 11.5, color: tokens.muted }} noWrap>{sub}</Typography>}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mt: 'auto' }}>
        <Box>{badge ?? (loading ? <Skeleton width={60} /> : <DeltaLine delta={delta ?? null} />)}</Box>
        <Box sx={{ width: 118, height: 40 }} aria-hidden>{!loading && spark && <Sparkline values={spark} color={accent} />}</Box>
      </Stack>
    </Card>
  );
}

/* ---------- operational cards ---------- */

/** Progress ring drawn with a conic gradient (a data indicator, not decoration). */
export function Ring({ pct, label, color = '#16A34A', size = 66 }: { pct: number; label: string; color?: string; size?: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <Stack alignItems="center" spacing={0.25} role="img" aria-label={`${label}: ${Math.round(p)}%`}>
      <Box sx={{ width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center', background: `conic-gradient(${color} ${p * 3.6}deg, #E5E7EB 0)` }}>
        <Box sx={{ width: size - 14, height: size - 14, borderRadius: '50%', bgcolor: '#fff', display: 'grid', placeItems: 'center', fontSize: 12.5, fontWeight: 800, color: tokens.text }}>{Math.round(p)}%</Box>
      </Box>
      <Typography sx={{ fontSize: 10.5, color: tokens.muted }}>{label}</Typography>
    </Stack>
  );
}

interface OpProps {
  label: string; icon: SvgIconComponent; value: ReactNode; sub?: ReactNode; to?: string; ring?: { pct: number; label: string; color?: string }; loading?: boolean; accent?: string;
}
export function OpCard({ label, icon: Icon, value, sub, to, ring, loading, accent = tokens.action }: OpProps) {
  const body = (
    <Stack sx={{ p: 1.75, height: '100%', boxSizing: 'border-box' }} spacing={0.75}>
      <Stack direction="row" spacing={1.25} alignItems="center">
        <Box sx={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: '#FFFFFF', color: accent, flexShrink: 0, boxShadow: '0 1px 4px rgba(22,101,52,.18)' }}><Icon sx={{ fontSize: 18 }} /></Box>
        <Typography sx={{ fontSize: 12, color: '#334e43', fontWeight: 600, flex: 1, lineHeight: 1.25 }}>{label}</Typography>
        {to && <ChevronRight sx={{ color: tokens.muted, fontSize: 20 }} />}
      </Stack>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mt: 'auto' }}>
        <Box sx={{ minWidth: 0 }}>
          {loading ? <Skeleton width={70} height={34} /> : <Typography sx={{ fontWeight: 800, fontSize: 21, lineHeight: 1.2, letterSpacing: '-0.02em' }} component="div">{value}</Typography>}
          {sub && <Typography sx={{ fontSize: 11, color: tokens.muted, mt: 0.25 }}>{sub}</Typography>}
        </Box>
        {ring && !loading && <Ring {...ring} />}
      </Stack>
    </Stack>
  );
  return (
    <Card sx={{ height: '100%', background: 'linear-gradient(135deg, #D6F3E1 0%, #E9F8EE 50%, #FFFFFF 135%)', transition: 'box-shadow .15s, border-color .15s', ...(to ? { '&:hover': { borderColor: '#86C99C', boxShadow: '0 8px 22px rgba(22,101,52,.14)' } } : {}) }}>
      {to ? <Box component={RouterLink} to={to} sx={{ display: 'block', height: '100%', color: 'inherit', textDecoration: 'none', borderRadius: 'inherit' }}>{body}</Box> : body}
    </Card>
  );
}

/* ---------- device status donut ---------- */

export interface StatusRow { label: string; value: number; color: string }

export function StatusDonut({ total, slices, rows, loading, viewAllTo }: { total: number; slices: Array<{ name: string; value: number; color: string }>; rows: StatusRow[]; loading?: boolean; viewAllTo?: string }) {
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const drawable = slices.filter((s) => s.value > 0);
  return (
    <Card sx={{ p: 2.25 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Devices Status</Typography>
        {viewAllTo && <Button component={RouterLink} to={viewAllTo} size="small" endIcon={<ArrowForward sx={{ fontSize: 16 }} />} sx={{ color: tokens.forest }}>View all</Button>}
      </Stack>
      {loading ? <Skeleton variant="rounded" height={150} /> : total === 0 ? (
        <EmptyState title="No devices yet" hint="Device status appears once devices are visible to you." />
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row', lg: 'column', xl: 'row' }} spacing={2} alignItems="center">
          <Box sx={{ position: 'relative', width: 150, height: 150, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={drawable.length ? drawable : [{ name: 'none', value: 1, color: '#E5E7EB' }]} dataKey="value" innerRadius={50} outerRadius={70} stroke="none" paddingAngle={drawable.length > 1 ? 2 : 0} isAnimationActive={false}>
                  {(drawable.length ? drawable : [{ name: 'none', value: 1, color: '#E5E7EB' }]).map((s) => <Cell key={s.name} fill={s.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <Typography sx={{ fontWeight: 800, fontSize: 22, lineHeight: 1 }}>{total}</Typography>
              <Typography sx={{ fontSize: 11, color: tokens.muted }}>{total === 1 ? 'Device' : 'Devices'}</Typography>
            </Stack>
          </Box>
          <Box sx={{ flex: 1, width: '100%' }}>
            {rows.map((r) => (
              <Stack key={r.label} direction="row" alignItems="center" spacing={1} sx={{ py: 0.7, borderBottom: `1px solid ${tokens.border}`, '&:last-child': { borderBottom: 0 } }}>
                <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: r.color, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 12, flex: 1 }}>{r.label}</Typography>
                <Typography sx={{ fontSize: 12, fontWeight: 700, width: 28, textAlign: 'right' }}>{r.value}</Typography>
                <Typography sx={{ fontSize: 11.5, color: tokens.muted, width: 40, textAlign: 'right' }}>{pct(r.value)}%</Typography>
              </Stack>
            ))}
          </Box>
        </Stack>
      )}
    </Card>
  );
}

/* ---------- recent readings ---------- */

/** The five most recent readings in the caller's scope (backend-scoped GET /sensor-data). */
export function RecentReadings() {
  const s = useAsync(() => sensorApi.list({ sortBy: 'recordedAt', sortDir: 'desc', page: 1, pageSize: 5, includeTotal: false }), []);
  return (
    <Card sx={{ p: 2.25 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Recent Sensor Readings</Typography>
        <Button component={RouterLink} to="/readings" size="small" endIcon={<ArrowForward sx={{ fontSize: 16 }} />} sx={{ color: tokens.forest }}>View all</Button>
      </Stack>
      {s.loading && <TableSkeleton rows={4} cols={4} />}
      {!!s.error && <ErrorState error={s.error} onRetry={s.reload} />}
      {!s.loading && !s.error && s.data?.items.length === 0 && <EmptyState title="No readings yet" hint="Readings appear here as devices report." />}
      {!!s.data?.items.length && (
        <TableContainer>
          <Table size="small" aria-label="Recent sensor readings" sx={{ '& td, & th': { px: 0.5, py: 0.9, fontSize: 11.5 } }}>
            <TableHead><TableRow>
              <TableCell>Time (IST)</TableCell><TableCell>Device</TableCell><TableCell align="center">AQI</TableCell>
              <TableCell align="right">PM2.5</TableCell><TableCell align="right">PM10</TableCell><TableCell align="right">Temp</TableCell><TableCell align="right">Hum.</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {s.data.items.map((r) => {
                const c = aqiCategory(r.aqi);
                return (
                  <TableRow key={r.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtShortTime(r.recordedAt)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.deviceId}</TableCell>
                    <TableCell align="center"><Tooltip title={c.label}><Box component="span" sx={{ display: 'inline-block', minWidth: 30, px: 0.75, py: 0.25, borderRadius: '6px', bgcolor: c.bg, color: c.color, fontWeight: 700 }}>{r.aqi ?? '—'}</Box></Tooltip></TableCell>
                    <TableCell align="right">{fmtNum(r.pm25, 0)}</TableCell><TableCell align="right">{fmtNum(r.pm10, 0)}</TableCell>
                    <TableCell align="right">{fmtNum(r.temperature)}</TableCell><TableCell align="right">{fmtNum(r.humidity, 0)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Card>
  );
}
