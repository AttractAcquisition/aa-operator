import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 8080

app.use(express.json())
app.use(express.static(join(__dirname, 'dist')))

// ─── Supabase client (server-side, service role) ──────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
)

// ─── WhatsApp webhook — Meta verification challenge ───────────────────────────
app.get('/webhook/whatsapp', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge)
  }
  res.sendStatus(403)
})

// ─── WhatsApp webhook — incoming messages ─────────────────────────────────────
app.post('/webhook/whatsapp', async (req, res) => {
  // Acknowledge immediately — Meta requires 200 within 20 s or will retry.
  res.sendStatus(200)

  try {
    // ── 1. Extract text messages from the Meta Cloud API payload ───────────────
    // Meta wraps messages in entry[].changes[].value.messages[].
    // We only process type='text' here; images/audio are ignored but won't error.
    const rawMsgs = []
    for (const entry of req.body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          if (msg.type !== 'text' || !msg.text?.body) continue
          rawMsgs.push({
            waId:      msg.id,                                              // Meta wamid
            from:      msg.from,                                            // E.164 digits, no '+'
            body:      msg.text.body,
            sentAt:    new Date(parseInt(msg.timestamp, 10) * 1000).toISOString(),
          })
        }
      }
    }

    if (rawMsgs.length === 0) return
    console.log(`[webhook/whatsapp] ${rawMsgs.length} text message(s) received`)

    // ── 2. Look up prospects by phone number ───────────────────────────────────
    // Meta delivers numbers without a '+' (e.g. '447700900001').
    // The prospects table may store them as '+447700900001', '447700900001', or
    // '07700900001' (UK local format). We query all three variants per number.
    const uniqueFroms  = [...new Set(rawMsgs.map(m => m.from))]
    const phoneVariants = uniqueFroms.flatMap(n => [
      `+${n}`,                                  // +447700900001
      n,                                         // 447700900001
      n.length > 2 ? `0${n.slice(2)}` : n,      // 07700900001 (strip country code)
    ])

    const { data: prospectRows, error: lookupErr } = await supabase
      .from('prospects')
      .select('id, phone, status')
      .in('phone', phoneVariants)

    if (lookupErr) {
      console.error('[webhook/whatsapp] prospect lookup error:', lookupErr.message)
      // Non-fatal — we still store the message; prospect_id will be null.
    }

    // Build stripped-digits → prospect_id map for O(1) matching.
    const phoneToProspectId = new Map()
    for (const p of prospectRows ?? []) {
      const digits = (p.phone ?? '').replace(/\D/g, '')
      if (digits) phoneToProspectId.set(digits, p.id)
    }

    // ── 3. Build whatsapp_messages rows ────────────────────────────────────────
    const rows = rawMsgs.map(msg => {
      const digits     = msg.from.replace(/\D/g, '')
      const prospectId = phoneToProspectId.get(digits) ?? null

      if (!prospectId) {
        console.warn(`[webhook/whatsapp] no prospect matched for number ${msg.from}`)
      }

      return {
        prospect_id:         prospectId,
        direction:           'inbound',
        message_body:        msg.body,
        whatsapp_message_id: msg.waId,
        from_number:         msg.from,
        status:              'sent',
        sent_at:             msg.sentAt,
      }
    })

    // ── 4. Upsert rows — ignoreDuplicates handles Meta webhook retries ─────────
    const { error: insertErr } = await supabase
      .from('whatsapp_messages')
      .upsert(rows, { onConflict: 'whatsapp_message_id', ignoreDuplicates: true })

    if (insertErr) {
      console.error('[webhook/whatsapp] upsert error:', insertErr.message)
      return
    }

    // ── 5. Fire sop-06-reply-triage once per matched prospect (async) ──────────
    // We de-duplicate so a burst of messages from the same prospect only
    // triggers one triage run. We do NOT await — the webhook has already
    // responded 200 and triage may take several seconds.
    const matchedIds = [...new Set(rows.filter(r => r.prospect_id).map(r => r.prospect_id))]

    for (const prospectId of matchedIds) {
      supabase.functions
        .invoke('sop-06-reply-triage', {
          body: { prospect_id: prospectId, source: 'whatsapp_webhook' },
        })
        .then(({ error }) => {
          if (error) {
            console.error(`[webhook/whatsapp] sop-06 error (prospect ${prospectId}):`, error.message)
          } else {
            console.log(`[webhook/whatsapp] sop-06 triggered for prospect ${prospectId}`)
          }
        })
    }

  } catch (err) {
    console.error('[webhook/whatsapp] unhandled error:', err instanceof Error ? err.message : err)
  }
})

// ─── SPA fallback — send index.html for all routes not matched above ──────────
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
