/** The API returns timestamps without a zone. Readings are device wall-clock time (IST); audit fields are UTC. */
const hasZone = (s: string) => /([zZ]|[+-]\d\d:?\d\d)$/.test(s);

export function parseApiDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(hasZone(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a zone-less reading timestamp exactly as stored (no timezone shifting). */
export function fmtWallClock(s: string | null | undefined, withSeconds = false): string {
  const d = parseApiDate(s);
  if (!d) return '—';
  return d.toLocaleString('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}), hour12: false,
  });
}

/** Audit timestamps (createdAt, lastLoginAt, assignedAt…) are UTC; show in the viewer's locale. */
export function fmtUtc(s: string | null | undefined): string {
  const d = parseApiDate(s);
  if (!d) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtShortTime(s: string): string {
  const d = parseApiDate(s);
  return d ? d.toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : s;
}

export const fmtNum = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: digits });

/** "Recently reporting" = last reading within `minutes` of now (device clock is IST = UTC+5:30). */
export function isRecentlyReporting(recordedAt: string | null | undefined, minutes = 30): boolean {
  const d = parseApiDate(recordedAt);
  if (!d) return false;
  const nowIst = Date.now() + 330 * 60_000;
  return nowIst - d.getTime() <= minutes * 60_000;
}

/** datetime-local value (yyyy-MM-ddTHH:mm) -> API query value. */
export const toApiDateTime = (v: string): string | undefined => (v ? `${v}:00` : undefined);
