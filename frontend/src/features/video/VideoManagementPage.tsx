import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, LinearProgress, MenuItem, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import PlayCircleOutline from '@mui/icons-material/PlayCircleOutline';
import { PageHeader } from '../../components/ui';
import { ConfirmDialog, EmptyState, ErrorState, useToast } from '../../components/feedback';
import { videoApi } from '../../api/services';
import { useAsync } from '../../utils/useAsync';
import { toAppError } from '../../utils/errors';
import { fmtUtc } from '../../utils/format';
import { useAuth } from '../auth/AuthContext';
import { useDevices } from '../devices/useDevices';
import type { AdminVideoSettings, VideoConfig, VideoItemDto, VideoOverview, VideoSubscription } from '../../types/api';

export const SUBSCRIPTION_MESSAGE = 'Your subscription has expired. Please contact Super Admin.';
export const CONTROL_LOCKED_MESSAGE = 'Video playback control is currently managed by Super Admin.';

const fmtSize = (b: number) => (b >= 1024 * 1024 * 1024 ? `${(b / 1024 / 1024 / 1024).toFixed(2)} GB` : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** datetime-local value (browser local time) <-> ISO UTC. */
const toLocalInput = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const periodText = (s: VideoSubscription) => (s.expiresAt ? `${s.startsAt ? fmtUtc(s.startsAt) : 'from the start'} → ${fmtUtc(s.expiresAt)}` : 'not set');
const subChip = (s: VideoSubscription) => ({ label: s.status === 'Active' ? 'Active' : s.status === 'NotStarted' ? 'Not started' : s.status === 'Expired' ? 'Expired' : 'Not set', color: (s.status === 'Active' ? 'success' : s.status === 'NotStarted' ? 'warning' : 'error') as 'success' | 'warning' | 'error' });

interface FormState extends VideoConfig { from: string; to: string }
const formOf = (c: VideoConfig, s: VideoSubscription): FormState => ({ ...c, from: toLocalInput(s.startsAt), to: toLocalInput(s.expiresAt) });

/** The settings one Admin (or one device without an Admin) has: subscription From/To and the permissions. */
function SettingsFields({ f, setF, sub }: { f: FormState; setF: (u: (p: FormState) => FormState) => void; sub: VideoSubscription }) {
  const set = (k: keyof VideoConfig) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.checked }));
  const extend = (days: number) => setF((p) => { const base = p.to && new Date(p.to) > new Date() ? new Date(p.to) : new Date(); base.setDate(base.getDate() + days); return { ...p, from: p.from || toLocalInput(new Date().toISOString()), to: toLocalInput(base.toISOString()) }; });
  const bad = !!f.from && !!f.to && new Date(f.from) >= new Date(f.to);
  return (
    <Stack spacing={1}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField label="Subscription from" type="datetime-local" size="small" value={f.from} onChange={(e) => setF((p) => ({ ...p, from: e.target.value }))} InputLabelProps={{ shrink: true }} sx={{ minWidth: 230 }} />
        <TextField label="Subscription to" type="datetime-local" size="small" value={f.to} onChange={(e) => setF((p) => ({ ...p, to: e.target.value }))} InputLabelProps={{ shrink: true }} sx={{ minWidth: 230 }}
          error={bad} helperText={bad ? "'From' must be before 'To'." : undefined} />
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip size="small" color={subChip(sub).color} label={`Now: ${subChip(sub).label}`} />
        <Button size="small" onClick={() => extend(30)}>+30 days</Button><Button size="small" onClick={() => extend(365)}>+1 year</Button>
        <Button size="small" color="inherit" onClick={() => setF((p) => ({ ...p, from: '', to: '' }))}>Clear</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">Uploads and playback work only between From and To. After you renew an expired subscription, playback stays OFF until it is turned ON.</Typography>
      <Box>
        <FormControlLabel control={<Switch checked={f.adminControlEnabled} onChange={set('adminControlEnabled')} inputProps={{ 'aria-label': 'Admin Video Control Permission' }} />}
          label={<>Admin Video Control Permission <Typography component="span" variant="caption" color="text.secondary">({f.adminControlEnabled ? 'Enabled' : 'Disabled'})</Typography></>} />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 0.5 }}>Enabled: the Admin can turn playback ON/OFF. Disabled: only you can. Uploading, deleting and choosing the active video are separate.</Typography>
      </Box>
      <Box>
        <FormControlLabel control={<Switch color="error" checked={f.forcedOff} onChange={set('forcedOff')} inputProps={{ 'aria-label': 'Force playback OFF' }} />}
          label={<>Force playback OFF <Typography component="span" variant="caption" color="text.secondary">({f.forcedOff ? 'forced OFF' : 'not forced'})</Typography></>} />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ ml: 0.5 }}>Stops playback whatever the Admin permission is. Only you can lift it. It does not block uploading or deleting.</Typography>
      </Box>
      <FormControlLabel control={<Switch checked={f.adminCanUpload} onChange={set('adminCanUpload')} inputProps={{ 'aria-label': 'Admins can upload' }} />} label="Admin can upload videos" />
      <FormControlLabel control={<Switch checked={f.adminCanDeleteOwn} onChange={set('adminCanDeleteOwn')} inputProps={{ 'aria-label': 'Admins can delete their own videos' }} />} label="Admin can delete their own videos" />
      <FormControlLabel control={<Switch checked={f.userCanView} onChange={set('userCanView')} inputProps={{ 'aria-label': 'Users can view the list' }} />} label="Users can view the video list (view only)" />
    </Stack>
  );
}

const requestOf = (f: FormState) => ({
  adminControlEnabled: f.adminControlEnabled, forcedOff: f.forcedOff, adminCanUpload: f.adminCanUpload, adminCanDeleteOwn: f.adminCanDeleteOwn, userCanView: f.userCanView,
  subscriptionStartsAt: fromLocalInput(f.from), subscriptionExpiresAt: fromLocalInput(f.to),
});

/** Super Admin, ONE device. A device of an Admin only has its own force-OFF here; a device without an Admin has the full settings. */
function DeviceConfigCard({ ov, onSaved }: { ov: VideoOverview; onSaved: () => void }) {
  const toast = useToast();
  const cfg = ov.config!;
  const [f, setF] = useState<FormState>(formOf(cfg, ov.subscription));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setF(formOf(ov.config!, ov.subscription)); setErr(null); }, [ov.deviceId, ov.config, ov.subscription]);   // eslint-disable-line react-hooks/exhaustive-deps
  const fromAdmin = cfg.scope === 'Admin';
  const dirty = fromAdmin ? f.forcedOff !== cfg.deviceForcedOff : JSON.stringify(f) !== JSON.stringify(formOf(cfg, ov.subscription));
  const save = async () => {
    setBusy(true); setErr(null);
    try { await videoApi.config(ov.deviceId, requestOf(fromAdmin ? { ...formOf(cfg, ov.subscription), forcedOff: f.forcedOff } : f)); toast('Video settings saved.', 'success'); onSaved(); }
    catch (e) { setErr(toAppError(e).message); } finally { setBusy(false); }
  };
  return (
    <Card sx={{ p: 2.5 }}>
      <Typography fontWeight={800}>Super Admin controls · this device</Typography>
      {err && <Alert severity="error" sx={{ my: 1.5 }}>{err}</Alert>}
      {fromAdmin ? (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Alert severity="info">The subscription and permissions of this device come from its Admin, <b>{cfg.adminName}</b>. Change them under <b>Admin accounts</b> below; they then apply to all of that Admin's devices.</Alert>
          <Box>
            <FormControlLabel control={<Switch color="error" checked={f.forcedOff} onChange={(e) => setF((p) => ({ ...p, forcedOff: e.target.checked }))} inputProps={{ 'aria-label': 'Force playback OFF' }} />}
              label={<>Force playback OFF on this device only <Typography component="span" variant="caption" color="text.secondary">({cfg.forcedOff && !cfg.deviceForcedOff ? 'also forced for all of this Admin' : f.forcedOff ? 'forced OFF' : 'not forced'})</Typography></>} />
          </Box>
        </Stack>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>This device has no Admin, so it has its own settings.</Typography>
          <SettingsFields f={f} setF={setF} sub={ov.subscription} />
        </>
      )}
      <Box sx={{ mt: 1.5 }}><Button variant="contained" onClick={() => void save()} disabled={!dirty || busy}>{busy ? <CircularProgress size={20} color="inherit" /> : 'Save video settings'}</Button></Box>
    </Card>
  );
}

/** Super Admin: one row per Admin (client). The settings apply to all of that Admin's devices at once. */
function AdminAccountsCard({ version, onChanged }: { version: number; onChanged: () => void }) {
  const toast = useToast();
  const admins = useAsync(() => videoApi.admins(), [version]);
  const [editing, setEditing] = useState<AdminVideoSettings | null>(null);
  const [f, setF] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const open = (a: AdminVideoSettings) => { setEditing(a); setF(formOf(a.config, a.subscription)); setErr(null); };
  const save = async () => {
    if (!editing || !f) return;
    setBusy(true); setErr(null);
    try { await videoApi.adminConfig(editing.adminId, requestOf(f)); toast(`Video settings of ${editing.adminName} saved for ${editing.deviceIds.length} device(s).`, 'success'); setEditing(null); admins.reload(); onChanged(); }
    catch (e) { setErr(toAppError(e).message); } finally { setBusy(false); }
  };
  return (
    <Card>
      <Typography fontWeight={800} sx={{ p: 2.5, pb: 0.5 }}>Admin accounts</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, pb: 1 }}>Subscription and permissions are set per Admin and apply to every device of that Admin. Admins never affect each other.</Typography>
      {!!admins.error && <ErrorState error={admins.error} onRetry={admins.reload} />}
      {admins.loading && !admins.data && <Box sx={{ p: 2.5 }}><CircularProgress aria-label="Loading admins" /></Box>}
      {(admins.data?.length ?? 0) === 0 && !admins.loading && !admins.error && <EmptyState title="No Admins yet" />}
      {(admins.data?.length ?? 0) > 0 && (
        <TableContainer>
          <Table size="small" aria-label="Admin video settings">
            <TableHead><TableRow><TableCell>Admin</TableCell><TableCell>Devices</TableCell><TableCell>Subscription (from → to)</TableCell><TableCell>Admin control</TableCell><TableCell>Force OFF</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {admins.data!.map((a) => (
                <TableRow key={a.adminId} hover>
                  <TableCell><b>{a.adminName}</b><Typography variant="caption" display="block" color="text.secondary">{a.adminEmail}</Typography></TableCell>
                  <TableCell>{a.deviceIds.length ? a.deviceIds.join(', ') : '—'}</TableCell>
                  <TableCell><Chip size="small" color={subChip(a.subscription).color} label={subChip(a.subscription).label} sx={{ mr: 1 }} />{periodText(a.subscription)}</TableCell>
                  <TableCell>{a.config.adminControlEnabled ? 'Enabled' : 'Disabled'}</TableCell>
                  <TableCell>{a.config.forcedOff ? <Chip size="small" color="error" label="Forced OFF" /> : 'No'}</TableCell>
                  <TableCell align="right"><Button size="small" onClick={() => open(a)} aria-label={`Edit video settings of ${a.adminName}`}>Edit</Button></TableCell>
                </TableRow>))}
            </TableBody>
          </Table>
        </TableContainer>)}
      <Dialog open={!!editing} onClose={busy ? undefined : () => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Video settings · {editing?.adminName}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {err && <Alert severity="error">{err}</Alert>}
            <Typography variant="body2" color="text.secondary">Applies to all of this Admin's devices: {editing?.deviceIds.join(', ') || 'none yet'}.</Typography>
            {f && editing && <SettingsFields f={f} setF={(u) => setF((p) => (p ? u(p) : p))} sub={editing.subscription} />}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={() => setEditing(null)} color="inherit" disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={() => void save()} disabled={busy || (!!f?.from && !!f?.to && new Date(f.from) >= new Date(f.to))}>{busy ? <CircularProgress size={20} color="inherit" /> : 'Save for this Admin'}</Button></DialogActions>
      </Dialog>
    </Card>
  );
}

export default function VideoManagementPage() {
  const { role } = useAuth();
  const isSA = role === 'SuperAdmin'; const isAdmin = role === 'Admin';
  const toast = useToast();
  const devices = useDevices(true);
  const [deviceId, setDeviceId] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => { if (!deviceId && devices.devices.length) setDeviceId(devices.devices[0].deviceId); }, [devices.devices, deviceId]);

  const ov = useAsync(() => videoApi.overview(deviceId), [deviceId, version], !!deviceId);
  const o = ov.data;
  const canList = o?.capabilities.canView ?? false;
  const list = useAsync(() => videoApi.list(deviceId), [deviceId, version, canList], !!deviceId && canList);
  const history = useAsync(() => videoApi.history(deviceId), [deviceId, version], !!deviceId && (isSA || isAdmin));
  const bump = () => setVersion((v) => v + 1);

  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<VideoItemDto | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const accept = useMemo(() => (o?.allowedFormats ?? []).join(','), [o]);
  const pick = async (file: File | undefined) => {
    if (!file || !o) return;
    setUploadError(null);
    if (file.size > o.maxSizeMb * 1024 * 1024) { setUploadError(`The video is larger than ${o.maxSizeMb} MB.`); return; }
    setProgress(0);
    try { await videoApi.upload(deviceId, file, setProgress); toast('Video uploaded.', 'success'); bump(); }
    catch (e) { setUploadError(toAppError(e).message); } finally { setProgress(null); if (fileInput.current) fileInput.current.value = ''; }
  };
  const playback = async (enabled: boolean) => {
    setBusy(true); setControlError(null);
    try { await videoApi.playback(deviceId, enabled); toast(enabled ? 'Playback turned ON.' : 'Playback turned OFF.', 'success'); bump(); }
    catch (e) { setControlError(toAppError(e).message); bump(); } finally { setBusy(false); }
  };
  const makeActive = async (v: VideoItemDto) => {
    setBusy(true); setControlError(null);
    try { await videoApi.setActive(deviceId, v.id); toast(`${v.fileName} is now the active video.`, 'success'); bump(); }
    catch (e) { setControlError(toAppError(e).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try { await videoApi.remove(deleting.id); toast('Video deleted.', 'success'); setDeleting(null); bump(); }
    catch (e) { toast(toAppError(e).message, 'error'); setDeleting(null); } finally { setBusy(false); }
  };

  const sub = o?.subscription;
  const expired = !!o && !o.subscription.active;
  const noVideo = !list.loading && !list.error && (list.data?.length ?? 0) === 0;

  return (
    <>
      <PageHeader title="Video Management" subtitle={isSA ? 'Upload videos, control playback, and decide what Admins may do.' : isAdmin ? 'Upload videos for your devices and manage them.' : 'The videos of your devices (view only).'}
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Settings' }, { label: 'Video Management' }]} />
      {!!devices.error && <ErrorState error={devices.error} onRetry={devices.reload} />}
      {!devices.loading && !devices.error && devices.devices.length === 0 && <Card><EmptyState title="No devices" hint="No device is available to you yet." /></Card>}
      {devices.devices.length > 0 && (
        <Stack spacing={2} sx={{ maxWidth: 1000 }}>
          <TextField select label="Device" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} sx={{ maxWidth: 420 }}>
            {devices.devices.map((d) => <MenuItem key={d.id} value={d.deviceId}>{d.deviceName.includes(d.deviceId) ? d.deviceName : `${d.deviceName} (${d.deviceId})`}</MenuItem>)}
          </TextField>
          {!!ov.error && <ErrorState error={ov.error} onRetry={ov.reload} />}
          {ov.loading && !o && <CircularProgress aria-label="Loading" />}
          {o && sub && (
            <>
              <Card sx={{ p: 2.5 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
                  <Box>
                    <Typography fontWeight={800}>Subscription</Typography>
                    <Typography variant="body2" color="text.secondary">{sub.status === 'NotSet' ? 'No subscription recorded' : `From ${sub.startsAt ? fmtUtc(sub.startsAt) : 'the start'} to ${fmtUtc(sub.expiresAt)}`}{o.config?.scope === 'Admin' ? ` · plan of Admin ${o.config.adminName}` : ''}</Typography>
                  </Box>
                  <Chip color={subChip(sub).color} label={subChip(sub).label} sx={{ fontWeight: 700 }} />
                </Stack>
                {expired && <Alert severity="error" sx={{ mt: 1.5 }}>{sub.message ?? SUBSCRIPTION_MESSAGE}</Alert>}
              </Card>

              <Card sx={{ p: 2.5 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
                  <Box>
                    <Typography fontWeight={800}>Playback</Typography>
                    <Typography variant="body2" color="text.secondary">{o.activeVideoName ? <>Active video: <b>{o.activeVideoName}</b></> : 'No active video yet'}</Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip color={o.effective.allowed ? 'success' : 'default'} label={o.effective.allowed ? 'Playing allowed' : 'Playback OFF'} sx={{ fontWeight: 700 }} />
                    {o.capabilities.canControlPlayback && (
                      <>
                        <Button variant="contained" color="success" disabled={busy || o.playbackEnabled && !o.config?.forcedOff && o.effective.allowed} onClick={() => void playback(true)}>Turn ON</Button>
                        <Button variant="contained" color="error" disabled={busy || !o.playbackEnabled} onClick={() => void playback(false)}>Turn OFF</Button>
                      </>)}
                  </Stack>
                </Stack>
                {!o.effective.allowed && o.effective.reason && !expired && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{o.effective.reason}</Typography>}
                {isAdmin && !o.capabilities.canControlPlayback && o.capabilities.controlMessage && <Alert severity="warning" sx={{ mt: 1.5 }}>{o.capabilities.controlMessage}</Alert>}
                {controlError && <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setControlError(null)}>{controlError}</Alert>}
                {o.deviceStatus && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>Device reports: {o.deviceStatus.state}{o.deviceStatus.message ? ` · ${o.deviceStatus.message}` : ''} · {fmtUtc(o.deviceStatus.reportedAt)}</Typography>}
                {role === 'User' && <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>View only.</Typography>}
              </Card>

              {(isSA || isAdmin) && (
                <Card sx={{ p: 2.5 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
                    <Box><Typography fontWeight={800}>Upload video</Typography>
                      <Typography variant="caption" color="text.secondary">{o.allowedFormats.join(', ')} · up to {o.maxSizeMb} MB</Typography></Box>
                    <Tooltip title={o.capabilities.uploadBlockedReason ?? ''}>
                      <span>
                        <Button variant="contained" startIcon={<UploadFileOutlined />} disabled={!o.capabilities.canUpload || progress !== null} onClick={() => fileInput.current?.click()}>Upload Video</Button>
                      </span>
                    </Tooltip>
                    <input ref={fileInput} type="file" hidden accept={accept} aria-label="Video file" onChange={(e) => void pick(e.target.files?.[0])} />
                  </Stack>
                  {progress !== null && <Box sx={{ mt: 1.5 }}><LinearProgress variant="determinate" value={progress} /><Typography variant="caption" color="text.secondary">Uploading {progress}%</Typography></Box>}
                  {uploadError && <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setUploadError(null)}>{uploadError}</Alert>}
                  {o.capabilities.uploadBlockedReason && <Alert severity={expired ? 'error' : 'warning'} sx={{ mt: 1.5 }}>{o.capabilities.uploadBlockedReason}</Alert>}
                </Card>)}

              <Card>
                <Typography fontWeight={800} sx={{ p: 2.5, pb: 1 }}>Uploaded videos</Typography>
                {!canList && <Typography color="text.secondary" sx={{ px: 2.5, pb: 2.5 }}>The video list is not available to you for this device.</Typography>}
                {canList && list.loading && !list.data && <Box sx={{ p: 2.5 }}><CircularProgress aria-label="Loading videos" /></Box>}
                {canList && !!list.error && <ErrorState error={list.error} onRetry={list.reload} />}
                {canList && noVideo && <EmptyState title="No videos yet" hint={isSA || isAdmin ? 'Use Upload Video to add one.' : undefined} />}
                {canList && (list.data?.length ?? 0) > 0 && (
                  <TableContainer>
                    <Table size="small" aria-label="Uploaded videos">
                      <TableHead><TableRow><TableCell>Video name</TableCell><TableCell>File size</TableCell><TableCell>Uploaded</TableCell><TableCell>Uploaded by</TableCell><TableCell>Processing</TableCell><TableCell>Playback</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
                      <TableBody>
                        {list.data!.map((v) => (
                          <TableRow key={v.id} hover>
                            <TableCell sx={{ fontWeight: 600 }}>{v.fileName}{v.isActive && <Chip size="small" color="primary" label="Active" sx={{ ml: 1 }} />}</TableCell>
                            <TableCell>{fmtSize(v.sizeBytes)}</TableCell>
                            <TableCell>{fmtUtc(v.uploadedAt)}</TableCell>
                            <TableCell>{v.uploadedByName}</TableCell>
                            <TableCell><Chip size="small" color={v.processingStatus === 'Ready' ? 'success' : 'warning'} label={v.processingStatus} /></TableCell>
                            <TableCell>{v.playbackStatus}</TableCell>
                            <TableCell align="right">
                              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                                {o.capabilities.canControlPlayback && !v.isActive && <Button size="small" startIcon={<PlayCircleOutline />} disabled={busy} onClick={() => void makeActive(v)}>Set active</Button>}
                                {v.canDelete && <Button size="small" color="error" startIcon={<DeleteOutline />} disabled={busy} onClick={() => setDeleting(v)}>Delete</Button>}
                              </Stack>
                            </TableCell>
                          </TableRow>))}
                      </TableBody>
                    </Table>
                  </TableContainer>)}
              </Card>

              {isSA && o.config && <DeviceConfigCard ov={o} onSaved={() => bump()} />}
              {isSA && <AdminAccountsCard version={version} onChanged={bump} />}

              {(isSA || isAdmin) && (history.data?.length ?? 0) > 0 && (
                <Card sx={{ p: 2.5 }}>
                  <Typography fontWeight={800} sx={{ mb: 1 }}>Recent activity</Typography>
                  <Stack spacing={0.5}>
                    {history.data!.slice(0, 10).map((h) => (
                      <Typography key={h.id} variant="body2" color={h.success ? 'text.primary' : 'error'}>{fmtUtc(h.at)} · <b>{h.action}</b> · {h.userName ?? h.source}{h.detail ? ` · ${h.detail}` : ''}</Typography>))}
                  </Stack>
                </Card>)}
            </>
          )}
        </Stack>
      )}
      <ConfirmDialog open={!!deleting} busy={busy} danger confirmLabel="Delete" title="Delete this video?" body={<>This permanently deletes <b>{deleting?.fileName}</b>. If it is the active video, playback stops.</>} onConfirm={() => void remove()} onClose={() => setDeleting(null)} />
    </>
  );
}
