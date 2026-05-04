// Model: claude-haiku-4-5-20251001 — mechanical CRM staging with batch summarisation.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const HAIKU = 'claude-haiku-4-5-20251001'
const MIN_QUALITY = 6

interface ProspectRow {
  id: string
  quality_score: number
  niche: string | null
  company: string
  location: string | null
}

async function generateBatchNotes(
  prospects: ProspectRow[],
  avgScore: number,
): Promise<string> {
  const nicheCounts: Record<string, number> = {}
  for (const p of prospects) {
    const niche = p.niche ?? 'unknown'
    nicheCounts[niche] = (nicheCounts[niche] ?? 0) + 1
  }

  const topNiches = Object.entries(nicheCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n, c]) => `${n} (${c})`)
    .join(', ')

  const scoreDistribution = [6, 7, 8, 9, 10]
    .map(s => {
      const n = prospects.filter(p => p.quality_score === s).length
      return n > 0 ? `${n} at ${s}` : null
    })
    .filter(Boolean)
    .join(', ')

  const context =
    `Batch: ${prospects.length} prospects staged. Avg quality: ${avgScore.toFixed(1)}/10. ` +
    `Score distribution: ${scoreDistribution || 'mixed'}. Top niches: ${topNiches}.`

  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 128,
    system: [
      'Write a single sentence summarising this CRM staging batch for an operator log.',
      'Be specific about volume, quality, and niche mix.',
      'Output ONLY the sentence — no quotes, no labels.',
    ].join(' '),
    messages: [{ role: 'user', content: context }],
  })

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
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

    // ── 1. Fetch enriched prospects that meet the quality threshold ───────────
    const { data: rawProspects, error: fetchError } = await supabase
      .from('prospects')
      .select('id, quality_score, niche, company, location')
      .eq('status', 'enriched')
      .gte('quality_score', MIN_QUALITY)
      .order('quality_score', { ascending: false })

    if (fetchError) throw new Error(`fetch prospects: ${fetchError.message}`)

    const prospects = (rawProspects ?? []) as ProspectRow[]

    if (prospects.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No enriched prospects meet the quality threshold', staged: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Compute batch metrics ──────────────────────────────────────────────
    const prospectIds = prospects.map(p => p.id)
    const avgQuality = prospects.reduce((s, p) => s + p.quality_score, 0) / prospects.length

    // ── 3. Stage all qualifying prospects in one update ───────────────────────
    const { error: updateError } = await supabase
      .from('prospects')
      .update({ status: 'staged' })
      .in('id', prospectIds)

    if (updateError) throw new Error(`stage prospects: ${updateError.message}`)

    // ── 4. Generate batch notes via Haiku (non-fatal if it fails) ─────────────
    let batchNotes: string | null = null
    try {
      batchNotes = await generateBatchNotes(prospects, avgQuality)
    } catch { /* proceed without notes */ }

    // ── 5. Create prospect_batches record ─────────────────────────────────────
    const batchDate = new Date().toISOString().slice(0, 10)

    const { data: batchRow, error: batchError } = await supabase
      .from('prospect_batches')
      .insert({
        batch_date: batchDate,
        count: prospects.length,
        avg_quality_score: parseFloat(avgQuality.toFixed(2)),
        min_quality_score: MIN_QUALITY,
        batch_notes: batchNotes,
        prospect_ids: prospectIds,
      })
      .select('id')
      .single()

    if (batchError) throw new Error(`create batch record: ${batchError.message}`)

    // ── 6. Audit log ──────────────────────────────────────────────────────────
    await supabase.from('ai_task_log').insert({
      sop_id: '04',
      sop_name: 'SOP 04 — CRM Staging',
      tool_called: HAIKU,
      status: 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${prospects.length} enriched prospects with quality_score >= ${MIN_QUALITY}`,
      output_summary:
        `${prospects.length} staged, avg quality ${avgQuality.toFixed(1)}, batch ${batchRow?.id}`,
    })

    return new Response(
      JSON.stringify({
        staged: prospects.length,
        avg_quality_score: parseFloat(avgQuality.toFixed(2)),
        batch_date: batchDate,
        batch_id: batchRow?.id,
        batch_notes: batchNotes,
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
        sop_id: '04',
        sop_name: 'SOP 04 — CRM Staging',
        tool_called: HAIKU,
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: `enriched prospects quality_score >= ${MIN_QUALITY}`,
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
