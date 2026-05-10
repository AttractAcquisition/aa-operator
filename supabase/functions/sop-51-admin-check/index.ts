// Model: claude-haiku-4-5-20251001 — admin briefing synthesis.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const HAIKU    = 'claude-haiku-4-5-20251001'
const SOP_ID   = '51'
const SOP_NAME = 'SOP 51 — Admin Check'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CronRow {
  sop_id:     string
  sop_name:   string
  domain:     string
  last_run:   string | null
  last_status: string | null
  last_error: string | null
  run_count:  number
}

interface ApprovalRow {
  id:           string
  created_at:   string
  sop_name:     string | null
  content_type: string | null
  priority:     string | null
  content:      Record<string, unknown>
}

interface AlertRow {
  id:              string
  created_at:      string
  severity:        string
  category:        string
  message:         string
  suggested_action: string
  client_name:     string | null
  sop_id:          string | null
}

interface AdminBriefing {
  overall_status:      'critical' | 'warning' | 'healthy'
  summary:             string
  sections: {
    failed_jobs:      { count: number; commentary: string }
    stale_approvals:  { count: number; commentary: string }
    critical_alerts:  { count: number; commentary: string }
  }
  priority_actions:    string[]
  escalation_required: boolean
}

// ─── Claude briefing ──────────────────────────────────────────────────────────

async function generateBriefing(
  failedJobs:      CronRow[],
  staleApprovals:  ApprovalRow[],
  criticalAlerts:  AlertRow[],
): Promise<AdminBriefing> {
  const now = new Date()

  const jobLines = failedJobs.length === 0
    ? 'None.'
    : failedJobs.map(j =>
        `  • SOP ${j.sop_id} "${j.sop_name}" [${j.domain}] — last ran ${j.last_run ?? 'never'}` +
        (j.last_error ? `, error: ${j.last_error.slice(0, 120)}` : ''),
      ).join('\n')

  const approvalLines = staleApprovals.length === 0
    ? 'None.'
    : staleApprovals.map(a => {
        const ageH = Math.floor((now.getTime() - new Date(a.created_at).getTime()) / 3_600_000)
        const title = (a.content?.title as string | undefined) ?? 'Untitled'
        return `  • "${title}" (${a.content_type ?? 'unknown'}, ${a.priority ?? 'medium'} priority, ${ageH}h pending)`
      }).join('\n')

  const alertLines = criticalAlerts.length === 0
    ? 'None.'
    : criticalAlerts.map(a => {
        const ageH = Math.floor((now.getTime() - new Date(a.created_at).getTime()) / 3_600_000)
        return `  • [${a.category}] ${a.message} — ${ageH}h unresolved` +
          (a.client_name ? ` (${a.client_name})` : '')
      }).join('\n')

  const prompt = `WEEKLY ADMIN CHECK — ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}

FAILED CRON JOBS (last 7 days):
${jobLines}

STALE APPROVAL ITEMS (pending > 48 hours):
${approvalLines}

UNRESOLVED CRITICAL ALERTS (> 24 hours old):
${alertLines}`

  const response = await anthropic.messages.create({
    model:      HAIKU,
    max_tokens: 600,
    system: [{ type: 'text', text: [
      'You are the admin assistant for Attract Acquisition, a paid advertising agency.',
      'Analyse the weekly system health report and return a JSON object with exactly these keys:',
      '  overall_status      — "critical"|"warning"|"healthy"',
      '  summary             — string: 2-3 sentence plain-English overview for the agency director',
      '  sections            — object with keys failed_jobs, stale_approvals, critical_alerts;',
      '                        each having count (integer) and commentary (1 sentence, actionable)',
      '  priority_actions    — string[]: 2-4 specific actions the admin should take today, ordered by urgency',
      '  escalation_required — boolean: true if human intervention is needed before next Monday',
      '',
      'Be direct and operational. Output ONLY valid JSON — no markdown fences, no explanation.',
    ].join('\n'), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  const parsed = JSON.parse(raw) as AdminBriefing

  // Ensure counts match reality — Claude cannot add new items
  parsed.sections.failed_jobs.count     = failedJobs.length
  parsed.sections.stale_approvals.count = staleApprovals.length
  parsed.sections.critical_alerts.count = criticalAlerts.length

  return parsed
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

    const now             = new Date()
    const sevenDaysAgo    = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString()
    const fortyEightHAgo  = new Date(now.getTime() - 48 *      60 * 60 * 1000).toISOString()
    const twentyFourHAgo  = new Date(now.getTime() - 24 *      60 * 60 * 1000).toISOString()

    console.log(`[sop-51] running admin check at ${now.toISOString()}`)

    // ── 1. Parallel data fetch ───────────────────────────────────────────────
    const [failedJobsRes, staleApprovalsRes, criticalAlertsRes] = await Promise.all([
      // Cron jobs that have a failure recorded in the last 7 days
      supabase
        .from('cron_schedule')
        .select('sop_id, sop_name, domain, last_run, last_status, last_error, run_count')
        .eq('last_status', 'failure')
        .gte('last_run', sevenDaysAgo)
        .order('last_run', { ascending: false }),

      // Approval items still pending after 48 hours
      supabase
        .from('approval_queue')
        .select('id, created_at, sop_name, content_type, priority, content')
        .eq('status', 'pending')
        .lte('created_at', fortyEightHAgo)
        .order('created_at', { ascending: true }),

      // Critical alerts unresolved for more than 24 hours
      supabase
        .from('ai_alerts')
        .select('id, created_at, severity, category, message, suggested_action, client_name, sop_id')
        .eq('resolved', false)
        .eq('severity', 'critical')
        .lte('created_at', twentyFourHAgo)
        .order('created_at', { ascending: true }),
    ])

    if (failedJobsRes.error)    throw new Error(`cron_schedule: ${failedJobsRes.error.message}`)
    if (staleApprovalsRes.error) throw new Error(`approval_queue: ${staleApprovalsRes.error.message}`)
    if (criticalAlertsRes.error) throw new Error(`ai_alerts: ${criticalAlertsRes.error.message}`)

    const failedJobs     = (failedJobsRes.data    ?? []) as CronRow[]
    const staleApprovals = (staleApprovalsRes.data ?? []) as ApprovalRow[]
    const criticalAlerts = (criticalAlertsRes.data ?? []) as AlertRow[]

    console.log(
      `[sop-51] ${failedJobs.length} failed jobs, ` +
      `${staleApprovals.length} stale approvals, ` +
      `${criticalAlerts.length} unresolved critical alerts`,
    )

    // ── 2. Generate admin briefing via Haiku ─────────────────────────────────
    const briefing = await generateBriefing(failedJobs, staleApprovals, criticalAlerts)

    const hasCriticalIssues =
      failedJobs.length > 0 ||
      staleApprovals.length > 0 ||
      criticalAlerts.length > 0

    const dateLabel = now.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })

    // ── 3. Create approval_queue item if any critical issues ─────────────────
    let queueId: string | null = null

    if (hasCriticalIssues) {
      const { data: queueRow, error: queueErr } = await supabase
        .from('approval_queue')
        .insert({
          sop_id:       SOP_ID,
          sop_name:     SOP_NAME,
          status:       'pending',
          priority:     'high',
          content_type: 'call_brief',
          content_id:   crypto.randomUUID(),
          content: {
            title:   `Admin Briefing — ${dateLabel}`,
            body:    briefing.summary,
            briefing,
            issues: {
              failed_jobs:     failedJobs.map(j => ({
                sop_id:     j.sop_id,
                sop_name:   j.sop_name,
                last_run:   j.last_run,
                last_error: j.last_error,
              })),
              stale_approvals: staleApprovals.map(a => ({
                id:           a.id,
                created_at:   a.created_at,
                content_type: a.content_type,
                priority:     a.priority,
                title:        (a.content?.title as string | undefined) ?? 'Untitled',
              })),
              critical_alerts: criticalAlerts.map(a => ({
                id:         a.id,
                created_at: a.created_at,
                category:   a.category,
                message:    a.message,
                client_name: a.client_name,
              })),
            },
            metadata: {
              generated_at:         now.toISOString(),
              escalation_required:  briefing.escalation_required,
              overall_status:       briefing.overall_status,
            },
          },
        })
        .select('id')
        .single()

      if (queueErr) {
        console.error(`[sop-51] approval_queue insert failed: ${queueErr.message}`)
      } else {
        queueId = queueRow?.id ?? null
        console.log(`[sop-51] admin briefing queued — id ${queueId}, status: ${briefing.overall_status}`)
      }
    } else {
      console.log('[sop-51] all systems healthy — no approval item needed')
    }

    // ── 4. Audit log ──────────────────────────────────────────────────────────
    const outputSummary =
      `Status: ${briefing.overall_status} — ` +
      `${failedJobs.length} failed jobs, ${staleApprovals.length} stale approvals, ` +
      `${criticalAlerts.length} critical alerts${queueId ? '; briefing queued' : ''}`

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    HAIKU,
      status:         'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `Weekly check: cron jobs, approval queue, critical alerts`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({
        briefing,
        issues: {
          failed_jobs:     failedJobs.length,
          stale_approvals: staleApprovals.length,
          critical_alerts: criticalAlerts.length,
        },
        queue_id: queueId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-51] fatal: ${message}`)

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    HAIKU,
        status:         'failure',
        duration_ms:    Date.now() - startedAt,
        input_summary:  'admin check run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
