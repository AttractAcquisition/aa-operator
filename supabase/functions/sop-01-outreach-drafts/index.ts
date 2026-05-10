// Model: claude-sonnet-4-6 — personalised WhatsApp outreach draft generation.
//
// For each staged prospect:
//   1. Drafts a personalised WhatsApp message via Sonnet.
//   2. Looks up (or creates) a whatsapp_conversations row for the prospect.
//   3. Inserts one whatsapp_outreach_queue row per message for operator review.
//
// whatsapp_outreach_queue is for cold first-touch outreach batches.
// whatsapp_ai_suggestions is for AI reply drafts on warm in-progress conversations
// (written by the Conversations UI, not this SOP).
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { checkSuppression } from '../_shared/suppression.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET      = 'claude-sonnet-4-6'
const BATCH_LIMIT = 25
const SOP_ID      = '01'
const SOP_NAME    = 'SOP 01 — WhatsApp Outreach Drafts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnrichmentData {
  review_count:  number | null
  trading_since: string | null
  has_website:   boolean
  niche_fit:     boolean
  summary:       string
  sources:       string[]
}

interface ProspectRow {
  id:              string
  name:            string
  company:         string
  phone:           string | null
  niche:           string | null
  location:        string | null
  quality_score:   number
  enrichment_data: EnrichmentData | null
}

interface DraftedMessage {
  prospect_id: string
  prospect:    ProspectRow
  message:     string
}

interface ConversationRow {
  id:          string
  prospect_id: string | null
}

// ─── Draft generation ─────────────────────────────────────────────────────────

async function draftMessages(prospects: ProspectRow[]): Promise<DraftedMessage[]> {
  const context = prospects.map(p => ({
    id:               p.id,
    name:             p.name,
    company:          p.company,
    niche:            p.niche ?? 'local business',
    location:         p.location ?? null,
    quality_score:    p.quality_score,
    trading_since:    p.enrichment_data?.trading_since ?? null,
    review_count:     p.enrichment_data?.review_count  ?? null,
    has_website:      p.enrichment_data?.has_website   ?? null,
    business_summary: p.enrichment_data?.summary       ?? null,
  }))

  const response = await anthropic.messages.create({
    model:      SONNET,
    max_tokens: 4096,
    system: [{ type: 'text', text: [
      'You write personalised WhatsApp cold outreach messages for Attract Acquisition,',
      'a performance marketing agency that helps local service businesses get more leads',
      'through paid advertising (Google Ads, Meta Ads).',
      '',
      'Message rules:',
      '  1. 3–4 sentences maximum. Natural and conversational — not salesy.',
      '  2. Open with "Hi [first name only]," — never use full name.',
      '  3. Reference ONE specific detail about the business (niche, how long trading,',
      '     or type of service they offer) to show genuine research.',
      '  4. One clear value prop: help them get a consistent flow of new clients.',
      '  5. Close with a low-pressure question: "Would it be worth a quick chat?"',
      '  6. No emojis, no exclamation marks, no buzzwords (e.g. "game-changing").',
      '  7. Never mention review counts, quality scores, or internal data points.',
      '  8. Vary the opening reference and phrasing across messages — avoid repetition.',
      '',
      'Return ONLY a valid JSON array — no markdown fences, no explanation:',
      '[{"prospect_id":"<uuid>","message":"<WhatsApp message text>"}]',
    ].join('\n'), cache_control: { type: 'ephemeral' } }],
    messages: [{
      role:    'user',
      content: `Draft personalised WhatsApp outreach messages for these ${prospects.length} prospects:\n\n` +
               JSON.stringify(context, null, 2),
    }],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('No JSON array in Sonnet response for outreach drafts')

  const drafts = JSON.parse(jsonMatch[0]) as Array<{ prospect_id: string; message: string }>

  const prospectMap = new Map(prospects.map(p => [p.id, p]))

  return drafts
    .filter(d => prospectMap.has(d.prospect_id))
    .map(d => ({
      prospect_id: d.prospect_id,
      prospect:    prospectMap.get(d.prospect_id)!,
      message:     d.message,
    }))
}

// ─── Main handler ─────────────────────────────────────────────────────────────

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

    // ── 1. Fetch staged prospects ordered by quality descending ───────────────
    const { data: rawProspects, error: fetchError } = await supabase
      .from('prospects')
      .select('id, name, company, phone, niche, location, quality_score, enrichment_data')
      .eq('status', 'staged')
      .order('quality_score', { ascending: false })
      .limit(BATCH_LIMIT)

    if (fetchError) throw new Error(`fetch prospects: ${fetchError.message}`)

    const prospects = (rawProspects ?? []) as ProspectRow[]

    if (prospects.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No staged prospects to draft', drafted: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Suppression check — filter before spending any Claude tokens ────────
    // All phone lookups run concurrently against the indexed suppression list.
    const suppressionResults = await Promise.all(
      prospects.map(p => checkSuppression(p.phone ?? '', supabase)),
    )

    const suppressedProspects  = prospects.filter((_, i) => suppressionResults[i])
    const unsuppressedProspects = prospects.filter((_, i) => !suppressionResults[i])
    const suppressedCount      = suppressedProspects.length

    if (suppressedCount > 0) {
      console.log(
        `[${SOP_NAME}] ${suppressedCount} suppressed number(s) skipped: ` +
        suppressedProspects.map(p => p.phone ?? p.company).join(', '),
      )
    }

    if (unsuppressedProspects.length === 0) {
      return new Response(
        JSON.stringify({
          message:    'All staged prospects are on the suppression list — nothing to draft',
          drafted:    0,
          suppressed: suppressedCount,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 3. Generate personalised messages via Sonnet ──────────────────────────
    const drafted = await draftMessages(unsuppressedProspects)

    if (drafted.length === 0) {
      throw new Error('Sonnet returned no valid drafted messages')
    }

    // ── 4. Resolve conversations — one per prospect ───────────────────────────
    // Batch fetch existing conversations for all drafted prospect IDs.
    const draftedProspectIds = drafted.map(d => d.prospect_id)

    const { data: existingConvs, error: convFetchError } = await supabase
      .from('whatsapp_conversations')
      .select('id, prospect_id')
      .in('prospect_id', draftedProspectIds)

    if (convFetchError) throw new Error(`fetch conversations: ${convFetchError.message}`)

    const convMap = new Map(
      ((existingConvs ?? []) as ConversationRow[]).map(c => [c.prospect_id!, c.id]),
    )

    // Create conversations for prospects that don't have one yet
    const prospectsNeedingConv = drafted.filter(d => !convMap.has(d.prospect_id))

    if (prospectsNeedingConv.length > 0) {
      const newConvRows = prospectsNeedingConv.map(d => ({
        prospect_id: d.prospect_id,
        phone:       d.prospect.phone ?? '',
        source:      'outreach_campaign',
        stage:       'new',
        status:      'open',
      }))

      const { data: createdConvs, error: convInsertError } = await supabase
        .from('whatsapp_conversations')
        .insert(newConvRows)
        .select('id, prospect_id')

      if (convInsertError) throw new Error(`create conversations: ${convInsertError.message}`)

      for (const c of (createdConvs ?? []) as ConversationRow[]) {
        if (c.prospect_id) convMap.set(c.prospect_id, c.id)
      }
    }

    // ── 5. Insert one whatsapp_outreach_queue row per drafted message ─────────
    const batchDate  = new Date().toISOString().slice(0, 10)
    const batchLabel = `Outreach Batch — ${batchDate}`

    const queueRows = drafted.map(d => ({
      batch_date:      batchDate,
      batch_label:     batchLabel,
      prospect_id:     d.prospect_id,
      conversation_id: convMap.get(d.prospect_id) ?? null,
      phone_number:    d.prospect.phone ?? '',
      contact_name:    d.prospect.name,
      company_name:    d.prospect.company,
      drafted_message: d.message,
      quality_score:   d.prospect.quality_score,
      status:          'pending_review',
    }))

    const { data: insertedRows, error: queueError } = await supabase
      .from('whatsapp_outreach_queue')
      .insert(queueRows)
      .select('id')

    if (queueError) throw new Error(`insert outreach queue: ${queueError.message}`)

    // ── 6. Mark drafted prospects as draft_ready ──────────────────────────────
    const { error: updateError } = await supabase
      .from('prospects')
      .update({ status: 'draft_ready' })
      .in('id', draftedProspectIds)

    if (updateError) throw new Error(`update prospect status: ${updateError.message}`)

    // ── 7. Audit log ──────────────────────────────────────────────────────────
    const queueCount   = (insertedRows ?? []).length
    const newConvCount = prospectsNeedingConv.length

    const suppressedNote = suppressedCount > 0
      ? ` · ${suppressedCount} suppressed (skipped)`
      : ''

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    SONNET,
      status:         'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${prospects.length} staged prospects (${suppressedCount} suppressed)`,
      output_summary: `${queueCount} messages queued in "${batchLabel}" · ${newConvCount} new conversations created · ${drafted.length} prospects → draft_ready${suppressedNote}`,
    })

    return new Response(
      JSON.stringify({
        drafted:               drafted.length,
        suppressed:            suppressedCount,
        queue_inserted:        queueCount,
        conversations_created: newConvCount,
        batch_date:            batchDate,
        batch_label:           batchLabel,
      }),
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
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    SONNET,
        status:         'failure',
        duration_ms:    Date.now() - startedAt,
        input_summary:  'staged prospects batch',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
