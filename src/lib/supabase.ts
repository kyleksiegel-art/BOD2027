// The anon Supabase client. Reads are public; every write goes through a SECURITY DEFINER
// RPC that demands a PIN session token (Phase 5), so the anon key alone can change nothing.
// Used for the one hydrate query (src/lib/data/hydrate.ts) and for the write RPCs
// (src/lib/data/mutations.ts). Realtime and the offline outbox are Phase 6.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local ' +
      '(run `supabase start` locally to get the values).',
  )
}

// The pin-verify Edge Function is called with plain fetch rather than functions.invoke(),
// because the 429 body carries a retry_after the UI needs and invoke() flattens it away.
export const supabaseUrl = url
export const supabaseAnonKey = anonKey

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
