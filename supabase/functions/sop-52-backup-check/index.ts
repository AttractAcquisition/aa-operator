// Model: claude-haiku-4-5-20251001 — system health synthesis and alerting.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const HAIKU    = 'claude-haiku-4-5-20251001'
const SOP_ID   = '52'
const SOP_NAME = 'SOP 52 — Backup & Security Check'

// SOPs that run daily (or every weekday) — checked for 25-hour freshness.
// Weekly/monthly SOPs are checked for last_status only, not freshness.
const DAILY_SOPS = ['58', '21', '23', '06', '26']

// Required environment variables that must be present for the system to function.
const REQUIRED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'META_ACCESS_TOKEN',
  'META_AD_ACCOUNT_ID',
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface CronRow {
  sop_id:      string
  sop_name:    string
  last_status: string | null
  last_run:    string | null
  is_active:   boolean
}

interface TaskLogRow {
  sop_id:     string
  status:     string
  created_at: string
}

interface CheckResult {
  name:    string
  ok:      boolean
  detail:  string
}

interface HealthReport {
  generated_at:    string
  overall_ok:      boolean
  failure_count:   number
  checks:          CheckResult[]
  summary:         string
}

// ─── Claude summary ───────────────────────────────────────────────────────────

async function generateSummary(report: Omit<HealthReport, 'summary'>): Promise<string> {
  const lines = report.checks.map(c => `[${c.ok ? 'OK' : 'FAIL'}] ${c.name}: ${c.detail}`).join('\n')

  const response = await anthropic.messages.create({
    model:      HAIKU,
    max_tokens: 200,
    system:     'You are a system reliability engineer. Given a health check report, write a single concise paragraph (max 3 sentences) summarising the system status, highlighting any failures, and stating the recommended action. Output plain text only.',
    messages:   [{ role: 'user', content: `Health check results (${report.failure_count} failure(s)):\n\n${lines}` }],
  })

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startedAt = Date.now()
  const checks: CheckResult[] = []

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const now25hAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()

    // ── Check 1: Required environment variables ──────────────────────────────
    const missingVars = REQUIRED_ENV_VARS.filter(v => !Deno.env.get(v))
    checks.push({
      name:   'Environment variables',
      ok:     missingVars.length === 0,
      detail: missingVars.length === 0
        ? `All ${REQUIRED_ENV_VARS.length} required vars present`
        : `Missing: ${missingVars.join(', ')}`,
    })

    // ── Check 2: Cron schedule — all active jobs ─────────────────────────────
    const { data: cronRows, error: cronErr } = await supabase
      .from('cron_schedule')
      .select('sop_id, sop_name, last_status, last_run, is_active')
      .eq('is_active', true)

    if (cronErr) {
      checks.push({ name: 'Cron schedule query', ok: false, detail: cronErr.message })
    } else {
      const rows = (cronRows ?? []) as CronRow[]

      // Sub-check 2a: any active job with last_status = 'failure'
      const failedJobs = rows.filter(r => r.last_status === 'failure')
      checks.push({
        name:   'Cron job last status',
        ok:     failedJobs.length === 0,
        detail: failedJobs.length === 0
          ? `${rows.length} active jobs — all last statuses clean`
          : `Failed: ${failedJobs.map(r => `SOP ${r.sop_id} (${r.sop_name})`).join(', ')}`,
      })

      // Sub-check 2b: daily SOPs must have run in the last 25 hours
      const { data: recentLogs, error: logErr } = await supabase
        .from('ai_task_log')
        .select('sop_id, status, created_at')
        .in('sop_id', DAILY_SOPS)
        .eq('status', 'success')
        .gte('created_at', now25hAgo)

      if (logErr) {
        checks.push({ name: 'Daily SOP freshness (ai_task_log)', ok: false, detail: logErr.message })
      } else {
        const recentSopIds = new Set((recentLogs ?? []).map((r: TaskLogRow) => r.sop_id))
        const staleSops = DAILY_SOPS.filter(id => !recentSopIds.has(id))
        const staleSopNames = staleSops.map(id => {
          const row = rows.find(r => r.sop_id === id)
          return row ? `SOP ${id} (${row.sop_name})` : `SOP ${id}`
        })
        checks.push({
          name:   'Daily SOP freshness (25 h)',
          ok:     staleSops.length === 0,
          detail: staleSops.length === 0
            ? `All ${DAILY_SOPS.length} daily SOPs ran successfully in the last 25 hours`
            : `Stale (no recent success): ${staleSopNames.join(', ')}`,
        })
      }
    }

    // ── Check 3: Edge Function health ping (sop-58-daily-briefing) ───────────
    try {
      const { data: pingData, error: pingErr } = await supabase.functions.invoke(
        'sop-58-daily-briefing',
        { body: { dry_run: true } },
      )
      checks.push({
        name:   'Edge Function ping (sop-58)',
        ok:     !pingErr && pingData?.ok === true,
        detail: pingErr
          ? `Invocation error: ${pingErr.message}`
          : (pingData?.ok === true ? 'Responded OK with dry_run=true' : `Unexpected response: ${JSON.stringify(pingData)}`),
      })
    } catch (pingEx) {
      const msg = pingEx instanceof Error ? pingEx.message : String(pingEx)
      checks.push({ name: 'Edge Function ping (sop-58)', ok: false, detail: msg })
    }

    // ── Aggregate results ────────────────────────────────────────────────────
    const failures    = checks.filter(c => !c.ok)
    const overallOk   = failures.length === 0
    const failureCount = failures.length

    console.log(`[sop-52] health check complete — ${failureCount} failure(s) across ${checks.length} checks`)

    // ── Claude summary ───────────────────────────────────────────────────────
    const partial: Omit<HealthReport, 'summary'> = {
      generated_at:  new Date().toISOString(),
      overall_ok:    overallOk,
      failure_count: failureCount,
      checks,
    }

    const summary = await generateSummary(partial)
    const report: HealthReport = { ...partial, summary }

    // ── Create ai_alerts for each failure ────────────────────────────────────
    if (failures.length > 0) {
      const alertInserts = failures.map(f => ({
        severity:         'critical' as const,
        sop_id:           SOP_ID,
        category:         'System Health',
        message:          `[${f.name}] ${f.detail}`,
        suggested_action: 'Review logs and environment configuration immediately.',
        client_name:      null,
        resolved:         false,
      }))

      const { error: alertErr } = await supabase.from('ai_alerts').insert(alertInserts)
      if (alertErr) {
        console.error(`[sop-52] alert insert failed: ${alertErr.message}`)
      } else {
        console.log(`[sop-52] ${alertInserts.length} critical alert(s) raised`)
      }
    }

    // ── Audit log ─────────────────────────────────────────────────────────────
    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    HAIKU,
      status:         overallOk ? 'success' : 'failure',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${checks.length} health checks performed`,
      output_summary: `${failureCount} failure(s): ${summary.slice(0, 200)}`,
    })

    return new Response(
      JSON.stringify({ health_report: report }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-52] fatal: ${message}`)

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await Promise.all([
        supabase.from('ai_alerts').insert({
          severity:         'critical',
          sop_id:           SOP_ID,
          category:         'System Health',
          message:          `Backup check function itself failed: ${message}`,
          suggested_action: 'Investigate sop-52-backup-check edge function logs immediately.',
          client_name:      null,
          resolved:         false,
        }),
        supabase.from('ai_task_log').insert({
          sop_id:         SOP_ID,
          sop_name:       SOP_NAME,
          tool_called:    HAIKU,
          status:         'failure',
          duration_ms:    Date.now() - startedAt,
          input_summary:  'backup check run',
          output_summary: `Fatal error: ${message}`,
        }),
      ])
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
