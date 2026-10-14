/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_TEST_ACCOUNTS?: string;
  readonly VITE_SHOW_TEST_ACCOUNTS?: string;
  readonly VITE_GPS_REFRESH_SECONDS?: string;
  readonly VITE_GPS_STALE_MINUTES?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
