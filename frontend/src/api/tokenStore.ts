/**
 * Token handling. The backend returns tokens in the JSON body (no HttpOnly cookies), so:
 *  - the short-lived access token lives only in memory,
 *  - the refresh token lives in sessionStorage (this tab only) or, if "Keep me signed in" is ticked, localStorage.
 * Limitation: any script running on this origin could read the refresh token; this is why the app ships no third-party scripts
 * and the CSP/hosting should be locked down. Cookie-based sessions would need a backend change and were not made.
 */
const KEY = 'vv.rt';
let accessToken: string | null = null;

const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export const tokenStore = {
  getAccess: () => accessToken,
  setAccess: (t: string | null) => { accessToken = t; },
  getRefresh: (): string | null => safe(() => sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY), null),
  isPersistent: (): boolean => safe(() => localStorage.getItem(KEY) !== null, false),
  setRefresh(token: string, persistent: boolean) {
    safe(() => {
      sessionStorage.removeItem(KEY); localStorage.removeItem(KEY);
      (persistent ? localStorage : sessionStorage).setItem(KEY, token);
    }, undefined);
  },
  clear() {
    accessToken = null;
    safe(() => { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); }, undefined);
  },
};
