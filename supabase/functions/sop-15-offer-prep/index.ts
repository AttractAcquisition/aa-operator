// Model: claude-sonnet-4-6 — offer document + call prep summary generation for call_booked prospects.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET = 'claude-sonnet-4-6'
const BATCH_LIMIT = 3
const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 days
const MAX_RESEARCH_ITERATIONS = 8

const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as Anthropic.Tool

// ── Product tier definitions ──────────────────────────────────────────────────
// These are embedded in prompts so Claude can reason about tier fit and pricing.
const TIER_CONTEXT = `
PRODUCT TIERS — Attract Acquisition:

1. Proof Sprint — £1,497/month (3-month minimum, ~£4,500 total commitment)
   Target: sole traders and small businesses (1–5 staff) new to paid advertising,
   limited budget, or testing a new market. Single ad channel (Google OR Meta).
   Deliverable: consistent qualified leads within 90 days or a full audit of why not.
   Ideal signals: no current ads, <50 Google reviews, trading <5 years, tight budget.

2. Proof Brand — £2,497/month (6-month minimum, ~£15,000 total commitment)
   Target: established small-to-medium businesses (5–20 staff) with some ad history,
   wanting a reliable lead pipeline and brand-building alongside lead gen.
   Dual channel (Google + Meta) + landing page optimisation.
   Ideal signals: 50–200 Google reviews, existing website, has tried ads before,
   seasonal business wanting year-round consistency.

3. Authority Brand — £3,997/month (12-month minimum, ~£48,000 total commitment)
   Target: growth-focused businesses (20+ staff or £500k+ revenue) wanting to dominate
   their local market. Full-stack: Google, Meta, remarketing, content, reputation.
   Ideal signals: 200+ reviews, strong brand, competitive niche, expansion goals,
   multiple locations or services, willing to invest for dominance.
`.trim()

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

type ProductTier = 'proof_sprint' | 'proof_brand' | 'authority_brand'

interface TierAssessment {
  recommended_tier: ProductTier
  tier_rationale: string
  monthly_price: number
  minimum_months: number
  total_commitment: number
  expected_leads_per_month: string
  expected_cpl: string
  roi_projection: string
  key_differentiators: string[]
  business_size_estimate: string
  growth_signals: string[]
  research_summary: string
}

// ── Phase 1: research the business and assess which tier fits ─────────────────
async function researchAndAssessTier(prospect: ProspectRow): Promise<TierAssessment> {
  const ed = prospect.enrichment_data
  const niche = prospect.niche ?? 'local service business'
  const location = prospect.location ?? 'UK'

  const schemaExample: TierAssessment = {
    recommended_tier: 'proof_sprint',
    tier_rationale: '<why this tier fits this specific business>',
    monthly_price: 1497,
    minimum_months: 3,
    total_commitment: 4491,
    expected_leads_per_month: '<e.g. 15–25 qualified enquiries>',
    expected_cpl: '<e.g. £35–60>',
    roi_projection: '<e.g. If each job is worth £800 and you close 30%, 5 closed jobs = £4,000 revenue vs £1,497 spend>',
    key_differentiators: ['<what makes this offer compelling for this prospect>'],
    business_size_estimate: '<sole trader | small (1–5) | medium (6–20) | larger>',
    growth_signals: ['<positive signal found in research>'],
    research_summary: '<2–3 sentences summarising what you found about the business>',
  }

  const systemPrompt = [
    'You are a senior strategist at Attract Acquisition, a UK performance marketing agency.',
    'Your task: research a prospect\'s business online, then recommend the right product tier.',
    '',
    TIER_CONTEXT,
    '',
    'Research process:',
    '  1. Search for the business by name + location to find their website, Google Business',
    '     listing, review count and rating, social media, and any press or directory listings.',
    '  2. Search their niche + location to gauge market competition and demand.',
    '  3. Infer business size from reviews, staff mentions, job volume, website quality.',
    '  4. Choose the tier that best fits their size, budget signals, and growth potential.',
    '',
    'ROI projection rules:',
    '  — Use a realistic CPL for their niche (trades: £40–80, medical/dental: £60–120,',
    '    professional services: £80–150).',
    '  — Estimate leads per month based on the tier\'s ad spend allowance.',
    '  — State the revenue per closed job for their niche as a round figure.',
    '  — Project minimum viable ROI at a 25–30% close rate.',
    '',
    'Return ONLY valid JSON matching this exact schema — no markdown fences:',
    JSON.stringify(schemaExample),
  ].join('\n')

  const userContent = [
    `Research this prospect and recommend a product tier:`,
    ``,
    `Name: ${prospect.name}`,
    `Company: ${prospect.company}`,
    `Niche: ${niche}`,
    `Location: ${location}`,
    `Quality score: ${prospect.quality_score}/10`,
    ed?.review_count != null ? `Known review count: ${ed.review_count}` : null,
    ed?.trading_since ? `Trading since: ${ed.trading_since}` : null,
    ed?.has_website != null ? `Has website: ${ed.has_website}` : null,
    ed?.summary ? `Enrichment summary: ${ed.summary}` : null,
  ].filter(Boolean).join('\n')

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userContent },
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
  if (!jsonMatch) throw new Error(`No JSON in tier assessment for ${prospect.company}`)

  return JSON.parse(jsonMatch[0]) as TierAssessment
}

// ── Phase 2: generate the personalised offer document HTML ────────────────────
async function generateOfferDocument(
  prospect: ProspectRow,
  assessment: TierAssessment,
): Promise<string> {
  const tierLabels: Record<ProductTier, string> = {
    proof_sprint: 'Proof Sprint',
    proof_brand: 'Proof Brand',
    authority_brand: 'Authority Brand',
  }

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 16000,
    system: [
      'You are a senior copywriter and strategist at Attract Acquisition.',
      'Generate a complete, self-contained HTML offer document for a prospect.',
      '',
      'Document requirements:',
      '  — A clean, professional single-page HTML file with embedded CSS.',
      '  — Agency brand colours: dark navy (#0F1B2D) and electric blue (#2563EB).',
      '  — Sections (in order):',
      '      1. Header: "Your Growth Plan" — prospect company name, date, tier badge.',
      '      2. Executive Summary: 2–3 sentences on the opportunity and what we\'re proposing.',
      '      3. Your Situation: business size, current position, key gap vs competitors.',
      '      4. Recommended Package: tier name, price, minimum commitment, what\'s included.',
      '      5. Expected Results: leads/month, CPL range, ROI projection table.',
      '      6. How It Works: 3-step process (Audit → Launch → Optimise).',
      '      7. Why Attract Acquisition: 3 proof points relevant to their niche.',
      '      8. Investment Summary: clear price box with monthly and total figures.',
      '      9. Next Steps: two CTA sentences for the call.',
      '  — Tone: confident, specific, peer-to-peer. No fluff. Numbers where possible.',
      '  — Output ONLY the complete HTML — no markdown fences, no commentary.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          'Generate the offer document for this prospect.',
          '',
          'PROSPECT:',
          JSON.stringify({
            name: prospect.name,
            first_name: prospect.name.split(' ')[0],
            company: prospect.company,
            niche: prospect.niche ?? 'local service business',
            location: prospect.location ?? 'UK',
            quality_score: prospect.quality_score,
            review_count: prospect.enrichment_data?.review_count ?? null,
            trading_since: prospect.enrichment_data?.trading_since ?? null,
            has_website: prospect.enrichment_data?.has_website ?? null,
          }, null, 2),
          '',
          'TIER ASSESSMENT:',
          JSON.stringify({
            recommended_tier: tierLabels[assessment.recommended_tier],
            tier_rationale: assessment.tier_rationale,
            monthly_price: `£${assessment.monthly_price.toLocaleString()}`,
            minimum_months: assessment.minimum_months,
            total_commitment: `£${assessment.total_commitment.toLocaleString()}`,
            expected_leads_per_month: assessment.expected_leads_per_month,
            expected_cpl: assessment.expected_cpl,
            roi_projection: assessment.roi_projection,
            key_differentiators: assessment.key_differentiators,
            business_size_estimate: assessment.business_size_estimate,
            growth_signals: assessment.growth_signals,
            research_summary: assessment.research_summary,
          }, null, 2),
          '',
          'Generate the complete HTML offer document now.',
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

// ── Phase 3: generate the one-page call prep summary HTML ─────────────────────
async function generateCallPrepSummary(
  prospect: ProspectRow,
  assessment: TierAssessment,
): Promise<string> {
  const tierLabels: Record<ProductTier, string> = {
    proof_sprint: 'Proof Sprint',
    proof_brand: 'Proof Brand',
    authority_brand: 'Authority Brand',
  }

  const response = await anthropic.messages.create({
    model: SONNET,
    max_tokens: 8000,
    system: [
      'You are a senior strategist at Attract Acquisition preparing a sales call.',
      'Generate a compact, one-page HTML call prep cheat sheet for the salesperson.',
      '',
      'Document requirements:',
      '  — Clean, print-friendly single-page HTML with embedded CSS.',
      '  — Tight layout: fits on one screen/A4 page.',
      '  — Agency brand: dark navy (#0F1B2D) headings, electric blue (#2563EB) accents.',
      '  — Sections:',
      '      1. Header: prospect name, company, niche, call date placeholder "[DATE]".',
      '      2. Quick Context: 3 bullet points — what they do, size estimate, key opportunity.',
      '      3. Recommended Offer: tier name, price, one-sentence rationale.',
      '      4. ROI Hook: the single most compelling number to open with.',
      '      5. Discovery Questions: 4 open-ended questions to understand goals and budget.',
      '      6. Likely Objections: 3 objection → response pairs (compact, 1–2 sentences each).',
      '      7. Closing Move: one recommended closing question or trial-close.',
      '  — Output ONLY the complete HTML — no markdown fences, no commentary.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          'Generate the call prep summary for this prospect.',
          '',
          'PROSPECT:',
          JSON.stringify({
            name: prospect.name,
            first_name: prospect.name.split(' ')[0],
            company: prospect.company,
            niche: prospect.niche ?? 'local service business',
            location: prospect.location ?? 'UK',
            quality_score: prospect.quality_score,
            review_count: prospect.enrichment_data?.review_count ?? null,
            trading_since: prospect.enrichment_data?.trading_since ?? null,
          }, null, 2),
          '',
          'OFFER CONTEXT:',
          JSON.stringify({
            recommended_tier: tierLabels[assessment.recommended_tier],
            monthly_price: `£${assessment.monthly_price.toLocaleString()}`,
            minimum_months: assessment.minimum_months,
            total_commitment: `£${assessment.total_commitment.toLocaleString()}`,
            roi_projection: assessment.roi_projection,
            expected_leads_per_month: assessment.expected_leads_per_month,
            expected_cpl: assessment.expected_cpl,
            tier_rationale: assessment.tier_rationale,
            business_size_estimate: assessment.business_size_estimate,
            growth_signals: assessment.growth_signals,
          }, null, 2),
          '',
          'Generate the one-page call prep summary now.',
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

// ── Upload to Storage and get 7-day signed URL ────────────────────────────────
async function uploadAndSign(
  supabase: ReturnType<typeof createClient>,
  storagePath: string,
  html: string,
): Promise<{ signedUrl: string; expiresAt: string }> {
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, html, { contentType: 'text/html', upsert: true })

  if (uploadError) throw new Error(`storage upload (${storagePath}): ${uploadError.message}`)

  const { data, error: signError } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, SIGNED_URL_TTL)

  if (signError || !data?.signedUrl) {
    throw new Error(`signed URL (${storagePath}): ${signError?.message ?? 'no URL returned'}`)
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString()
  return { signedUrl: data.signedUrl, expiresAt }
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
    } catch { /* no body or non-JSON body */ }

    // ── 1. Fetch call_booked prospects ────────────────────────────────────────
    let query = supabase
      .from('prospects')
      .select('id, name, company, phone, niche, location, quality_score, enrichment_data')
      .eq('status', 'call_booked')
      .order('quality_score', { ascending: false })
      .limit(BATCH_LIMIT)

    if (webhookProspectId) query = query.eq('id', webhookProspectId)

    const { data: rawProspects, error: fetchError } = await query

    if (fetchError) throw new Error(`fetch prospects: ${fetchError.message}`)

    const prospects = (rawProspects ?? []) as ProspectRow[]

    if (prospects.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No call_booked prospects found', prepped: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Process each prospect ──────────────────────────────────────────────
    const prepped: Array<{
      prospect_id: string
      company: string
      recommended_tier: string
      offer_storage_path: string
      offer_signed_url: string
      offer_approval_id: string
      call_prep_storage_path: string
      call_prep_signed_url: string
      call_prep_approval_id: string
    }> = []
    let errors = 0

    for (const prospect of prospects) {
      try {
        // 2a. Research business + determine tier
        const assessment = await researchAndAssessTier(prospect)

        // 2b. Generate offer document HTML
        const offerHtml = await generateOfferDocument(prospect, assessment)
        if (!offerHtml || offerHtml.length < 200) {
          throw new Error('Generated offer HTML is too short — generation may have failed')
        }

        // 2c. Generate call prep summary HTML
        const callPrepHtml = await generateCallPrepSummary(prospect, assessment)
        if (!callPrepHtml || callPrepHtml.length < 200) {
          throw new Error('Generated call prep HTML is too short — generation may have failed')
        }

        // 2d. Upload both documents and get signed URLs
        const offerPath = `offer/${prospect.id}.html`
        const callPrepPath = `call-prep/${prospect.id}.html`

        const [offerSigned, callPrepSigned] = await Promise.all([
          uploadAndSign(supabase, offerPath, offerHtml),
          uploadAndSign(supabase, callPrepPath, callPrepHtml),
        ])

        const batchDate = new Date().toISOString().slice(0, 10)
        const tierLabel = {
          proof_sprint: 'Proof Sprint',
          proof_brand: 'Proof Brand',
          authority_brand: 'Authority Brand',
        }[assessment.recommended_tier]

        const sharedMeta = {
          prospect_id: prospect.id,
          company: prospect.company,
          niche: prospect.niche,
          location: prospect.location,
          quality_score: prospect.quality_score,
          recommended_tier: assessment.recommended_tier,
          monthly_price: assessment.monthly_price,
          minimum_months: assessment.minimum_months,
          total_commitment: assessment.total_commitment,
        }

        // 2e. Approval item for offer document
        const { data: offerApproval, error: offerApprovalError } = await supabase
          .from('approval_queue')
          .insert({
            sop_id: '15',
            sop_name: 'SOP 15 — Offer Prep',
            status: 'pending',
            priority: 'high',
            content_type: 'offer_document',
            content_id: prospect.id,
            content: {
              title: `Offer Doc — ${prospect.company} — ${tierLabel} — ${batchDate}`,
              body: `Personalised ${tierLabel} offer document for ${prospect.company} (${prospect.location ?? 'UK'}). ${assessment.tier_rationale}`,
              recipient: prospect.name,
              signed_url: offerSigned.signedUrl,
              storage_path: offerPath,
              metadata: {
                ...sharedMeta,
                expected_leads_per_month: assessment.expected_leads_per_month,
                expected_cpl: assessment.expected_cpl,
                roi_projection: assessment.roi_projection,
                expires_at: offerSigned.expiresAt,
              },
            },
          })
          .select('id')
          .single()

        if (offerApprovalError) throw new Error(`create offer approval item: ${offerApprovalError.message}`)

        // 2f. Approval item for call prep summary
        const { data: callPrepApproval, error: callPrepApprovalError } = await supabase
          .from('approval_queue')
          .insert({
            sop_id: '15',
            sop_name: 'SOP 15 — Offer Prep',
            status: 'pending',
            priority: 'high',
            content_type: 'call_brief',
            content_id: prospect.id,
            content: {
              title: `Call Prep — ${prospect.company} — ${tierLabel} — ${batchDate}`,
              body: `One-page call prep summary for ${prospect.company}. Recommended tier: ${tierLabel} at £${assessment.monthly_price.toLocaleString()}/month.`,
              recipient: prospect.name,
              signed_url: callPrepSigned.signedUrl,
              storage_path: callPrepPath,
              metadata: {
                ...sharedMeta,
                expires_at: callPrepSigned.expiresAt,
              },
            },
          })
          .select('id')
          .single()

        if (callPrepApprovalError) throw new Error(`create call prep approval item: ${callPrepApprovalError.message}`)

        // 2g. Advance prospect status
        await supabase
          .from('prospects')
          .update({ status: 'offer_prepped' })
          .eq('id', prospect.id)

        prepped.push({
          prospect_id: prospect.id,
          company: prospect.company,
          recommended_tier: assessment.recommended_tier,
          offer_storage_path: offerPath,
          offer_signed_url: offerSigned.signedUrl,
          offer_approval_id: offerApproval?.id,
          call_prep_storage_path: callPrepPath,
          call_prep_signed_url: callPrepSigned.signedUrl,
          call_prep_approval_id: callPrepApproval?.id,
        })
      } catch (prospectErr) {
        console.error(
          `Offer prep error for ${prospect.company} (${prospect.id}):`,
          prospectErr instanceof Error ? prospectErr.message : String(prospectErr),
        )
        errors++
      }
    }

    // ── 3. Audit log ──────────────────────────────────────────────────────────
    const allFailed = errors > 0 && prepped.length === 0

    await supabase.from('ai_task_log').insert({
      sop_id: '15',
      sop_name: 'SOP 15 — Offer Prep',
      tool_called: SONNET,
      status: allFailed ? 'failure' : 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${prospects.length} call_booked prospects`,
      output_summary: `${prepped.length} offer + call prep document pairs generated and queued, ${errors} errors`,
    })

    return new Response(
      JSON.stringify({ prepped: prepped.length, errors, documents: prepped }),
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
        sop_id: '15',
        sop_name: 'SOP 15 — Offer Prep',
        tool_called: SONNET,
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: 'call_booked prospects',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
