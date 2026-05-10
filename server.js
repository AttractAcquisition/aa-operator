import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 8080

app.use(express.json())
app.use(express.static(join(__dirname, 'dist')))

// ─── WhatsApp webhook ─────────────────────────────────────────────────────────
// The /webhook/whatsapp GET and POST routes have been removed from this server.
// All Meta Cloud API webhook traffic (verification challenge + inbound messages)
// is handled exclusively by the `meta-whatsapp-webhook` Supabase Edge Function
// in the aa-outreach-auto repo. Configure the Meta app webhook URL to point
// directly to that Edge Function's Supabase URL — not to this Railway server.

// ─── SPA fallback — send index.html for all routes not matched above ──────────
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
