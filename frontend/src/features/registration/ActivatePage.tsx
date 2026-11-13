import { useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import type { z } from 'zod';
import { registrationApi } from '../../api/services';
import { activateSchema } from '../../utils/schemas';
import { toAppError } from '../../utils/errors';
import type { ActivationCheck } from '../../types/api';
import { PublicFrame } from './RegisterPage';

type Form = z.infer<typeof activateSchema>;

/** The page behind the activation link in the email: confirms the email owner and lets them choose their own password. The link works once. */
export default function ActivatePage() {
  const token = useSearchParams()[0].get('token') ?? '';
  const [check, setCheck] = useState<ActivationCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(activateSchema), defaultValues: { password: '', confirm: '' } });

  useEffect(() => {
    if (!token) { setCheck({ valid: false }); return; }
    registrationApi.checkActivation(token).then(setCheck).catch((e) => { setError(toAppError(e).message); setCheck({ valid: false }); });
  }, [token]);

  const submit = handleSubmit(async (v) => {
    setError(null);
    try { await registrationApi.activate(token, v.password); setDone(true); } catch (e) { setError(toAppError(e).message); }
  });

  if (done) {
    return (
      <PublicFrame title="Account activated">
        <Alert severity="success" sx={{ mb: 2 }}>Your password is set and your email address is confirmed.</Alert>
        <Button component={RouterLink} to="/login" variant="contained">Sign in</Button>
      </PublicFrame>
    );
  }
  if (!check) return <PublicFrame title="Activate your account"><CircularProgress aria-label="Checking the link" /></PublicFrame>;
  if (!check.valid) {
    return (
      <PublicFrame title="This link cannot be used">
        <Alert severity="warning" sx={{ mb: 2 }}>{error ?? 'The activation link is invalid, has already been used, or has expired. Ask your administrator to send you a new one.'}</Alert>
        <Button component={RouterLink} to="/login">Back to sign in</Button>
      </PublicFrame>
    );
  }
  return (
    <PublicFrame title="Activate your account" subtitle={`Welcome ${check.name}. Choose a password for ${check.email}.`}>
      <form onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="New password" type="password" autoComplete="new-password" {...register('password')} error={!!errors.password} helperText={errors.password?.message ?? 'At least 10 characters with an uppercase letter, a lowercase letter and a digit.'} />
          <TextField label="Confirm password" type="password" autoComplete="new-password" {...register('confirm')} error={!!errors.confirm} helperText={errors.confirm?.message} />
          <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>{isSubmitting ? <CircularProgress size={22} color="inherit" /> : 'Activate account'}</Button>
          <Typography variant="caption" color="text.secondary">Your email address is your login. This link works once.</Typography>
        </Stack>
      </form>
    </PublicFrame>
  );
}
