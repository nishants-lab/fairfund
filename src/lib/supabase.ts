import { createClient, SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Supabase client is only created when env vars are configured.
// This lets the app run fully without a backend during development.
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key) : null

export const isAuthEnabled = !!supabase
