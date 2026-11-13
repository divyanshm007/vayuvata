import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CircularProgress, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { PageHeader } from '../../components/ui';
import { ErrorState, useToast } from '../../components/feedback';
import { alertsApi } from '../../api/services';
import { useAsync } from '../../utils/useAsync';
import { toAppError } from '../../utils/errors';
import type { AlertConfig } from '../../types/api';

type NumKey = { [K in keyof AlertConfig]-?: AlertConfig[K] extends number ? K : never }[keyof AlertConfig];
interface Field { key: NumKey; label: string; help: string; step?: number }

const SECTIONS: Array<{ title: string; text: string; fields: Field[] }> = [
  { title: 'Maintenance intervals', text: 'Reminders are counted from the last time it was marked done (or from the device registration).', fields: [
    { key: 'filterIntervalDays', label: 'Filter replacement every (days)', help: '45 days = 1.5 months' },
    { key: 'binIntervalDays', label: 'Bin cleaning every (days)', help: '90 days = 3 months' },
    { key: 'maintenanceWarnDaysBefore', label: 'Warn this many days before it is due', help: 'The reminder (Warning) starts this early.' },
    { key: 'maintenanceCriticalOverdueDays', label: 'Critical when this many days overdue', help: 'Still not done after the due date plus this.' },
    { key: 'maintenanceRepeatDays', label: 'Repeat the reminder email every (days)', help: 'While it stays open.' },
  ] },
  { title: 'Abnormal AQI and temperature', text: 'The current value (last window) is compared with the average of the previous days.', fields: [
    { key: 'baselineDays', label: 'Baseline: previous days', help: 'Average of the previous N days (5).' },
    { key: 'recentWindowMinutes', label: 'Current value: last minutes', help: 'Average of the last N minutes.' },
    { key: 'aqiChangePercent', label: 'AQI change (%)', help: 'Abnormal when it differs by more than this percent…', step: 1 },
    { key: 'aqiMinChange', label: 'AQI minimum change', help: '…and by at least this many AQI points.', step: 1 },
    { key: 'tempChangeDegrees', label: 'Temperature change (°C)', help: 'Abnormal when it differs by more than this many degrees.', step: 0.5 },
    { key: 'minBaselineSamples', label: 'Minimum readings in the baseline', help: 'Fewer readings than this: nothing is judged.' },
  ] },
  { title: 'Notification timings', text: 'How long an abnormal change must last before people are told.', fields: [
    { key: 'warningAfterHours', label: 'Warning for the Super Admin after (hours)', help: '7 hours' },
    { key: 'criticalAfterHours', label: 'Critical, also to Admin and User, after (hours)', help: '24 hours. Must be more than the warning time.' },
    { key: 'resolveGraceMinutes', label: 'Resolve after it stayed normal for (minutes)', help: 'Short dips do not restart the clock.' },
  ] },
  { title: 'Machine errors', text: 'Reported to the Super Admin and the Admin at once.', fields: [
    { key: 'offlineAfterMinutes', label: 'Device offline after no reading for (minutes)', help: '' },
    { key: 'outerMissingPercent', label: 'Outer sensor failure when this % of the last hour is missing', help: '' },
  ] },
];

/** Settings -> Alert Configuration (Super Admin): maintenance intervals, abnormal-reading thresholds and notification timings. */
export default function AlertConfigPage() {
  const toast = useToast();
  const cfg = useAsync(() => alertsApi.config(), []);
  const [form, setForm] = useState<AlertConfig | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (cfg.data) setForm(cfg.data); }, [cfg.data]);
  const dirty = !!form && !!cfg.data && JSON.stringify({ ...form, updatedAt: null }) !== JSON.stringify({ ...cfg.data, updatedAt: null });
  const set = (k: NumKey, v: string) => setForm((p) => (p ? { ...p, [k]: v === '' ? 0 : Number(v) } : p));
  const save = async () => {
    if (!form) return;
    setBusy(true); setErr(null);
    try { const saved = await alertsApi.updateConfig(form); setForm(saved); cfg.reload(); toast('Alert configuration saved.', 'success'); }
    catch (e) { setErr(toAppError(e).message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Alert Configuration" subtitle="Maintenance intervals, abnormal-reading thresholds and notification timings."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Settings' }, { label: 'Alert Configuration' }]} />
      {cfg.error && <ErrorState error={cfg.error} onRetry={cfg.reload} />}
      {cfg.loading && !form && <CircularProgress aria-label="Loading" />}
      {form && (
        <Stack spacing={2} sx={{ maxWidth: 900 }}>
          {err && <Alert severity="error">{err}</Alert>}
          {SECTIONS.map((sec) => (
            <Card key={sec.title} sx={{ p: 2.5 }}>
              <Typography fontWeight={800}>{sec.title}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{sec.text}</Typography>
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } }}>
                {sec.fields.map((f) => (
                  <TextField key={f.key} label={f.label} type="number" size="small" value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} helperText={f.help || undefined} inputProps={{ min: 0, step: f.step ?? 1 }} />))}
              </Box>
            </Card>))}
          <Card sx={{ p: 2.5 }}>
            <Typography fontWeight={800}>Notifications</Typography>
            <FormControlLabel control={<Switch checked={form.emailEnabled} onChange={(e) => setForm({ ...form, emailEnabled: e.target.checked })} inputProps={{ 'aria-label': 'Send alert emails' }} />} label="Send alert emails" />
            <Typography variant="caption" color="text.secondary" display="block">Maintenance and machine errors: Super Admin and the Admin. Abnormal readings: Warning to the Super Admin; Critical to the Super Admin, the Admin and the User. Resolved: to everyone who was told. Alerts are always shown in the panel.</Typography>
          </Card>
          <Box><Button variant="contained" onClick={() => void save()} disabled={!dirty || busy}>{busy ? <CircularProgress size={20} color="inherit" /> : 'Save configuration'}</Button></Box>
        </Stack>
      )}
    </>
  );
}
