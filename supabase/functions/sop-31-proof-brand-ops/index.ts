// Model: claude-sonnet-4-6 — monthly delivery status checks for Proof Brand clients.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET    = 'claude-sonnet-4-6'
const SOP_ID    = '31'
const SOP_NAME  = 'SOP 31 — Proof Brand Monthly Ops'

// Proof Brand tier: £1500/mo, Google Ads + Meta Ads, 14-day proof sprint cadence.
// Upsell target: Authority Brand (£3000/mo, adds Remarketing).
const TIER_LABEL       = 'Proof Brand'
const UPSELL_TIER      = 'Authority Brand'
const UPSELL_THRESHOLD = 8

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  id:           string
  name:         string
  status:       string
  tier:         string
  niche:        string | null
  contact_name: string | null
}

interface SprintRow {
  id:               string
  client_name:      string
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
  meta_campaign_id: string | null
  start_date:       string | null
}

interface SprintLogRow {
  sprint_id:       string
  logged_at:       string
  day_number:      number
  leads_generated: number
  spend:           number
  cpl:             number
  roas:            number
  health_status:   string
}

interface AdSetLogRow {
  sprint_id:   string
  adset_name:  string
  date:        string
  spend:       number
  impressions: number
  clicks:      number
  cpl:         number
  cpl_target:  number | null
}

interface TrendResult {
  direction: 'improving' | 'worsening' | 'stable' | 'insufficient_data'
  delta_pct:  number
  label:      string
}

interface ClaudeOutput {
  upsell_score:     number
  upsell_rationale: string
  campaign_health:  string
  report_html:      string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function monthStart(): { iso: string; date: string } {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  const iso = d.toISOString()
  return { iso, date: iso.slice(0, 10) }
}

// Splits sorted logs into first/second half and returns direction of change.
// CPL: lower is better, so a negative delta is "improving".
// ROAS: higher is better, so a positive delta is "improving".
function computeTrend(
  logs: SprintLogRow[],
  field: 'cpl' | 'roas',
): TrendResult {
  if (logs.length < 4) {
    return { direction: 'insufficient_data', delta_pct: 0, label: 'Insufficient data (< 4 log entries)' }
  }

  const sorted   = logs.slice().sort((a, b) => a.logged_at.localeCompare(b.logged_at))
  const mid      = Math.floor(sorted.length / 2)
  const avg      = (arr: SprintLogRow[]) => arr.reduce((s, l) => s + l[field], 0) / arr.length
  const firstAvg = avg(sorted.slice(0, mid))
  const lastAvg  = avg(sorted.slice(mid))

  if (firstAvg === 0) {
    return { direction: 'insufficient_data', delta_pct: 0, label: 'No baseline data' }
  }

  const delta = ((lastAvg - firstAvg) / firstAvg) * 100
  const improving = field === 'cpl' ? delta < -5 : delta > 5
  const worsening = field === 'cpl' ? delta > 5  : delta < -5

  const direction: TrendResult['direction'] = improving ? 'improving' : worsening ? 'worsening' : 'stable'
  const sign      = improving ? '↓' : worsening ? '↑' : '→'
  const qualifier = improving ? 'improving' : worsening ? 'worsening' : 'stable'

  return {
    direction,
    delta_pct: parseFloat(delta.toFixed(1)),
    label: `${sign} ${qualifier} (${Math.abs(delta).toFixed(1)}% ${field === 'cpl' ? 'CPL' : 'ROAS'} shift month-to-date)`,
  }
}

function campaignHealthSummary(logs: SprintLogRow[]): string {
  if (logs.length === 0) return 'No log data available'
  const counts = { on_track: 0, at_risk: 0, off_track: 0 }
  for (const l of logs) {
    if (l.health_status in counts) counts[l.health_status as keyof typeof counts]++
  }
  const total  = logs.length
  const onPct  = ((counts.on_track  / total) * 100).toFixed(0)
  const riskPct = ((counts.at_risk   / total) * 100).toFixed(0)
  const offPct = ((counts.off_track / total) * 100).toFixed(0)
  return `${onPct}% on-track, ${riskPct}% at-risk, ${offPct}% off-track across ${total} daily checks`
}

// ─── Claude call + response parsing ──────────────────────────────────────────

async function generateDeliveryCheck(
  client:     ClientRow,
  sprint:     SprintRow | null,
  monthLogs:  SprintLogRow[],
  adSetLogs:  AdSetLogRow[],
  monthStart: string,
  today:      string,
): Promise<ClaudeOutput> {
  const cplTrend  = computeTrend(monthLogs, 'cpl')
  const roasTrend = computeTrend(monthLogs, 'roas')
  const healthSummary = campaignHealthSummary(monthLogs)

  // Month-to-date lead delta: newest snapshot minus start-of-month snapshot
  let monthLeads = 0
  let monthSpend = 0
  if (sprint && monthLogs.length > 0) {
    const sorted  = monthLogs.slice().sort((a, b) => a.logged_at.localeCompare(b.logged_at))
    const oldest  = sorted[0]
    const newest  = sorted[sorted.length - 1]
    monthLeads = Math.max(0, newest.leads_generated - oldest.leads_generated)
    monthSpend = Math.max(0, newest.spend - oldest.spend)
  } else if (sprint) {
    monthLeads = sprint.leads_generated
    monthSpend = sprint.spend
  }

  // Best and worst ad sets by CPL this month
  const adSetSummary = adSetLogs.length > 0
    ? (() => {
        const byAdSet = new Map<string, number[]>()
        for (const l of adSetLogs) {
          if (l.cpl > 0) {
            const arr = byAdSet.get(l.adset_name) ?? []
            arr.push(l.cpl)
            byAdSet.set(l.adset_name, arr)
          }
        }
        const ranked = [...byAdSet.entries()]
          .map(([name, cpls]) => ({ name, avg_cpl: cpls.reduce((s, v) => s + v, 0) / cpls.length }))
          .sort((a, b) => a.avg_cpl - b.avg_cpl)
        const best  = ranked[0]
        const worst = ranked[ranked.length - 1]
        return [
          `Best ad set: "${best?.name ?? 'N/A'}" avg CPL £${best?.avg_cpl.toFixed(2) ?? '-'}`,
          `Worst ad set: "${worst?.name ?? 'N/A'}" avg CPL £${worst?.avg_cpl.toFixed(2) ?? '-'}`,
          `Total ad sets tracked: ${byAdSet.size}`,
        ].join(' | ')
      })()
    : 'No ad set breakdown available'

  const sprintContext = sprint
    ? `Sprint day: ${sprint.day_number}/14
Leads MTD: ${monthLeads} / ${sprint.leads_target} target (${sprint.leads_target > 0 ? ((monthLeads / sprint.leads_target) * 100).toFixed(0) : '0'}% of target)
Total spend MTD: £${monthSpend.toFixed(2)} / £${sprint.spend_budget} budget
Current CPL: £${sprint.cpl.toFixed(2)} vs £${sprint.cpl_target} target
Current ROAS: ${sprint.roas.toFixed(2)}x vs ${sprint.roas_target}x target
Impressions: ${sprint.impressions.toLocaleString()} | Clicks: ${sprint.clicks.toLocaleString()} | CTR: ${sprint.impressions > 0 ? ((sprint.clicks / sprint.impressions) * 100).toFixed(2) : '0'}%
CPL trend (MTD): ${cplTrend.label}
ROAS trend (MTD): ${roasTrend.label}
Campaign health: ${healthSummary}
Ad set performance: ${adSetSummary}`
    : 'No active sprint found this month.'

  const prompt = `Client: ${client.name}
Tier: ${TIER_LABEL} (£1500/mo | Google Ads + Meta Ads)
Niche: ${client.niche ?? 'Local service business'}
Period: ${monthStart} to ${today}

${sprintContext}

Upsell context: A score of ${UPSELL_THRESHOLD}+ means the client is a strong candidate to upgrade to ${UPSELL_TIER} (£3000/mo, adds Remarketing). Base your score on: CPL performance vs target, ROAS vs target, leads pace, trend direction, and overall campaign health.`

  const response = await anthropic.messages.create({
    model:      SONNET,
    max_tokens: 3000,
    system: [
      `You produce monthly delivery status checks for Attract Acquisition's ${TIER_LABEL} clients.`,
      `${TIER_LABEL} clients pay £1500/mo for Google Ads + Meta Ads management on a 14-day proof sprint cadence.`,
      '',
      'Your response MUST follow this exact structure — no deviations:',
      '',
      'SCORE_JSON: {"upsell_score":<1-10>,"upsell_rationale":"<one sentence, max 20 words>","campaign_health":"<Healthy|Mixed|Underperforming>"}',
      '',
      '<!DOCTYPE html>',
      '<html>... (full HTML report below)',
      '',
      'HTML report sections (in order):',
      '  1. Executive Summary — overall verdict in 2-3 sentences; is the client getting results?',
      '  2. Leads This Month vs Target — MTD count, target, percentage to target, trend',
      '  3. CPL Trend — current CPL, target, month-over-month direction, interpretation',
      '  4. ROAS Trend — current ROAS, target, direction, revenue efficiency commentary',
      '  5. Campaign Health — health status breakdown, top/bottom ad sets, key observations',
      '  6. Recommended Optimisations — 3 specific, data-driven actions for next 14 days',
      `  7. Upsell Readiness (score from SCORE_JSON) — what's working, what would ${UPSELL_TIER} add for this client`,
      '',
      'HTML style rules (inline styles only):',
      '  - max-width 700px, margin auto, font-family Arial/sans-serif, color #1a1a1a, background #fff',
      '  - Header: background #1a1a2e, white text, padding 24px 32px; client name + period + tier badge',
      '  - Section <h2>: color #1a1a2e, border-bottom 2px solid #1a1a2e, margin-top 28px',
      '  - Upsell score badge: large number (48px), green if ≥8 (#22c55e), amber if 5-7 (#f59e0b), red if ≤4 (#ef4444)',
      '  - Metric tables: width 100%, border-collapse collapse, alternating rows #f9f9f9',
      '  - Status indicators: inline coloured spans — green on-track, amber at-risk, red off-track',
      '  - Footer: light grey background, small text, "Generated by AA Operator · Attract Acquisition"',
    ].join('\n'),
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  // Extract SCORE_JSON line
  const jsonLine  = raw.match(/^SCORE_JSON:\s*(\{[^\n]+\})/m)
  let upsellScore      = 5
  let upsellRationale  = 'Score could not be parsed from model response'
  let campaignHealth   = 'Unknown'

  if (jsonLine) {
    try {
      const parsed    = JSON.parse(jsonLine[1])
      upsellScore     = Math.min(10, Math.max(1, parseInt(String(parsed.upsell_score), 10) || 5))
      upsellRationale = String(parsed.upsell_rationale ?? upsellRationale)
      campaignHealth  = String(parsed.campaign_health ?? campaignHealth)
    } catch {
      console.warn(`[sop-31] SCORE_JSON parse failed for ${client.name} — using defaults`)
    }
  } else {
    console.warn(`[sop-31] No SCORE_JSON found in response for ${client.name}`)
  }

  // Extract HTML (everything from <!DOCTYPE html> onward)
  const htmlMatch = raw.match(/<!DOCTYPE html>[\s\S]*/i)
  const reportHtml = htmlMatch ? htmlMatch[0] : `<!DOCTYPE html><html><body><p>Report generation failed for ${client.name}.</p></body></html>`

  return {
    upsell_score:     upsellScore,
    upsell_rationale: upsellRationale,
    campaign_health:  campaignHealth,
    report_html:      reportHtml,
  }
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

    const { iso: mStart, date: mStartDate } = monthStart()
    const today = new Date().toISOString().slice(0, 10)

    // ── 1. Fetch active proof_brand clients ───────────────────────────────────
    const { data: rawClients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, name, status, tier, niche, contact_name')
      .eq('status', 'active')
      .eq('tier', 'proof_brand')

    if (clientsErr) throw new Error(`fetch clients: ${clientsErr.message}`)

    const clients = (rawClients ?? []) as ClientRow[]
    console.log(`[sop-31] ${clients.length} active proof_brand clients`)

    if (clients.length === 0) {
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    SONNET,
        status:         'success',
        duration_ms:    Date.now() - startedAt,
        input_summary:  '0 proof_brand clients',
        output_summary: 'No active proof_brand clients — nothing to process',
      })
      return new Response(
        JSON.stringify({ message: 'No active proof_brand clients', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Bulk-fetch all active sprints indexed by client_name ───────────────
    const { data: rawSprints, error: sprintsErr } = await supabase
      .from('sprints')
      .select([
        'id', 'client_name', 'day_number',
        'leads_generated', 'leads_target',
        'spend', 'spend_budget', 'cpl', 'cpl_target',
        'roas', 'roas_target', 'impressions', 'clicks',
        'meta_campaign_id', 'start_date',
      ].join(', '))
      .eq('status', 'active')

    if (sprintsErr) throw new Error(`fetch sprints: ${sprintsErr.message}`)

    const sprints        = (rawSprints ?? []) as SprintRow[]
    const sprintByClient = new Map<string, SprintRow>(
      sprints.map(s => [s.client_name.toLowerCase().trim(), s]),
    )
    const sprintIds = sprints.map(s => s.id)

    console.log(`[sop-31] ${sprints.length} active sprints found`)

    // ── 3. Bulk-fetch month-to-date sprint logs ───────────────────────────────
    const logsBySprint = new Map<string, SprintLogRow[]>()

    if (sprintIds.length > 0) {
      const { data: rawLogs, error: logsErr } = await supabase
        .from('sprint_logs')
        .select('sprint_id, logged_at, day_number, leads_generated, spend, cpl, roas, health_status')
        .in('sprint_id', sprintIds)
        .gte('logged_at', mStart)
        .order('logged_at', { ascending: true })

      if (logsErr) throw new Error(`fetch sprint_logs: ${logsErr.message}`)

      for (const log of (rawLogs ?? []) as SprintLogRow[]) {
        const arr = logsBySprint.get(log.sprint_id) ?? []
        arr.push(log)
        logsBySprint.set(log.sprint_id, arr)
      }
    }

    // ── 4. Bulk-fetch month-to-date ad set logs ───────────────────────────────
    const adLogsBySprint = new Map<string, AdSetLogRow[]>()

    if (sprintIds.length > 0) {
      const { data: rawAdLogs, error: adLogsErr } = await supabase
        .from('ad_set_performance_logs')
        .select('sprint_id, adset_name, date, spend, impressions, clicks, cpl, cpl_target')
        .in('sprint_id', sprintIds)
        .gte('date', mStartDate)
        .order('date', { ascending: false })

      if (adLogsErr) {
        // Non-fatal: ad set logs may not be synced yet
        console.warn(`[sop-31] ad_set_performance_logs fetch warning: ${adLogsErr.message}`)
      } else {
        for (const log of (rawAdLogs ?? []) as AdSetLogRow[]) {
          const arr = adLogsBySprint.get(log.sprint_id) ?? []
          arr.push(log)
          adLogsBySprint.set(log.sprint_id, arr)
        }
      }
    }

    // ── 5. Process each proof_brand client ────────────────────────────────────
    let reportsGenerated     = 0
    let approvalItemsCreated = 0
    let alertsCreated        = 0
    const approvalIds: string[] = []
    const upsellClients: string[] = []
    const errors: string[]       = []

    for (const client of clients) {
      try {
        console.log(`[sop-31] processing ${client.name}...`)

        const sprint    = sprintByClient.get(client.name.toLowerCase().trim()) ?? null
        const monthLogs = sprint ? (logsBySprint.get(sprint.id)    ?? []) : []
        const adSetLogs = sprint ? (adLogsBySprint.get(sprint.id)  ?? []) : []

        // ── 5a. Generate delivery check via Claude Sonnet ─────────────────────
        const output = await generateDeliveryCheck(
          client, sprint, monthLogs, adSetLogs, mStartDate, today,
        )
        reportsGenerated++

        console.log(
          `[sop-31] ${client.name} — score ${output.upsell_score}/10, health: ${output.campaign_health}`,
        )

        // ── 5b. Write to approval_queue ───────────────────────────────────────
        const periodLabel = `${mStartDate} – ${today}`

        const { data: approvalRow, error: approvalErr } = await supabase
          .from('approval_queue')
          .insert({
            sop_id:       SOP_ID,
            sop_name:     SOP_NAME,
            status:       'pending',
            priority:     'medium',
            content_type: 'client_report',
            content_id:   crypto.randomUUID(),
            content: {
              title:       `Proof Brand Monthly Check — ${client.name} — ${periodLabel}`,
              body:        `Monthly delivery status check for ${client.name} (${TIER_LABEL}). Upsell score: ${output.upsell_score}/10. Campaign health: ${output.campaign_health}.`,
              html_report: output.report_html,
              metadata: {
                client_id:        client.id,
                client_name:      client.name,
                tier:             'proof_brand',
                sprint_id:        sprint?.id ?? null,
                sprint_day:       sprint?.day_number ?? null,
                period_label:     periodLabel,
                upsell_score:     output.upsell_score,
                upsell_rationale: output.upsell_rationale,
                campaign_health:  output.campaign_health,
                cpl:              sprint?.cpl ?? null,
                cpl_target:       sprint?.cpl_target ?? null,
                roas:             sprint?.roas ?? null,
                roas_target:      sprint?.roas_target ?? null,
              },
            },
          })
          .select('id')
          .single()

        if (approvalErr) {
          console.error(`[sop-31] approval_queue insert failed for ${client.name}: ${approvalErr.message}`)
          errors.push(`approval ${client.name}: ${approvalErr.message}`)
        } else {
          approvalItemsCreated++
          approvalIds.push(approvalRow?.id ?? '')
          console.log(`[sop-31] approval item created for ${client.name}: ${approvalRow?.id}`)
        }

        // ── 5c. Alert if upsell score meets threshold ─────────────────────────
        if (output.upsell_score >= UPSELL_THRESHOLD) {
          upsellClients.push(client.name)

          const { error: alertErr } = await supabase.from('ai_alerts').insert({
            severity:         'info',
            sop_id:           SOP_ID,
            category:         'Upsell Opportunity',
            message:          `${client.name} upsell-ready: score ${output.upsell_score}/10 — ${output.upsell_rationale}`,
            suggested_action: `Propose ${UPSELL_TIER} upgrade to ${client.contact_name ?? client.name}. Current tier: ${TIER_LABEL} (£1500/mo). Next tier: ${UPSELL_TIER} (£3000/mo, adds Remarketing).`,
            client_name:      client.name,
            resolved:         false,
          })

          if (alertErr) {
            console.error(`[sop-31] alert insert failed for ${client.name}: ${alertErr.message}`)
            errors.push(`alert ${client.name}: ${alertErr.message}`)
          } else {
            alertsCreated++
            console.log(`[sop-31] upsell alert created for ${client.name} (score ${output.upsell_score})`)
          }
        }
      } catch (clientErr) {
        const msg = clientErr instanceof Error ? clientErr.message : String(clientErr)
        console.error(`[sop-31] error processing ${client.name}: ${msg}`)
        errors.push(`${client.name}: ${msg}`)
      }
    }

    // ── 6. Audit log ──────────────────────────────────────────────────────────
    const upsellNote = upsellClients.length > 0
      ? `, ${upsellClients.length} upsell alerts (${upsellClients.join(', ')})`
      : ''

    const outputSummary =
      `${reportsGenerated} delivery checks generated, ${approvalItemsCreated} approval items created` +
      upsellNote +
      (errors.length > 0 ? `, ${errors.length} errors: ${errors.slice(0, 3).join('; ')}` : '')

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    SONNET,
      status:         errors.length > 0 && reportsGenerated === 0 ? 'failure' : 'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${clients.length} proof_brand clients, ${sprints.length} active sprints, period: ${mStartDate}–${today}`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({
        processed:               clients.length,
        reports_generated:       reportsGenerated,
        approval_items_created:  approvalItemsCreated,
        upsell_alerts_created:   alertsCreated,
        upsell_clients:          upsellClients,
        approval_ids:            approvalIds,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-31] fatal: ${message}`)

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
        input_summary:  'proof_brand monthly ops run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
