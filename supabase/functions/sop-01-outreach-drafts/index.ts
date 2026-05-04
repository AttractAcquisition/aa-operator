// Model: claude-sonnet-4-6 — personalised WhatsApp outreach draft generation.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET = 'claude-sonnet-4-6'
const BATCH_LIMIT = 25

interface EnrichmentData {
  review_count: number | null
  trading_since: string | null
  has_website: boolean
  niche_fit: boolean
  summary: string
  sources: string[]
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

interface DraftedMessage {
  prospect_id: string
  name: string
  company: string
  phone: string | null
  message: string
}

async function draftMessages(prospects: ProspectRow[]): Promise<DraftedMessage[]> {
  // Strip fields Claude doesn't need (sources, raw urls) to keep the prompt compact
  const context = prospects.map(p => ({
    id: p.id,
    name: p.name,
    company: p.company,
    niche: p.niche ?? 'local business',
    location: p.location ?? null,
    quality_score: p.quality_score,
    trading_since: p.enrichment_data?.trading_since ?? null,
    review_count: p.enrichment_data?.review_count ?? null,
    has_website: p.enrichment_data?.has_website ?? null,
    business_summary: p.enrichment_data?.summary ?? null,
  }))

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 4096,
    system: [
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
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content:
          `Draft personalised WhatsApp outreach messages for these ${prospects.length} prospects:\n\n` +
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
  if (!jsonMatch) throw new Error('No JSON array in Sonnet response for outreach drafts')

  const drafts = JSON.parse(jsonMatch[0]) as Array<{ prospect_id: string; message: string }>

  // Only keep drafts whose IDs come from the actual fetch — guard against hallucinated IDs
  const prospectMap = new Map(prospects.map(p => [p.id, p]))

  return drafts
    .filter(d => prospectMap.has(d.prospect_id))
    .map(d => {
      const p = prospectMap.get(d.prospect_id)!
      return {
        prospect_id: d.prospect_id,
        name: p.name,
        company: p.company,
        phone: p.phone,
        message: d.message,
      }
    })
}

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

    // ── 2. Generate personalised messages via Sonnet ──────────────────────────
    const drafted = await draftMessages(prospects)

    if (drafted.length === 0) {
      throw new Error('Sonnet returned no valid drafted messages')
    }

    const draftedIds = drafted.map(d => d.prospect_id)

    // ── 3. Mark successfully drafted prospects as draft_ready ─────────────────
    const { error: updateError } = await supabase
      .from('prospects')
      .update({ status: 'draft_ready' })
      .in('id', draftedIds)

    if (updateError) throw new Error(`update prospect status: ${updateError.message}`)

    // ── 4. Create one approval_queue item for the whole batch ─────────────────
    const batchDate = new Date().toISOString().slice(0, 10)
    const batchTitle = `WhatsApp Outreach Batch — ${batchDate} — ${drafted.length} drafts`

    const { data: approvalRow, error: approvalError } = await supabase
      .from('approval_queue')
      .insert({
        sop_id: '01',
        sop_name: 'SOP 01 — WhatsApp Outreach Drafts',
        status: 'pending',
        priority: 'high',
        content_type: 'whatsapp_message',
        content_id: crypto.randomUUID(),
        content: {
          title: batchTitle,
          body: `${drafted.length} personalised WhatsApp messages ready for review and sending.`,
          messages: drafted,
          metadata: {
            batch_date: batchDate,
            count: drafted.length,
            prospect_ids: draftedIds,
          },
        },
      })
      .select('id')
      .single()

    if (approvalError) throw new Error(`create approval item: ${approvalError.message}`)

    // ── 5. Audit log ──────────────────────────────────────────────────────────
    await supabase.from('ai_task_log').insert({
      sop_id: '01',
      sop_name: 'SOP 01 — WhatsApp Outreach Drafts',
      tool_called: SONNET,
      status: 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${prospects.length} staged prospects`,
      output_summary:
        `${drafted.length} messages drafted, 1 approval item created (${approvalRow?.id})`,
    })

    return new Response(
      JSON.stringify({
        drafted: drafted.length,
        approval_queue_id: approvalRow?.id,
        batch_date: batchDate,
        messages: drafted,
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
        sop_id: '01',
        sop_name: 'SOP 01 — WhatsApp Outreach Drafts',
        tool_called: SONNET,
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: 'staged prospects batch',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
