// Model: claude-sonnet-4-6 — SPOA document generation with web research + template fill.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET = 'claude-sonnet-4-6'
const BATCH_LIMIT = 3
const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 days

const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as Anthropic.Tool

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

interface BusinessProfile {
  website_url: string | null
  google_rating: number | null
  review_count: number | null
  social_media: string[]
  strengths: string[]
  weaknesses: string[]
  online_presence_score: 'weak' | 'moderate' | 'strong'
  profile_summary: string
  sources: string[]
}

// ── Phase 1: research the prospect's local market and competitors ──────────────
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
        `4. 2–4 named local competitors visible online`,
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

  return {
    competitor_count: null,
    avg_competitor_reviews: null,
    market_demand: 'medium',
    key_competitors: [],
    local_insights: `Detailed competitor data for ${niche} businesses in ${location} was not available online.`,
    sources: [],
  }
}

// ── Phase 2: research the prospect's own business profile online ──────────────
async function researchBusinessProfile(prospect: ProspectRow): Promise<BusinessProfile> {
  const niche = prospect.niche ?? 'local service business'
  const location = prospect.location ?? 'UK'

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Research the online presence and business profile of "${prospect.company}", a ${niche} in ${location}.`,
        ``,
        `Find:`,
        `1. Their website URL (if any)`,
        `2. Google Business rating and review count`,
        `3. Active social media profiles (Facebook, Instagram, TikTok, etc.)`,
        `4. 2–3 business strengths visible from their online presence`,
        `5. 2–3 gaps or weaknesses in their online presence`,
        `6. Overall online presence score: weak (no reviews, no website), moderate (basic presence), or strong (active, rated)`,
        ``,
        `Return ONLY valid JSON — no markdown:`,
        `{"website_url":<string|null>,"google_rating":<number|null>,"review_count":<number|null>,` +
        `"social_media":["<platform: url>"],"strengths":["<text>"],"weaknesses":["<text>"],` +
        `"online_presence_score":"<weak|moderate|strong>","profile_summary":"<2-3 sentences>","sources":["<url>"]}`,
      ].join('\n'),
    },
  ]

  let finalText = ''
  for (let i = 0; i < 7; i++) {
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

  const jsonMatch = finalText.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as BusinessProfile
    } catch { /* fall through to default */ }
  }

  return {
    website_url: null,
    google_rating: null,
    review_count: null,
    social_media: [],
    strengths: [],
    weaknesses: ['Online presence data not publicly available'],
    online_presence_score: 'weak',
    profile_summary: `Online profile data for ${prospect.company} could not be retrieved.`,
    sources: [],
  }
}

// ── Phase 3: fill the HTML template with all research data ───────────────────
async function fillTemplate(
  template: string,
  prospect: ProspectRow,
  market: MarketResearch,
  profile: BusinessProfile,
): Promise<string> {
  const ed = prospect.enrichment_data

  const prospectJson = JSON.stringify({
    name: prospect.name,
    first_name: prospect.name.split(' ')[0],
    company: prospect.company,
    niche: prospect.niche ?? 'local service business',
    location: prospect.location ?? 'UK',
    quality_score: prospect.quality_score,
    review_count: ed?.review_count ?? profile.review_count ?? null,
    trading_since: ed?.trading_since ?? null,
    has_website: ed?.has_website ?? (profile.website_url !== null),
    business_summary: ed?.summary ?? profile.profile_summary ?? null,
  }, null, 2)

  const marketJson = JSON.stringify(market, null, 2)
  const profileJson = JSON.stringify(profile, null, 2)

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 16000,
    system: [
      'You are an expert strategic document writer for Attract Acquisition,',
      'a performance marketing agency that helps local service businesses win more clients.',
      '',
      'Task: fill every placeholder in the HTML SPOA template with real, prospect-specific data',
      'to produce a complete, personalised Strategic Plan of Action document.',
      '',
      'Rules:',
      '  1. Replace ALL {{placeholder}} tokens using the provided prospect, market, and profile data.',
      '  2. Where live data is missing, write a professional, plausible default.',
      '  3. Do not change any HTML tags, class names, CSS, or document structure.',
      '  4. Quantify opportunity where possible: review gap vs competitors, market demand,',
      '     current weaknesses vs growth potential.',
      '  5. Make the strategic recommendations specific to their niche, location, and gaps.',
      '  6. Tone: authoritative, data-driven, empathetic — not salesy.',
      '  7. Output ONLY the complete, filled HTML document — no markdown fences, no commentary.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          'PROSPECT DATA:',
          prospectJson,
          '',
          'LOCAL MARKET RESEARCH:',
          marketJson,
          '',
          'BUSINESS PROFILE RESEARCH:',
          profileJson,
          '',
          'TEMPLATE (fill every placeholder and return the complete HTML):',
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

    // ── 1. Fetch SPOA template from knowledge_base ────────────────────────────
    const { data: templateRow, error: templateError } = await supabase
      .from('knowledge_base')
      .select('content, title')
      .eq('type', 'template')
      .contains('tags', ['spoa_template'])
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (templateError) throw new Error(`knowledge_base query: ${templateError.message}`)
    if (!templateRow) throw new Error('SPOA template not found — seed knowledge_base with type=template, tags=[spoa_template]')

    const template: string = templateRow.content

    // ── 2. Fetch spoa_ready prospects ─────────────────────────────────────────
    const { data: rawProspects, error: fetchError } = await supabase
      .from('prospects')
      .select('id, name, company, phone, niche, location, quality_score, enrichment_data')
      .eq('status', 'spoa_ready')
      .order('quality_score', { ascending: false })
      .limit(BATCH_LIMIT)

    if (fetchError) throw new Error(`fetch prospects: ${fetchError.message}`)

    const prospects = (rawProspects ?? []) as ProspectRow[]

    if (prospects.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No spoa_ready prospects found', built: 0 }),
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
      online_presence_score: string
    }> = []
    let errors = 0

    for (const prospect of prospects) {
      try {
        // 3a. Research local market + competitors
        const market = await researchMarket(prospect)

        // 3b. Research the prospect's own business profile
        const profile = await researchBusinessProfile(prospect)

        // 3c. Generate personalised SPOA HTML
        const html = await fillTemplate(template, prospect, market, profile)
        if (!html || html.length < 100) throw new Error('Generated HTML is too short — template fill may have failed')

        // 3d. Upload to Supabase Storage
        const storagePath = `spoa/${prospect.id}.html`

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, html, {
            contentType: 'text/html',
            upsert: true,
          })

        if (uploadError) throw new Error(`storage upload: ${uploadError.message}`)

        // 3e. Create signed URL valid for 7 days
        const { data: signedData, error: signError } = await supabase.storage
          .from('documents')
          .createSignedUrl(storagePath, SIGNED_URL_TTL)

        if (signError || !signedData?.signedUrl) {
          throw new Error(`signed URL: ${signError?.message ?? 'no URL returned'}`)
        }

        const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString()
        const batchDate = new Date().toISOString().slice(0, 10)

        // 3f. Create approval_queue item (always high priority for SPOA)
        const { data: approvalRow, error: approvalError } = await supabase
          .from('approval_queue')
          .insert({
            sop_id: '12',
            sop_name: 'SOP 12 — SPOA Build',
            status: 'pending',
            priority: 'high',
            content_type: 'spoa_document',
            content_id: prospect.id,
            content: {
              title: `SPOA — ${prospect.company} — ${batchDate}`,
              body: `Strategic Plan of Action ready for ${prospect.company} (${prospect.location ?? 'UK'}).`,
              recipient: prospect.name,
              signed_url: signedData.signedUrl,
              storage_path: storagePath,
              metadata: {
                prospect_id: prospect.id,
                company: prospect.company,
                niche: prospect.niche,
                location: prospect.location,
                quality_score: prospect.quality_score,
                competitor_count: market.competitor_count,
                avg_competitor_reviews: market.avg_competitor_reviews,
                market_demand: market.market_demand,
                online_presence_score: profile.online_presence_score,
                google_rating: profile.google_rating,
                review_count: profile.review_count,
                website_url: profile.website_url,
                expires_at: expiresAt,
              },
            },
          })
          .select('id')
          .single()

        if (approvalError) throw new Error(`create approval item: ${approvalError.message}`)

        // 3g. Advance prospect status
        await supabase
          .from('prospects')
          .update({ status: 'spoa_built' })
          .eq('id', prospect.id)

        built.push({
          prospect_id: prospect.id,
          company: prospect.company,
          storage_path: storagePath,
          signed_url: signedData.signedUrl,
          approval_id: approvalRow?.id,
          market_demand: market.market_demand,
          online_presence_score: profile.online_presence_score,
        })
      } catch (prospectErr) {
        console.error(
          `SPOA error for ${prospect.company} (${prospect.id}):`,
          prospectErr instanceof Error ? prospectErr.message : String(prospectErr),
        )
        errors++
      }
    }

    // ── 4. Audit log ──────────────────────────────────────────────────────────
    const allFailed = errors > 0 && built.length === 0

    await supabase.from('ai_task_log').insert({
      sop_id: '12',
      sop_name: 'SOP 12 — SPOA Build',
      tool_called: SONNET,
      status: allFailed ? 'failure' : 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${prospects.length} spoa_ready prospects`,
      output_summary: `${built.length} SPOAs built and queued for approval, ${errors} errors`,
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
        sop_id: '12',
        sop_name: 'SOP 12 — SPOA Build',
        tool_called: SONNET,
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: 'spoa_ready prospects',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
