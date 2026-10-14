const num = (v: string | undefined, fallback: number, min: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

/**
 * Polling interval for GPS reads. The Raspberry Pi reports about once a minute, so polling faster than that only adds load;
 * the floor is 30 s. Override with VITE_GPS_REFRESH_SECONDS.
 */
export const GPS_REFRESH_SECONDS = num(import.meta.env.VITE_GPS_REFRESH_SECONDS, 60, 30);

/** A position older than this is flagged as stale (about 10 missed reports). Override with VITE_GPS_STALE_MINUTES. */
export const GPS_STALE_MINUTES = num(import.meta.env.VITE_GPS_STALE_MINUTES, 10, 1);
