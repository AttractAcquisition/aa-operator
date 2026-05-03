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
  // Acknowledge immediately so Meta doesn't retry
  res.sendStatus(200)

  try {
    const entries = req.body?.entry ?? []
    const messages = []

    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          messages.push({
            wa_message_id: msg.id,
            from_number:   msg.from,
            timestamp:     new Date(parseInt(msg.timestamp, 10) * 1000).toISOString(),
            type:          msg.type,
            text:          msg.text?.body ?? null,
            raw:           msg,
          })
        }
      }
    }

    if (messages.length === 0) return

    const { error: insertError } = await supabase
      .from('whatsapp_messages')
      .insert(messages)

    if (insertError) {
      console.error('[webhook/whatsapp] insert error:', insertError.message)
    }

    // Trigger reply triage for any newly stored messages
    const { error: fnError } = await supabase.functions.invoke('sop-06-reply-triage', {
      body: { source: 'whatsapp_webhook', message_count: messages.length },
    })

    if (fnError) {
      console.error('[webhook/whatsapp] sop-06-reply-triage error:', fnError.message)
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
