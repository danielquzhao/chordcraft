/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API origin in production, e.g. https://api.chordcraft.app (dev uses the /api proxy). */
  readonly VITE_API_URL?: string
  /** Supabase project URL and publishable (anon) key. Leave unset to run without sign-in. */
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
