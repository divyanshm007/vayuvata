import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import { Box } from '@mui/material';
import { ParticleField } from './ParticleField';
import { useMotionPrefs } from './useMotion';

export const BG_LARGE = '/login-bg.jpg';
export const BG_SMALL = '/login-bg-sm.jpg';
/** Native size of the photo; used to reserve space and keep layer positions aligned to the image. */
const ASPECT = '1672 / 941';

/** The photograph. srcSet lets small screens fetch the 900px file; width/height reserve the box so nothing shifts on load. */
export function BackgroundPhoto({ objectPosition = 'center', onLoaded, style }: { objectPosition?: string; onLoaded?: () => void; style?: CSSProperties }) {
  // A cached image can finish before React attaches onLoad, so also check `complete` when the element mounts.
  const ref = useCallback((el: HTMLImageElement | null) => { if (el?.complete && el.naturalWidth > 0) onLoaded?.(); }, [onLoaded]);
  return (
    <img
      ref={ref}
      src={BG_LARGE} srcSet={`${BG_SMALL} 900w, ${BG_LARGE} 1672w`} sizes="100vw"
      width={1672} height={941} alt="" decoding="async" fetchPriority="high" draggable={false} onLoad={onLoaded}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition, ...style }}
    />
  );
}

const ribbon = (top: number, h: number, left: number, w: number, delay: number, dur: number, rot: number, alpha: number) => ({
  position: 'absolute' as const, top: `${top}%`, left: `${left}%`, width: `${w}%`, height: `${h}%`,
  borderRadius: '50%', transform: `rotate(${rot}deg)`, mixBlendMode: 'screen' as const, filter: 'blur(14px)',
  background: `linear-gradient(90deg, rgba(150,210,255,0) 0%, rgba(185,228,255,${alpha}) 22%, rgba(255,255,255,${alpha * 0.7}) 48%, rgba(150,210,255,${alpha * 0.45}) 74%, rgba(150,210,255,0) 100%)`,
  WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 14%, #000 62%, transparent)',
  maskImage: 'linear-gradient(90deg, transparent, #000 14%, #000 62%, transparent)',
  animation: `vv-flow ${dur}s ease-in-out ${delay}s infinite alternate`,
});

/**
 * Cinematic left panel: photo, drifting translucent airflow leaving the purifier, soft light shafts from the sun,
 * layered particles and a faint scanning beam. No pointer interaction: the background never reacts to the mouse. Everything is decoration; text goes in `children`.
 */
export function AtmosphereScene({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const { reduced, lowPower } = useMotionPrefs();
  const rich = !reduced && !lowPower;

  return (
    <Box sx={{
      position: 'relative', overflow: 'hidden', bgcolor: '#07162b', color: '#fff', minHeight: '100dvh',
      '@keyframes vv-fade': { from: { opacity: 0 }, to: { opacity: 1 } },
      '@keyframes vv-kenburns': { from: { transform: 'scale(1.02)' }, to: { transform: 'scale(1.075)' } },
      '@keyframes vv-flow': { '0%': { translate: '0 0', opacity: 0.55, scale: '1 1' }, '100%': { translate: '5% -2%', opacity: 1, scale: '1.08 1.18' } },
      '@keyframes vv-rays': { from: { opacity: 0.55 }, to: { opacity: 1 } },
      '@keyframes vv-scan': { '0%': { transform: 'translateX(-14vw)', opacity: 0 }, '6%': { opacity: 1 }, '60%': { opacity: 1 }, '72%,100%': { transform: 'translateX(112vw)', opacity: 0 } },
      '@keyframes vv-vent': { '0%,100%': { opacity: 0.45, transform: 'translate(-50%,-50%) scale(1)' }, '50%': { opacity: 0.95, transform: 'translate(-50%,-50%) scale(1.15)' } },
      '@keyframes vv-ring': { '0%': { opacity: 0.4, transform: 'translate(-50%,-50%) scale(.35)' }, '100%': { opacity: 0, transform: 'translate(-50%,-50%) scale(1.7)' } },
    }}>
      {/* depth plane 1: photograph, eased in once decoded. Sized from the scene height so it always covers, never stretches */}
      <Box sx={{
        position: 'absolute', left: 0, top: '50%', height: '100%', minHeight: '56.28vw', aspectRatio: ASPECT,
        transform: 'translateY(-50%)',
        opacity: loaded ? 1 : 0, transition: 'opacity 1.2s ease',
      }}>
        <Box sx={{ position: 'absolute', inset: 0, animation: rich ? 'vv-kenburns 38s ease-in-out infinite alternate' : 'none' }}>
          <BackgroundPhoto objectPosition="0% 50%" onLoaded={() => setLoaded(true)} />

          {/* depth plane 2: soft sunlight shafts from the upper right */}
          {!lowPower && (
            <Box sx={{
              position: 'absolute', inset: 0, mixBlendMode: 'screen', filter: 'blur(5px)', animation: rich ? 'vv-rays 11s ease-in-out infinite alternate' : 'none', opacity: 0.8,
              background: 'conic-gradient(from 188deg at 89% 33%, transparent 0deg, rgba(255,238,200,.20) 5deg, transparent 12deg, transparent 20deg, rgba(255,238,200,.13) 25deg, transparent 33deg, transparent 41deg, rgba(255,238,200,.11) 46deg, transparent 54deg)',
              WebkitMaskImage: 'linear-gradient(to bottom left, #000 10%, transparent 75%)', maskImage: 'linear-gradient(to bottom left, #000 10%, transparent 75%)',
            }} />
          )}

          {/* depth plane 3: translucent airflow leaving the purifier toward the open landscape */}
          {!lowPower && (
            <Box sx={{ position: 'absolute', inset: 0 }}>
              <Box sx={ribbon(46, 15, 14, 62, 0, 13, -5, 0.5)} />
              <Box sx={ribbon(52, 12, 16, 58, -4, 17, -2, 0.42)} />
              <Box sx={ribbon(40, 11, 18, 52, -8, 15, -9, 0.34)} />
              <Box sx={ribbon(57, 9, 14, 64, -2, 19, 1, 0.3)} />
            </Box>
          )}

          {/* purifier highlights: outlet glow, base reflection, slow sensing ring */}
          <Box sx={{ position: 'absolute', left: '18.2%', top: '47.6%', width: '15%', height: '7%', borderRadius: '50%', mixBlendMode: 'screen', background: 'radial-gradient(closest-side, rgba(150,215,255,.75), rgba(150,215,255,0))', transform: 'translate(-50%,-50%)', animation: rich ? 'vv-vent 4.2s ease-in-out infinite' : 'none', opacity: 0.7 }} />
          <Box sx={{ position: 'absolute', left: '20%', top: '80%', width: '22%', height: '9%', borderRadius: '50%', mixBlendMode: 'screen', background: 'radial-gradient(closest-side, rgba(120,190,255,.45), rgba(120,190,255,0))', transform: 'translate(-50%,-50%)', animation: rich ? 'vv-vent 5.4s ease-in-out infinite' : 'none', opacity: 0.6 }} />
          {rich && <Box sx={{ position: 'absolute', left: '18.2%', top: '63%', width: '17%', aspectRatio: '1', borderRadius: '50%', border: '1px solid rgba(190,230,255,.55)', transform: 'translate(-50%,-50%)', animation: 'vv-ring 6s ease-out infinite' }} />}

          {/* particle planes */}
          {rich && <ParticleField />}
        </Box>
      </Box>

      {/* legibility: darken the floor and the left edge where text sits, keep the purifier and view bright */}
      <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(to top, rgba(4,14,30,.88) 0%, rgba(4,14,30,.55) 16%, rgba(4,14,30,0) 38%), linear-gradient(to bottom, rgba(4,14,30,.62) 0%, rgba(4,14,30,.3) 24%, rgba(4,14,30,0) 44%), linear-gradient(to right, rgba(4,14,30,.62) 0%, rgba(4,14,30,.3) 28%, rgba(4,14,30,0) 52%), radial-gradient(ellipse 52% 62% at 17% 34%, rgba(4,14,30,.5), rgba(4,14,30,0) 70%)' }} />

      {/* foreground: faint environmental scan beam */}
      {rich && (
        <Box aria-hidden sx={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: 120, pointerEvents: 'none', mixBlendMode: 'screen', animation: 'vv-scan 12s linear 2s infinite', opacity: 0,
          background: 'linear-gradient(90deg, rgba(160,215,255,0) 0%, rgba(190,232,255,.07) 40%, rgba(225,245,255,.30) 50%, rgba(190,232,255,.07) 60%, rgba(160,215,255,0) 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 22%, #000 78%, transparent)', maskImage: 'linear-gradient(to bottom, transparent, #000 22%, #000 78%, transparent)',
        }} />
      )}

      <Box sx={{ position: 'relative', zIndex: 2, minHeight: '100dvh', animation: 'vv-fade 1s ease .2s both' }}>
        {children}
      </Box>
    </Box>
  );
}
