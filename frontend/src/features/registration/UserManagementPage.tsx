import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, ListItemText, MenuItem, OutlinedInput,
  Select, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography,
} from '@mui/material';
import PersonAddAltOutlined from '@mui/icons-material/PersonAddAltOutlined';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import { PageHeader, PaginationBar } from '../../components/ui';
import { EmptyState, ErrorState, useToast } from '../../components/feedback';
import { userMgmtApi, usersApi } from '../../api/services';
import { useAsync } from '../../utils/useAsync';
import { toAppError } from '../../utils/errors';
import { fmtUtc } from '../../utils/format';
import { mobileSchema } from '../../utils/schemas';
import { useDevices } from '../devices/useDevices';
import { RegistrationLinkCard } from './RegistrationLinkCard';
import type { InviteResult, RegistrationRequestDto, UserDto } from '../../types/api';

const statusColor = (s: string | null | undefined): 'success' | 'warning' | 'error' | 'default' =>
  s === 'Active' || s === 'Approved' || s === 'Sent' ? 'success' : s === 'Pending' || s === 'Pending activation' || s === 'NotConfigured' ? 'warning' : s === 'Rejected' || s === 'Failed' || s === 'Inactive' ? 'error' : 'default';
const StatusChip = ({ s }: { s: string | null | undefined }) => (s ? <Chip size="small" color={statusColor(s)} label={s} sx={{ fontWeight: 700 }} /> : <>—</>);

const TABS = [
  { key: 'users', label: 'All Users' }, { key: 'admins', label: 'All Admins' }, { key: 'requests', label: 'Registration Requests' }, { key: 'pending', label: 'Pending Approvals' },
  { key: 'approved', label: 'Approved Accounts' }, { key: 'rejected', label: 'Rejected Requests' }, { key: 'mapping', label: 'Admin–User Mapping' }, { key: 'history', label: 'History' }, { key: 'email', label: 'Email log' },
] as const;
type TabKey = typeof TABS[number]['key'];

function EmailSummary({ r }: { r: InviteResult }) {
  return (
    <Stack spacing={0.5} sx={{ mt: 1 }}>
      {r.emails.map((e, i) => <Typography key={i} variant="body2">{e.status === 'Sent' ? '✓' : '✗'} {e.template} → {e.to} <StatusChip s={e.status} /></Typography>)}
    </Stack>
  );
}

/** What the Device ID an applicant entered is, for the Super Admin: Free (assigned automatically on approval), not registered yet (create it first), or already assigned. */
export function DeviceChip({ r }: { r: RegistrationRequestDto }) {
  if (r.status !== 'Pending' || !r.deviceStatus) return null;
  const map = {
    Free: { label: 'Free: assigned on approval', color: 'success' as const }, NotRegistered: { label: 'Not registered: create it first', color: 'warning' as const },
    Assigned: { label: `Assigned to ${r.deviceOwnerName ?? 'someone'}`, color: 'warning' as const }, Inactive: { label: 'Inactive device', color: 'error' as const },
  }[r.deviceStatus];
  return <Chip size="small" color={map.color} label={map.label} />;
}

// ------------------------------------------------------------------ users / admins

function UsersTab({ role, onResend, version }: { role: 'User' | 'Admin'; onResend: (u: UserDto) => void; version: number }) {
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const list = useAsync(() => usersApi.list({ role, page, pageSize }), [role, page, pageSize, version]);
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;
  if (list.loading && !list.data) return <CircularProgress aria-label="Loading" />;
  const items = list.data?.items ?? [];
  return (
    <>
      {items.length === 0 ? <EmptyState title={role === 'Admin' ? 'No admins yet' : 'No users yet'} /> : (
        <TableContainer><Table size="small" aria-label={role === 'Admin' ? 'All Admins' : 'All Users'}>
          <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Email</TableCell><TableCell>Mobile</TableCell>{role === 'User' && <TableCell>Admin</TableCell>}<TableCell>Activation status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
          <TableBody>{items.map((u) => (
            <TableRow key={u.id} hover>
              <TableCell sx={{ fontWeight: 600 }}>{u.name}</TableCell><TableCell>{u.email}</TableCell><TableCell>{u.mobile ?? '—'}</TableCell>
              {role === 'User' && <TableCell>{u.managerName ?? '—'}{u.managerRole === 'SuperAdmin' ? ' (Super Admin)' : ''}</TableCell>}
              <TableCell><StatusChip s={u.activationStatus ?? (u.isActive ? 'Active' : 'Inactive')} /></TableCell>
              <TableCell align="right">{u.activationStatus === 'Pending activation' && <Button size="small" onClick={() => onResend(u)}>Resend invitation</Button>}</TableCell>
            </TableRow>))}</TableBody>
        </Table></TableContainer>
      )}
      <PaginationBar page={page} result={list.data} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </>
  );
}

// ------------------------------------------------------------------ requests

function RequestsTab({ status, onApprove, onReject, onResend, version }: { status?: string; onApprove: (r: RegistrationRequestDto) => void; onReject: (r: RegistrationRequestDto) => void; onResend: (userId: number) => void; version: number }) {
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  useEffect(() => setPage(1), [status]);
  const list = useAsync(() => userMgmtApi.requests({ status, page, pageSize }), [status, page, pageSize, version]);
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} />;
  if (list.loading && !list.data) return <CircularProgress aria-label="Loading" />;
  const items = list.data?.items ?? [];
  return (
    <>
      {items.length === 0 ? <EmptyState title={status === 'Pending' ? 'Nothing is waiting for approval' : 'No requests'} /> : (
        <TableContainer><Table size="small" aria-label="Registration requests">
          <TableHead><TableRow><TableCell>Applicant</TableCell><TableCell>Requested</TableCell><TableCell>Admin entered</TableCell><TableCell>Device ID</TableCell><TableCell>Received</TableCell><TableCell>Status</TableCell><TableCell>Decision</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
          <TableBody>{items.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell><b>{r.fullName}</b><Typography variant="caption" display="block" color="text.secondary">{r.email} · {r.mobile}</Typography></TableCell>
              <TableCell>{r.requestedRole}</TableCell>
              <TableCell>{r.requestedRole === 'User' ? (r.adminEmail ?? '—') : '—'}</TableCell>
              <TableCell>{r.deviceId ? <>{r.deviceId}<Box sx={{ mt: 0.5 }}><DeviceChip r={r} /></Box></> : '—'}</TableCell>
              <TableCell>{fmtUtc(r.createdAt)}</TableCell>
              <TableCell><StatusChip s={r.status} />{r.status === 'Approved' && <Box sx={{ mt: 0.5 }}><StatusChip s={r.activationStatus} /></Box>}</TableCell>
              <TableCell>{r.decidedAt ? <>{fmtUtc(r.decidedAt)}<Typography variant="caption" display="block" color="text.secondary">{r.decidedByName}{r.approvedRole && r.approvedRole !== r.requestedRole ? ` · granted ${r.approvedRole}` : ''}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</Typography></> : '—'}</TableCell>
              <TableCell align="right">
                {r.status === 'Pending' && <Stack direction="row" spacing={1} justifyContent="flex-end"><Button size="small" variant="contained" onClick={() => onApprove(r)}>Approve</Button><Button size="small" color="error" onClick={() => onReject(r)}>Reject</Button></Stack>}
                {r.status === 'Approved' && r.activationStatus === 'Pending activation' && r.userId != null && <Button size="small" onClick={() => onResend(r.userId!)}>Resend invitation</Button>}
              </TableCell>
            </TableRow>))}</TableBody>
        </Table></TableContainer>
      )}
      <PaginationBar page={page} result={list.data} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </>
  );
}

// ------------------------------------------------------------------ mapping, history, email log

function MappingTab({ version }: { version: number }) {
  const m = useAsync(() => userMgmtApi.mapping(), [version]);
  if (m.error) return <ErrorState error={m.error} onRetry={m.reload} />;
  if (m.loading && !m.data) return <CircularProgress aria-label="Loading" />;
  if (!m.data?.length) return <EmptyState title="No admins yet" />;
  return (
    <Stack spacing={2}>
      {m.data.map((a) => (
        <Card key={a.adminId ?? 'standalone'} variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap><AdminPanelSettingsOutlined fontSize="small" /><Typography fontWeight={800}>{a.adminName}</Typography>{a.adminEmail && <Typography color="text.secondary">{a.adminEmail}</Typography>}<StatusChip s={a.adminStatus} /></Stack>
          {a.users.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No users yet.</Typography> : (
            <Table size="small" sx={{ mt: 1 }} aria-label={`Users of ${a.adminName}`}>
              <TableHead><TableRow><TableCell>User</TableCell><TableCell>Email</TableCell><TableCell>Status</TableCell><TableCell>Devices</TableCell></TableRow></TableHead>
              <TableBody>{a.users.map((u) => <TableRow key={u.id}><TableCell>{u.name}</TableCell><TableCell>{u.email}</TableCell><TableCell><StatusChip s={u.activationStatus} /></TableCell><TableCell>{u.devices.join(', ') || '—'}</TableCell></TableRow>)}</TableBody>
            </Table>)}
        </Card>))}
    </Stack>
  );
}

function HistoryTab() {
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const h = useAsync(() => userMgmtApi.history({ page, pageSize }), [page, pageSize]);
  if (h.error) return <ErrorState error={h.error} onRetry={h.reload} />;
  if (h.loading && !h.data) return <CircularProgress aria-label="Loading" />;
  return (
    <>
      {(h.data?.items.length ?? 0) === 0 ? <EmptyState title="No history yet" /> : (
        <TableContainer><Table size="small" aria-label="Registration and approval history">
          <TableHead><TableRow><TableCell>When</TableCell><TableCell>Action</TableCell><TableCell>By</TableCell><TableCell>Account</TableCell><TableCell>Detail</TableCell></TableRow></TableHead>
          <TableBody>{h.data!.items.map((x) => <TableRow key={x.id} hover><TableCell>{fmtUtc(x.at)}</TableCell><TableCell><Chip size="small" label={x.action} /></TableCell><TableCell>{x.actorName ?? 'Applicant / system'}</TableCell><TableCell>{x.targetName ?? '—'}</TableCell><TableCell>{x.detail ?? ''}</TableCell></TableRow>)}</TableBody>
        </Table></TableContainer>)}
      <PaginationBar page={page} result={h.data} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </>
  );
}

function EmailLogTab() {
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(20);
  const l = useAsync(() => userMgmtApi.emailLog({ page, pageSize }), [page, pageSize]);
  if (l.error) return <ErrorState error={l.error} onRetry={l.reload} />;
  if (l.loading && !l.data) return <CircularProgress aria-label="Loading" />;
  return (
    <>
      {(l.data?.items.length ?? 0) === 0 ? <EmptyState title="No emails sent yet" /> : (
        <TableContainer><Table size="small" aria-label="Email notification history">
          <TableHead><TableRow><TableCell>When</TableCell><TableCell>To</TableCell><TableCell>Subject</TableCell><TableCell>Status</TableCell></TableRow></TableHead>
          <TableBody>{l.data!.items.map((e) => <TableRow key={e.id} hover><TableCell>{fmtUtc(e.at)}</TableCell><TableCell>{e.toEmail}</TableCell><TableCell>{e.subject}</TableCell><TableCell><StatusChip s={e.status} />{e.error && <Typography variant="caption" display="block" color="error">{e.error}</Typography>}</TableCell></TableRow>)}</TableBody>
        </Table></TableContainer>)}
      <PaginationBar page={page} result={l.data} pageSize={pageSize} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
    </>
  );
}

// ------------------------------------------------------------------ dialogs

function useAdmins(enabled: boolean) {
  const a = useAsync(() => usersApi.list({ role: 'Admin', isActive: true, page: 1, pageSize: 100 }), [], enabled);
  return a.data?.items ?? [];
}

function DevicePicker({ value, onChange, enabled }: { value: number[]; onChange: (v: number[]) => void; enabled: boolean }) {
  const devices = useDevices(enabled).devices;
  return (
    <FormControl fullWidth>
      <InputLabel id="dev-label">Devices to assign</InputLabel>
      <Select labelId="dev-label" multiple value={value} onChange={(e) => onChange(e.target.value as number[])} input={<OutlinedInput label="Devices to assign" />} renderValue={(sel) => devices.filter((d) => sel.includes(d.id)).map((d) => d.deviceId).join(', ')}>
        {devices.map((d) => <MenuItem key={d.id} value={d.id}><Checkbox checked={value.includes(d.id)} /><ListItemText primary={d.deviceName} secondary={`${d.deviceId}${d.assignedUserName ? ` · now with ${d.assignedUserName}` : ''}`} /></MenuItem>)}
      </Select>
    </FormControl>
  );
}

function CreateDialog({ role, onClose, onDone }: { role: 'Admin' | 'User' | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const admins = useAdmins(role === 'User');
  const [f, setF] = useState({ name: '', email: '', mobile: '', adminEmail: '' });
  const [deviceIds, setDeviceIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [result, setResult] = useState<InviteResult | null>(null); const [reassign, setReassign] = useState(false);
  useEffect(() => { if (role) { setF({ name: '', email: '', mobile: '', adminEmail: '' }); setDeviceIds([]); setErr(null); setResult(null); setReassign(false); } }, [role]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const mobileOk = mobileSchema.safeParse(f.mobile).success;
  const valid = f.name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) && mobileOk && (role !== 'User' || f.adminEmail !== '');
  const submit = async () => {
    if (!role) return;
    setBusy(true); setErr(null);
    try { const r = await userMgmtApi.invite({ name: f.name.trim(), email: f.email.trim(), mobile: f.mobile.trim(), role, adminEmail: role === 'User' ? f.adminEmail : null, deviceIds, reassign }); setResult(r); toast(`${role} created. Invitation sent.`, 'success'); onDone(); }
    catch (e) { setErr(toAppError(e).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={role !== null} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create {role}</DialogTitle>
      <DialogContent>
        {result ? (
          <Stack spacing={1} sx={{ pt: 1 }}><Alert severity="success">The account is approved. {result.email} was sent an invitation to set a password.</Alert><EmailSummary r={result} /></Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {err && <Alert severity="error">{err}</Alert>}
            <TextField label="Full name" value={f.name} onChange={set('name')} autoFocus />
            <TextField label="Email address" type="email" value={f.email} onChange={set('email')} helperText="This becomes their login." />
            <TextField label="Mobile number" value={f.mobile} onChange={set('mobile')} error={f.mobile !== '' && !mobileOk} helperText={f.mobile !== '' && !mobileOk ? 'Enter a valid mobile number.' : ' '} />
            {role === 'User' && (
              <TextField select label="Admin (email)" value={f.adminEmail} onChange={set('adminEmail')} helperText="Required: the approved Admin this User belongs to.">
                {admins.map((a) => <MenuItem key={a.id} value={a.email}>{a.name} · {a.email}</MenuItem>)}
              </TextField>)}
            <DevicePicker value={deviceIds} onChange={setDeviceIds} enabled={role !== null} />
            {/Reassign/.test(err ?? '') && <FormControlLabel control={<Checkbox checked={reassign} onChange={(e) => setReassign(e.target.checked)} />} label="Reassign the device if it belongs to someone else" />}
            <Typography variant="caption" color="text.secondary">The account is approved immediately and the selected devices are assigned automatically. No password is sent: the person gets a single-use activation link by email.</Typography>
          </Stack>)}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>{result ? 'Close' : 'Cancel'}</Button>
        {!result && <Button variant="contained" onClick={() => void submit()} disabled={!valid || busy}>{busy ? <CircularProgress size={20} color="inherit" /> : `Create ${role} and send invitation`}</Button>}
      </DialogActions>
    </Dialog>
  );
}

function ApproveDialog({ req, onClose, onDone }: { req: RegistrationRequestDto | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const admins = useAdmins(req !== null);
  const [role, setRole] = useState<'Admin' | 'User'>('User'); const [adminId, setAdminId] = useState<number | ''>(''); const [deviceIds, setDeviceIds] = useState<number[]>([]); const [note, setNote] = useState('');
  const [assignRequested, setAssignRequested] = useState(true); const [reassign, setReassign] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (req) { setRole(req.requestedRole); setAdminId(req.adminUserId ?? ''); setDeviceIds([]); setNote(''); setErr(null); setAssignRequested(req.deviceStatus !== 'NotRegistered' && req.deviceStatus !== 'Inactive'); setReassign(false); } }, [req]);
  const submit = async () => {
    if (!req) return;
    setBusy(true); setErr(null);
    try { await userMgmtApi.approve(req.id, { role, adminId: role === 'User' && adminId !== '' ? adminId : null, deviceIds, assignRequestedDevice: assignRequested, reassign, note: note.trim() || null }); toast(`${req.fullName} approved. Activation email sent.`, 'success'); onDone(); onClose(); }
    catch (e) { setErr(toAppError(e).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={req !== null} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Approve {req?.fullName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {err && <Alert severity="error">{err}</Alert>}
          <Typography variant="body2" color="text.secondary">{req?.email} · {req?.mobile} · requested {req?.requestedRole}</Typography>
          <TextField select label="Grant role" value={role} onChange={(e) => setRole(e.target.value as 'Admin' | 'User')}><MenuItem value="User">User</MenuItem><MenuItem value="Admin">Admin</MenuItem></TextField>
          {role === 'User' && (
            <TextField select label="Admin" value={adminId} onChange={(e) => setAdminId(Number(e.target.value))} helperText={req?.adminEmail ? `The applicant entered ${req.adminEmail}. Verify the relationship, or choose another Admin.` : 'Choose the approved Admin this User belongs to.'}>
              {admins.map((a) => <MenuItem key={a.id} value={a.id}>{a.name} · {a.email}</MenuItem>)}
            </TextField>)}
          {req?.deviceId && (
            <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Typography variant="body2">Device ID entered by the applicant: <b>{req.deviceId}</b> <DeviceChip r={req} /></Typography>
              <FormControlLabel control={<Checkbox checked={assignRequested} onChange={(e) => setAssignRequested(e.target.checked)} />} label="Assign this device to the new account automatically" />
              {req.deviceStatus === 'NotRegistered' && <Typography variant="caption" color="warning.main" display="block">This device is not registered yet. Create it on the Devices page, then approve; or approve without it.</Typography>}
              {(req.deviceStatus === 'Assigned' || /Reassign/.test(err ?? '')) && <FormControlLabel control={<Checkbox checked={reassign} onChange={(e) => setReassign(e.target.checked)} />} label="Reassign it if it belongs to someone else" />}
            </Box>)}
          <DevicePicker value={deviceIds} onChange={setDeviceIds} enabled={req !== null} />
          <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Typography variant="caption" color="text.secondary">The account stays inactive until the person uses the activation link that is emailed to them.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || (role === 'User' && adminId === '')}>{busy ? <CircularProgress size={20} color="inherit" /> : 'Approve and send activation link'}</Button></DialogActions>
    </Dialog>
  );
}

function RejectDialog({ req, onClose, onDone }: { req: RegistrationRequestDto | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setReason(''); setErr(null); }, [req]);
  const submit = async () => { if (!req) return; setBusy(true); try { await userMgmtApi.reject(req.id, reason.trim()); toast(`${req.fullName} rejected.`, 'success'); onDone(); onClose(); } catch (e) { setErr(toAppError(e).message); } finally { setBusy(false); } };
  return (
    <Dialog open={req !== null} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Reject {req?.fullName}?</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{err && <Alert severity="error">{err}</Alert>}<Typography variant="body2">No account is created. The decision is kept in the history.</Typography><TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} /></Stack></DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button><Button color="error" variant="contained" onClick={() => void submit()} disabled={busy}>Reject</Button></DialogActions>
    </Dialog>
  );
}

// ------------------------------------------------------------------ page

export default function UserManagementPage() {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('pending');
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState<'Admin' | 'User' | null>(null);
  const [approving, setApproving] = useState<RegistrationRequestDto | null>(null);
  const [rejecting, setRejecting] = useState<RegistrationRequestDto | null>(null);
  const [resendMsg, setResendMsg] = useState<InviteResult | null>(null);
  const bump = () => setVersion((v) => v + 1);

  const resend = async (userId: number) => {
    try { const r = await userMgmtApi.resend(userId); setResendMsg(r); toast('Invitation sent again.', 'success'); bump(); }
    catch (e) { toast(toAppError(e).message, 'error'); }
  };
  const pending = useAsync(() => userMgmtApi.requests({ status: 'Pending', page: 1, pageSize: 1, includeTotal: true }), [version]);

  return (
    <>
      <PageHeader title="User Management" subtitle="Registrations, approvals, accounts and who belongs to whom."
        crumbs={[{ label: 'Home', to: '/' }, { label: 'User Management' }]}
        actions={<Stack direction="row" spacing={1}><Button variant="contained" startIcon={<PersonAddAltOutlined />} onClick={() => setCreating('User')}>Create User</Button><Button variant="outlined" startIcon={<AdminPanelSettingsOutlined />} onClick={() => setCreating('Admin')}>Create Admin</Button></Stack>} />
      <Box sx={{ mb: 2 }}><RegistrationLinkCard /></Box>
      {resendMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setResendMsg(null)}>A new activation link was sent to {resendMsg.email}.<EmailSummary r={resendMsg} /></Alert>}
      <Card>
        <Tabs value={tab} onChange={(_, v: TabKey) => setTab(v)} variant="scrollable" scrollButtons="auto" aria-label="User management sections">
          {TABS.map((t) => <Tab key={t.key} value={t.key} label={t.key === 'pending' && (pending.data?.totalCount ?? 0) > 0 ? `${t.label} (${pending.data!.totalCount})` : t.label} />)}
        </Tabs>
        <Box sx={{ p: 2 }}>
          {tab === 'users' && <UsersTab role="User" onResend={(u) => void resend(u.id)} version={version} />}
          {tab === 'admins' && <UsersTab role="Admin" onResend={(u) => void resend(u.id)} version={version} />}
          {tab === 'requests' && <RequestsTab onApprove={setApproving} onReject={setRejecting} onResend={(id) => void resend(id)} version={version} />}
          {tab === 'pending' && <RequestsTab status="Pending" onApprove={setApproving} onReject={setRejecting} onResend={(id) => void resend(id)} version={version} />}
          {tab === 'approved' && <RequestsTab status="Approved" onApprove={setApproving} onReject={setRejecting} onResend={(id) => void resend(id)} version={version} />}
          {tab === 'rejected' && <RequestsTab status="Rejected" onApprove={setApproving} onReject={setRejecting} onResend={(id) => void resend(id)} version={version} />}
          {tab === 'mapping' && <MappingTab version={version} />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'email' && <EmailLogTab />}
        </Box>
      </Card>
      <CreateDialog role={creating} onClose={() => setCreating(null)} onDone={bump} />
      <ApproveDialog req={approving} onClose={() => setApproving(null)} onDone={bump} />
      <RejectDialog req={rejecting} onClose={() => setRejecting(null)} onDone={bump} />
    </>
  );
}
