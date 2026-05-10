// Shared suppression-list helper.
// Queries whatsapp_suppression_list to determine whether a phone number has
// opted out of WhatsApp contact. Call checkSuppression before inserting any
// outreach row to avoid messaging unsubscribed or legally-blocked numbers.
//
// Fail-open policy: if the DB query errors (table missing, network timeout,
// etc.) the function returns false so outreach is not silently blocked. The
// warning is logged to the Edge Function console for investigation.
import { createClient } from 'npm:@supabase/supabase-js@2'

type SupabaseClient = ReturnType<typeof createClient>

// ─── Phone normalisation ───────────────────────────────────────────────────────
// Converts any UK phone format to E.164 (+44…) for consistent comparison.
//   07700 900001  →  +447700900001
//   447700900001  →  +447700900001
//   +447700900001 →  +447700900001

export function normalizePhone(phone: string): string {
  const digits = phone.trim().replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('44') && digits.length >= 11) return `+${digits}`
  if (digits.startsWith('0')  && digits.length >= 10) return `+44${digits.slice(1)}`
  if (digits.length >= 7) return `+44${digits}`
  return digits
}

// ─── Single-phone suppression check ───────────────────────────────────────────
// Returns true  — phone is on the active suppression list; skip this prospect.
// Returns false — not suppressed, or the check could not be completed (fail-open).

export async function checkSuppression(
  phone: string,
  supabase: SupabaseClient,
): Promise<boolean> {
  const normalized = normalizePhone(phone)
  if (!normalized) return false

  const { data, error } = await supabase
    .from('whatsapp_suppression_list')
    .select('id')
    .eq('phone', normalized)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn(`[suppression] check failed for ${normalized}: ${error.message}`)
    return false
  }

  return data !== null
}
