import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Autocomplete, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import type { z } from 'zod';
import { usersApi } from '../../api/services';
import { createUserSchema, resetPasswordSchema, updateUserSchema } from '../../utils/schemas';
import { toAppError } from '../../utils/errors';
import { useToast } from '../../components/feedback';
import { useAsync, useDebounced } from '../../utils/useAsync';
import { useAuth } from '../auth/AuthContext';
import type { UserDto } from '../../types/api';

function Actions({ onClose, busy, label }: { onClose: () => void; busy: boolean; label: string }) {
  return (
    <DialogActions sx={{ px: 3, pb: 2 }}>
      <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
      <Button type="submit" variant="contained" disabled={busy}>{busy ? <CircularProgress size={20} color="inherit" /> : label}</Button>
    </DialogActions>
  );
}

function place(e: unknown, setError: (n: never, o: { message: string }) => void, setTop: (m: string) => void, fields: string[]) {
  const err = toAppError(e);
  let placed = false;
  for (const [k, msgs] of Object.entries(err.fieldErrors)) {
    const f = fields.find((x) => x.toLowerCase() === k.toLowerCase());
    if (f) { setError(f as never, { message: msgs[0] }); placed = true; }
  }
  if (!placed) {
    if (err.status === 409) setError('email' as never, { message: err.message });
    else setTop(err.message);
  }
}

/** Active Admins, searchable. Used for manager pickers (SuperAdmin only; the endpoint is scoped by the backend anyway). */
function useAdmins(enabled: boolean) {
  const [input, setInput] = useState('');
  const q = useDebounced(input);
  const s = useAsync(() => usersApi.list({ role: 'Admin', isActive: true, search: q || undefined, pageSize: 20, includeTotal: false }), [q], enabled);
  return { options: s.data?.items ?? [], loading: s.loading, setInput };
}

type CreateForm = z.infer<typeof createUserSchema>;

export function CreateUserDialog({ open, kind, adminId, adminName, onClose, onCreated }: {
  open: boolean;
  /** 'Admin' creates an Admin account (SuperAdmin only); 'User' creates a regular User. */
  kind: 'Admin' | 'User';
  /** When set, the User is created under this Admin via POST /admins/{adminId}/users. */
  adminId?: number; adminName?: string;
  onClose: () => void; onCreated: (u: UserDto) => void;
}) {
  const { role } = useAuth();
  const toast = useToast();
  const isSA = role === 'SuperAdmin';
  const [top, setTop] = useState<string | null>(null);
  const [manager, setManager] = useState<UserDto | null>(null); // null = standalone (SuperAdmin) / self (Admin)
  const admins = useAdmins(open && isSA && kind === 'User' && !adminId);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<CreateForm>({
    resolver: zodResolver(createUserSchema), defaultValues: { name: '', email: '', password: '' },
  });

  const submit = handleSubmit(async (v) => {
    setTop(null);
    const body = { name: v.name.trim(), email: v.email.trim(), password: v.password };
    try {
      const u = adminId
        ? await usersApi.createUnderAdmin(adminId, body)
        : await usersApi.create({ ...body, role: kind, managerId: kind === 'User' && isSA && manager ? manager.id : undefined });
      toast(`${kind} account created.`); reset(); setManager(null); onCreated(u);
    } catch (e) { place(e, setError as never, setTop, ['name', 'email', 'password']); }
  });

  return (
    <Dialog open={open} onClose={isSubmitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>{kind === 'Admin' ? 'Create admin' : adminName ? `Add user to ${adminName}` : 'Create user'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {top && <Alert severity="error">{top}</Alert>}
            <TextField label="Full name" autoFocus error={!!errors.name} helperText={errors.name?.message} {...register('name')} />
            <TextField label="Email" type="email" autoComplete="off" error={!!errors.email} helperText={errors.email?.message} {...register('email')} />
            <TextField label="Temporary password" type="password" autoComplete="new-password" error={!!errors.password}
              helperText={errors.password?.message ?? '10–100 characters with an uppercase letter, a lowercase letter and a digit.'} {...register('password')} />
            {kind === 'User' && isSA && !adminId && (
              <Autocomplete
                options={admins.options} loading={admins.loading} value={manager} onChange={(_, v) => setManager(v)}
                getOptionLabel={(a) => `${a.name} (${a.email})`} isOptionEqualToValue={(a, b) => a.id === b.id} filterOptions={(o) => o}
                onInputChange={(_, v, r) => { if (r === 'input') admins.setInput(v); }}
                renderInput={(p) => <TextField {...p} label="Managing admin" helperText="Leave empty to create a standalone user managed directly by you." />}
              />
            )}
            {kind === 'User' && !isSA && <Typography variant="caption" color="text.secondary">This user will be managed by you.</Typography>}
          </Stack>
        </DialogContent>
        <Actions onClose={onClose} busy={isSubmitting} label="Create" />
      </form>
    </Dialog>
  );
}

type EditForm = z.infer<typeof updateUserSchema>;
export function EditUserDialog({ user, onClose, onSaved }: { user: UserDto | null; onClose: () => void; onSaved: (u: UserDto) => void }) {
  const toast = useToast();
  const [top, setTop] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<EditForm>({
    resolver: zodResolver(updateUserSchema), values: { name: user?.name ?? '', email: user?.email ?? '' },
  });
  const submit = handleSubmit(async (v) => {
    if (!user) return;
    setTop(null);
    try { const u = await usersApi.update(user.id, { name: v.name.trim(), email: v.email.trim() }); toast('Account updated.'); onSaved(u); }
    catch (e) { place(e, setError as never, setTop, ['name', 'email']); }
  });
  return (
    <Dialog open={!!user} onClose={isSubmitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>Edit account</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {top && <Alert severity="error">{top}</Alert>}
            <TextField label="Full name" autoFocus error={!!errors.name} helperText={errors.name?.message} {...register('name')} />
            <TextField label="Email" type="email" error={!!errors.email} helperText={errors.email?.message} {...register('email')} />
            <Typography variant="caption" color="text.secondary">Role and manager cannot be changed here.</Typography>
          </Stack>
        </DialogContent>
        <Actions onClose={onClose} busy={isSubmitting} label="Save" />
      </form>
    </Dialog>
  );
}

type ResetForm = z.infer<typeof resetPasswordSchema>;
export function ResetPasswordDialog({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const toast = useToast();
  const [top, setTop] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<ResetForm>({
    resolver: zodResolver(resetPasswordSchema), defaultValues: { newPassword: '' },
  });
  const submit = handleSubmit(async (v) => {
    if (!user) return;
    setTop(null);
    try { await usersApi.resetPassword(user.id, v.newPassword); toast(`Password reset for ${user.name}.`); reset(); onClose(); }
    catch (e) { place(e, setError as never, setTop, ['newPassword']); }
  });
  return (
    <Dialog open={!!user} onClose={isSubmitting ? undefined : onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit} noValidate>
        <DialogTitle>Reset password</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">Set a new password for <b>{user?.name}</b>. Their active sessions will be signed out.</Typography>
            {top && <Alert severity="error">{top}</Alert>}
            <TextField label="New password" type="password" autoComplete="new-password" autoFocus error={!!errors.newPassword}
              helperText={errors.newPassword?.message ?? '10–100 characters with an uppercase letter, a lowercase letter and a digit.'} {...register('newPassword')} />
          </Stack>
        </DialogContent>
        <Actions onClose={onClose} busy={isSubmitting} label="Reset password" />
      </form>
    </Dialog>
  );
}

/** SuperAdmin only. managerId is explicit: an active Admin, or the SuperAdmin's own id for a standalone User. */
export function ReassignManagerDialog({ user, onClose, onSaved }: { user: UserDto | null; onClose: () => void; onSaved: (u: UserDto) => void }) {
  const { user: me } = useAuth();
  const toast = useToast();
  const [admin, setAdmin] = useState<UserDto | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const admins = useAdmins(!!user);
  const target = standalone ? me?.id : admin?.id;
  const submit = async () => {
    if (!user || !target) return;
    setBusy(true); setErr(null);
    try { const u = await usersApi.setManager(user.id, target); toast(standalone ? `${user.name} is now standalone.` : `${user.name} reassigned to ${admin?.name}.`); setAdmin(null); setStandalone(false); onSaved(u); }
    catch (e) { setErr(toAppError(e).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!user} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Change manager</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2">
            {user?.name} is currently {user?.assignmentType === 'Standalone' ? 'a standalone user' : <>managed by <b>{user?.managerName}</b></>}.
            Devices, assignments and reading history are preserved; only visibility follows the new manager.
          </Typography>
          {err && <Alert severity="error">{err}</Alert>}
          <Autocomplete
            disabled={standalone} options={admins.options.filter((a) => a.id !== user?.managerId)} loading={admins.loading} value={admin} onChange={(_, v) => setAdmin(v)}
            getOptionLabel={(a) => `${a.name} (${a.email})`} isOptionEqualToValue={(a, b) => a.id === b.id} filterOptions={(o) => o}
            onInputChange={(_, v, r) => { if (r === 'input') admins.setInput(v); }} renderInput={(p) => <TextField {...p} label="Assign to admin" />}
          />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={standalone} onChange={(e) => setStandalone(e.target.checked)} disabled={user?.assignmentType === 'Standalone'} /> Make standalone (managed directly by me)
          </label>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!target || busy}>{busy ? <CircularProgress size={20} color="inherit" /> : 'Change manager'}</Button>
      </DialogActions>
    </Dialog>
  );
}
