import { useAuth } from '../auth/AuthContext';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert, Autocomplete, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import ContentCopy from '@mui/icons-material/ContentCopy';
import Check from '@mui/icons-material/Check';
import type { z } from 'zod';
import { devicesApi, usersApi } from '../../api/services';
import { createDeviceSchema, updateDeviceSchema } from '../../utils/schemas';
import { toAppError } from '../../utils/errors';
import { useToast } from '../../components/feedback';
import { useAsync } from '../../utils/useAsync';
import type { DeviceDto, DeviceWithKeyDto, UserDto } from '../../types/api';

function FormActions({ onClose, busy, label }: { onClose: () => void; busy: boolean; label: string }) {
  return (
    <DialogActions sx={{ px: 3, pb: 2 }}>
      <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
      <Button type="submit" variant="contained" disabled={busy}>{busy ? <CircularProgress size={20} color="inherit" /> : label}</Button>
    </DialogActions>
  );
}

function applyServerErrors(e: unknown, setError: (n: never, o: { message: string }) => void, setTop: (m: string) => void, fields: string[]) {
  const err = toAppError(e);
  let placed = false;
  for (const [k, msgs] of Object.entries(err.fieldErrors)) {
    const f = fields.find((x) => x.toLowerCase() === k.toLowerCase());
    if (f) { setError(f as never, { message: msgs[0] }); placed = true; }
  }
  if (!placed) setTop(err.message);
}

/** Shows the API key exactly once. It is held only in component state/props and never written to storage. */
export function ApiKeyDialog({ device, title, onClose }: { device: DeviceWithKeyDto | null; title: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [ack, setAck] = useState(false);
  const copy = async () => {
    if (!device) return;
    try { await navigator.clipboard.writeText(device.apiKey); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: user can select the text */ }
  };
  return (
    <Dialog open={!!device} maxWidth="sm" fullWidth onClose={(_, reason) => { if (reason === 'backdropClick' || reason === 'escapeKeyDown') return; onClose(); }} TransitionProps={{ onExited: () => { setAck(false); setCopied(false); } }}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Copy this key now and store it securely. <b>It is shown only once and cannot be retrieved later.</b> If it is lost, rotate the key to issue a new one.
        </Alert>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Device {device?.deviceId} · {device?.deviceName}</Typography>
        <TextField
          value={device?.apiKey ?? ''} label="Device API key" InputProps={{
            readOnly: true, sx: { fontFamily: 'ui-monospace, Consolas, monospace' },
            endAdornment: <InputAdornment position="end"><Tooltip title={copied ? 'Copied' : 'Copy'}><IconButton aria-label="Copy API key" onClick={copy}>{copied ? <Check color="success" /> : <ContentCopy />}</IconButton></Tooltip></InputAdornment>,
          }}
          onFocus={(e) => e.target.select()}
        />
        <Box sx={{ mt: 1.5 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have copied the key and stored it safely.
          </label>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button variant="contained" disabled={!ack} onClick={onClose}>Done</Button></DialogActions>
    </Dialog>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked: select the text instead */ }
  };
  return (
    <TextField label={label} value={value} onFocus={(e) => e.target.select()} InputProps={{
      readOnly: true, sx: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 },
      endAdornment: <InputAdornment position="end"><Tooltip title={copied ? 'Copied' : 'Copy'}><IconButton aria-label={`Copy ${label}`} onClick={copy}>{copied ? <Check color="success" /> : <ContentCopy />}</IconButton></Tooltip></InputAdornment>,
    }} />
  );
}

/** Shows the stored key hash (GET /devices/{id}/key-hash, SuperAdmin) for flashing the ESP32. Held in state only, never stored. */
export function KeyHashDialog({ device, onClose }: { device: DeviceDto | null; onClose: () => void }) {
  const s = useAsync(() => devicesApi.keyHash(device!.id), [device?.id], !!device);
  return (
    <Dialog open={!!device} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Device credentials for ESP32</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Flash these into the device. The ESP32 sends its <b>Device ID</b> in the request body and the <b>key hash</b> in the <code>X-Device-Key</code> header; the server checks that both belong to the same device.
          </Typography>
          {s.loading && <CircularProgress size={24} />}
          {!!s.error && <Alert severity="error">{toAppError(s.error).message}</Alert>}
          {s.data && (
            <>
              <CopyField label="Device ID" value={s.data.deviceId} />
              {s.data.apiKeyHash
                ? <CopyField label="Key hash (X-Device-Key)" value={s.data.apiKeyHash} />
                : <Alert severity="warning">This device has no key yet. Rotate its key to create one.</Alert>}
              <Alert severity="warning">Treat the hash like a password. Anyone who has it can send data as this device. Rotating the key changes it. The server must have <code>DeviceAuth:AcceptStoredHashAsKey</code> enabled to accept it.</Alert>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button variant="contained" onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}

type CreateForm = z.infer<typeof createDeviceSchema>;
export function RegisterDeviceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (d: DeviceWithKeyDto) => void }) {
  const [top, setTop] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<CreateForm>({
    resolver: zodResolver(createDeviceSchema), defaultValues: { deviceId: '', deviceName: '', description: '' },
  });
  const submit = handleSubmit(async (v) => {
    setTop(null);
    try {
      const d = await devicesApi.create({ deviceId: v.deviceId.trim(), deviceName: v.deviceName.trim(), description: v.description?.trim() || null });
      reset(); onCreated(d);
    } catch (e) { applyServerErrors(e, setError as never, setTop, ['deviceId', 'deviceName', 'description']); }
  });
  return (
    <Dialog open={open} onClose={isSubmitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>Register device</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {top && <Alert severity="error">{top}</Alert>}
            <TextField label="Device ID" placeholder="ESP32-A1B2C3" autoFocus error={!!errors.deviceId} helperText={errors.deviceId?.message ?? 'Physical identifier. Letters, digits, - _ :'} {...register('deviceId')} />
            <TextField label="Device name" error={!!errors.deviceName} helperText={errors.deviceName?.message} {...register('deviceName')} />
            <TextField label="Description" multiline minRows={2} error={!!errors.description} helperText={errors.description?.message} {...register('description')} />
          </Stack>
        </DialogContent>
        <FormActions onClose={onClose} busy={isSubmitting} label="Register" />
      </form>
    </Dialog>
  );
}

type EditForm = z.infer<typeof updateDeviceSchema>;
export function EditDeviceDialog({ device, onClose, onSaved }: { device: DeviceDto | null; onClose: () => void; onSaved: (d: DeviceDto) => void }) {
  const toast = useToast();
  const [top, setTop] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<EditForm>({
    resolver: zodResolver(updateDeviceSchema), values: { deviceName: device?.deviceName ?? '', description: device?.description ?? '' },
  });
  const submit = handleSubmit(async (v) => {
    if (!device) return;
    setTop(null);
    try {
      const d = await devicesApi.update(device.id, { deviceName: v.deviceName.trim(), description: v.description?.trim() || null });
      toast('Device updated.'); onSaved(d);
    } catch (e) { applyServerErrors(e, setError as never, setTop, ['deviceName', 'description']); }
  });
  return (
    <Dialog open={!!device} onClose={isSubmitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>Edit device</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {top && <Alert severity="error">{top}</Alert>}
            <TextField label="Device ID" value={device?.deviceId ?? ''} disabled helperText="The physical ID cannot be changed." />
            <TextField label="Device name" autoFocus error={!!errors.deviceName} helperText={errors.deviceName?.message} {...register('deviceName')} />
            <TextField label="Description" multiline minRows={2} error={!!errors.description} helperText={errors.description?.message} {...register('description')} />
          </Stack>
        </DialogContent>
        <FormActions onClose={onClose} busy={isSubmitting} label="Save" />
      </form>
    </Dialog>
  );
}

/** Assign (or reassign) a device. Candidates come from GET /users (scoped by the backend): Users, plus Admins when the caller is a SuperAdmin. */
export function AssignDeviceDialog({ device, onClose, onDone }: { device: DeviceDto | null; onClose: () => void; onDone: (d: DeviceDto) => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<UserDto | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { role } = useAuth();
  const users = useAsync(async () => {
    const q = (r: 'User' | 'Admin') => usersApi.list({ role: r, isActive: true, search: search || undefined, pageSize: 20, includeTotal: false });
    const [u, a] = await Promise.all([q('User'), role === 'SuperAdmin' ? q('Admin') : Promise.resolve(null)]);
    return [...(a?.items ?? []), ...u.items];
  }, [search, role], !!device);

  const submit = async () => {
    if (!device || !selected) return;
    setBusy(true); setErr(null);
    try {
      const d = await devicesApi.assign(device.id, selected.id, notes.trim());
      toast(`Assigned to ${selected.name}.`); onDone(d); setSelected(null); setNotes('');
    } catch (e) { setErr(toAppError(e).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!device} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{device?.assignedUserId ? 'Reassign device' : 'Assign device'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {device?.assignedUserId && <Alert severity="info">Currently assigned to <b>{device.assignedUserName}</b>. Reassigning ends that assignment; history is kept.</Alert>}
          {err && <Alert severity="error">{err}</Alert>}
          <Autocomplete
            options={users.data ?? []} groupBy={(u) => (u.role === 'Admin' ? 'Admins' : 'Users')} loading={users.loading} value={selected} onChange={(_, v) => setSelected(v)}
            getOptionLabel={(u) => `${u.name} (${u.email})${u.role === 'Admin' ? ' · Admin' : ''}`} isOptionEqualToValue={(a, b) => a.id === b.id}
            filterOptions={(o) => o} onInputChange={(_, v, reason) => { if (reason === 'input') setSearch(v); }}
            renderInput={(p) => <TextField {...p} label={role === 'SuperAdmin' ? 'User or Admin' : 'User'} placeholder="Search by name or email" />}
          />
          <TextField label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} inputProps={{ maxLength: 500 }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!selected || busy}>{busy ? <CircularProgress size={20} color="inherit" /> : 'Assign'}</Button>
      </DialogActions>
    </Dialog>
  );
}
