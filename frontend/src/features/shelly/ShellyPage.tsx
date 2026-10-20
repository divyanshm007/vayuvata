import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Stack,
  Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import Refresh from '@mui/icons-material/Refresh';
import PowerSettingsNew from '@mui/icons-material/PowerSettingsNew';
import { PageHeader } from '../../components/ui';
import { ConfirmDialog, EmptyState, ErrorState, useToast } from '../../components/feedback';
import { shellyApi } from '../../api/services';
import { useAsync } from '../../utils/useAsync';
import { toAppError } from '../../utils/errors';
import { fmtNum, fmtUtc } from '../../utils/format';
import { useAuth } from '../auth/AuthContext';
import { useDevices } from '../devices/useDevices';
import type { ShellyCommand, ShellyDevice, ShellyStatus } from '../../types/api';

/** The Shelly Cloud allows about one request per second per account, so the page never polls: the state is read only when the user presses Refresh. */
const REFRESH_COOLDOWN_MS = 1500;

/** One switch: ON / OFF buttons, and the live state from the Shelly Cloud when (and only when) Refresh is pressed. */
function SwitchCard({ sw, canEdit, onEdit, onHistory, onDeleted, onCommanded }: { sw: ShellyDevice; canEdit: boolean; onEdit: () => void; onHistory: () => void; onDeleted: () => void; onCommanded: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<ShellyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<boolean | null>(null);      // the state the user asked for, while the confirm dialog is open
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);                   // the delete confirmation is open
  const [cooling, setCooling] = useState(false);                     // short pause after a request, so a double click cannot trip the cloud's rate limit
  const [commanded, setCommanded] = useState(false);                 // the shown state is what was last sent, not yet confirmed by a refresh
  const alive = useRef(true);
  // set to true on every mount: React dev mode mounts, unmounts and mounts again, and a flag left false would swallow every update
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (!sw.isActive) return;
    setLoading(true); setCooling(true);
    try { const s = await shellyApi.status(sw.id); if (alive.current) { setStatus(s); setError(null); setCommanded(false); } }
    catch (e) { if (alive.current) setError(toAppError(e).message); }
    finally { if (alive.current) setLoading(false); setTimeout(() => { if (alive.current) setCooling(false); }, REFRESH_COOLDOWN_MS); }
  }, [sw.id, sw.isActive]);

  const remove = async () => {
    setBusy(true);
    try { await shellyApi.remove(sw.id); toast(`${sw.name} deleted.`, 'success'); setDeleting(false); onDeleted(); }
    catch (e) { toast(toAppError(e).message, 'error'); setDeleting(false); }
    finally { if (alive.current) setBusy(false); }
  };

  const send = async () => {
    if (pending === null) return;
    setBusy(true);
    try {
      const r = await shellyApi.switch(sw.id, pending);
      toast(`${sw.name}: ${r.message}`, 'success');
      // The cloud accepted the command. No extra request is made (rate limit); show what was sent and let the user press Refresh to confirm.
      setStatus((prev) => ({ ...(prev ?? { id: sw.id, powerW: null, voltageV: null, currentA: null, temperatureC: null, wifiRssi: null, ssid: null, energyTotalWh: null, cloudUpdatedAt: null, checkedAt: new Date().toISOString() }), online: true, on: pending }));
      setCommanded(true); setError(null);
      onCommanded();                                                  // re-read OUR list so "Last command" updates (this does not call the Shelly Cloud)
    } catch (e) { toast(toAppError(e).message, 'error'); }
    finally { setBusy(false); setPending(null); }
  };

  const online = status?.online === true;
  // The buttons follow the real state: once it is known, only the opposite action is offered (ON -> only "Turn OFF", OFF -> only "Turn ON").
  // Before the state has been read (or when the switch is offline or deactivated) neither is offered: press refresh first.
  const known = sw.isActive && online && status?.on != null;
  const canOn = known && status!.on === false && !busy;
  const canOff = known && status!.on === true && !busy;
  const stateLabel = !sw.isActive ? 'Deactivated' : status === null ? 'Not checked' : !online ? 'Offline' : status.on === null ? 'Unknown' : status.on ? 'ON' : 'OFF';
  const stateColor = !sw.isActive || !online ? 'default' : status?.on ? 'success' : 'warning';

  return (
    <Card sx={{ p: 2.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography fontWeight={800} noWrap>{sw.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {sw.deviceId ? <>VayuVata device <b>{sw.deviceName ?? sw.deviceId}</b> ({sw.deviceId})</> : 'Not linked to a VayuVata device'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>
            {sw.shellyId} · channel {sw.channel}{canEdit ? ` · ${sw.cloudHost}` : ''}{canEdit && sw.authKeyHint ? ` · key ${sw.authKeyHint}` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Chip size="small" color={stateColor as 'default' | 'success' | 'warning'} label={stateLabel} sx={{ fontWeight: 700 }} />
          <Tooltip title="Read the live state from the Shelly Cloud"><span><IconButton size="small" color={status === null ? 'primary' : 'default'} onClick={() => void refresh()} disabled={loading || cooling || !sw.isActive} aria-label={`Refresh ${sw.name}`}>
            {loading ? <CircularProgress size={16} /> : <Refresh fontSize="small" />}</IconButton></span></Tooltip>
          <Tooltip title="Command history"><IconButton size="small" onClick={onHistory} aria-label={`History of ${sw.name}`}><HistoryOutlined fontSize="small" /></IconButton></Tooltip>
          {canEdit && <Tooltip title="Edit"><IconButton size="small" onClick={onEdit} aria-label={`Edit ${sw.name}`}><EditOutlined fontSize="small" /></IconButton></Tooltip>}
          {canEdit && <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setDeleting(true)} aria-label={`Delete ${sw.name}`}><DeleteOutline fontSize="small" /></IconButton></Tooltip>}
        </Stack>
      </Stack>

      {error && <Alert severity="warning" sx={{ mt: 1.5 }}>{error}</Alert>}
      {status === null && !error && sw.isActive && <Alert severity="info" sx={{ mt: 1.5 }}>The live state is not read automatically. Press the refresh button first: Turn ON / Turn OFF unlock once the state is known.</Alert>}
      {commanded && <Alert severity="success" sx={{ mt: 1.5 }}>Command sent and accepted by the Shelly Cloud. Press refresh to confirm the real state.</Alert>}

      {status && online && !commanded && (
        <Stack direction="row" flexWrap="wrap" gap={3} sx={{ mt: 2 }}>
          <Metric label="Power" value={fmtNum(status.powerW, 1)} unit="W" />
          <Metric label="Voltage" value={fmtNum(status.voltageV, 1)} unit="V" />
          <Metric label="Current" value={fmtNum(status.currentA, 2)} unit="A" />
          <Metric label="Temperature" value={fmtNum(status.temperatureC, 1)} unit="°C" />
          <Metric label="Wi-Fi" value={status.wifiRssi != null ? String(status.wifiRssi) : '—'} unit={status.wifiRssi != null ? 'dBm' : ''} />
        </Stack>
      )}
      {status && !online && !error && <Alert severity="info" sx={{ mt: 1.5 }}>The Shelly Cloud reports this switch as offline (power or Wi-Fi). It cannot be switched now.</Alert>}

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2 }}>
        <Button variant="contained" color="success" startIcon={<PowerSettingsNew />} disabled={!canOn} onClick={() => setPending(true)}>Turn ON</Button>
        <Button variant="contained" color="error" startIcon={<PowerSettingsNew />} disabled={!canOff} onClick={() => setPending(false)}>Turn OFF</Button>
        {sw.lastCommandAt && (
          <Typography variant="caption" color="text.secondary">
            Last command: {sw.lastCommandOn ? 'ON' : 'OFF'} by {sw.lastCommandBy} · {fmtUtc(sw.lastCommandAt)}
          </Typography>
        )}
      </Stack>

      <ConfirmDialog
        open={deleting} busy={busy} danger confirmLabel="Delete"
        title="Delete this switch?"
        body={<>This permanently removes <b>{sw.name}</b> ({sw.shellyId}) and its command history from VayuVata. It does not change the physical switch or its power state. To keep the record but stop using it, deactivate it in Edit instead.</>}
        onConfirm={() => void remove()} onClose={() => setDeleting(false)}
      />
      <ConfirmDialog
        open={pending !== null} busy={busy} danger={pending === false} confirmLabel={pending ? 'Turn ON' : 'Turn OFF'}
        title={pending ? 'Turn this switch ON?' : 'Turn this switch OFF?'}
        body={<>This sends the command to <b>{sw.name}</b>{sw.deviceId ? <> and changes the power of <b>{sw.deviceId}</b></> : null}. {pending === false ? 'The device behind it will lose power.' : ''}</>}
        onConfirm={() => void send()} onClose={() => setPending(null)}
      />
    </Card>
  );
}

const Metric = ({ label, value, unit }: { label: string; value: string; unit?: string }) => (
  <Box sx={{ minWidth: 90 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography fontWeight={700}>{value} {unit && <Typography component="span" variant="caption" color="text.secondary">{unit}</Typography>}</Typography>
  </Box>
);

function HistoryDialog({ sw, onClose }: { sw: ShellyDevice | null; onClose: () => void }) {
  const [rows, setRows] = useState<ShellyCommand[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setRows(null); setErr(null);
    if (sw) shellyApi.commands(sw.id).then(setRows).catch((e) => setErr(toAppError(e).message));
  }, [sw]);
  return (
    <Dialog open={!!sw} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Command history · {sw?.name}</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error">{err}</Alert>}
        {!rows && !err && <CircularProgress size={22} />}
        {rows && rows.length === 0 && <Typography color="text.secondary">No command has been sent yet.</Typography>}
        {rows && rows.length > 0 && (
          <Stack spacing={1}>
            {rows.map((r) => (
              <Stack key={r.id} direction="row" spacing={1.5} alignItems="center">
                <Chip size="small" label={r.turnOn ? 'ON' : 'OFF'} color={r.turnOn ? 'success' : 'warning'} />
                <Typography variant="body2" sx={{ minWidth: 150 }}>{fmtUtc(r.at)}</Typography>
                <Typography variant="body2" sx={{ flex: 1 }}>{r.userName}</Typography>
                <Chip size="small" variant="outlined" color={r.succeeded ? 'success' : 'error'} label={r.succeeded ? 'done' : 'failed'} />
                {r.error && <Tooltip title={r.error}><Typography variant="caption" color="error" noWrap sx={{ maxWidth: 160 }}>{r.error}</Typography></Tooltip>}
              </Stack>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

interface Form { name: string; shellyId: string; authKey: string; cloudHost: string; channel: string; deviceId: string; isActive: boolean }
const EMPTY: Form = { name: '', shellyId: '', authKey: '', cloudHost: 'shelly-277-eu.shelly.cloud', channel: '0', deviceId: '', isActive: true };

/** SuperAdmin only: register a switch (device id, auth key, cloud server, linked VayuVata device) or edit one. The auth key is never shown again; leave it empty on edit to keep it. */
function EditDialog({ open, sw, onClose, onSaved }: { open: boolean; sw: ShellyDevice | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const devices = useDevices(open);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setF(sw ? { name: sw.name, shellyId: sw.shellyId, authKey: '', cloudHost: sw.cloudHost, channel: String(sw.channel), deviceId: sw.deviceId ?? '', isActive: sw.isActive } : EMPTY);
  }, [open, sw]);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (sw) await shellyApi.update(sw.id, { name: f.name, cloudHost: f.cloudHost, channel: Number(f.channel), deviceId: f.deviceId || null, authKey: f.authKey || null, isActive: f.isActive });
      else await shellyApi.create({ name: f.name, shellyId: f.shellyId, authKey: f.authKey, cloudHost: f.cloudHost, channel: Number(f.channel), deviceId: f.deviceId || null });
      toast(sw ? 'Switch updated.' : 'Switch added.', 'success'); onSaved(); onClose();
    } catch (e) { setErr(toAppError(e).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{sw ? 'Edit Shelly switch' : 'Add Shelly switch'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField label="Name" value={f.name} onChange={set('name')} autoFocus placeholder="Vayu_004 power switch" />
          <TextField label="Shelly device ID" value={f.shellyId} onChange={set('shellyId')} disabled={!!sw} placeholder="d0cf13cb84d4"
            helperText={sw ? 'Cannot be changed.' : 'The "id" of the device in the Shelly Cloud (its MAC without separators).'} />
          <TextField label="Shelly Cloud auth key" type="password" value={f.authKey} onChange={set('authKey')} autoComplete="new-password"
            placeholder={sw ? (sw.authKeyHint ?? '') : ''} helperText={sw ? 'Leave empty to keep the current key.' : 'The auth_key of the Shelly Cloud account. Stored on the server; never shown again.'} />
          <TextField label="Cloud server" value={f.cloudHost} onChange={set('cloudHost')} helperText="Must end in .shelly.cloud, e.g. shelly-277-eu.shelly.cloud" />
          <Stack direction="row" spacing={2}>
            <TextField label="Channel" select value={f.channel} onChange={set('channel')} sx={{ width: 120 }}>
              {[0, 1, 2, 3].map((c) => <MenuItem key={c} value={String(c)}>{c}</MenuItem>)}
            </TextField>
            <TextField label="VayuVata device" select value={f.deviceId} onChange={set('deviceId')} sx={{ flex: 1 }} helperText="The device this switch powers (one switch per device).">
              <MenuItem value="">None</MenuItem>
              {devices.devices.map((d) => <MenuItem key={d.id} value={d.deviceId}>{d.deviceName} ({d.deviceId})</MenuItem>)}
            </TextField>
          </Stack>
          {sw && <FormControlLabel control={<Switch checked={f.isActive} onChange={(e) => setF((p) => ({ ...p, isActive: e.target.checked }))} />} label="Active" />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || !f.name.trim() || !f.shellyId.trim() || (!sw && !f.authKey.trim())}>
          {busy ? <CircularProgress size={20} color="inherit" /> : sw ? 'Save' : 'Add switch'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ShellyPage() {
  const { role } = useAuth();
  const isSA = role === 'SuperAdmin';
  const list = useAsync(() => shellyApi.list(), []);
  const [editing, setEditing] = useState<ShellyDevice | null>(null);
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState<ShellyDevice | null>(null);
  const items = list.data ?? [];

  return (
    <>
      <PageHeader
        title="Shelly Switches"
        subtitle={isSA ? 'Power switches of your devices. You see all of them and can add, edit and switch.' : 'Power switches of the devices assigned to you and your users. You can turn them ON and OFF.'}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Shelly Switches' }]}
        actions={isSA ? <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>Add Shelly switch</Button> : undefined}
      />
      {!!list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <CircularProgress aria-label="Loading" />}
      {!list.loading && !list.error && items.length === 0 && (
        <Card><EmptyState title="No Shelly switches" hint={isSA ? 'Add one with its device ID and auth key, and link it to a VayuVata device.' : 'No switch is linked to a device assigned to you. Ask the administrator to link one.'} /></Card>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' } }}>
        {items.map((sw) => <SwitchCard key={`${sw.id}-${sw.isActive}`} sw={sw} canEdit={isSA} onEdit={() => setEditing(sw)} onHistory={() => setHistory(sw)} onDeleted={list.reload} onCommanded={list.reload} />)}
      </Box>
      <HistoryDialog sw={history} onClose={() => setHistory(null)} />
      {isSA && <EditDialog open={adding || !!editing} sw={editing} onClose={() => { setAdding(false); setEditing(null); }} onSaved={list.reload} />}
    </>
  );
}
