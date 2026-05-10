// Model: claude-sonnet-4-6 — billing chase WhatsApp message generation.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET    = 'claude-sonnet-4-6'
const SOP_ID    = '46'
const SOP_NAME  = 'SOP 46 — Billing & Payment Chase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  id:            string
  name:          string
  contact_name:  string | null
  contact_phone: string | null
  tier:          string | null
}

interface LedgerRow {
  id:             string
  client_id:      string
  client_name:    string
  invoice_number: string
  invoice_date:   string
  due_date:       string
  amount:         number
  currency:       string
  description:    string
}

interface OverdueInvoice extends LedgerRow {
  days_overdue: number
}

interface ClientOverdue {
  client:        ClientRow
  invoices:      OverdueInvoice[]
  total_overdue: number
  max_days:      number
}

// ─── Claude message generation ────────────────────────────────────────────────

async function generateChaseMessage(
  client:   ClientRow,
  invoices: OverdueInvoice[],
): Promise<string> {
  const invoiceLines = invoices.map(inv =>
    `  Invoice ${inv.invoice_number}: £${inv.amount.toFixed(2)} — due ${inv.due_date} (${inv.days_overdue} days overdue)`,
  ).join('\n')

  const totalOwed = invoices.reduce((sum, inv) => sum + inv.amount, 0)
  const maxDays   = Math.max(...invoices.map(inv => inv.days_overdue))

  const context = `CLIENT: ${client.name}
CONTACT NAME: ${client.contact_name ?? client.name}
TIER: ${client.tier ?? 'standard'}

OVERDUE INVOICES:
${invoiceLines}

TOTAL OWED: £${totalOwed.toFixed(2)}
MOST OVERDUE: ${maxDays} days`

  const response = await anthropic.messages.create({
    model:      SONNET,
    max_tokens: 400,
    system: [{ type: 'text', text: [
      'You write short, warm, professional WhatsApp payment chase messages for Attract Acquisition,',
      'a paid advertising agency. These are messages to existing managed clients — the tone should be',
      'friendly and relationship-preserving, not aggressive or formal.',
      '',
      'Guidelines:',
      '- Address the contact by first name only',
      '- Mention the invoice number(s) and total amount owed clearly',
      '- Ask if there are any issues or if they need a fresh bank transfer link',
      '- Keep it under 120 words — WhatsApp messages should be concise',
      '- Do NOT use emojis',
      '- End with: "Thanks, Alex"',
      '- Output ONLY the message text — no intro, no quotes, no explanation',
    ].join('\n'), cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role:    'user',
        content: `Write the payment chase WhatsApp message for this client:\n\n${context}`,
      },
    ],
  })

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startedAt = Date.now()

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ── 1. Fetch active clients ──────────────────────────────────────────────
    const { data: rawClients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, name, contact_name, contact_phone, tier')
      .eq('status', 'active')

    if (clientsErr) throw new Error(`fetch clients: ${clientsErr.message}`)

    const clients  = (rawClients ?? []) as ClientRow[]
    const clientMap = new Map(clients.map(c => [c.id, c]))

    console.log(`[sop-46] ${clients.length} active clients`)

    if (clients.length === 0) {
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    SONNET,
        status:         'success',
        duration_ms:    Date.now() - startedAt,
        input_summary:  '0 active clients',
        output_summary: 'No active clients to check',
      })
      return new Response(
        JSON.stringify({ message: 'No active clients', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Fetch invoices overdue by 7+ days (not paid or cancelled) ─────────
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 7)
    const cutoff = cutoffDate.toISOString().slice(0, 10)

    const { data: rawLedger, error: ledgerErr } = await supabase
      .from('finance_ledger')
      .select('id, client_id, client_name, invoice_number, invoice_date, due_date, amount, currency, description')
      .in('client_id', clients.map(c => c.id))
      .in('status', ['pending', 'overdue', 'partial'])
      .lte('due_date', cutoff)
      .order('due_date', { ascending: true })

    if (ledgerErr) throw new Error(`fetch ledger: ${ledgerErr.message}`)

    const ledger = (rawLedger ?? []) as LedgerRow[]
    console.log(`[sop-46] ${ledger.length} invoices overdue by 7+ days`)

    if (ledger.length === 0) {
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    SONNET,
        status:         'success',
        duration_ms:    Date.now() - startedAt,
        input_summary:  `${clients.length} active clients checked`,
        output_summary: 'No invoices overdue by 7+ days',
      })
      return new Response(
        JSON.stringify({ message: 'No overdue invoices', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 3. Calculate days overdue and group by client ────────────────────────
    const todayMs = new Date().setHours(0, 0, 0, 0)

    const byClient = new Map<string, ClientOverdue>()

    for (const inv of ledger) {
      const daysOver = Math.floor((todayMs - new Date(inv.due_date).getTime()) / 86_400_000)
      const overdue: OverdueInvoice = { ...inv, days_overdue: daysOver }
      const existing = byClient.get(inv.client_id)

      if (existing) {
        existing.invoices.push(overdue)
        existing.total_overdue += inv.amount
        existing.max_days = Math.max(existing.max_days, daysOver)
      } else {
        const client = clientMap.get(inv.client_id)
        if (!client) continue
        byClient.set(inv.client_id, {
          client,
          invoices:      [overdue],
          total_overdue: inv.amount,
          max_days:      daysOver,
        })
      }
    }

    // ── 4. Process each client ───────────────────────────────────────────────
    let approvalsCreated = 0
    let alertsCreated    = 0
    const errors: string[] = []

    for (const [, group] of byClient) {
      try {
        const { client, invoices, total_overdue, max_days } = group
        console.log(`[sop-46] generating chase for ${client.name} — ${invoices.length} invoice(s), max ${max_days}d overdue`)

        // ── 4a. Generate WhatsApp message via Claude ─────────────────────────
        const message = await generateChaseMessage(client, invoices)

        // ── 4b. Create approval_queue item ───────────────────────────────────
        const invoiceLabel = invoices.length === 1
          ? `Invoice ${invoices[0].invoice_number}`
          : `${invoices.length} invoices`

        const title = `Payment Chase — ${client.name} — ${invoiceLabel} (${max_days}d overdue)`

        const { error: approvalErr } = await supabase
          .from('approval_queue')
          .insert({
            sop_id:       SOP_ID,
            sop_name:     SOP_NAME,
            status:       'pending',
            priority:     'high',
            content_type: 'whatsapp_message',
            content_id:   crypto.randomUUID(),
            content: {
              title,
              body:     message,
              messages: [{
                client_id:    client.id,
                client_name:  client.name,
                contact_name: client.contact_name,
                phone:        client.contact_phone,
                message,
              }],
              metadata: {
                client_id:       client.id,
                client_name:     client.name,
                invoice_count:   invoices.length,
                total_overdue,
                max_days_overdue: max_days,
                invoices: invoices.map(inv => ({
                  invoice_number: inv.invoice_number,
                  due_date:       inv.due_date,
                  amount:         inv.amount,
                  days_overdue:   inv.days_overdue,
                  description:    inv.description,
                })),
              },
            },
          })

        if (approvalErr) {
          console.error(`[sop-46] approval insert failed for ${client.name}: ${approvalErr.message}`)
          errors.push(`approval ${client.name}: ${approvalErr.message}`)
        } else {
          approvalsCreated++
          console.log(`[sop-46] approval item created for ${client.name}`)
        }

        // ── 4c. Warning alerts for invoices overdue 14+ days ─────────────────
        for (const inv of invoices.filter(i => i.days_overdue > 14)) {
          const alertMsg =
            `Invoice ${inv.invoice_number} overdue ${inv.days_overdue} days — ` +
            `${client.name}: £${inv.amount.toFixed(2)} due ${inv.due_date}`

          const { error: alertErr } = await supabase.from('ai_alerts').insert({
            severity:         'warning',
            sop_id:           SOP_ID,
            category:         'Billing',
            message:          alertMsg,
            suggested_action: `Chase payment from ${client.name} — WhatsApp message ready in approval queue`,
            client_name:      client.name,
            resolved:         false,
          })

          if (alertErr) {
            console.error(`[sop-46] alert insert failed for ${inv.invoice_number}: ${alertErr.message}`)
            errors.push(`alert ${inv.invoice_number}: ${alertErr.message}`)
          } else {
            alertsCreated++
            console.log(`[sop-46] warning alert created — ${inv.invoice_number} (${inv.days_overdue}d overdue)`)
          }
        }
      } catch (clientErr) {
        const msg = clientErr instanceof Error ? clientErr.message : String(clientErr)
        console.error(`[sop-46] error processing ${group.client.name}: ${msg}`)
        errors.push(`${group.client.name}: ${msg}`)
      }
    }

    // ── 5. Audit log ─────────────────────────────────────────────────────────
    const totalClients  = byClient.size
    const outputSummary =
      `${totalClients} clients with overdue invoices, ${approvalsCreated} chase messages created, ${alertsCreated} warning alerts raised` +
      (errors.length > 0 ? `, ${errors.length} errors: ${errors.slice(0, 3).join('; ')}` : '')

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    SONNET,
      status:         errors.length > 0 && approvalsCreated === 0 ? 'failure' : 'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${clients.length} active clients, ${ledger.length} overdue invoices`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({
        clients_checked:   clients.length,
        clients_overdue:   totalClients,
        invoices_overdue:  ledger.length,
        approvals_created: approvalsCreated,
        alerts_created:    alertsCreated,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-46] fatal: ${message}`)

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    SONNET,
        status:         'failure',
        duration_ms:    Date.now() - startedAt,
        input_summary:  'billing run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
