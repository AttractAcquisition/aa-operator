import { createClient } from '@supabase/supabase-js'

// ─── TODO: Add your Supabase credentials ────────────────────────────────────
// Either set these in a .env file:
//   VITE_SUPABASE_URL=https://your-project.supabase.co
//   VITE_SUPABASE_ANON_KEY=your-anon-key
//
// Or connect via Claude Code:
//   claude "connect this app to supabase project [your-project-ref]"
// ─────────────────────────────────────────────────────────────────────────────

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ─── Type helpers ─────────────────────────────────────────────────────────────
export type SupabaseClient = typeof supabase

// ─── Edge Function caller ─────────────────────────────────────────────────────
export async function callEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw error
  return data as T
}
