// Model: claude-sonnet-4-6 — SOP performance review and improvement suggestion.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET   = 'claude-sonnet-4-6'
const SOP_ID   = '33'
const SOP_NAME = 'SOP 33 — SOP Versioning'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KBSop {
  id:       string
  title:    string
  content:  string
  metadata: Record<string, unknown>
  tags:     string[]
}

interface TaskLogRow {
  sop_id:         string
  status:         string
  duration_ms:    number | null
  output_summary: string
  created_at:     string
}

interface SopStats {
  total_runs:     number
  success_count:  number
  failure_count:  number
  success_rate:   number
  avg_duration_ms: number
  recent_errors:  string[]
}

interface ClaudeReview {
  improvements:    string[]
  risk_level:      'low' | 'medium' | 'high'
  summary:         string
  revised_excerpt: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the numeric sop_id from a KB entry — checks metadata first, then title. */
function extractSopId(entry: KBSop): string | null {
  if (typeof entry.metadata?.sop_id === 'string' && entry.metadata.sop_id) {
    return entry.metadata.sop_id
  }
  const match = entry.title.match(/SOP[- #]*0*(\d+)/i)
  return match ? match[1] : null
}

function calcStats(logs: TaskLogRow[]): SopStats {
  const successLogs = logs.filter(l => l.status === 'success')
  const failureLogs = logs.filter(l => l.status === 'failure')

  const durations = successLogs
    .map(l => l.duration_ms)
    .filter((d): d is number => d !== null)

  const avg_duration_ms = durations.length > 0
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : 0

  const recent_errors = failureLogs
    .slice(0, 5)
    .map(l => l.output_summary)
    .filter(Boolean)

  return {
    total_runs:     logs.length,
    success_count:  successLogs.length,
    failure_count:  failureLogs.length,
    success_rate:   logs.length > 0
      ? Math.round((successLogs.length / logs.length) * 1000) / 10
      : 0,
    avg_duration_ms,
    recent_errors,
  }
}

// ─── Claude review ────────────────────────────────────────────────────────────

async function reviewSop(entry: KBSop, stats: SopStats): Promise<ClaudeReview> {
  const contentPreview = entry.content.length > 4000
    ? entry.content.slice(0, 4000) + '\n\n[… content truncated …]'
    : entry.content

  const perfBlock = stats.total_runs === 0
    ? 'No execution data available for this SOP in the last 30 days.'
    : [
        `Runs (30 days):   ${stats.total_runs}`,
        `Success rate:     ${stats.success_rate}%`,
        `Avg duration:     ${stats.avg_duration_ms}ms`,
        `Failures:         ${stats.failure_count}`,
        stats.recent_errors.length > 0
          ? `Recent errors:\n${stats.recent_errors.map(e => `  - ${e}`).join('\n')}`
          : 'Recent errors:    none',
      ].join('\n')

  const response = await anthropic.messages.create({
    model:      SONNET,
    max_tokens: 800,
    system: [{ type: 'text', text: [
      'You are a senior automation engineer reviewing Standard Operating Procedures for Attract Acquisition, a paid advertising agency.',
      'Analyse the SOP instructions and its 30-day execution performance, then suggest concrete improvements.',
      '',
      'Return a JSON object with exactly these keys:',
      '  improvements    — string[]: 3-5 specific, actionable improvements, each starting with an action verb',
      '  risk_level      — "low"|"medium"|"high": risk of leaving this SOP unchanged',
      '  summary         — string: 1-2 sentence summary of the SOP\'s health and single highest-priority change',
      '  revised_excerpt — string: 1-2 paragraph rewrite of the most critical section (empty string if no rewrite needed)',
      '',
      'Focus on: error-handling gaps revealed by failures, performance bottlenecks from high avg_duration,',
      'missing edge-case handling, unclear instructions that may cause mis-execution, and dependency risks.',
      '',
      'Output ONLY valid JSON — no markdown fences, no explanation.',
    ].join('\n'), cache_control: { type: 'ephemeral' } }],
    messages: [{
      role:    'user',
      content: `SOP: ${entry.title}\n\nPERFORMANCE (last 30 days):\n${perfBlock}\n\nSOP INSTRUCTIONS:\n${contentPreview}`,
    }],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  return JSON.parse(raw) as ClaudeReview
}

// ─── Handler ──────────────────────────────────────────────────────────────────

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

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // ── 1. Parallel fetch: active SOPs + last-30-day task logs ───────────────
    const [sopRes, logRes] = await Promise.all([
      supabase
        .from('knowledge_base')
        .select('id, title, content, metadata, tags')
        .eq('type', 'sop')
        .eq('is_active', true)
        .order('title'),

      supabase
        .from('ai_task_log')
        .select('sop_id, status, duration_ms, output_summary, created_at')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false }),
    ])

    if (sopRes.error) throw new Error(`knowledge_base: ${sopRes.error.message}`)
    if (logRes.error) throw new Error(`ai_task_log: ${logRes.error.message}`)

    const sops = (sopRes.data ?? []) as KBSop[]
    const allLogs = (logRes.data ?? []) as TaskLogRow[]

    console.log(`[sop-33] ${sops.length} active SOPs, ${allLogs.length} log entries (30 days)`)

    if (sops.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No active SOPs found in knowledge_base', reviewed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Group logs by sop_id
    const logsBySopId = new Map<string, TaskLogRow[]>()
    for (const log of allLogs) {
      const bucket = logsBySopId.get(log.sop_id) ?? []
      bucket.push(log)
      logsBySopId.set(log.sop_id, bucket)
    }

    // ── 2. Review each SOP sequentially ──────────────────────────────────────
    const results: Array<{
      title:      string
      sop_id_ref: string | null
      risk_level: string
      runs:       number
      queued:     boolean
    }> = []

    for (const entry of sops) {
      try {
        const sopIdRef = extractSopId(entry)
        const logs     = sopIdRef ? (logsBySopId.get(sopIdRef) ?? []) : []
        const stats    = calcStats(logs)

        console.log(
          `[sop-33] reviewing "${entry.title}" (sop_id=${sopIdRef ?? 'unknown'}, ` +
          `runs=${stats.total_runs}, success=${stats.success_rate}%)`,
        )

        const review = await reviewSop(entry, stats)

        // ── 3. Create approval_queue item ───────────────────────────────────
        const title = `SOP Review — ${entry.title}`

        const { error: queueErr } = await supabase
          .from('approval_queue')
          .insert({
            sop_id:       SOP_ID,
            sop_name:     SOP_NAME,
            status:       'pending',
            priority:     'low',
            content_type: 'client_report',
            content_id:   crypto.randomUUID(),
            content: {
              title,
              body:            review.summary,
              sop_title:       entry.title,
              sop_id_ref:      sopIdRef,
              improvements:    review.improvements,
              revised_excerpt: review.revised_excerpt,
              risk_level:      review.risk_level,
              performance: {
                total_runs:      stats.total_runs,
                success_rate:    stats.success_rate,
                avg_duration_ms: stats.avg_duration_ms,
                failure_count:   stats.failure_count,
                period_days:     30,
              },
              metadata: {
                kb_entry_id: entry.id,
                tags:        entry.tags,
                reviewed_at: new Date().toISOString(),
              },
            },
          })

        if (queueErr) {
          console.error(`[sop-33] approval_queue insert failed for "${entry.title}": ${queueErr.message}`)
          results.push({ title: entry.title, sop_id_ref: sopIdRef, risk_level: review.risk_level, runs: stats.total_runs, queued: false })
        } else {
          results.push({ title: entry.title, sop_id_ref: sopIdRef, risk_level: review.risk_level, runs: stats.total_runs, queued: true })
          console.log(`[sop-33] queued review for "${entry.title}" — risk: ${review.risk_level}`)
        }
      } catch (sopErr) {
        const msg = sopErr instanceof Error ? sopErr.message : String(sopErr)
        console.error(`[sop-33] failed to review "${entry.title}": ${msg}`)
        results.push({ title: entry.title, sop_id_ref: null, risk_level: 'unknown', runs: 0, queued: false })
      }
    }

    // ── 4. Audit log ──────────────────────────────────────────────────────────
    const queued  = results.filter(r => r.queued).length
    const highRisk = results.filter(r => r.risk_level === 'high').length
    const duration_ms = Date.now() - startedAt

    const outputSummary =
      `Reviewed ${sops.length} SOPs — ${queued} queued for approval, ${highRisk} high-risk`

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    SONNET,
      status:         'success',
      duration_ms,
      input_summary:  `${sops.length} active SOPs, ${allLogs.length} log entries`,
      output_summary: outputSummary,
    })

    console.log(`[sop-33] complete — ${outputSummary} in ${duration_ms}ms`)

    return new Response(
      JSON.stringify({ reviewed: sops.length, queued, high_risk: highRisk, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-33] fatal: ${message}`)

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
        input_summary:  'sop versioning run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
