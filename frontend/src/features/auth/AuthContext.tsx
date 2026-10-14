import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoginResponse, Profile, Role } from '../../types/api';
import { applySession, bindSessionHandlers, refreshSession } from '../../api/client';
import { authApi } from '../../api/services';
import { tokenStore } from '../../api/tokenStore';

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: Profile | null;
  role: Role | null;
  sessionExpired: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<Profile>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Adopt the fresh session returned by change-password. */
  adoptSession: (s: LoginResponse) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<Profile | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const clearLocal = useCallback(() => { tokenStore.clear(); setUser(null); setStatus('anonymous'); }, []);

  useEffect(() => {
    bindSessionHandlers(
      () => undefined,
      () => { setSessionExpired(true); setUser(null); setStatus('anonymous'); },
    );
  }, []);

  // Restore a session after a page reload from the stored refresh token.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tokenStore.getRefresh()) { setStatus('anonymous'); return; }
      try {
        await refreshSession();
        const me = await authApi.me();
        if (!cancelled) { setUser(me); setStatus('authenticated'); }
      } catch {
        if (!cancelled) clearLocal();
      }
    })();
    return () => { cancelled = true; };
  }, [clearLocal]);

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    const session = await authApi.login(email, password);
    applySession(session, remember);
    try {
      const me = await authApi.me(); // role comes from the server, never from the form
      setUser(me); setSessionExpired(false); setStatus('authenticated');
      return me;
    } catch (e) {
      tokenStore.clear();
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    const rt = tokenStore.getRefresh();
    try { if (rt) await authApi.logout(rt); } catch { /* server-side revoke best effort; local session is cleared regardless */ }
    setSessionExpired(false);
    clearLocal();
  }, [clearLocal]);

  const refreshProfile = useCallback(async () => { setUser(await authApi.me()); }, []);

  const adoptSession = useCallback((s: LoginResponse) => applySession(s, tokenStore.isPersistent()), []);

  const value = useMemo<AuthState>(
    () => ({ status, user, role: user?.role ?? null, sessionExpired, login, logout, refreshProfile, adoptSession }),
    [status, user, sessionExpired, login, logout, refreshProfile, adoptSession],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
}
