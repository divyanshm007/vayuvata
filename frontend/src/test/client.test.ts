import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { http, bindSessionHandlers, API_PREFIX } from '../api/client';
import { tokenStore } from '../api/tokenStore';

const session = (n: number) => ({ accessToken: `acc${n}`, refreshToken: `ref${n}`, expiresAt: '', refreshTokenExpiresAt: '', userId: 1, name: 'A', email: 'a@x.io', role: 'Admin' });

describe('http client token handling', () => {
  let api: MockAdapter;
  let raw: MockAdapter;
  const lost = vi.fn();
  beforeEach(() => {
    api = new MockAdapter(http); raw = new MockAdapter(axios); lost.mockReset();
    bindSessionHandlers(() => undefined, lost);
    tokenStore.clear(); tokenStore.setAccess('expired'); tokenStore.setRefresh('ref0', false);
  });
  afterEach(() => { api.restore(); raw.restore(); tokenStore.clear(); });

  it('refreshes once for concurrent 401s and retries each request with the new token', async () => {
    const ok = (cfg: { headers?: Record<string, unknown> }) => (cfg.headers?.Authorization === 'Bearer acc1' ? [200, { ok: true }] : [401]);
    api.onGet('/users').reply(ok as never);
    api.onGet('/devices').reply(ok as never);
    raw.onPost(`${API_PREFIX}/auth/refresh`).reply(200, session(1));
    const [a, b] = await Promise.all([http.get('/users'), http.get('/devices')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(raw.history.post.length).toBe(1);
    expect(tokenStore.getRefresh()).toBe('ref1');
  });

  it('ends the session when the refresh token is rejected', async () => {
    api.onGet('/users').reply(401);
    raw.onPost(`${API_PREFIX}/auth/refresh`).reply(401, { code: 'unauthorized' });
    await expect(http.get('/users')).rejects.toBeTruthy();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(tokenStore.getRefresh()).toBeNull();
    expect(tokenStore.getAccess()).toBeNull();
  });

  it('keeps the session on a network error during refresh', async () => {
    api.onGet('/users').reply(401);
    raw.onPost(`${API_PREFIX}/auth/refresh`).networkError();
    await expect(http.get('/users')).rejects.toBeTruthy();
    expect(lost).not.toHaveBeenCalled();
    expect(tokenStore.getRefresh()).toBe('ref0');
  });

  it('stores the refresh token per tab unless remember-me is chosen', () => {
    tokenStore.setRefresh('r', false);
    expect(localStorage.getItem('vv.rt')).toBeNull();
    tokenStore.setRefresh('r', true);
    expect(localStorage.getItem('vv.rt')).toBe('r');
    expect(sessionStorage.getItem('vv.rt')).toBeNull();
  });
});
