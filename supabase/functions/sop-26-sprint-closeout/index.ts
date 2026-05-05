// Model: claude-sonnet-4-6 — sprint closeout reports and next-step recommendations.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET    = 'claude-sonnet-4-6'
const SOP_ID    = '26'
const SOP_NAME  = 'SOP 26 — Sprint Closeout'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SprintRow {
  id:               string
  client_name:      string
  status:           string
  day_number:       number
  leads_generated:  number
  leads_target:     number
  spend:            number
  spend_budget:     number
  cpl:              number
  cpl_target:       number
  roas:             number
  roas_target:      number
  impressions:      number
  clicks:           number
  start_date:       string | null
  end_date:         string | null
  meta_campaign_id: string | null
}

interface AdSetLogRow {
  adset_name:  string
  spend:       number
  impressions: number
  clicks:      number
  cpl:         number
  cpl_target:  number | null
}

interface CloseoutAnalysis {
  totalLeads:       number
  finalCPL:         number
  finalROAS:        number
  cplVsTarget:      string
  roasVsTarget:     string
  budgetUtilisation: string
  leadPaceVsTarget: string
  ctr:              string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function analyse(s: SprintRow): CloseoutAnalysis {
  const cplDelta  = s.cpl_target > 0 ? ((s.cpl / s.cpl_target - 1) * 100) : 0
  const roasDelta = s.roas_target > 0 ? ((s.roas / s.roas_target - 1) * 100) : 0
  const budgetPct = s.spend_budget > 0 ? (s.spend / s.spend_budget) * 100 : 0
  const leadPct   = s.leads_target > 0 ? (s.leads_generated / s.leads_target) * 100 : 0
  const ctr       = s.impressions  > 0 ? (s.clicks / s.impressions) * 100 : 0

  return {
    totalLeads:        s.leads_generated,
    finalCPL:          s.cpl,
    finalROAS:         s.roas,
    cplVsTarget:       `${cplDelta >= 0 ? '+' : ''}${cplDelta.toFixed(1)}%`,
    roasVsTarget:      `${roasDelta >= 0 ? '+' : ''}${roasDelta.toFixed(1)}%`,
    budgetUtilisation: `${budgetPct.toFixed(1)}%`,
    leadPaceVsTarget:  `${leadPct.toFixed(1)}%`,
    ctr:               `${ctr.toFixed(2)}%`,
  }
}

// ─── Claude analysis ──────────────────────────────────────────────────────────

interface CloseoutReport {
  summary:        string
  keyLearnings:   string[]
  recommendation: 'continue_as_proof_brand' | 'repeat_sprint' | 'pause'
  rationale:      string
  nextSteps:      string[]
}

async function generateCloseoutReport(
  sprint:     SprintRow,
  adSetLogs:  AdSetLogRow[],
  metrics:    CloseoutAnalysis,
): Promise<CloseoutReport> {
  const adSetSection = adSetLogs.length > 0
    ? adSetLogs.map(a =>
        `  ${a.adset_name}: spend £${a.spend.toFixed(2)}, CPL £${a.cpl.toFixed(2)}` +
        (a.cpl_target ? ` vs £${a.cpl_target} target` : '') +
        `, ${a.impressions} impressions, ${a.clicks} clicks`,
      ).join('\n')
    : '  No ad set breakdown available'

  const context = `SPRINT CLOSEOUT DATA
Client: ${sprint.client_name}
Sprint dates: ${sprint.start_date ?? 'unknown'} → ${sprint.end_date ?? 'today'}
Sprint day: ${sprint.day_number} of 14

FINAL METRICS:
  Leads generated: ${metrics.totalLeads} / ${sprint.leads_target} target (${metrics.leadPaceVsTarget} of target)
  CPL: £${metrics.finalCPL.toFixed(2)} vs £${sprint.cpl_target} target (${metrics.cplVsTarget} vs target)
  ROAS: ${metrics.finalROAS.toFixed(2)}x vs ${sprint.roas_target}x target (${metrics.roasVsTarget} vs target)
  Spend: £${sprint.spend.toFixed(2)} / £${sprint.spend_budget} budget (${metrics.budgetUtilisation} utilised)
  Impressions: ${sprint.impressions.toLocaleString()}
  Clicks: ${sprint.clicks.toLocaleString()}
  CTR: ${metrics.ctr}

AD SET PERFORMANCE:
${adSetSection}`

  const response = await anthropic.messages.create({
    model:      SONNET,
    max_tokens: 1200,
    system: [
      'You are an expert performance marketing analyst for Attract Acquisition,',
      'an agency running paid advertising (Meta Ads) for local service businesses.',
      '',
      'Analyse the sprint closeout data and return a JSON object with exactly these keys:',
      '  summary        — string: 2-3 sentence executive summary of the sprint',
      '  keyLearnings   — string[]: 3-5 bullet points of what we learned (campaign, audience, offer insights)',
      '  recommendation — one of: "continue_as_proof_brand" | "repeat_sprint" | "pause"',
      '                   continue_as_proof_brand: CPL ≤ target, leads ≥ 80% of target, strong ROAS — client ready to scale',
      '                   repeat_sprint: CPL within 20% of target or leads 60-79% of target — good signal, needs another sprint',
      '                   pause: CPL > 20% over target AND leads < 60% of target — fundamentals need reviewing',
      '  rationale      — string: 2-3 sentences explaining the recommendation decision',
      '  nextSteps      — string[]: 3-5 specific, actionable next steps for the account manager',
      '',
      'Output ONLY valid JSON — no markdown fences, no explanation.',
    ].join('\n'),
    messages: [
      {
        role:    'user',
        content: `Analyse this sprint and produce the closeout JSON:\n\n${context}`,
      },
    ],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  return JSON.parse(raw) as CloseoutReport
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

    // ── 1. Fetch sprints ready for closeout ──────────────────────────────────
    const { data: rawSprints, error: sprintsErr } = await supabase
      .from('sprints')
      .select([
        'id', 'client_name', 'status', 'day_number',
        'leads_generated', 'leads_target',
        'spend', 'spend_budget', 'cpl', 'cpl_target',
        'roas', 'roas_target', 'impressions', 'clicks',
        'start_date', 'end_date', 'meta_campaign_id',
      ].join(', '))
      .eq('status', 'active')
      .gte('day_number', 14)

    if (sprintsErr) throw new Error(`fetch sprints: ${sprintsErr.message}`)

    const sprints = (rawSprints ?? []) as SprintRow[]
    console.log(`[sop-26] ${sprints.length} sprints eligible for closeout`)

    if (sprints.length === 0) {
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    SONNET,
        status:         'success',
        duration_ms:    Date.now() - startedAt,
        input_summary:  '0 sprints at day 14+',
        output_summary: 'No sprints ready for closeout',
      })
      return new Response(
        JSON.stringify({ message: 'No sprints ready for closeout', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Bulk-fetch ad set performance logs for each sprint ────────────────
    const sprintIds = sprints.map(s => s.id)
    let adLogsBySprint = new Map<string, AdSetLogRow[]>()

    const { data: rawAdLogs, error: adLogsErr } = await supabase
      .from('ad_set_performance_logs')
      .select('sprint_id, adset_name, spend, impressions, clicks, cpl, cpl_target')
      .in('sprint_id', sprintIds)
      .order('spend', { ascending: false })

    if (adLogsErr) {
      console.warn(`[sop-26] ad_set_performance_logs fetch warning: ${adLogsErr.message}`)
    } else {
      for (const log of (rawAdLogs ?? []) as (AdSetLogRow & { sprint_id: string })[]) {
        const arr = adLogsBySprint.get(log.sprint_id) ?? []
        arr.push(log)
        adLogsBySprint.set(log.sprint_id, arr)
      }
    }

    // ── 3. Process each sprint ───────────────────────────────────────────────
    let closedOut         = 0
    let approvalCreated   = 0
    let alertsCreated     = 0
    const approvalIds: string[] = []
    const errors: string[]      = []

    for (const sprint of sprints) {
      try {
        console.log(`[sop-26] closing out sprint for ${sprint.client_name} (day ${sprint.day_number})`)

        const adSetLogs = adLogsBySprint.get(sprint.id) ?? []
        const metrics   = analyse(sprint)

        // ── 3a. Generate AI analysis ─────────────────────────────────────────
        const report = await generateCloseoutReport(sprint, adSetLogs, metrics)
        console.log(`[sop-26] ${sprint.client_name} → recommendation: ${report.recommendation}`)

        // ── 3b. Mark sprint as complete ──────────────────────────────────────
        const { error: updateErr } = await supabase
          .from('sprints')
          .update({ status: 'complete' })
          .eq('id', sprint.id)

        if (updateErr) {
          console.error(`[sop-26] sprint update failed for ${sprint.id}: ${updateErr.message}`)
          errors.push(`sprint update ${sprint.id}: ${updateErr.message}`)
          continue
        }

        closedOut++

        // ── 3c. Create approval_queue item ───────────────────────────────────
        const today     = new Date().toISOString().slice(0, 10)
        const startDate = sprint.start_date ?? 'unknown'
        const reportTitle = `Sprint Closeout — ${sprint.client_name} — ${startDate} → ${today}`

        const recommendationLabel: Record<string, string> = {
          continue_as_proof_brand: 'Continue as Proof Brand',
          repeat_sprint:           'Repeat Sprint',
          pause:                   'Pause',
        }

        const contentBody = [
          report.summary,
          '',
          `Recommendation: ${recommendationLabel[report.recommendation] ?? report.recommendation}`,
          report.rationale,
          '',
          'Key Learnings:',
          ...report.keyLearnings.map(l => `• ${l}`),
          '',
          'Next Steps:',
          ...report.nextSteps.map(s => `• ${s}`),
        ].join('\n')

        const { data: approvalRow, error: approvalErr } = await supabase
          .from('approval_queue')
          .insert({
            sop_id:       SOP_ID,
            sop_name:     SOP_NAME,
            status:       'pending',
            priority:     'high',
            content_type: 'client_report',
            content_id:   crypto.randomUUID(),
            content: {
              title:  reportTitle,
              body:   contentBody,
              metadata: {
                client_name:      sprint.client_name,
                sprint_id:        sprint.id,
                sprint_day:       sprint.day_number,
                total_leads:      metrics.totalLeads,
                leads_target:     sprint.leads_target,
                final_cpl:        metrics.finalCPL,
                cpl_target:       sprint.cpl_target,
                cpl_vs_target:    metrics.cplVsTarget,
                final_roas:       metrics.finalROAS,
                roas_target:      sprint.roas_target,
                budget_used_pct:  metrics.budgetUtilisation,
                recommendation:   report.recommendation,
                key_learnings:    report.keyLearnings,
                next_steps:       report.nextSteps,
              },
            },
          })
          .select('id')
          .single()

        if (approvalErr) {
          console.error(`[sop-26] approval_queue insert failed for ${sprint.client_name}: ${approvalErr.message}`)
          errors.push(`approval ${sprint.client_name}: ${approvalErr.message}`)
        } else {
          approvalCreated++
          approvalIds.push(approvalRow?.id ?? '')
          console.log(`[sop-26] approval item created for ${sprint.client_name}: ${approvalRow?.id}`)
        }

        // ── 3d. Create ai_alert for sprint completion ────────────────────────
        const alertMsg = [
          `Sprint complete — ${sprint.client_name}: ${metrics.totalLeads} leads at CPL £${metrics.finalCPL.toFixed(2)}`,
          `(${metrics.cplVsTarget} vs £${sprint.cpl_target} target, ROAS ${metrics.finalROAS.toFixed(2)}x).`,
          `Recommendation: ${recommendationLabel[report.recommendation] ?? report.recommendation}.`,
        ].join(' ')

        const suggestedAction = report.nextSteps[0]
          ?? `Review sprint results for ${sprint.client_name} and action the closeout recommendation`

        const { error: alertErr } = await supabase.from('ai_alerts').insert({
          severity:         'info',
          sop_id:           SOP_ID,
          category:         'Sprint Closeout',
          message:          alertMsg,
          suggested_action: suggestedAction,
          client_name:      sprint.client_name,
          resolved:         false,
        })

        if (alertErr) {
          console.error(`[sop-26] alert insert failed for ${sprint.id}: ${alertErr.message}`)
          errors.push(`alert ${sprint.id}: ${alertErr.message}`)
        } else {
          alertsCreated++
          console.log(`[sop-26] alert created for ${sprint.client_name}`)
        }
      } catch (sprintErr) {
        const msg = sprintErr instanceof Error ? sprintErr.message : String(sprintErr)
        console.error(`[sop-26] error processing sprint ${sprint.id}: ${msg}`)
        errors.push(`${sprint.client_name}: ${msg}`)
      }
    }

    // ── 4. Audit log ─────────────────────────────────────────────────────────
    const outputSummary =
      `${closedOut} sprints closed, ${approvalCreated} approval items created, ${alertsCreated} alerts raised` +
      (errors.length > 0 ? `, ${errors.length} errors: ${errors.slice(0, 3).join('; ')}` : '')

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    SONNET,
      status:         errors.length > 0 && closedOut === 0 ? 'failure' : 'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${sprints.length} sprints at day 14+`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({
        processed:              sprints.length,
        sprints_closed:         closedOut,
        approval_items_created: approvalCreated,
        alerts_created:         alertsCreated,
        approval_ids:           approvalIds,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-26] fatal: ${message}`)

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
        input_summary:  'sprint closeout run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
