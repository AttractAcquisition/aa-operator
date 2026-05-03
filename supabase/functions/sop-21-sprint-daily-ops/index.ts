import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const SOP_ID   = '21'
const SOP_NAME = 'SOP 21 — Proof Sprint Daily Ops'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SprintRow {
  id: string
  client_name: string
  status: string
  day_number: number
  leads_generated: number
  leads_target: number
  spend: number
  spend_budget: number
  cpl: number
  cpl_target: number
  roas: number
  roas_target: number
  meta_sync_status: string | null
}

type HealthStatus = 'on_track' | 'at_risk' | 'off_track'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function healthStatus(cpl: number, cplTarget: number): HealthStatus {
  if (cplTarget <= 0) return 'on_track'
  const ratio = cpl / cplTarget
  if (ratio <= 1.10) return 'on_track'
  if (ratio <= 1.20) return 'at_risk'
  return 'off_track'
}

function pct(value: number, target: number): number {
  return target > 0 ? ((value - target) / target) * 100 : 0
}

function buildNotes(s: SprintRow, health: HealthStatus): string {
  const cplDelta  = pct(s.cpl, s.cpl_target)
  const roasDelta = pct(s.roas, s.roas_target)
  const pacePct   = s.leads_target > 0 ? (s.leads_generated / s.leads_target) * 100 : 0
  const budgetPct = s.spend_budget  > 0 ? (s.spend / s.spend_budget) * 100 : 0

  return [
    `Day ${s.day_number}: ${s.leads_generated}/${s.leads_target} leads (${pacePct.toFixed(1)}% of target)`,
    `CPL £${s.cpl.toFixed(2)} vs £${s.cpl_target} target` +
      (cplDelta > 0 ? ` (+${cplDelta.toFixed(1)}% over)` : ` (${Math.abs(cplDelta).toFixed(1)}% under)`),
    `ROAS ${s.roas.toFixed(2)}x vs ${s.roas_target}x target` +
      (roasDelta >= 0 ? ` (+${roasDelta.toFixed(1)}%)` : ` (${roasDelta.toFixed(1)}%)`),
    `Spend £${s.spend.toFixed(2)} / £${s.spend_budget} (${budgetPct.toFixed(1)}% used)`,
    `Health: ${health}`,
  ].join('. ')
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

    // ── 1. Fetch active sprints ───────────────────────────────────────────────
    const { data: initial, error: fetchErr } = await supabase
      .from('sprints')
      .select('*')
      .eq('status', 'active')

    if (fetchErr) throw new Error(`fetch sprints: ${fetchErr.message}`)

    const initialSprints = (initial ?? []) as SprintRow[]
    console.log(`[sop-21] ${initialSprints.length} active sprints`)

    if (initialSprints.length === 0) {
      await supabase.from('ai_task_log').insert({
        sop_id: SOP_ID, sop_name: SOP_NAME,
        tool_called: 'sop_21_sprint_daily_ops', status: 'success',
        duration_ms: Date.now() - startedAt,
        input_summary: '0 active sprints',
        output_summary: 'No active sprints — nothing to process',
      })
      return new Response(
        JSON.stringify({ message: 'No active sprints', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Sync latest Meta Ads data ─────────────────────────────────────────
    console.log('[sop-21] calling meta-ads-sync...')
    const { data: syncResult, error: syncErr } = await supabase.functions.invoke(
      'meta-ads-sync',
      { body: { date_preset: 'last_30d' } },
    )
    if (syncErr) {
      // Non-fatal: proceed with the metrics already in the DB
      console.warn(`[sop-21] meta-ads-sync warning (continuing with cached data): ${syncErr.message}`)
    } else {
      console.log(`[sop-21] meta-ads-sync done — synced=${syncResult?.synced ?? 0}, skipped=${syncResult?.skipped ?? 0}`)
    }

    // ── 3. Re-fetch sprints with freshly synced metrics ───────────────────────
    const { data: fresh, error: refreshErr } = await supabase
      .from('sprints')
      .select('*')
      .eq('status', 'active')

    if (refreshErr) throw new Error(`re-fetch sprints: ${refreshErr.message}`)

    const sprints = (fresh ?? []) as SprintRow[]
    const now     = new Date().toISOString()

    let logsCreated   = 0
    let alertsCreated = 0
    const errors: string[] = []

    // ── 4. Process each sprint ────────────────────────────────────────────────
    for (const sprint of sprints) {
      try {
        const health   = healthStatus(sprint.cpl, sprint.cpl_target)
        const cplDelta = pct(sprint.cpl, sprint.cpl_target)
        const notes    = buildNotes(sprint, health)

        console.log(`[sop-21] ${sprint.client_name} — ${health}, CPL delta ${cplDelta.toFixed(1)}%`)

        // Write daily sprint log entry
        const { error: logErr } = await supabase.from('sprint_logs').insert({
          sprint_id:       sprint.id,
          client_name:     sprint.client_name,
          logged_at:       now,
          health_status:   health,
          day_number:      sprint.day_number,
          leads_generated: sprint.leads_generated,
          leads_target:    sprint.leads_target,
          spend:           sprint.spend,
          cpl:             sprint.cpl,
          cpl_target:      sprint.cpl_target,
          roas:            sprint.roas,
          roas_target:     sprint.roas_target,
          notes,
        })

        if (logErr) {
          console.error(`[sop-21] sprint_logs insert failed for ${sprint.id}: ${logErr.message}`)
          errors.push(`sprint_log ${sprint.id}: ${logErr.message}`)
        } else {
          logsCreated++
          // Stamp last_log_at on the sprint
          await supabase.from('sprints').update({ last_log_at: now }).eq('id', sprint.id)
        }

        // ── 5. Alert when CPL > 20% over target ──────────────────────────────
        if (sprint.cpl_target > 0 && sprint.cpl > sprint.cpl_target * 1.2) {
          const severity: 'critical' | 'warning' =
            sprint.cpl > sprint.cpl_target * 1.5 ? 'critical' : 'warning'

          const suggestedAction = severity === 'critical'
            ? `Pause underperforming ad sets for ${sprint.client_name} immediately — CPL is ${cplDelta.toFixed(1)}% above target`
            : `Review and pause underperforming ad sets for ${sprint.client_name} — CPL is ${cplDelta.toFixed(1)}% above target`

          const { error: alertErr } = await supabase.from('ai_alerts').insert({
            severity,
            sop_id:           SOP_ID,
            category:         'Sprint Performance',
            message:          `${sprint.client_name} CPL £${sprint.cpl.toFixed(2)} is ${cplDelta.toFixed(1)}% over target (£${sprint.cpl_target})`,
            suggested_action: suggestedAction,
            client_name:      sprint.client_name,
            resolved:         false,
          })

          if (alertErr) {
            console.error(`[sop-21] alert insert failed for ${sprint.id}: ${alertErr.message}`)
            errors.push(`alert ${sprint.id}: ${alertErr.message}`)
          } else {
            alertsCreated++
            console.log(`[sop-21] ${severity} alert raised for ${sprint.client_name}`)
          }
        }
      } catch (sprintErr) {
        const msg = sprintErr instanceof Error ? sprintErr.message : String(sprintErr)
        console.error(`[sop-21] unhandled error processing sprint ${sprint.id}: ${msg}`)
        errors.push(`sprint ${sprint.id}: ${msg}`)
      }
    }

    // ── 6. Audit log ─────────────────────────────────────────────────────────
    const outputSummary =
      `${sprints.length} sprints processed, ${logsCreated} logs created, ${alertsCreated} alerts raised` +
      (errors.length > 0 ? `, ${errors.length} errors` : '')

    await supabase.from('ai_task_log').insert({
      sop_id:        SOP_ID,
      sop_name:      SOP_NAME,
      tool_called:   'sop_21_sprint_daily_ops',
      status:        errors.length > 0 && logsCreated === 0 ? 'failure' : 'success',
      duration_ms:   Date.now() - startedAt,
      input_summary: `${sprints.length} active sprints`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({
        processed:     sprints.length,
        logs_created:  logsCreated,
        alerts_raised: alertsCreated,
        meta_sync:     syncResult ?? null,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-21] fatal: ${message}`)

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await supabase.from('ai_task_log').insert({
        sop_id:        SOP_ID,
        sop_name:      SOP_NAME,
        tool_called:   'sop_21_sprint_daily_ops',
        status:        'failure',
        duration_ms:   Date.now() - startedAt,
        input_summary: 'sprint daily ops run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
