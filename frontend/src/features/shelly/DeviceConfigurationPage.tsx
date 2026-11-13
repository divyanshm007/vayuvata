import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Card, Chip, CircularProgress, FormControlLabel, IconButton, MenuItem, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import PowerSettingsNew from '@mui/icons-material/PowerSettingsNew';
import Refresh from '@mui/icons-material/Refresh';
import { PageHeader } from '../../components/ui';
import { ConfirmDialog, EmptyState, ErrorState, useToast } from '../../components/feedback';
import { shellyApi } from '../../api/services';
import { useAsync } from '../../utils/useAsync';
import { toAppError } from '../../utils/errors';
import { fmtNum, fmtUtc } from '../../utils/format';
import { useAuth } from '../auth/AuthContext';
import { useDevices } from '../devices/useDevices';
import type { ShellyDevice, ShellyStatus } from '../../types/api';

/** The Shelly Cloud allows about one request per second per account: the state is read only when Refresh is pressed. */
const REFRESH_COOLDOWN_MS = 1500;
export const LOCKED_MESSAGE = 'Device control is currently managed by Super Admin.';

const Metric = ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
  <Box sx={{ minWidth: 90 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography fontWeight={700}>{value} {unit && <Typography component="span" variant="caption" color="text.secondary">{unit}</Typography>}</Typography>
  </Box>
);

/**
 * Current Shelly relay state and the ON / OFF buttons. The Shelly relay powers the WHOLE device: ON = the device runs, OFF = the device loses power.
 * Everyone sees ON / OFF. Only the SuperAdmin gets power, voltage, current, temperature and Wi-Fi (the server does not send them to anyone else).
 * Buttons: SuperAdmin always; Admin unless the SuperAdmin override is on; the User never.
 */
function ShellyControl({ sw, isSA, onCommanded }: { sw: ShellyDevice; isSA: boolean; onCommanded: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<ShellyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooling, setCooling] = useState(false);
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [commanded, setCommanded] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (!sw.isActive) return;
    setLoading(true); setCooling(true);
    try { const s = await shellyApi.status(sw.id); if (alive.current) { setStatus(s); setError(null); setCommanded(false); } }
    catch (e) { if (alive.current) setError(toAppError(e).message); }
    finally { if (alive.current) setLoading(false); setTimeout(() => { if (alive.current) setCooling(false); }, REFRESH_COOLDOWN_MS); }
  }, [sw.id, sw.isActive]);

  const send = async () => {
    if (pending === null) return;
    setBusy(true);
    try {
      const r = await shellyApi.switch(sw.id, pending);
      toast(`${sw.name}: ${r.message}`, 'success');
      setStatus((prev) => ({ ...(prev ?? { id: sw.id, powerW: null, voltageV: null, currentA: null, temperatureC: null, wifiRssi: null, ssid: null, energyTotalWh: null, cloudUpdatedAt: null, errors: [], checkedAt: new Date().toISOString() }), online: true, on: pending }));
      setCommanded(true); setError(null);
      onCommanded();
    } catch (e) { toast(toAppError(e).message, 'error'); onCommanded(); }   // a refused command (e.g. the override was switched on meanwhile) also refreshes the list
    finally { setBusy(false); setPending(null); }
  };

  const online = status?.online === true;
  const known = sw.isActive && online && status?.on != null;
  const canOn = sw.canControl && known && status!.on === false && !busy;
  const canOff = sw.canControl && known && status!.on === true && !busy;
  const stateLabel = !sw.isActive ? 'Deactivated' : status === null ? 'Not checked' : !online ? 'Offline' : status.on === null ? 'Unknown' : status.on ? 'ON' : 'OFF';
  const stateColor = !sw.isActive || !online ? 'default' : status?.on ? 'success' : 'warning';
  const viewOnly = !isSA && !sw.canControl && !sw.overrideActive;      // a User (an Admin always has the buttons unless the override is on)

  return (
    <Card sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={800}>Shelly relay</Typography>
          <Typography variant="body2" color="text.secondary">Powers the whole device: ON = the device runs, OFF = the device has no power.</Typography>
        </Box>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Chip size="small" color={stateColor as 'default' | 'success' | 'warning'} label={stateLabel} sx={{ fontWeight: 700 }} />
          <Tooltip title="Read the live state from the Shelly Cloud"><span><IconButton size="small" color={status === null ? 'primary' : 'default'} onClick={() => void refresh()} disabled={loading || cooling || !sw.isActive} aria-label="Refresh Shelly status">
            {loading ? <CircularProgress size={16} /> : <Refresh fontSize="small" />}</IconButton></span></Tooltip>
        </Stack>
      </Stack>

      {error && <Alert severity="warning" sx={{ mt: 1.5 }}>{error}</Alert>}
      {status === null && !error && sw.isActive && <Alert severity="info" sx={{ mt: 1.5 }}>The live state is not read automatically. Press the refresh button to see whether the relay is ON or OFF.</Alert>}
      {commanded && <Alert severity="success" sx={{ mt: 1.5 }}>Command sent and accepted. Press refresh to confirm the real state.</Alert>}
      {status && !online && !error && <Alert severity="info" sx={{ mt: 1.5 }}>The Shelly Cloud reports this relay as offline (power or Wi-Fi). It cannot be switched now.</Alert>}

      {isSA && status && online && !commanded && (
        <>
          <Stack direction="row" flexWrap="wrap" gap={3} sx={{ mt: 2 }}>
            <Metric label="Power" value={fmtNum(status.powerW, 1)} unit="W" />
            <Metric label="Voltage" value={fmtNum(status.voltageV, 1)} unit="V" />
            <Metric label="Current" value={fmtNum(status.currentA, 2)} unit="A" />
            <Metric label="Temperature" value={fmtNum(status.temperatureC, 1)} unit="°C" />
            <Metric label="Wi-Fi" value={status.wifiRssi != null ? String(status.wifiRssi) : '—'} unit={status.wifiRssi != null ? 'dBm' : ''} />
          </Stack>
          {status.errors.length > 0 && <Alert severity="error" sx={{ mt: 1.5 }}>The Shelly reports a protection error: {status.errors.join(', ')}. It will not be switched ON until this clears.</Alert>}
        </>
      )}

      {!isSA && sw.overrideActive && <Alert severity="warning" sx={{ mt: 1.5 }}>{LOCKED_MESSAGE}</Alert>}
      {isSA && sw.overrideActive && <Alert severity="info" sx={{ mt: 1.5 }}>Super Admin override is ON: Admins cannot switch this device and the daily schedule is paused.</Alert>}
      {viewOnly && <Alert severity="info" sx={{ mt: 1.5 }}>View only. You can see whether the device is ON or OFF but cannot change it.</Alert>}

      {!viewOnly && (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2 }}>
          <Button variant="contained" color="success" startIcon={<PowerSettingsNew />} disabled={!canOn} onClick={() => setPending(true)}>Turn ON</Button>
          <Button variant="contained" color="error" startIcon={<PowerSettingsNew />} disabled={!canOff} onClick={() => setPending(false)}>Turn OFF</Button>
          {sw.lastCommandAt && (
            <Typography variant="caption" color="text.secondary">Last command: {sw.lastCommandOn ? 'ON' : 'OFF'} by {sw.lastCommandBy} · {fmtUtc(sw.lastCommandAt)}</Typography>
          )}
        </Stack>
      )}

      <ConfirmDialog
        open={pending !== null} busy={busy} danger={pending === false} confirmLabel={pending ? 'Turn ON' : 'Turn OFF'}
        title={pending ? 'Turn the Shelly relay ON?' : 'Turn the Shelly relay OFF?'}
        body={<>This switches the Shelly relay of <b>{sw.deviceName ?? sw.name}</b>. {pending === false ? 'The whole device will lose power.' : 'The whole device will get power and start.'}</>}
        onConfirm={() => void send()} onClose={() => setPending(null)}
      />
    </Card>
  );
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** SuperAdmin only: daily Shelly ON / OFF time and the override of ONE device. Saved per device. */
function ConfigCard({ sw, onSaved }: { sw: ShellyDevice; onSaved: () => void }) {
  const toast = useToast();
  const cfg = sw.config;
  const [enabled, setEnabled] = useState(cfg?.scheduleEnabled ?? false);
  const [onTime, setOnTime] = useState(cfg?.dailyOnTime ?? '');
  const [offTime, setOffTime] = useState(cfg?.dailyOffTime ?? '');
  const [override, setOverride] = useState(cfg?.overrideActive ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // follow the saved values when they change (after Save, or when another device is selected)
  useEffect(() => {
    setEnabled(cfg?.scheduleEnabled ?? false); setOnTime(cfg?.dailyOnTime ?? ''); setOffTime(cfg?.dailyOffTime ?? ''); setOverride(cfg?.overrideActive ?? false); setErr(null);
  }, [sw.id, cfg?.scheduleEnabled, cfg?.dailyOnTime, cfg?.dailyOffTime, cfg?.overrideActive]);

  const dirty = enabled !== (cfg?.scheduleEnabled ?? false) || onTime !== (cfg?.dailyOnTime ?? '') || offTime !== (cfg?.dailyOffTime ?? '') || override !== (cfg?.overrideActive ?? false);
  const timesOk = (!onTime || TIME_RE.test(onTime)) && (!offTime || TIME_RE.test(offTime));
  const scheduleOk = !enabled || (TIME_RE.test(onTime) && TIME_RE.test(offTime) && onTime !== offTime);
  const problem = !timesOk ? 'Enter valid times.' : enabled && (!onTime || !offTime) ? 'Set both the ON time and the OFF time.' : enabled && onTime === offTime ? 'The ON time and the OFF time must be different.' : null;

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await shellyApi.updateConfig(sw.id, { scheduleEnabled: enabled, dailyOnTime: onTime || null, dailyOffTime: offTime || null, overrideActive: override });
      toast('Configuration saved.', 'success'); onSaved();
    } catch (e) { setErr(toAppError(e).message); } finally { setBusy(false); }
  };

  return (
    <Card sx={{ p: 2.5 }}>
      <Typography fontWeight={800}>Configuration</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>These settings belong to this device only. Times are India time (IST). The schedule switches the Shelly relay, which powers or cuts the whole device.</Typography>
      {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
      <Stack spacing={2}>
        <FormControlLabel control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} inputProps={{ 'aria-label': 'Daily schedule' }} />}
          label={<>Daily schedule <Typography component="span" variant="caption" color="text.secondary">({enabled ? 'enabled' : 'disabled'})</Typography></>} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Daily Shelly ON time" type="time" value={onTime} onChange={(e) => setOnTime(e.target.value)} disabled={!enabled}
            InputLabelProps={{ shrink: true }} inputProps={{ step: 60 }} sx={{ flex: 1 }} />
          <TextField label="Daily Shelly OFF time" type="time" value={offTime} onChange={(e) => setOffTime(e.target.value)} disabled={!enabled}
            InputLabelProps={{ shrink: true }} inputProps={{ step: 60 }} sx={{ flex: 1 }} />
        </Stack>
        <Box>
          <FormControlLabel control={<Switch checked={override} onChange={(e) => setOverride(e.target.checked)} color="warning" inputProps={{ 'aria-label': 'Super Admin override' }} />}
            label={<>Super Admin override <Typography component="span" variant="caption" color="text.secondary">({override ? 'enabled' : 'disabled'})</Typography></>} />
          <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 0.5 }}>
            While enabled, Admins cannot turn this device ON or OFF and the daily schedule is paused. It stays until you disable it here.
          </Typography>
          {cfg?.overrideActive && cfg.overrideSetAt && <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 0.5 }}>Enabled by {cfg.overrideBy ?? 'Super Admin'} · {fmtUtc(cfg.overrideSetAt)}</Typography>}
        </Box>
        {problem && <Alert severity="warning">{problem}</Alert>}
        <Stack direction="row" spacing={2} alignItems="center">
          <Button variant="contained" onClick={() => void save()} disabled={busy || !dirty || !!problem || !scheduleOk}>
            {busy ? <CircularProgress size={20} color="inherit" /> : 'Save Configuration'}
          </Button>
          {cfg?.updatedAt && <Typography variant="caption" color="text.secondary">Last saved {fmtUtc(cfg.updatedAt)}{cfg.updatedBy ? ` by ${cfg.updatedBy}` : ''}</Typography>}
        </Stack>
      </Stack>
    </Card>
  );
}

interface Option { key: string; label: string; sw: ShellyDevice | null }

/** Settings -> Device Configuration. SuperAdmin: configure and control; Admin: control (unless the override is on); User: view only. */
export default function DeviceConfigurationPage() {
  const { role } = useAuth();
  const isSA = role === 'SuperAdmin';
  const list = useAsync(() => shellyApi.list(), []);
  const devices = useDevices(true);
  const [selected, setSelected] = useState('');

  const options = useMemo<Option[]>(() => {
    const switches = list.data ?? [];
    const byDevice = new Map(switches.filter((s) => s.deviceId).map((s) => [s.deviceId!, s]));
    const opts: Option[] = devices.devices.map((d) => ({ key: `d:${d.deviceId}`, label: d.deviceName.includes(d.deviceId) ? d.deviceName : `${d.deviceName} (${d.deviceId})`, sw: byDevice.get(d.deviceId) ?? null }));
    const known = new Set(devices.devices.map((d) => d.deviceId));
    for (const s of switches) if (!s.deviceId || !known.has(s.deviceId)) opts.push({ key: `s:${s.id}`, label: `${s.name} (not linked to a device)`, sw: s });
    return opts;
  }, [list.data, devices.devices]);

  useEffect(() => {
    if (options.length === 0) return;
    if (!options.some((o) => o.key === selected)) setSelected((options.find((o) => o.sw) ?? options[0]).key);
  }, [options, selected]);

  const current = options.find((o) => o.key === selected) ?? null;
  const loading = (list.loading && !list.data) || (devices.loading && !devices.data);
  const error = list.error ?? devices.error;

  return (
    <>
      <PageHeader
        title="Device Configuration"
        subtitle={isSA ? 'Choose a device to set its daily Shelly ON / OFF time and the Super Admin override.' : role === 'Admin' ? 'Choose a device to see its Shelly state and switch it ON or OFF.' : 'Choose a device to see whether its Shelly relay is ON or OFF.'}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Settings' }, { label: 'Device Configuration' }]}
      />
      {!!error && <ErrorState error={error} onRetry={() => { list.reload(); devices.reload(); }} />}
      {loading && <CircularProgress aria-label="Loading" />}
      {!loading && !error && options.length === 0 && <Card><EmptyState title="No devices" hint="No device is available to you yet." /></Card>}
      {options.length > 0 && (
        <Stack spacing={2} sx={{ maxWidth: 880 }}>
          <TextField select label="Device" value={selected} onChange={(e) => setSelected(e.target.value)} sx={{ maxWidth: 420 }}>
            {options.map((o) => <MenuItem key={o.key} value={o.key}>{o.label}{o.sw ? '' : ' — no Shelly switch'}</MenuItem>)}
          </TextField>
          {current && !current.sw && (
            <Alert severity="info">This device has no Shelly switch linked.{isSA ? ' Add and link one under Shelly Switches.' : ' Ask the Super Admin to link one.'}</Alert>
          )}
          {current?.sw && !current.sw.isActive && <Alert severity="warning">This Shelly switch is deactivated.</Alert>}
          {current?.sw && (
            <>
              <ShellyControl key={`c${current.sw.id}`} sw={current.sw} isSA={isSA} onCommanded={list.reload} />
              {isSA && <ConfigCard key={`f${current.sw.id}`} sw={current.sw} onSaved={list.reload} />}
            </>
          )}
        </Stack>
      )}
    </>
  );
}
