// Model: claude-haiku-4-5-20251001 — mechanical enrichment + quality scoring via web_search.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const HAIKU = 'claude-haiku-4-5-20251001'
const BATCH_SIZE = 20
const MAX_SEARCH_ITERATIONS = 5

const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as Anthropic.Tool

interface EnrichmentResult {
  icp_total_score: number
}

interface Prospect {
  id: string
  owner_name: string
  business_name: string
  phone: string | null
  vertical: string | null
  city: string | null
}

async function enrichProspect(prospect: Prospect): Promise<EnrichmentResult> {
  const locationLine = prospect.city ? `Location: ${prospect.city}` : ''
  const nicheLine = prospect.vertical ? `Industry/Niche: ${prospect.vertical}` : ''

  const prompt = [
    `Research the following business online and return a structured quality score.`,
    ``,
    `Business: ${prospect.business_name}`,
    `Contact: ${prospect.owner_name}`,
    locationLine,
    nicheLine,
    ``,
    `Search for this business online. Find:`,
    `1. Number of online reviews (Google, Trustpilot, Facebook, etc.)`,
    `2. How long they have been trading (founded/established year)`,
    `3. Whether they have a professional website`,
    `4. Whether they are a strong fit for a performance marketing agency`,
    `   (Ideal niches: trades, home services, medical/dental, professional services, local retail)`,
    ``,
    `Score quality 1–10 using these rules:`,
    `- Review count: 50+ reviews = +3, 10–49 = +2, 1–9 = +1, 0 = +0`,
    `- Trading history: 3+ years = +2, 1–3 years = +1, <1 year or unknown = +0`,
    `- Website quality: professional site = +2, basic/social-only = +1, none = +0`,
    `- Niche fit: ideal niche = +3, acceptable = +2, poor fit = +0`,
    ``,
    `Return ONLY valid JSON — no markdown, no explanation:`,
    `{"quality_score":<1-10>,"review_count":<number|null>,"trading_since":<"YYYY"|null>,"has_website":<true|false>,"niche_fit":<true|false>,"summary":"<one sentence>","sources":["<url>"]}`,
  ].filter(Boolean).join('\n')

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt },
  ]

  let finalText = ''

  for (let i = 0; i < MAX_SEARCH_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: HAIKU,
      max_tokens: 1024,
      tools: [WEB_SEARCH_TOOL],
      messages,
    })

    if (response.stop_reason === 'end_turn') {
      finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim()
      break
    }

    // Push assistant turn (includes web_search_tool_use + web_search_tool_result blocks)
    messages.push({ role: 'assistant', content: response.content })
  }

  const jsonMatch = finalText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON in enrichment response for ${prospect.business_name}`)

  const parsed = JSON.parse(jsonMatch[0])

  return {
    icp_total_score: Math.min(10, Math.max(1, Number(parsed.quality_score) || 1)),
  }
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

    // Webhook calls include { prospect_id } to process a single row immediately.
    // Cron / manual calls omit it and fall back to the full batch query.
    let webhookProspectId: string | null = null
    try {
      const body = await req.json()
      if (typeof body?.prospect_id === 'string') webhookProspectId = body.prospect_id
    } catch { /* no body */ }

    // Fetch new prospects
    let query = supabase
      .from('prospects')
      .select('id, owner_name, business_name, phone, vertical, city')
      .eq('status', 'new')
      .limit(BATCH_SIZE)

    if (webhookProspectId) query = query.eq('id', webhookProspectId)

    const { data: rawProspects, error: fetchError } = await query

    if (fetchError) throw new Error(`fetch prospects: ${fetchError.message}`)

    if (!rawProspects || rawProspects.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No new prospects to enrich', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── Deduplication within batch ───────────────────────────────────────────
    const seenPhones = new Set<string>()
    const seenCompanies = new Set<string>()
    const unique: Prospect[] = []
    const duplicateIds: string[] = []

    for (const p of rawProspects) {
      const phone = p.phone ? String(p.phone).replace(/\D/g, '') : null
      const company = p.business_name ? String(p.business_name).toLowerCase().trim() : null

      const isDuplicate =
        (phone && seenPhones.has(phone)) ||
        (company && seenCompanies.has(company))

      if (isDuplicate) {
        duplicateIds.push(p.id)
      } else {
        if (phone) seenPhones.add(phone)
        if (company) seenCompanies.add(company)
        unique.push(p as Prospect)
      }
    }

    if (duplicateIds.length > 0) {
      await supabase
        .from('prospects')
        .update({ status: 'duplicate' })
        .in('id', duplicateIds)
    }

    // ── Enrich unique prospects ──────────────────────────────────────────────
    let enriched = 0
    let low_quality = 0
    let errors = 0

    for (const prospect of unique) {
      try {
        const result = await enrichProspect(prospect)
        const newStatus = result.icp_total_score >= 5 ? 'enriched' : 'low_quality'

        await supabase
          .from('prospects')
          .update({
            icp_total_score: result.icp_total_score,
            status: newStatus,
          })
          .eq('id', prospect.id)

        if (newStatus === 'enriched') enriched++
        else low_quality++
      } catch {
        errors++
      }
    }

    const outputSummary =
      `${unique.length} processed — ${enriched} enriched, ${low_quality} low_quality, ` +
      `${duplicateIds.length} duplicates removed, ${errors} errors.`

    await supabase.from('ai_task_log').insert({
      sop_id: '03',
      sop_name: 'SOP 03 — Prospect Enrichment',
      tool_called: HAIKU,
      status: 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${rawProspects.length} new prospects`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({
        processed: unique.length,
        enriched,
        low_quality,
        duplicates_removed: duplicateIds.length,
        errors,
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
        sop_id: '03',
        sop_name: 'SOP 03 — Prospect Enrichment',
        tool_called: HAIKU,
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: 'new prospects batch',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
