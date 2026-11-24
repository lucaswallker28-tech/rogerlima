/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_BRAND_COVER?: string;
  readonly VITE_BRAND_LOGO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
