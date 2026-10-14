import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { LoginResponse } from '../types/api';
import { tokenStore } from './tokenStore';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
export const API_PREFIX = `${API_BASE}/api/v1`;

export const http = axios.create({ baseURL: API_PREFIX, timeout: 30_000, headers: { Accept: 'application/json' } });

type Listener = (session: LoginResponse) => void;
let onSessionRenewed: Listener | null = null;
let onSessionLost: (() => void) | null = null;
export function bindSessionHandlers(renewed: Listener, lost: () => void) { onSessionRenewed = renewed; onSessionLost = lost; }

const isAuthCall = (url?: string) => !!url && /\/auth\/(login|refresh)$/.test(url);

// Single-flight refresh: concurrent 401s share one rotation so a rotated refresh token is never presented twice.
let refreshing: Promise<LoginResponse> | null = null;

export function refreshSession(): Promise<LoginResponse> {
  if (refreshing) return refreshing;
  const rt = tokenStore.getRefresh();
  if (!rt) return Promise.reject(new Error('No refresh token'));
  const persistent = tokenStore.isPersistent();
  refreshing = axios
    .post<LoginResponse>(`${API_PREFIX}/auth/refresh`, { refreshToken: rt }, { timeout: 30_000 })
    .then((r) => {
      applySession(r.data, persistent);
      return r.data;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export function applySession(s: LoginResponse, persistent: boolean) {
  tokenStore.setAccess(s.accessToken);
  tokenStore.setRefresh(s.refreshToken, persistent);
}

http.interceptors.request.use((cfg) => {
  const t = tokenStore.getAccess();
  if (t && !isAuthCall(cfg.url)) cfg.headers.set('Authorization', `Bearer ${t}`);
  return cfg;
});

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const cfg = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    if (error.response?.status === 401 && cfg && !cfg._retried && !isAuthCall(cfg.url) && tokenStore.getRefresh()) {
      cfg._retried = true;
      try {
        const session = await refreshSession();
        onSessionRenewed?.(session);
        cfg.headers.set('Authorization', `Bearer ${session.accessToken}`);
        return http(cfg);
      } catch (e) {
        // Only end the session when the server rejected the refresh token; a network blip must not log the user out.
        if (axios.isAxiosError(e) && e.response && e.response.status === 401) {
          tokenStore.clear();
          onSessionLost?.();
        }
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  },
);

/** Drop undefined/empty query values so they are not sent. */
export function clean<T extends object>(params: T): Partial<T> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<T>;
}
