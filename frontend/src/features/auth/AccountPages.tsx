import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Card, CircularProgress, Grid, Stack, TextField, Typography } from '@mui/material';
import type { z } from 'zod';
import { authApi } from '../../api/services';
import { PageHeader, ActiveChip, RoleChip } from '../../components/ui';
import { useToast } from '../../components/feedback';
import { useAuth } from './AuthContext';
import { changePasswordSchema } from '../../utils/schemas';
import { toAppError } from '../../utils/errors';
import { fmtUtc } from '../../utils/format';

type Form = z.infer<typeof changePasswordSchema>;

export function ChangePasswordPage() {
  const { adoptSession } = useAuth();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError: setFieldError, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      const session = await authApi.changePassword(v.currentPassword, v.newPassword);
      adoptSession(session); // server revoked old refresh tokens and issued a fresh session
      reset();
      toast('Password changed. Other devices will be signed out shortly.');
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'current_password_incorrect') setFieldError('currentPassword', { message: 'Current password is incorrect.' });
      else setError(err.status === 429 ? 'Too many attempts or the account is temporarily locked. Try again later.' : err.message);
    }
  });

  return (
    <>
      <PageHeader title="Change Password" crumbs={[{ label: 'Home', to: '/' }, { label: 'Change Password' }]} />
      <Card sx={{ p: 3, maxWidth: 520 }}>
        <form onSubmit={onSubmit} noValidate>
          <Stack spacing={2.25}>
            {error && <Alert severity="error" role="alert">{error}</Alert>}
            <TextField label="Current password" type="password" autoComplete="current-password" error={!!errors.currentPassword} helperText={errors.currentPassword?.message} {...register('currentPassword')} />
            <TextField label="New password" type="password" autoComplete="new-password" error={!!errors.newPassword}
              helperText={errors.newPassword?.message ?? '10–100 characters with an uppercase letter, a lowercase letter and a digit.'} {...register('newPassword')} />
            <TextField label="Confirm new password" type="password" autoComplete="new-password" error={!!errors.confirm} helperText={errors.confirm?.message} {...register('confirm')} />
            <Box><Button type="submit" variant="contained" disabled={isSubmitting}>{isSubmitting ? <CircularProgress size={20} color="inherit" /> : 'Update password'}</Button></Box>
          </Stack>
        </form>
      </Card>
    </>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  const rows: Array<[string, React.ReactNode]> = [
    ['Name', user.name], ['Email', user.email], ['Role', <RoleChip role={user.role} />],
    ['Status', <ActiveChip active={user.isActive} />], ['Last sign-in', fmtUtc(user.lastLoginAt)],
  ];
  return (
    <>
      <PageHeader title="My Profile" crumbs={[{ label: 'Home', to: '/' }, { label: 'My Profile' }]} />
      <Card sx={{ p: 3, maxWidth: 640 }}>
        <Grid container spacing={2.5}>
          {rows.map(([k, v]) => (
            <Grid item xs={12} sm={6} key={k}>
              <Typography variant="caption" color="text.secondary">{k}</Typography>
              <Box sx={{ fontWeight: 600, mt: 0.25 }}>{v}</Box>
            </Grid>
          ))}
        </Grid>
        <Alert severity="info" sx={{ mt: 3 }}>Name and email are managed by your administrator.</Alert>
      </Card>
    </>
  );
}
