/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_TEST_ACCOUNTS?: string;
  readonly VITE_SHOW_TEST_ACCOUNTS?: string;
  readonly VITE_GPS_REFRESH_SECONDS?: string;
  readonly VITE_GPS_STALE_MINUTES?: string;
  readonly VITE_MAP_TILE_URL?: string;
  readonly VITE_MAP_ATTRIBUTION?: string;
  readonly VITE_MAP_MAX_ZOOM?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
