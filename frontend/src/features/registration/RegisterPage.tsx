import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Card, CircularProgress, FormControlLabel, Link, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import type { z } from 'zod';
import { Brand } from '../../components/Brand';
import { registrationApi } from '../../api/services';
import { registerSchema } from '../../utils/schemas';
import { toAppError } from '../../utils/errors';

type Form = z.infer<typeof registerSchema>;

/** Shared frame of the public pages (register, activate): brand on top, one card. */
export function PublicFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', bgcolor: '#0b2a1b', backgroundImage: 'linear-gradient(180deg,#0b2a1b 0%,#103a26 100%)', px: 2, py: 4 }}>
      <Box sx={{ mb: 3 }}><Brand /></Box>
      <Card sx={{ width: '100%', maxWidth: 520, p: { xs: 2.5, sm: 4 } }}>
        <Typography variant="h5" fontWeight={800}>{title}</Typography>
        {subtitle && <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>{subtitle}</Typography>}
        {children}
      </Card>
    </Box>
  );
}

/** One public registration page for Admin and User. The request waits for Super Admin approval; nothing can sign in before that. */
export default function RegisterPage() {
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(registerSchema), defaultValues: { fullName: '', email: '', mobile: '', requestedRole: 'User', adminEmail: '', deviceId: '' },
  });
  const role = watch('requestedRole');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await registrationApi.register({ fullName: v.fullName.trim(), email: v.email.trim(), mobile: v.mobile.trim(), requestedRole: v.requestedRole, adminEmail: v.requestedRole === 'User' ? v.adminEmail?.trim() : null, deviceId: v.deviceId?.trim() || null });
      setDone(r.message);
    } catch (e) { setError(toAppError(e).message); }
  });

  if (done) {
    return (
      <PublicFrame title="Registration received">
        <Alert severity="success" sx={{ mb: 2 }}>{done}</Alert>
        <Typography color="text.secondary">After the Super Admin approves your request you will get an email with a link to set your password. Then you can sign in with your email address.</Typography>
        <Button component={RouterLink} to="/login" sx={{ mt: 3 }}>Back to sign in</Button>
      </PublicFrame>
    );
  }

  return (
    <PublicFrame title="Create your account" subtitle="Register as an Admin or a User. The Super Admin reviews every request.">
      <form onSubmit={submit} noValidate>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Full name" autoComplete="name" {...register('fullName')} error={!!errors.fullName} helperText={errors.fullName?.message} />
          <TextField label="Email address" type="email" autoComplete="email" {...register('email')} error={!!errors.email} helperText={errors.email?.message ?? 'This is your login.'} />
          <TextField label="Mobile number" type="tel" autoComplete="tel" {...register('mobile')} error={!!errors.mobile} helperText={errors.mobile?.message ?? 'For example +91 98765 43210'} />
          <Box>
            <Typography variant="body2" color="text.secondary" id="role-label">I am registering as</Typography>
            <RadioGroup row aria-labelledby="role-label" value={role} onChange={(e) => setValue('requestedRole', e.target.value as 'Admin' | 'User', { shouldValidate: true })}>
              {(['User', 'Admin'] as const).map((r) => <FormControlLabel key={r} value={r} label={r} control={<Radio />} />)}
            </RadioGroup>
          </Box>
          {role === 'User' && (
            <TextField label="Your Admin's email address" type="email" {...register('adminEmail')} error={!!errors.adminEmail} helperText={errors.adminEmail?.message ?? 'Required. Must be the email of an approved Admin. You will be attached to that Admin.'} />
          )}
          <TextField label="Device ID (optional)" {...register('deviceId')} error={!!errors.deviceId} helperText={errors.deviceId?.message ?? 'The ID of your device, e.g. Vayu_004. When your request is approved the device is assigned to you automatically.'} />
          <Button type="submit" variant="contained" size="large" disabled={isSubmitting}>{isSubmitting ? <CircularProgress size={22} color="inherit" /> : 'Submit registration'}</Button>
          <Typography variant="body2" color="text.secondary" textAlign="center">Already have an account? <Link component={RouterLink} to="/login">Sign in</Link></Typography>
        </Stack>
      </form>
    </PublicFrame>
  );
}
