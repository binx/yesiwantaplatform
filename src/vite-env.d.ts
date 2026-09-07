/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" once the Phase 2 API server should be the store's data source. */
  readonly VITE_BELUGA_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv & Record<string, string | boolean | undefined>;
}
