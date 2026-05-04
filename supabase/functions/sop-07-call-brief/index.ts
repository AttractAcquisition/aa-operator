// Model: claude-sonnet-4-6 — call brief generation with live business research.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET = 'claude-sonnet-4-6'
const BATCH_LIMIT = 5
const MAX_LOOP_ITERATIONS = 8

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

interface ObjectionHandler {
  objection: string
  response: string
}

interface CallBrief {
  company_background: string
  estimated_size: string
  online_presence: string
  pain_points: string[]
  suggested_angles: string[]
  objection_handling: ObjectionHandler[]
  opening_line: string
  key_questions: string[]
  call_notes: string
}

// Single agentic loop: research the business then output the structured brief.
async function generateCallBrief(prospect: ProspectRow): Promise<CallBrief> {
  const ed = prospect.enrichment_data
  const niche = prospect.niche ?? 'local service business'
  const location = prospect.location ?? 'UK'

  const schemaExample: CallBrief = {
    company_background: '<what the business does, how long trading, service area>',
    estimated_size: '<sole trader | small (1–5) | medium (6–20) | larger>',
    online_presence: '<website quality, review count and rating, social media presence>',
    pain_points: [
      '<specific problem this type of business faces getting new clients>',
      '<gap vs competitors visible from research>',
    ],
    suggested_angles: [
      '<lead-gen angle most relevant to their niche and situation>',
      '<secondary angle based on their review count / market position>',
    ],
    objection_handling: [
      { objection: '<likely first objection>', response: '<concise, empathetic response>' },
      { objection: '<price / budget objection>', response: '<ROI-focused response>' },
      { objection: '<already tried ads>', response: '<differentiation response>' },
    ],
    opening_line: '<one natural sentence to open the call, referencing something specific>',
    key_questions: [
      '<discovery question about their current lead sources>',
      '<question about their busy/quiet seasons>',
      '<question about their target client or job type>',
    ],
    call_notes: '<any other context worth knowing before the call>',
  }

  const systemPrompt = [
    'You prepare call briefs for Attract Acquisition, a performance marketing agency',
    'that helps local service businesses (trades, home services, medical/dental,',
    'professional services) get a consistent flow of new clients through paid ads.',
    '',
    'Process:',
    '  1. Use web_search to research the business: find their website, Google reviews,',
    '     social media, and any news. Also search for their niche + location to understand',
    '     the competitive landscape.',
    '  2. After research, output a structured call brief as valid JSON.',
    '',
    'Call brief rules:',
    '  — pain_points: specific, research-backed — not generic marketing pain points.',
    '  — suggested_angles: tailored to THIS business\'s situation (review gap, no ads,',
    '    seasonal demand, competitor activity, etc.).',
    '  — objection_handling: concise (2–3 sentences each). Empathetic, not pushy.',
    '  — opening_line: reference something specific found in research (e.g. a service,',
    '    location, how long they\'ve been trading). Never "I was just reaching out".',
    '  — key_questions: open-ended, discovery-focused — not leading or salesy.',
    '  — estimated_size: infer from website, reviews, staff mentions, or directory listings.',
    '',
    'Return ONLY valid JSON matching this exact schema — no markdown fences:',
    JSON.stringify(schemaExample),
  ].join('\n')

  const userContent = [
    `Build a call brief for this prospect:`,
    ``,
    `Name: ${prospect.name}`,
    `Company: ${prospect.company}`,
    `Niche: ${niche}`,
    `Location: ${location}`,
    `Quality score: ${prospect.quality_score}/10`,
    `Phone: ${prospect.phone ?? 'unknown'}`,
    ed?.review_count != null ? `Known review count: ${ed.review_count}` : null,
    ed?.trading_since ? `Trading since: ${ed.trading_since}` : null,
    ed?.has_website != null ? `Has website: ${ed.has_website}` : null,
    ed?.summary ? `Enrichment summary: ${ed.summary}` : null,
  ].filter(Boolean).join('\n')

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userContent },
  ]

  let finalText = ''

  for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
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
  if (!jsonMatch) throw new Error(`No JSON in call brief response for ${prospect.company}`)

  return JSON.parse(jsonMatch[0]) as CallBrief
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

    // Webhook calls include { prospect_id } to process a single row immediately.
    // Cron / manual calls omit it and fall back to the full batch query.
    let webhookProspectId: string | null = null
    try {
      const body = await req.json()
      if (typeof body?.prospect_id === 'string') webhookProspectId = body.prospect_id
    } catch { /* no body */ }

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
        JSON.stringify({ message: 'No call_booked prospects found', briefed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Generate brief + queue approval item per prospect ──────────────────
    const briefed: Array<{ prospect_id: string; company: string; approval_id: string }> = []
    let errors = 0

    for (const prospect of prospects) {
      try {
        // 2a. Research + generate
        const brief = await generateCallBrief(prospect)

        // 2b. Create approval_queue item
        const today = new Date().toISOString().slice(0, 10)

        const { data: approvalRow, error: approvalError } = await supabase
          .from('approval_queue')
          .insert({
            sop_id: '07',
            sop_name: 'SOP 07 — Call Brief',
            status: 'pending',
            priority: 'high',
            content_type: 'call_brief',
            content_id: prospect.id,
            content: {
              title: `Call Brief — ${prospect.company} — ${today}`,
              body: brief.company_background,
              recipient: prospect.name,
              brief,
              metadata: {
                prospect_id: prospect.id,
                company: prospect.company,
                niche: prospect.niche,
                location: prospect.location,
                phone: prospect.phone,
                quality_score: prospect.quality_score,
                generated_at: new Date().toISOString(),
              },
            },
          })
          .select('id')
          .single()

        if (approvalError) throw new Error(`create approval item: ${approvalError.message}`)

        briefed.push({
          prospect_id: prospect.id,
          company: prospect.company,
          approval_id: approvalRow?.id,
        })
      } catch (prospectErr) {
        console.error(
          `Call brief error for ${prospect.company} (${prospect.id}):`,
          prospectErr instanceof Error ? prospectErr.message : String(prospectErr),
        )
        errors++
      }
    }

    // ── 3. Audit log ──────────────────────────────────────────────────────────
    await supabase.from('ai_task_log').insert({
      sop_id: '07',
      sop_name: 'SOP 07 — Call Brief',
      tool_called: SONNET,
      status: briefed.length === 0 ? 'failure' : 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${prospects.length} call_booked prospects`,
      output_summary: `${briefed.length} call briefs generated and queued, ${errors} errors`,
    })

    return new Response(
      JSON.stringify({ briefed: briefed.length, errors, items: briefed }),
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
        sop_id: '07',
        sop_name: 'SOP 07 — Call Brief',
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
