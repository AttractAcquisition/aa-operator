// Model: claude-sonnet-4-6 — analytical synthesis for lead sourcing strategy.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET = 'claude-sonnet-4-6'
const ANALYSIS_DAYS = 90
const MIN_SAMPLE = 5

// Statuses that indicate a prospect was contacted (conversion denominator)
const CONTACTED = new Set([
  'contacted', 'replied', 'warm', 'cold', 'not_interested', 'unsubscribed',
  'call_booked', 'closed', 'mjr_ready', 'mjr_sent', 'spoa_ready', 'spoa_sent',
])

// Statuses that count as a successful conversion (numerator)
const CONVERTED = new Set([
  'warm', 'call_booked', 'closed', 'mjr_ready', 'mjr_sent', 'spoa_ready', 'spoa_sent',
])

interface ProspectRow {
  niche: string | null
  source_list: string | null
  location: string | null
  quality_score: number
  status: string
}

interface GroupStats {
  total: number
  qualitySum: number
  contacted: number
  conversions: number
}

interface RecommendedVertical {
  rank: number
  vertical: string
  avg_quality_score: number
  conversion_rate_pct: number
  recommended_locations: string[]
  rationale: string
}

interface SourcingRecommendation {
  generated_at: string
  analysis_summary: string
  top_verticals: RecommendedVertical[]
  top_source_lists: string[]
  scraping_brief: string
}

function buildStats(rows: ProspectRow[]): GroupStats {
  return rows.reduce(
    (acc, p) => ({
      total: acc.total + 1,
      qualitySum: acc.qualitySum + p.quality_score,
      contacted: acc.contacted + (CONTACTED.has(p.status) ? 1 : 0),
      conversions: acc.conversions + (CONVERTED.has(p.status) ? 1 : 0),
    }),
    { total: 0, qualitySum: 0, contacted: 0, conversions: 0 },
  )
}

function groupAndAggregate(
  prospects: ProspectRow[],
  keyFn: (p: ProspectRow) => string,
  minCount = 1,
  topN = 15,
): Array<{ key: string; avgScore: number; convRate: number; total: number }> {
  const groups: Record<string, ProspectRow[]> = {}
  for (const p of prospects) {
    const k = keyFn(p)
    if (!groups[k]) groups[k] = []
    groups[k].push(p)
  }

  return Object.entries(groups)
    .filter(([, rows]) => rows.length >= minCount)
    .map(([key, rows]) => {
      const s = buildStats(rows)
      return {
        key,
        avgScore: s.qualitySum / s.total,
        convRate: s.contacted > 0 ? (s.conversions / s.contacted) * 100 : 0,
        total: s.total,
      }
    })
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, topN)
}

function formatRows(
  rows: Array<{ key: string; avgScore: number; convRate: number; total: number }>,
  label: string,
): string {
  if (rows.length === 0) return `${label}: (insufficient data)\n`
  const lines = rows.map(
    r => `  ${r.key}: n=${r.total}, avg_quality=${r.avgScore.toFixed(1)}, conv_rate=${r.convRate.toFixed(1)}%`,
  )
  return `${label}:\n${lines.join('\n')}`
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

    const cutoff = new Date(Date.now() - ANALYSIS_DAYS * 86_400_000).toISOString()

    // ── 1. Fetch enriched prospects from the analysis window ─────────────────
    const { data: rawProspects, error: fetchError } = await supabase
      .from('prospects')
      .select('niche, source_list, location, quality_score, status')
      .not('quality_score', 'is', null)
      .gte('created_at', cutoff)
      .limit(1000)

    if (fetchError) throw new Error(`fetch prospects: ${fetchError.message}`)

    const prospects = (rawProspects ?? []) as ProspectRow[]

    if (prospects.length < MIN_SAMPLE) {
      return new Response(
        JSON.stringify({ message: 'Insufficient enriched data for sourcing analysis', analysed: prospects.length }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Aggregate by niche, source list, and location ─────────────────────
    const byNiche = groupAndAggregate(prospects, p => p.niche ?? 'unknown', 3)
    const bySource = groupAndAggregate(prospects, p => p.source_list ?? 'unknown', 1)
    const byLocation = groupAndAggregate(
      prospects,
      p => (p.location ?? 'unknown').split(',')[0].trim(),
      2,
    )

    const overallAvg = prospects.reduce((s, p) => s + p.quality_score, 0) / prospects.length
    const distinctNiches = new Set(prospects.map(p => p.niche ?? 'unknown')).size

    // ── 3. Build context for Claude ───────────────────────────────────────────
    const context = [
      `Lead sourcing analysis — ${new Date().toISOString()}`,
      `Total prospects analysed: ${prospects.length} (last ${ANALYSIS_DAYS} days)`,
      `Overall average quality score: ${overallAvg.toFixed(1)}/10`,
      `Distinct niches: ${distinctNiches}`,
      ``,
      formatRows(byNiche, 'BY NICHE (vertical)'),
      ``,
      formatRows(bySource, 'BY SOURCE LIST'),
      ``,
      formatRows(byLocation, 'BY LOCATION'),
    ].join('\n')

    // ── 4. Call Claude Sonnet 4.6 ─────────────────────────────────────────────
    const schemaExample: SourcingRecommendation = {
      generated_at: '<ISO timestamp>',
      analysis_summary: '<2–3 sentence strategic rationale>',
      top_verticals: [
        {
          rank: 1,
          vertical: '<niche name>',
          avg_quality_score: 0,
          conversion_rate_pct: 0,
          recommended_locations: ['<city1>', '<city2>'],
          rationale: '<one sentence why this vertical>',
        },
      ],
      top_source_lists: ['<source1>', '<source2>'],
      scraping_brief: '<one paragraph actionable instructions for the next scraping run>',
    }

    const response = await anthropic.messages.create({
      model: SONNET,
      max_tokens: 2048,
      system: [
        'You are a lead generation strategist for Attract Acquisition, a B2B performance marketing agency.',
        'You analyse prospect quality and conversion data to recommend the next scraping targets.',
        '',
        'Rules:',
        '  1. Select top_verticals by balancing avg_quality_score AND conv_rate — both matter.',
        '  2. Include exactly 3 verticals in top_verticals, ranked 1–3.',
        '  3. For each vertical, recommend 2–3 specific locations drawn from the BY LOCATION data.',
        '     If location data is sparse, use the highest-volume cities for that niche.',
        '  4. top_source_lists: list the source lists with the best avg_quality, up to 3.',
        '  5. scraping_brief: write one clear paragraph telling the scraper operator exactly',
        '     which verticals, locations, and source lists to target and why.',
        '  6. Respond with ONLY valid JSON — no markdown fences, no explanation.',
        '',
        'JSON schema:',
        JSON.stringify(schemaExample),
      ].join('\n'),
      messages: [{ role: 'user', content: context }],
    })

    const raw = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('')
      .trim()

    const recommendation = JSON.parse(raw) as SourcingRecommendation

    // ── 5. Retire previous active SOP-05 entries ──────────────────────────────
    await supabase
      .from('knowledge_base')
      .update({ is_active: false })
      .contains('tags', ['sop-05'])

    // ── 6. Write recommendation to knowledge_base ─────────────────────────────
    const title = `SOP 05 — Lead Sourcing Recommendation — ${new Date().toISOString().slice(0, 10)}`

    const contentLines = [
      recommendation.analysis_summary,
      '',
      ...recommendation.top_verticals.map(v =>
        [
          `${v.rank}. ${v.vertical}`,
          `   Avg quality: ${v.avg_quality_score} | Conversion: ${v.conversion_rate_pct}%`,
          `   Locations: ${v.recommended_locations.join(', ')}`,
          `   ${v.rationale}`,
        ].join('\n')
      ),
      '',
      `Top source lists: ${recommendation.top_source_lists.join(', ')}`,
      '',
      `Scraping brief: ${recommendation.scraping_brief}`,
    ]

    const { error: insertError } = await supabase.from('knowledge_base').insert({
      type: 'reference',
      title,
      content: contentLines.join('\n'),
      metadata: {
        ...recommendation,
        total_prospects_analysed: prospects.length,
        analysis_period_days: ANALYSIS_DAYS,
        overall_avg_quality: parseFloat(overallAvg.toFixed(1)),
      },
      tags: ['sop-05', 'sourcing', 'recommendation'],
      is_active: true,
    })
    if (insertError) throw new Error(`insert knowledge_base: ${insertError.message}`)

    // ── 7. Audit log ──────────────────────────────────────────────────────────
    const topVertical = recommendation.top_verticals[0]?.vertical ?? 'unknown'

    await supabase.from('ai_task_log').insert({
      sop_id: '05',
      sop_name: 'SOP 05 — Lead Sourcing',
      tool_called: SONNET,
      status: 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${prospects.length} prospects across ${distinctNiches} niches (last ${ANALYSIS_DAYS} days)`,
      output_summary: `Recommendation written: top vertical "${topVertical}" | sources: ${recommendation.top_source_lists.join(', ')}`,
    })

    return new Response(JSON.stringify(recommendation), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await supabase.from('ai_task_log').insert({
        sop_id: '05',
        sop_name: 'SOP 05 — Lead Sourcing',
        tool_called: SONNET,
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: 'sourcing analysis run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
