import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, IconButton, InputAdornment, Stack, TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import MailOutline from '@mui/icons-material/MailOutline';
import LockOutlined from '@mui/icons-material/LockOutlined';
import ArrowForward from '@mui/icons-material/ArrowForward';
import SensorsOutlined from '@mui/icons-material/SensorsOutlined';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';
import DevicesOtherOutlined from '@mui/icons-material/DevicesOtherOutlined';
import type { z } from 'zod';
import { useAuth } from './AuthContext';
import { Brand, LogoMark, APP_VERSION, BRAND_NAME, BRAND_TAGLINE } from '../../components/Brand';
import { TestAccounts, readTestAccounts } from './TestAccounts';
import { AtmosphereScene, BackgroundPhoto } from './scene/AtmosphereScene';
import { loginSchema } from '../../utils/schemas';
import { toAppError } from '../../utils/errors';

type Form = z.infer<typeof loginSchema>;

const HEADLINE = ['Understand the Air.', 'Improve Every Breath.'];
const COPY = 'Monitor environmental conditions, manage connected devices, and transform sensor readings into meaningful air-quality insights.';
const FEATURES = [
  { icon: SensorsOutlined, title: 'Real-time monitoring', text: 'Live readings from every sensor' },
  { icon: InsightsOutlined, title: 'Intelligent insights', text: 'Turn data into healthier decisions' },
  { icon: DevicesOtherOutlined, title: 'Connected sensors', text: 'Register, assign and control devices' },
];

const NAVY = '#0b3a73';
// Dev-only quick-fill: needs BOTH a dev build and an explicit flag. Dead code in production builds.
const SHOW_TEST_ACCOUNTS = import.meta.env.DEV && import.meta.env.VITE_SHOW_TEST_ACCOUNTS === 'true';

/** Left column: brand (top), headline + copy (upper area, clear of the purifier/airflow), three feature items (bottom, in normal flow). */
function HeroColumn() {
  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', minHeight: '100dvh', boxSizing: 'border-box',
      pt: 'clamp(14px, 3dvh, 36px)', pb: 'clamp(16px, 4dvh, 48px)', pl: 'clamp(24px, 4.6vw, 76px)', pr: 'clamp(16px, 2vw, 32px)',
    }}>
      <Brand />

      {/* One content group (headline, paragraph, three feature items), vertically centred in the page. The bottom padding offsets the brand row so the group sits at the true middle. */}
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', pb: 'clamp(8px, 4.6dvh, 48px)' }}>
      <Box sx={{ maxWidth: 580 }}>
        <Typography component="p" variant="h2" sx={{
          fontSize: 'clamp(30px, min(3.5vw, 6.4dvh), 54px)', lineHeight: 1.12, letterSpacing: '-0.02em', textShadow: '0 2px 28px rgba(0,0,0,.55)',
        }}>
          {HEADLINE[0]}<br />
          <Box component="span" sx={{ background: 'linear-gradient(90deg,#99f6e4,#7dd3fc)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 2px 14px rgba(0,0,0,.45))' }}>{HEADLINE[1]}</Box>
        </Typography>
        <Typography sx={{
          color: 'rgba(240,248,255,.92)', fontSize: 'clamp(14px, 2.1dvh, 16.5px)', lineHeight: 1.55, mt: 'clamp(8px, 1.8dvh, 18px)', textShadow: '0 1px 16px rgba(0,0,0,.6)',
        }}>{COPY}</Typography>

        <Stack direction="row" sx={{ mt: 'clamp(16px, 3.4dvh, 36px)' }}>
          {FEATURES.map((f, i) => (
            <Stack key={f.title} alignItems="flex-start" spacing={0.75} sx={{
              flex: '1 1 0', minWidth: 0, pl: i ? 2 : 0, pr: 1.5, borderLeft: i ? '1px solid rgba(255,255,255,.18)' : 0,
            }}>
              <Box sx={{ width: 38, height: 38, '@media (max-height: 700px)': { width: 32, height: 32 }, borderRadius: '50%', display: 'grid', placeItems: 'center', border: '1.5px solid rgba(125,211,252,.8)', color: '#7dd3fc', bgcolor: 'rgba(8,30,56,.4)' }}>
                <f.icon sx={{ fontSize: 20 }} />
              </Box>
              <Typography sx={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.25, textShadow: '0 1px 10px rgba(0,0,0,.6)' }}>{f.title}</Typography>
              <Typography sx={{ fontSize: 12, lineHeight: 1.4, color: 'rgba(235,245,255,.82)', textShadow: '0 1px 10px rgba(0,0,0,.6)' }}>{f.text}</Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
      </Box>
    </Box>
  );
}

/** Phones and tablets: brand + headline (+ paragraph on tablets) above the card. The photo sits behind the whole page. */
function CompactHero() {
  return (
    <Stack spacing={{ xs: 2, sm: 3 }} sx={{ color: '#fff', width: '100%', maxWidth: 560 }}>
      <Brand />
      <Box>
        <Typography component="p" variant="h5" sx={{ fontSize: { xs: 24, sm: 34 }, lineHeight: 1.12, letterSpacing: '-0.01em', textShadow: '0 2px 24px rgba(0,0,0,.55)' }}>
          {HEADLINE[0]}<br />
          <Box component="span" sx={{ background: 'linear-gradient(90deg,#99f6e4,#7dd3fc)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{HEADLINE[1]}</Box>
        </Typography>
        <Typography sx={{ display: { xs: 'none', sm: 'block' }, mt: 1.5, fontSize: 15, lineHeight: 1.55, color: 'rgba(240,248,255,.9)', textShadow: '0 1px 14px rgba(0,0,0,.6)' }}>{COPY}</Typography>
      </Box>
    </Stack>
  );
}

const field = {
  '& .MuiOutlinedInput-root': {
    height: 50, bgcolor: '#fff', borderRadius: '10px', transition: 'box-shadow .2s',
    '& fieldset': { borderColor: 'rgba(11,58,115,.14)' },
    '&:hover fieldset': { borderColor: 'rgba(11,58,115,.32)' },
    '&.Mui-focused': { boxShadow: '0 0 0 4px rgba(14,165,233,.2), 0 6px 20px rgba(14,165,233,.16)' },
    '&.Mui-focused fieldset': { borderColor: '#0ea5e9', borderWidth: 1.5 },
  },
  '& .MuiOutlinedInput-input': { py: 0, height: '100%', boxSizing: 'border-box' },
};

export default function LoginPage() {
  const { login, status, sessionExpired } = useAuth();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const testAccounts = SHOW_TEST_ACCOUNTS ? readTestAccounts() : [];
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Form>({
    resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '', remember: false },
  });

  // Every sign-in lands on the Dashboard first (SuperAdmin, Admin and User), not on whichever page was open before.
  if (status === 'authenticated') return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try {
      await login(v.email.trim(), v.password, !!v.remember);
    } catch (e) {
      const err = toAppError(e);
      setError(
        err.status === 401 ? 'Incorrect email or password, or the account is inactive or temporarily locked.'
          : err.status === 429 ? 'Too many sign-in attempts. Please wait a minute and try again.'
          : err.message,
      );
    }
  });

  const card = (
    <Box component="section" aria-labelledby="login-title" sx={{
      position: 'relative', boxSizing: 'border-box', width: 'min(100%, 420px)', p: { xs: 2.5, md: 3 }, borderRadius: '18px', color: NAVY,
      // Frosted glass over the photo at every size; slightly denser on small screens so text stays easy to read.
      bgcolor: { xs: 'rgba(240,246,252,.8)', md: 'rgba(238,245,252,.7)' },
      backdropFilter: 'blur(22px) saturate(1.25)', WebkitBackdropFilter: 'blur(22px) saturate(1.25)',
      border: '1px solid rgba(255,255,255,.6)',
      boxShadow: '0 1px 0 rgba(255,255,255,.7) inset, 0 24px 60px -20px rgba(2,12,32,.55), 0 0 44px -12px rgba(125,211,252,.3)',
      animation: 'vv-rise .9s cubic-bezier(.2,.7,.2,1) .2s both',
    }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2.25 }}>
        <LogoMark size={42} />
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 18, lineHeight: 1.1, color: NAVY }}>{BRAND_NAME}</Typography>
          <Typography sx={{ fontSize: 10.5, letterSpacing: '.24em', textTransform: 'uppercase', color: 'rgba(11,58,115,.7)', mt: 0.25 }}>Admin Panel</Typography>
        </Box>
      </Stack>

      <Typography id="login-title" variant="h5" component="h1" sx={{ color: NAVY, fontSize: 22 }}>Welcome Back</Typography>
      <Typography sx={{ mt: 0.25, mb: 2, fontSize: 13.5, color: 'rgba(11,58,115,.75)' }}>Sign in to manage your air quality network.</Typography>

      {sessionExpired && <Alert severity="warning" sx={{ mb: 1.5 }}>Your session expired. Please sign in again.</Alert>}
      {error && <Alert severity="error" sx={{ mb: 1.5 }} role="alert">{error}</Alert>}

      <form onSubmit={onSubmit} noValidate>
        <Stack spacing={1.5}>
          <TextField placeholder="Email address" inputProps={{ 'aria-label': 'Email address' }} type="email" autoComplete="username" autoFocus sx={field}
            error={!!errors.email} helperText={errors.email?.message} disabled={isSubmitting} {...register('email')}
            InputProps={{ startAdornment: <InputAdornment position="start"><MailOutline sx={{ color: 'rgba(11,58,115,.55)', fontSize: 20 }} /></InputAdornment> }} />
          <TextField placeholder="Password" inputProps={{ 'aria-label': 'Password' }} type={show ? 'text' : 'password'} autoComplete="current-password" sx={field}
            error={!!errors.password} helperText={errors.password?.message} disabled={isSubmitting} {...register('password')}
            InputProps={{
              startAdornment: <InputAdornment position="start"><LockOutlined sx={{ color: 'rgba(11,58,115,.55)', fontSize: 20 }} /></InputAdornment>,
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)} edge="end" size="small">
                    {show ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>),
            }} />
          <FormControlLabel sx={{ mr: 0, ml: -0.5, color: NAVY, mt: '-4px' }} control={<Checkbox size="small" {...register('remember')} />}
            label={<Typography variant="body2">Remember me</Typography>} />
          <Button type="submit" variant="contained" disabled={isSubmitting}
            endIcon={isSubmitting ? undefined : <ArrowForward sx={{ fontSize: 19 }} />}
            sx={{
              height: 50, borderRadius: '10px', fontSize: 15, position: 'relative',
              background: 'linear-gradient(90deg,#0a4fa3 0%,#0b73c9 55%,#0ea5e9 100%)', boxShadow: '0 10px 24px -10px rgba(10,79,163,.85)',
              transition: 'transform .15s, box-shadow .15s, filter .15s',
              '& .MuiButton-endIcon': { position: 'absolute', right: 16, m: 0 },
              '&:hover': { filter: 'brightness(1.08)', transform: 'translateY(-1px)', boxShadow: '0 14px 28px -10px rgba(10,79,163,.9)' },
              '&:active': { transform: 'translateY(0) scale(.99)', boxShadow: '0 5px 14px -8px rgba(10,79,163,.85)' },
              '&.Mui-disabled': { color: '#fff', opacity: 0.88 },
            }}>
            {isSubmitting ? <CircularProgress size={22} color="inherit" /> : 'Sign In'}
          </Button>
        </Stack>
      </form>

      {SHOW_TEST_ACCOUNTS && <TestAccounts accounts={testAccounts} onPick={(a) => { setValue('email', a.email); setValue('password', a.password); }} />}
      <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 2, color: 'rgba(11,58,115,.65)' }}>{BRAND_NAME} {BRAND_TAGLINE} · v{APP_VERSION}</Typography>
    </Box>
  );

  const rise = { '@keyframes vv-rise': { from: { opacity: 0, transform: 'translateY(14px)' }, to: { opacity: 1, transform: 'translateY(0)' } } };

  if (!desktop) {
    return (
      <Box sx={{ position: 'relative', minHeight: '100dvh', overflow: 'hidden', bgcolor: '#07162b', ...rise }}>
        {/* photo behind everything, cropped toward the purifier, under a darker overlay */}
        <Box aria-hidden sx={{ position: 'absolute', inset: 0 }}>
          <BackgroundPhoto objectPosition="16% 55%" />
          <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(4,14,30,.78) 0%, rgba(4,14,30,.5) 38%, rgba(4,14,30,.62) 100%)' }} />
        </Box>
        <Stack alignItems="center" spacing={{ xs: 3, sm: 4 }} sx={{ position: 'relative', minHeight: '100dvh', boxSizing: 'border-box', justifyContent: 'center', p: { xs: 2.5, sm: 5 }, py: { xs: 3, sm: 5 } }}>
          <CompactHero />
          {card}
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={rise}>
      <AtmosphereScene>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 62fr) minmax(380px, 38fr)', minHeight: '100dvh' }}>
          <HeroColumn />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', px: 'clamp(16px, 3vw, 48px)', py: 'clamp(12px, 3dvh, 40px)' }}>{card}</Box>
        </Box>
      </AtmosphereScene>
    </Box>
  );
}
