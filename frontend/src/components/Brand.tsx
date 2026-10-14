import { Box, Stack, Typography } from '@mui/material';

export const APP_VERSION = '1.0.0';
export const BRAND_NAME = 'LIVVAir';
export const BRAND_TAGLINE = 'Protect';
export const LOGO_SRC = '/livvsecure.jpeg';

/** Circular badge showing the whole logo (not cropped); the shield fits inside the circle. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <Box sx={{ width: size, height: size, borderRadius: '50%', bgcolor: '#fff', overflow: 'hidden', flexShrink: 0, display: 'grid', placeItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,.18)' }}>
      <Box component="img" src={LOGO_SRC} alt="LIVVAir Protect" draggable={false}
        sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </Box>
  );
}

export function Brand({ light = true, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center">
      <LogoMark />
      {!compact && (
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 17, lineHeight: 1.1, letterSpacing: '-0.01em', color: light ? '#fff' : 'text.primary' }}>{BRAND_NAME}</Typography>
          <Typography sx={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: light ? 'rgba(255,255,255,.6)' : 'text.secondary' }}>{BRAND_TAGLINE}</Typography>
        </Box>
      )}
    </Stack>
  );
}
