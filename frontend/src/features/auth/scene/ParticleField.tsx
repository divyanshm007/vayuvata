import { useEffect, useRef } from 'react';

interface P { x: number; y: number; z: number; vx: number; vy: number; size: number; alpha: number; phase: number; wob: number; age: number }

/** Soft round sprite, rendered once and reused so each particle is a single cheap drawImage. */
function makeSprite(): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(235,247,255,1)');
    grad.addColorStop(0.35, 'rgba(190,225,255,.55)');
    grad.addColorStop(1, 'rgba(160,210,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return s;
}

// Where the purifier's outlet sits, as a fraction of the photo (particles are born here, then drift toward the open landscape).
const SOURCE = { x0: 0.15, x1: 0.26, y0: 0.5, y1: 0.68 };

/**
 * Fine airborne particles on three depth planes (far = small, dim, slow; near = larger, brighter, faster).
 * Single canvas, capped pixel ratio, paused when the tab is hidden. Particle count scales with area and is small.
 */
export function ParticleField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const sprite = makeSprite();
    let w = 0, h = 0, raf = 0, last = 0;
    let ps: P[] = [];

    const born = (p: Partial<P>, initial: boolean): P => {
      const z = Math.pow(Math.random(), 1.4);
      const fromPurifier = !initial && Math.random() < 0.65;
      const k = w / 1000;
      return {
        z,
        x: fromPurifier ? w * (SOURCE.x0 + Math.random() * (SOURCE.x1 - SOURCE.x0)) : initial ? w * (0.08 + Math.random() * 0.92) : w * Math.random() * 0.3,
        y: fromPurifier ? h * (SOURCE.y0 + Math.random() * (SOURCE.y1 - SOURCE.y0)) : h * (0.1 + Math.random() * 0.78),
        vx: (9 + z * 34 + Math.random() * 8) * k,
        vy: -(1.5 + z * 6 + Math.random() * 3) * k,
        size: 1.1 + z * 2.6,
        alpha: 0.16 + z * 0.5,
        phase: Math.random() * Math.PI * 2,
        wob: 4 + Math.random() * 10,
        age: initial ? 5 : 0,
        ...p,
      };
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(80, Math.max(34, (w * h) / 15000)));
      ps = Array.from({ length: n }, () => born({}, true));
    };

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, last ? (t - last) / 1000 : 0.016);
      last = t;
      ctx.clearRect(0, 0, w, h);
      const time = t / 1000;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt + Math.sin(time * 0.6 + p.phase) * p.wob * dt;
        if (p.x > w * 1.02 || p.y < -10) { ps[i] = born({}, false); continue; }
        const edge = Math.min(1, p.x / (w * 0.08), (w - p.x) / (w * 0.12));
        const fade = Math.max(0, Math.min(1, p.age / 1.2)) * Math.max(0, edge);
        const twinkle = 0.75 + 0.25 * Math.sin(time * (0.8 + p.z) + p.phase);
        ctx.globalAlpha = p.alpha * fade * twinkle;
        const s = p.size * 2.6;
        ctx.drawImage(sprite, p.x - s, p.y - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) { last = 0; raf = requestAnimationFrame(tick); }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas ref={ref} aria-hidden style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', mixBlendMode: 'screen',
    }} />
  );
}
