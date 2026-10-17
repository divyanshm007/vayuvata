import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async () => { vi.resetModules(); return import('../config/mapTiles'); };
afterEach(() => vi.unstubAllEnvs());

describe('map tile configuration', () => {
  it('defaults to the public OpenStreetMap server (no subdomain) with its attribution', async () => {
    const m = await load();
    expect(m.MAP_TILE_URL).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(m.MAP_ATTRIBUTION).toMatch(/OpenStreetMap/);
    expect(m.MAP_MAX_ZOOM).toBe(19);
  });

  it('uses the provider set in the environment, with its own attribution and zoom', async () => {
    vi.stubEnv('VITE_MAP_TILE_URL', 'https://tiles.example.test/{z}/{x}/{y}.png?key=abc');
    vi.stubEnv('VITE_MAP_ATTRIBUTION', '&copy; Example Maps');
    vi.stubEnv('VITE_MAP_MAX_ZOOM', '18');
    const m = await load();
    expect(m.MAP_TILE_URL).toBe('https://tiles.example.test/{z}/{x}/{y}.png?key=abc');
    expect(m.MAP_ATTRIBUTION).toBe('&copy; Example Maps');
    expect(m.MAP_MAX_ZOOM).toBe(18);
  });

  it('never shows the OpenStreetMap credit for a different tile source that gave none, and ignores a bad zoom', async () => {
    vi.stubEnv('VITE_MAP_TILE_URL', 'https://tiles.example.test/{z}/{x}/{y}.png');
    vi.stubEnv('VITE_MAP_MAX_ZOOM', 'abc');
    const m = await load();
    expect(m.MAP_ATTRIBUTION).not.toMatch(/OpenStreetMap/);
    expect(m.MAP_MAX_ZOOM).toBe(19);
  });
});
