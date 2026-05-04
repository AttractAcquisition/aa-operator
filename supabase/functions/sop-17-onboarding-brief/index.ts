// Model: claude-sonnet-4-6 — client onboarding brief generation on prospect close.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET = 'claude-sonnet-4-6'
const BATCH_LIMIT = 3
const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 days
const MAX_RESEARCH_ITERATIONS = 8

const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 6 } as Anthropic.Tool

// ── Tier definitions (mirrors sop-15 — used for budget allocation logic) ──────
const TIER_BUDGETS: Record<string, { ad_spend: number; channels: string[]; label: string }> = {
  proof_sprint: {
    ad_spend: 800,
    channels: ['Google Ads'],
    label: 'Proof Sprint',
  },
  proof_brand: {
    ad_spend: 1500,
    channels: ['Google Ads', 'Meta Ads'],
    label: 'Proof Brand',
  },
  authority_brand: {
    ad_spend: 3000,
    channels: ['Google Ads', 'Meta Ads', 'Remarketing'],
    label: 'Authority Brand',
  },
}

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

interface OfferContext {
  recommended_tier: string
  tier_label: string
  monthly_price: number
  minimum_months: number
  ad_spend_budget: number
  channels: string[]
}

interface CampaignResearch {
  top_keywords: string[]
  audience_demographics: string
  seasonal_patterns: string
  platform_recommendation: string
  competitor_ad_observations: string
  cpl_benchmark: string
  creative_themes: string[]
  research_notes: string
}

// ── Step 1: try to fetch offer/tier context from a prior approval_queue item ──
async function resolveOfferContext(
  prospectId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<OfferContext | null> {
  const { data } = await supabase
    .from('approval_queue')
    .select('content')
    .eq('content_type', 'offer_document')
    .eq('content_id', prospectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.content?.metadata) return null

  const meta = data.content.metadata as Record<string, unknown>
  const tier = (meta.recommended_tier as string) ?? null
  if (!tier) return null

  const budgetInfo = TIER_BUDGETS[tier] ?? TIER_BUDGETS.proof_sprint

  return {
    recommended_tier: tier,
    tier_label: budgetInfo.label,
    monthly_price: (meta.monthly_price as number) ?? 1497,
    minimum_months: (meta.minimum_months as number) ?? 3,
    ad_spend_budget: budgetInfo.ad_spend,
    channels: budgetInfo.channels,
  }
}

// ── Step 2: research ad strategy for this niche and location ──────────────────
async function researchCampaignStrategy(
  prospect: ProspectRow,
  offerCtx: OfferContext | null,
): Promise<CampaignResearch> {
  const niche = prospect.niche ?? 'local service business'
  const location = prospect.location ?? 'UK'
  const channels = offerCtx?.channels ?? ['Google Ads', 'Meta Ads']

  const schemaExample: CampaignResearch = {
    top_keywords: ['<high-intent keyword for this niche>', '<secondary keyword>'],
    audience_demographics: '<age range, homeowner/renter, income level, decision-maker profile>',
    seasonal_patterns: '<peak months, quiet periods, and how to handle them>',
    platform_recommendation: '<which platform to prioritise first and why for this niche>',
    competitor_ad_observations: '<what local competitors are advertising and any gaps>',
    cpl_benchmark: '<typical CPL range for this niche on the recommended platform>',
    creative_themes: ['<ad angle 1 that resonates with this audience>', '<ad angle 2>'],
    research_notes: '<any other campaign-relevant insight from research>',
  }

  const systemPrompt = [
    'You are a senior paid media strategist at Attract Acquisition, a UK performance',
    'marketing agency specialising in local service businesses.',
    '',
    `Your task: research the best ad campaign strategy for a ${niche} business in ${location}.`,
    `Channels in scope: ${channels.join(', ')}.`,
    '',
    'Research process:',
    `  1. Search for "${niche} advertising strategy UK" and similar queries to find`,
    '     what ad formats and platforms work best for this niche.',
    `  2. Search "${niche} ${location} ads" or similar to observe competitor ad activity.`,
    '  3. Research the typical target audience: who books or buys from this type of business.',
    '  4. Look up any seasonality data relevant to this niche.',
    '',
    'Return ONLY valid JSON matching this exact schema — no markdown fences:',
    JSON.stringify(schemaExample),
  ].join('\n')

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Research campaign strategy for: ${prospect.company}`,
        `Niche: ${niche}`,
        `Location: ${location}`,
        `Channels: ${channels.join(', ')}`,
        prospect.enrichment_data?.review_count != null
          ? `Current review count: ${prospect.enrichment_data.review_count}`
          : null,
        prospect.enrichment_data?.has_website != null
          ? `Has website: ${prospect.enrichment_data.has_website}`
          : null,
        prospect.enrichment_data?.summary
          ? `Business summary: ${prospect.enrichment_data.summary}`
          : null,
      ].filter(Boolean).join('\n'),
    },
  ]

  let finalText = ''

  for (let i = 0; i < MAX_RESEARCH_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: SONNET,
      max_tokens: 2048,
      system: systemPrompt,
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
  if (!jsonMatch) throw new Error(`No JSON in campaign research for ${prospect.company}`)

  return JSON.parse(jsonMatch[0]) as CampaignResearch
}

// ── Step 3: generate the onboarding brief HTML document ───────────────────────
async function generateOnboardingBrief(
  prospect: ProspectRow,
  offerCtx: OfferContext | null,
  research: CampaignResearch,
): Promise<string> {
  const niche = prospect.niche ?? 'local service business'
  const location = prospect.location ?? 'UK'
  const today = new Date().toISOString().slice(0, 10)

  // Build the 14-day action plan scaffold so Claude fills in niche-specific details
  const actionPlanScaffold = [
    'Days 1–2:   Discovery & account access (ad accounts, analytics, website, tracking)',
    'Days 3–4:   Keyword research, audience build, competitor audit',
    'Days 5–6:   Campaign structure design, ad copy drafting, creative brief',
    'Days 7–8:   Landing page review / recommendations, tracking pixel install',
    'Days 9–10:  Campaign build in ad platform(s), quality assurance review',
    'Days 11–12: Soft launch — limited budget, monitor for conversion tracking issues',
    'Days 13–14: Full launch, baseline metrics established, first optimisation pass',
  ].join('\n')

  const tier = offerCtx?.tier_label ?? 'Proof Sprint'
  const adSpend = offerCtx?.ad_spend_budget ?? 800
  const channels = offerCtx?.channels ?? ['Google Ads']
  const monthlyFee = offerCtx?.monthly_price ?? 1497

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 16000,
    system: [
      'You are a senior campaign strategist at Attract Acquisition, a UK performance',
      'marketing agency. You are writing an internal client onboarding brief for the',
      'delivery team — this is an operational document, not a client-facing sales piece.',
      '',
      'Generate a complete, self-contained HTML onboarding brief.',
      '',
      'Document requirements:',
      '  — Clean, professional HTML with embedded CSS.',
      '  — Agency brand colours: dark navy (#0F1B2D) and electric blue (#2563EB).',
      '  — Sections (in order):',
      '      1. Header: "Client Onboarding Brief" — company, niche, location, date.',
      '      2. Client Snapshot: package tier, monthly fee, ad spend budget, channels,',
      '         contract length, estimated start date (today + 3 working days).',
      '      3. Campaign Strategy: objectives, campaign types, funnel structure,',
      '         conversion goals, and platform rationale.',
      '      4. Target Audience: primary and secondary audience profiles,',
      '         geographic targeting radius, device preference, intent signals.',
      '      5. Ad Creative Direction: 3 headline angles with example copy,',
      '         image/video style guidance, tone of voice, key USPs to lead with.',
      '      6. Budget Allocation: table showing channel, campaign type,',
      '         monthly spend allocation (£), and primary KPI per channel.',
      '      7. First 14-Day Action Plan: detailed task list with day ranges,',
      '         task owner (Agency / Client), and expected output.',
      '      8. Success Metrics: primary KPIs with targets for month 1 and month 3.',
      '      9. Client Inputs Needed: checklist of assets / access the client',
      '         must provide before launch.',
      '  — Tone: operational, specific, actionable. Written for the internal team.',
      '  — Output ONLY the complete HTML — no markdown fences, no commentary.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          'Generate the onboarding brief for this new client.',
          '',
          'CLIENT:',
          JSON.stringify({
            name: prospect.name,
            company: prospect.company,
            niche,
            location,
            quality_score: prospect.quality_score,
            review_count: prospect.enrichment_data?.review_count ?? null,
            trading_since: prospect.enrichment_data?.trading_since ?? null,
            has_website: prospect.enrichment_data?.has_website ?? null,
            business_summary: prospect.enrichment_data?.summary ?? null,
          }, null, 2),
          '',
          'SOLD PACKAGE:',
          JSON.stringify({
            tier,
            monthly_management_fee: `£${monthlyFee.toLocaleString()}`,
            monthly_ad_spend_budget: `£${adSpend.toLocaleString()}`,
            channels,
            minimum_months: offerCtx?.minimum_months ?? 3,
            brief_date: today,
          }, null, 2),
          '',
          'CAMPAIGN RESEARCH:',
          JSON.stringify(research, null, 2),
          '',
          '14-DAY ACTION PLAN SCAFFOLD (fill in niche-specific detail):',
          actionPlanScaffold,
          '',
          'Generate the complete onboarding brief HTML now.',
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

    // Support optional webhook body { prospect_id } for single-prospect trigger
    let webhookProspectId: string | null = null
    try {
      const body = await req.json()
      if (typeof body?.prospect_id === 'string') webhookProspectId = body.prospect_id
    } catch { /* no body or non-JSON */ }

    // ── 1. Fetch closed prospects ─────────────────────────────────────────────
    let query = supabase
      .from('prospects')
      .select('id, name, company, phone, niche, location, quality_score, enrichment_data')
      .eq('status', 'closed')
      .order('quality_score', { ascending: false })
      .limit(BATCH_LIMIT)

    if (webhookProspectId) query = query.eq('id', webhookProspectId)

    const { data: rawProspects, error: fetchError } = await query

    if (fetchError) throw new Error(`fetch prospects: ${fetchError.message}`)

    const prospects = (rawProspects ?? []) as ProspectRow[]

    if (prospects.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No closed prospects found', briefed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Process each prospect ──────────────────────────────────────────────
    const briefed: Array<{
      prospect_id: string
      company: string
      tier: string
      storage_path: string
      signed_url: string
      approval_id: string
    }> = []
    let errors = 0

    for (const prospect of prospects) {
      try {
        // 2a. Retrieve offer context from prior approval_queue item (best-effort)
        const offerCtx = await resolveOfferContext(prospect.id, supabase)

        // 2b. Research campaign strategy for this niche + location
        const research = await researchCampaignStrategy(prospect, offerCtx)

        // 2c. Generate the full onboarding brief HTML
        const html = await generateOnboardingBrief(prospect, offerCtx, research)
        if (!html || html.length < 200) {
          throw new Error('Generated onboarding brief HTML is too short — generation may have failed')
        }

        // 2d. Upload to Supabase Storage
        const storagePath = `onboarding/${prospect.id}.html`

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, html, { contentType: 'text/html', upsert: true })

        if (uploadError) throw new Error(`storage upload: ${uploadError.message}`)

        // 2e. Create 7-day signed URL
        const { data: signedData, error: signError } = await supabase.storage
          .from('documents')
          .createSignedUrl(storagePath, SIGNED_URL_TTL)

        if (signError || !signedData?.signedUrl) {
          throw new Error(`signed URL: ${signError?.message ?? 'no URL returned'}`)
        }

        const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString()
        const batchDate = new Date().toISOString().slice(0, 10)
        const tierLabel = offerCtx?.tier_label ?? 'Proof Sprint'

        // 2f. Create approval_queue item
        const { data: approvalRow, error: approvalError } = await supabase
          .from('approval_queue')
          .insert({
            sop_id: '17',
            sop_name: 'SOP 17 — Onboarding Brief',
            status: 'pending',
            priority: 'high',
            content_type: 'client_report',
            content_id: prospect.id,
            content: {
              title: `Onboarding Brief — ${prospect.company} — ${tierLabel} — ${batchDate}`,
              body: `Client onboarding brief for ${prospect.company} (${prospect.location ?? 'UK'}). ` +
                `Package: ${tierLabel}. Channels: ${(offerCtx?.channels ?? ['Google Ads']).join(', ')}.`,
              recipient: prospect.name,
              signed_url: signedData.signedUrl,
              storage_path: storagePath,
              metadata: {
                prospect_id: prospect.id,
                company: prospect.company,
                niche: prospect.niche,
                location: prospect.location,
                quality_score: prospect.quality_score,
                tier: offerCtx?.recommended_tier ?? null,
                tier_label: tierLabel,
                monthly_fee: offerCtx?.monthly_price ?? null,
                ad_spend_budget: offerCtx?.ad_spend_budget ?? null,
                channels: offerCtx?.channels ?? null,
                platform_recommendation: research.platform_recommendation,
                cpl_benchmark: research.cpl_benchmark,
                expires_at: expiresAt,
              },
            },
          })
          .select('id')
          .single()

        if (approvalError) throw new Error(`create approval item: ${approvalError.message}`)

        // 2g. Advance prospect status
        await supabase
          .from('prospects')
          .update({ status: 'onboarding_briefed' })
          .eq('id', prospect.id)

        briefed.push({
          prospect_id: prospect.id,
          company: prospect.company,
          tier: tierLabel,
          storage_path: storagePath,
          signed_url: signedData.signedUrl,
          approval_id: approvalRow?.id,
        })
      } catch (prospectErr) {
        console.error(
          `Onboarding brief error for ${prospect.company} (${prospect.id}):`,
          prospectErr instanceof Error ? prospectErr.message : String(prospectErr),
        )
        errors++
      }
    }

    // ── 3. Audit log ──────────────────────────────────────────────────────────
    const allFailed = errors > 0 && briefed.length === 0

    await supabase.from('ai_task_log').insert({
      sop_id: '17',
      sop_name: 'SOP 17 — Onboarding Brief',
      tool_called: SONNET,
      status: allFailed ? 'failure' : 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${prospects.length} closed prospects`,
      output_summary: `${briefed.length} onboarding briefs generated and queued, ${errors} errors`,
    })

    return new Response(
      JSON.stringify({ briefed: briefed.length, errors, documents: briefed }),
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
        sop_id: '17',
        sop_name: 'SOP 17 — Onboarding Brief',
        tool_called: SONNET,
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: 'closed prospects',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
