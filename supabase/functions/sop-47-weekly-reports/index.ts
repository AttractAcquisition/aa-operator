// Model: claude-sonnet-4-6 — professional weekly performance reports for active clients.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET    = 'claude-sonnet-4-6'
const SOP_ID    = '47'
const SOP_NAME  = 'SOP 47 — Weekly Client Reports'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  id:     string
  name:   string
  status: string
}

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

interface ClientReportData {
  client:     ClientRow
  sprint:     SprintRow | null
  recentLogs: SprintLogRow[]
  adSetLogs:  AdSetLogRow[]
  weekLeads:  number
  weekSpend:  number
}

// ─── Report generation ────────────────────────────────────────────────────────

async function generateReport(data: ClientReportData): Promise<string> {
  const { client, sprint, recentLogs, adSetLogs, weekLeads, weekSpend } = data
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const today   = new Date().toISOString().slice(0, 10)

  let context: string

  if (sprint) {
    const cplDelta     = sprint.cpl_target > 0 ? ((sprint.cpl / sprint.cpl_target - 1) * 100).toFixed(1) : '0'
    const cplDirection = sprint.cpl <= sprint.cpl_target ? 'under' : 'over'
    const roasDelta    = sprint.roas_target > 0 ? ((sprint.roas / sprint.roas_target - 1) * 100).toFixed(1) : '0'
    const ctr          = sprint.impressions > 0 ? ((sprint.clicks / sprint.impressions) * 100).toFixed(2) : '0'
    const budgetUsedPct = sprint.spend_budget > 0 ? ((sprint.spend / sprint.spend_budget) * 100).toFixed(1) : '0'
    const paceVsTarget = sprint.leads_target > 0
      ? ((sprint.leads_generated / sprint.leads_target) * 100).toFixed(1)
      : '0'

    const dailyTrend = recentLogs.length > 0
      ? recentLogs
          .slice()
          .sort((a, b) => a.logged_at.localeCompare(b.logged_at))
          .map(l =>
            `  ${l.logged_at.slice(0, 10)}: cumulative ${l.leads_generated} leads, CPL £${l.cpl.toFixed(2)}, ROAS ${l.roas.toFixed(2)}x, health: ${l.health_status}`,
          ).join('\n')
      : '  No daily log data available for this period'

    const adSetSection = adSetLogs.length > 0
      ? adSetLogs.map(a =>
          `  ${a.adset_name} (${a.date}): spend £${a.spend.toFixed(2)}, CPL £${a.cpl.toFixed(2)}` +
          (a.cpl_target ? ` vs £${a.cpl_target} target` : '') +
          `, impressions ${a.impressions}, clicks ${a.clicks}`,
        ).join('\n')
      : '  No ad set breakdown available (no Meta campaign linked or no sync data)'

    context = `Client: ${client.name}
Report period: ${weekAgo} to ${today}

SPRINT PERFORMANCE:
  Sprint day: ${sprint.day_number} of 14
  Leads generated (sprint total): ${sprint.leads_generated} / ${sprint.leads_target} target (${paceVsTarget}% of target)
  Leads this week: ${weekLeads}
  Spend this week: £${weekSpend.toFixed(2)}
  Total spend: £${sprint.spend.toFixed(2)} / £${sprint.spend_budget} budget (${budgetUsedPct}% used)
  CPL: £${sprint.cpl.toFixed(2)} vs £${sprint.cpl_target} target (${Math.abs(parseFloat(cplDelta))}% ${cplDirection} target)
  ROAS: ${sprint.roas.toFixed(2)}x vs ${sprint.roas_target}x target (${roasDelta}% vs target)
  Impressions: ${sprint.impressions.toLocaleString()}
  Clicks: ${sprint.clicks.toLocaleString()}
  CTR: ${ctr}%

DAILY TREND (last 7 days):
${dailyTrend}

AD SET PERFORMANCE (last 7 days):
${adSetSection}`
  } else {
    context = `Client: ${client.name}
Report period: ${weekAgo} to ${today}

No active sprint found for this client this week. This may be a client between sprints or awaiting campaign setup.`
  }

  const response = await anthropic.messages.create({
    model:      SONNET,
    max_tokens: 2500,
    system: [
      'You write professional weekly performance reports for Attract Acquisition,',
      'a performance marketing agency that runs paid advertising (Meta Ads) for local service businesses.',
      '',
      'Generate a clean, professional HTML report with these exact sections in order:',
      '  1. Executive Summary — 2-3 sentences on overall performance vs targets, including a clear verdict',
      '  2. Leads Generated — week total, sprint total, pace vs target, trend commentary',
      '  3. CPL vs Target — current CPL, target CPL, delta percentage, trend interpretation',
      '  4. ROAS — current ROAS vs target, revenue efficiency commentary',
      '  5. Ad Performance Highlights — top/bottom performing ad sets this week, CTR, key observations',
      '  6. Next Week Focus — 2-3 specific, data-driven, actionable recommendations',
      '',
      'HTML formatting rules:',
      '  - Inline styles throughout; no external CSS or <style> blocks',
      '  - Page: max-width 700px, margin auto, font-family Arial/sans-serif, color #1a1a1a, background #fff',
      '  - Header: background #1a1a2e, white text, padding 24px 32px; show client name + date range',
      '  - Section headings: <h2> with color #1a1a2e, border-bottom 2px solid #1a1a2e, margin-top 28px',
      '  - Metric tables: width 100%, border-collapse collapse, alternating row background #f9f9f9',
      '  - Status badges: inline spans — green (#22c55e) for on-track, amber (#f59e0b) for at-risk, red (#ef4444) for off-track',
      '  - Bullet lists: <ul> with margin-left 20px, line-height 1.7',
      '  - Footer: light grey background, small text, "Generated by AA Operator · Attract Acquisition"',
      '  - Output ONLY the HTML — no markdown fences, no explanation; start with <!DOCTYPE html>',
    ].join('\n'),
    messages: [
      {
        role:    'user',
        content: `Generate the weekly performance report using the following data:\n\n${context}`,
      },
    ],
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

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Optional single-client mode — passed by the UI "Generate Report" button
    let targetClientId: string | null = null
    if (req.method === 'POST') {
      try {
        const body = await req.json()
        targetClientId = body?.client_id ?? null
      } catch { /* no body or invalid JSON — run for all clients */ }
    }

    const sevenDaysAgo     = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const sevenDaysAgoDate = sevenDaysAgo.slice(0, 10)

    // ── 1. Fetch active clients (all, or single if client_id supplied) ────────
    let clientsQuery = supabase
      .from('clients')
      .select('id, name, status')
      .eq('status', 'active')

    if (targetClientId) {
      clientsQuery = clientsQuery.eq('id', targetClientId)
    }

    const { data: rawClients, error: clientsErr } = await clientsQuery

    if (clientsErr) throw new Error(`fetch clients: ${clientsErr.message}`)

    const clients = (rawClients ?? []) as ClientRow[]
    console.log(`[sop-47] ${clients.length} active clients`)

    if (clients.length === 0) {
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    SONNET,
        status:         'success',
        duration_ms:    Date.now() - startedAt,
        input_summary:  '0 active clients',
        output_summary: 'No active clients — nothing to process',
      })
      return new Response(
        JSON.stringify({ message: 'No active clients', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Bulk-fetch all active sprints ──────────────────────────────────────
    const { data: rawSprints, error: sprintsErr } = await supabase
      .from('sprints')
      .select([
        'id', 'client_name', 'status', 'day_number',
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

    console.log(`[sop-47] ${sprints.length} active sprints found`)

    // ── 3. Bulk-fetch 7-day sprint logs ───────────────────────────────────────
    let logsBySprint = new Map<string, SprintLogRow[]>()

    if (sprintIds.length > 0) {
      const { data: rawLogs, error: logsErr } = await supabase
        .from('sprint_logs')
        .select('sprint_id, logged_at, day_number, leads_generated, spend, cpl, roas, health_status')
        .in('sprint_id', sprintIds)
        .gte('logged_at', sevenDaysAgo)
        .order('logged_at', { ascending: false })

      if (logsErr) throw new Error(`fetch sprint_logs: ${logsErr.message}`)

      for (const log of (rawLogs ?? []) as SprintLogRow[]) {
        const arr = logsBySprint.get(log.sprint_id) ?? []
        arr.push(log)
        logsBySprint.set(log.sprint_id, arr)
      }
    }

    // ── 4. Bulk-fetch 7-day ad set performance logs ───────────────────────────
    let adLogsBySprint = new Map<string, AdSetLogRow[]>()

    if (sprintIds.length > 0) {
      const { data: rawAdLogs, error: adLogsErr } = await supabase
        .from('ad_set_performance_logs')
        .select('sprint_id, adset_name, date, spend, impressions, clicks, cpl, cpl_target')
        .in('sprint_id', sprintIds)
        .gte('date', sevenDaysAgoDate)
        .order('date', { ascending: false })

      if (adLogsErr) {
        // Non-fatal: table may be empty or ad sets not yet synced
        console.warn(`[sop-47] ad_set_performance_logs fetch warning: ${adLogsErr.message}`)
      } else {
        for (const log of (rawAdLogs ?? []) as AdSetLogRow[]) {
          const arr = adLogsBySprint.get(log.sprint_id) ?? []
          arr.push(log)
          adLogsBySprint.set(log.sprint_id, arr)
        }
      }
    }

    // ── 5. Process each client ────────────────────────────────────────────────
    let reportsGenerated      = 0
    let approvalItemsCreated  = 0
    const approvalIds: string[] = []
    const errors: string[]      = []

    for (const client of clients) {
      try {
        console.log(`[sop-47] generating report for ${client.name}...`)

        const sprint     = sprintByClient.get(client.name.toLowerCase().trim()) ?? null
        const recentLogs = sprint ? (logsBySprint.get(sprint.id) ?? []) : []
        const adSetLogs  = sprint ? (adLogsBySprint.get(sprint.id) ?? []) : []

        // Compute week-level lead and spend deltas from cumulative sprint_log snapshots
        let weekLeads = 0
        let weekSpend = 0

        if (sprint) {
          if (sprint.day_number <= 7 || recentLogs.length === 0) {
            // Sprint is within its first week, or no logs yet — totals are the week's totals
            weekLeads = sprint.leads_generated
            weekSpend = sprint.spend
          } else {
            // Compute delta: newest log minus oldest log in the 7-day window
            const sorted  = recentLogs.slice().sort((a, b) => a.logged_at.localeCompare(b.logged_at))
            const oldest  = sorted[0]
            const newest  = sorted[sorted.length - 1]
            weekLeads = Math.max(0, newest.leads_generated - oldest.leads_generated)
            weekSpend = Math.max(0, newest.spend - oldest.spend)
          }
        }

        // ── 5a. Generate HTML report via Claude Sonnet ────────────────────────
        const html = await generateReport({
          client, sprint, recentLogs, adSetLogs, weekLeads, weekSpend,
        })
        reportsGenerated++

        console.log(`[sop-47] report generated for ${client.name} (${html.length} chars)`)

        // ── 5b. Write to approval_queue ───────────────────────────────────────
        const weekLabel = `${sevenDaysAgoDate} – ${new Date().toISOString().slice(0, 10)}`

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
              title:       `Weekly Report — ${client.name} — ${weekLabel}`,
              body:        `AI-generated weekly performance report for ${client.name}. Review before sending to client.`,
              html_report: html,
              metadata: {
                client_id:    client.id,
                client_name:  client.name,
                sprint_id:    sprint?.id ?? null,
                sprint_day:   sprint?.day_number ?? null,
                week_label:   weekLabel,
                week_leads:   weekLeads,
                week_spend:   weekSpend,
                total_leads:  sprint?.leads_generated ?? null,
                leads_target: sprint?.leads_target ?? null,
                cpl:          sprint?.cpl ?? null,
                cpl_target:   sprint?.cpl_target ?? null,
                roas:         sprint?.roas ?? null,
                roas_target:  sprint?.roas_target ?? null,
              },
            },
          })
          .select('id')
          .single()

        if (approvalErr) {
          console.error(`[sop-47] approval_queue insert failed for ${client.name}: ${approvalErr.message}`)
          errors.push(`approval ${client.name}: ${approvalErr.message}`)
        } else {
          approvalItemsCreated++
          approvalIds.push(approvalRow?.id ?? '')
          console.log(`[sop-47] approval item created for ${client.name}: ${approvalRow?.id}`)
        }
      } catch (clientErr) {
        const msg = clientErr instanceof Error ? clientErr.message : String(clientErr)
        console.error(`[sop-47] error processing ${client.name}: ${msg}`)
        errors.push(`${client.name}: ${msg}`)
      }
    }

    // ── 6. Audit log ──────────────────────────────────────────────────────────
    const outputSummary =
      `${reportsGenerated} reports generated, ${approvalItemsCreated} approval items created` +
      (errors.length > 0 ? `, ${errors.length} errors: ${errors.slice(0, 3).join('; ')}` : '')

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    SONNET,
      status:         errors.length > 0 && reportsGenerated === 0 ? 'failure' : 'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${clients.length} active clients, ${sprints.length} active sprints`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({
        processed:              clients.length,
        reports_generated:      reportsGenerated,
        approval_items_created: approvalItemsCreated,
        approval_ids:           approvalIds,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-47] fatal: ${message}`)

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
        input_summary:  'weekly client reports run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
