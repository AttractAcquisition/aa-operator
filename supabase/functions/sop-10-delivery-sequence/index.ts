// Model: claude-sonnet-4-6 — 3-message WhatsApp delivery sequence for MJR documents.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET = 'claude-sonnet-4-6'
const BATCH_LIMIT = 5
const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 days
const FOLLOW_UP_DELAY_MS = 24 * 60 * 60 * 1000 // 24 hours
const CHASE_DELAY_MS = 48 * 60 * 60 * 1000 // 48 hours

interface EnrichmentData {
  review_count: number | null
  trading_since: string | null
  has_website: boolean
  niche_fit: boolean
  summary: string
}

interface ProspectRow {
  id: string
  name: string
  company: string
  phone: string | null
  niche: string | null
  location: string | null
  quality_score: number
  enrichment_data: EnrichmentData | null
}

interface MessageBody {
  message_number: 1 | 2 | 3
  send_at: string
  body: string
}

interface SequenceDraft {
  prospect_id: string
  messages: Array<{ message_number: 1 | 2 | 3; body: string }>
}

// ── Generate all 3 message bodies for a batch of prospects via one Sonnet call ─
async function draftSequences(
  prospects: ProspectRow[],
  sendAtBase: number,
): Promise<Map<string, MessageBody[]>> {
  const now = new Date(sendAtBase).toISOString()
  const at24h = new Date(sendAtBase + FOLLOW_UP_DELAY_MS).toISOString()
  const at48h = new Date(sendAtBase + CHASE_DELAY_MS).toISOString()

  const context = prospects.map(p => ({
    id: p.id,
    first_name: p.name.split(' ')[0],
    name: p.name,
    company: p.company,
    niche: p.niche ?? 'local service business',
    location: p.location ?? 'UK',
    trading_since: p.enrichment_data?.trading_since ?? null,
    review_count: p.enrichment_data?.review_count ?? null,
    has_website: p.enrichment_data?.has_website ?? null,
  }))

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 6000,
    system: [
      'You write personalised WhatsApp message sequences for Attract Acquisition,',
      'a performance marketing agency that helps local service businesses win more clients.',
      '',
      'You will draft a 3-message delivery sequence per prospect:',
      '',
      'Message 1 (sent immediately):',
      '  — Deliver the Missed Jobs Report (MJR). Open warmly by name.',
      '  — Mention you researched their specific area/niche and found the data revealing.',
      '  — Include this exact placeholder for the link: {{MJR_LINK}}',
      '  — One sentence asking them to take a look and let you know what they think.',
      '  — 3–5 sentences total.',
      '',
      'Message 2 (sent 24 hours later):',
      '  — Friendly, low-pressure follow-up. Assume they saw the report but are busy.',
      '  — One specific hook from their business profile (niche, location, or trading duration).',
      '  — Invite a quick 15-minute call to walk through it together.',
      '  — 2–3 sentences.',
      '',
      'Message 3 (sent 48 hours later):',
      '  — Final, brief chase. Acknowledge you have reached out a couple of times.',
      '  — Keep the door open — no pressure, just genuine offer to help.',
      '  — 2 sentences maximum.',
      '',
      'Rules for all messages:',
      '  • Natural and conversational — not salesy. No buzzwords. No exclamation marks.',
      '  • Open with "Hi [first name]," — never full name.',
      '  • No emojis. Never reveal internal scores or enrichment data.',
      '  • Vary phrasing across the three messages in each sequence.',
      '',
      'Return ONLY a valid JSON array — no markdown, no explanation:',
      '[{"prospect_id":"<uuid>","messages":[',
      '  {"message_number":1,"body":"<text with {{MJR_LINK}} placeholder>"},',
      '  {"message_number":2,"body":"<text>"},',
      '  {"message_number":3,"body":"<text>"}',
      ']}]',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content:
          `Draft 3-message WhatsApp delivery sequences for these ${prospects.length} prospects.\n\n` +
          `Send times for reference (use {{MJR_LINK}} for the report link):\n` +
          `  Message 1: ${now}\n` +
          `  Message 2: ${at24h}\n` +
          `  Message 3: ${at48h}\n\n` +
          `Prospects:\n` +
          JSON.stringify(context, null, 2),
      },
    ],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('No JSON array in Sonnet response for delivery sequences')

  const drafts = JSON.parse(jsonMatch[0]) as SequenceDraft[]

  const prospectIds = new Set(prospects.map(p => p.id))
  const result = new Map<string, MessageBody[]>()

  for (const draft of drafts) {
    if (!prospectIds.has(draft.prospect_id)) continue

    const bodies = draft.messages.sort((a, b) => a.message_number - b.message_number)
    if (bodies.length !== 3) continue

    result.set(draft.prospect_id, [
      { message_number: 1, send_at: now, body: bodies[0].body },
      { message_number: 2, send_at: at24h, body: bodies[1].body },
      { message_number: 3, send_at: at48h, body: bodies[2].body },
    ])
  }

  return result
}

// ── Resolve signed URL: try approval_queue first, fall back to regenerate ──────
async function resolveSignedUrl(
  prospectId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<string> {
  const { data: aqRow } = await supabase
    .from('approval_queue')
    .select('content')
    .eq('content_type', 'mjr_document')
    .eq('content_id', prospectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const storedUrl = aqRow?.content?.signed_url as string | undefined
  const expiresAt = aqRow?.content?.metadata?.expires_at as string | undefined

  if (storedUrl && expiresAt && new Date(expiresAt) > new Date()) {
    return storedUrl
  }

  // Regenerate from Storage
  const storagePath = `mjr/${prospectId}.html`
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, SIGNED_URL_TTL)

  if (error || !data?.signedUrl) {
    throw new Error(`Could not resolve signed URL for prospect ${prospectId}: ${error?.message ?? 'no URL'}`)
  }

  return data.signedUrl
}

// ── Handler ───────────────────────────────────────────────────────────────────

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

    // ── 1. Fetch mjr_built prospects ──────────────────────────────────────────
    const { data: rawProspects, error: fetchError } = await supabase
      .from('prospects')
      .select('id, name, company, phone, niche, location, quality_score, enrichment_data')
      .eq('status', 'mjr_built')
      .order('quality_score', { ascending: false })
      .limit(BATCH_LIMIT)

    if (fetchError) throw new Error(`fetch prospects: ${fetchError.message}`)

    const prospects = (rawProspects ?? []) as ProspectRow[]

    if (prospects.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No mjr_built prospects found', sequenced: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Draft all sequences in one Sonnet call ─────────────────────────────
    const sendAtBase = Date.now()
    const sequenceMap = await draftSequences(prospects, sendAtBase)

    // ── 3. Process each prospect: resolve URL, inject link, create queue item ─
    const queued: Array<{
      prospect_id: string
      company: string
      phone: string | null
      approval_id: string
    }> = []
    let errors = 0

    for (const prospect of prospects) {
      try {
        const messages = sequenceMap.get(prospect.id)
        if (!messages || messages.length !== 3) {
          throw new Error('Sequence draft missing or incomplete for this prospect')
        }

        // 3a. Get or regenerate the MJR signed URL
        const signedUrl = await resolveSignedUrl(prospect.id, supabase)

        // 3b. Inject the real URL into the message 1 placeholder
        const hydratedMessages = messages.map(m => ({
          ...m,
          body: m.body.replace(/\{\{MJR_LINK\}\}/g, signedUrl),
        }))

        // 3c. Create one approval_queue item for this prospect's sequence
        const batchDate = new Date().toISOString().slice(0, 10)

        const { data: approvalRow, error: approvalError } = await supabase
          .from('approval_queue')
          .insert({
            sop_id: '10',
            sop_name: 'SOP 10 — Delivery Sequence',
            status: 'pending',
            priority: 'high',
            content_type: 'delivery_sequence',
            content_id: prospect.id,
            content: {
              title: `Delivery Sequence — ${prospect.company} — ${batchDate}`,
              body: `3-message MJR delivery sequence for ${prospect.company} (${prospect.location ?? 'UK'}).`,
              recipient: prospect.name,
              phone: prospect.phone,
              messages: hydratedMessages,
              metadata: {
                prospect_id: prospect.id,
                company: prospect.company,
                niche: prospect.niche,
                location: prospect.location,
                quality_score: prospect.quality_score,
                send_at_msg1: hydratedMessages[0].send_at,
                send_at_msg2: hydratedMessages[1].send_at,
                send_at_msg3: hydratedMessages[2].send_at,
                mjr_signed_url: signedUrl,
              },
            },
          })
          .select('id')
          .single()

        if (approvalError) throw new Error(`create approval item: ${approvalError.message}`)

        // 3d. Advance prospect status
        await supabase
          .from('prospects')
          .update({ status: 'sequence_queued' })
          .eq('id', prospect.id)

        queued.push({
          prospect_id: prospect.id,
          company: prospect.company,
          phone: prospect.phone,
          approval_id: approvalRow?.id,
        })
      } catch (prospectErr) {
        console.error(
          `Delivery sequence error for ${prospect.company} (${prospect.id}):`,
          prospectErr instanceof Error ? prospectErr.message : String(prospectErr),
        )
        errors++
      }
    }

    // ── 4. Audit log ──────────────────────────────────────────────────────────
    const allFailed = errors > 0 && queued.length === 0

    await supabase.from('ai_task_log').insert({
      sop_id: '10',
      sop_name: 'SOP 10 — Delivery Sequence',
      tool_called: SONNET,
      status: allFailed ? 'failure' : 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${prospects.length} mjr_built prospects`,
      output_summary: `${queued.length} delivery sequences queued for approval, ${errors} errors`,
    })

    return new Response(
      JSON.stringify({ sequenced: queued.length, errors, sequences: queued }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await supabase.from('ai_task_log').insert({
        sop_id: '10',
        sop_name: 'SOP 10 — Delivery Sequence',
        tool_called: SONNET,
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: 'mjr_built prospects',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
