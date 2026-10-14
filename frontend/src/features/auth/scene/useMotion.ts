import { useEffect, useState } from 'react';

export interface MotionPrefs {
  /** User asked the OS/browser for reduced motion. */
  reduced: boolean;
  /** Probably a weak or battery/data-constrained device: skip the expensive effects. */
  lowPower: boolean;
}

interface NavigatorHints extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

function readPrefs(): MotionPrefs {
  if (typeof window === 'undefined' || !window.matchMedia) return { reduced: true, lowPower: true };
  const nav = navigator as NavigatorHints;
  const weakCpu = (nav.hardwareConcurrency ?? 8) <= 4;
  const weakMem = nav.deviceMemory !== undefined && nav.deviceMemory <= 4;
  return {
    reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    lowPower: weakCpu || weakMem || !!nav.connection?.saveData,
  };
}

export function useMotionPrefs(): MotionPrefs {
  const [prefs, setPrefs] = useState<MotionPrefs>(readPrefs);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setPrefs(readPrefs());
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return prefs;
}
