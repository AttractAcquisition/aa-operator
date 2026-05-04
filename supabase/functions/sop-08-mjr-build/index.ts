// Model: claude-sonnet-4-6 — MJR document generation with web research + template fill.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET = 'claude-sonnet-4-6'
const BATCH_LIMIT = 3
const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 days

// deno-lint-ignore no-explicit-any
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 4 } as any

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

interface MarketResearch {
  competitor_count: number | null
  avg_competitor_reviews: number | null
  market_demand: 'low' | 'medium' | 'high'
  key_competitors: string[]
  local_insights: string
  sources: string[]
}

// ── Phase 1: research the prospect's local market via web_search ──────────────
async function researchMarket(prospect: ProspectRow): Promise<MarketResearch> {
  const niche = prospect.niche ?? 'local service business'
  const location = prospect.location ?? 'UK'

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Research the local market for a ${niche} business in ${location}.`,
        `Business: ${prospect.company}`,
        ``,
        `Find:`,
        `1. Approximate number of competing ${niche} businesses in ${location}`,
        `2. Average Google review count for local competitors`,
        `3. Overall market demand signals (busy, growing, saturated, seasonal)`,
        `4. 2–4 named local competitors if visible online`,
        ``,
        `Return ONLY valid JSON — no markdown:`,
        `{"competitor_count":<number|null>,"avg_competitor_reviews":<number|null>,` +
        `"market_demand":"<low|medium|high>","key_competitors":["<name>"],` +
        `"local_insights":"<2-3 sentences>","sources":["<url>"]}`,
      ].join('\n'),
    },
  ]

  let finalText = ''
  for (let i = 0; i < 6; i++) {
    const response = await anthropic.messages.create({
      model: SONNET,
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

    messages.push({ role: 'assistant', content: response.content })
  }

  const jsonMatch = finalText.match(/\{[\s\S]*?\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as MarketResearch
    } catch { /* fall through to default */ }
  }

  // Graceful fallback so one bad search doesn't block document generation
  return {
    competitor_count: null,
    avg_competitor_reviews: null,
    market_demand: 'medium',
    key_competitors: [],
    local_insights: `Detailed competitor data for ${niche} businesses in ${location} was not available online.`,
    sources: [],
  }
}

// ── Phase 2: fill the HTML template with prospect + research data ─────────────
async function fillTemplate(
  template: string,
  prospect: ProspectRow,
  research: MarketResearch,
): Promise<string> {
  const ed = prospect.enrichment_data

  const prospectJson = JSON.stringify({
    name: prospect.name,
    first_name: prospect.name.split(' ')[0],
    company: prospect.company,
    niche: prospect.niche ?? 'local service business',
    location: prospect.location ?? 'UK',
    quality_score: prospect.quality_score,
    review_count: ed?.review_count ?? null,
    trading_since: ed?.trading_since ?? null,
    has_website: ed?.has_website ?? null,
    business_summary: ed?.summary ?? null,
  }, null, 2)

  const researchJson = JSON.stringify(research, null, 2)

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 16000,
    system: [
      'You are an expert HTML document personaliser for Attract Acquisition,',
      'a performance marketing agency that helps local service businesses win more clients.',
      '',
      'Task: fill every placeholder in the HTML template with real, prospect-specific data.',
      '',
      'Rules:',
      '  1. Replace ALL {{placeholder}} tokens using the provided prospect and market data.',
      '  2. Where data is missing, write a professional, plausible default.',
      '  3. Do not change any HTML tags, class names, CSS, or document structure.',
      '  4. Quantify missed opportunity where possible (competitor count, review gap, etc.).',
      '  5. Tone: direct, data-driven, empathetic — not salesy.',
      '  6. Output ONLY the complete, filled HTML document — no markdown fences, no commentary.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          'PROSPECT DATA:',
          prospectJson,
          '',
          'MARKET RESEARCH:',
          researchJson,
          '',
          'TEMPLATE (fill and return as complete HTML):',
          template,
        ].join('\n'),
      },
    ],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  // Strip accidental markdown code fences
  return raw.replace(/^```html?\n?/i, '').replace(/\n?```\s*$/, '').trim()
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

    // ── 1. Fetch MJR template from knowledge_base ─────────────────────────────
    // Stored with type='template' and tags containing 'mjr_template'
    const { data: templateRow, error: templateError } = await supabase
      .from('knowledge_base')
      .select('content, title')
      .eq('type', 'template')
      .contains('tags', ['mjr_template'])
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (templateError) throw new Error(`knowledge_base query: ${templateError.message}`)
    if (!templateRow) throw new Error('MJR template not found — seed knowledge_base with type=template, tags=[mjr_template]')

    const template: string = templateRow.content

    // ── 2. Fetch mjr_ready prospects ──────────────────────────────────────────
    const { data: rawProspects, error: fetchError } = await supabase
      .from('prospects')
      .select('id, name, company, phone, niche, location, quality_score, enrichment_data')
      .eq('status', 'mjr_ready')
      .order('quality_score', { ascending: false })
      .limit(BATCH_LIMIT)

    if (fetchError) throw new Error(`fetch prospects: ${fetchError.message}`)

    const prospects = (rawProspects ?? []) as ProspectRow[]

    if (prospects.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No mjr_ready prospects found', built: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 3. Process each prospect sequentially ─────────────────────────────────
    const built: Array<{
      prospect_id: string
      company: string
      storage_path: string
      signed_url: string
      approval_id: string
      market_demand: string
    }> = []
    let errors = 0

    for (const prospect of prospects) {
      try {
        // 3a. Research local market
        const research = await researchMarket(prospect)

        // 3b. Generate personalised HTML
        const html = await fillTemplate(template, prospect, research)
        if (!html || html.length < 100) throw new Error('Generated HTML is too short — template fill may have failed')

        // 3c. Upload to Supabase Storage
        const storagePath = `mjr/${prospect.id}.html`

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, html, {
            contentType: 'text/html',
            upsert: true,
          })

        if (uploadError) throw new Error(`storage upload: ${uploadError.message}`)

        // 3d. Create signed URL valid for 7 days
        const { data: signedData, error: signError } = await supabase.storage
          .from('documents')
          .createSignedUrl(storagePath, SIGNED_URL_TTL)

        if (signError || !signedData?.signedUrl) {
          throw new Error(`signed URL: ${signError?.message ?? 'no URL returned'}`)
        }

        const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString()

        // 3e. Create approval_queue item
        const batchDate = new Date().toISOString().slice(0, 10)

        const { data: approvalRow, error: approvalError } = await supabase
          .from('approval_queue')
          .insert({
            sop_id: '08',
            sop_name: 'SOP 08 — MJR Build',
            status: 'pending',
            priority: prospect.quality_score >= 8 ? 'high' : 'medium',
            content_type: 'mjr_document',
            content_id: prospect.id,
            content: {
              title: `MJR — ${prospect.company} — ${batchDate}`,
              body: `Missed Jobs Report ready for ${prospect.company} (${prospect.location ?? 'UK'}).`,
              recipient: prospect.name,
              signed_url: signedData.signedUrl,
              storage_path: storagePath,
              metadata: {
                prospect_id: prospect.id,
                company: prospect.company,
                niche: prospect.niche,
                location: prospect.location,
                quality_score: prospect.quality_score,
                competitor_count: research.competitor_count,
                avg_competitor_reviews: research.avg_competitor_reviews,
                market_demand: research.market_demand,
                expires_at: expiresAt,
              },
            },
          })
          .select('id')
          .single()

        if (approvalError) throw new Error(`create approval item: ${approvalError.message}`)

        // 3f. Update prospect status
        await supabase
          .from('prospects')
          .update({ status: 'mjr_built' })
          .eq('id', prospect.id)

        built.push({
          prospect_id: prospect.id,
          company: prospect.company,
          storage_path: storagePath,
          signed_url: signedData.signedUrl,
          approval_id: approvalRow?.id,
          market_demand: research.market_demand,
        })
      } catch (prospectErr) {
        console.error(
          `MJR error for ${prospect.company} (${prospect.id}):`,
          prospectErr instanceof Error ? prospectErr.message : String(prospectErr),
        )
        errors++
      }
    }

    // ── 4. Audit log ──────────────────────────────────────────────────────────
    const allFailed = errors > 0 && built.length === 0

    await supabase.from('ai_task_log').insert({
      sop_id: '08',
      sop_name: 'SOP 08 — MJR Build',
      tool_called: SONNET,
      status: allFailed ? 'failure' : 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${prospects.length} mjr_ready prospects`,
      output_summary: `${built.length} MJRs built and queued for approval, ${errors} errors`,
    })

    return new Response(
      JSON.stringify({ built: built.length, errors, documents: built }),
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
        sop_id: '08',
        sop_name: 'SOP 08 — MJR Build',
        tool_called: SONNET,
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: 'mjr_ready prospects',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
