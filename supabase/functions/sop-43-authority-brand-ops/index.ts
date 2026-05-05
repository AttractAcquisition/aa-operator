// Model: claude-sonnet-4-6 — comprehensive monthly delivery review for Authority Brand clients.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET    = 'claude-sonnet-4-6'
const SOP_ID    = '43'
const SOP_NAME  = 'SOP 43 — Authority Brand Monthly Ops'

// Authority Brand: £3000/mo, Google Ads + Meta Ads + Remarketing. Top tier.
// No upsell path — focus is retention, deepening results, and strategic expansion.
const TIER_LABEL   = 'Authority Brand'
const TIER_VALUE   = 'authority_brand'
const MONTHLY_FEE  = '£3,000'
const CHANNELS     = 'Google Ads + Meta Ads + Remarketing'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  id:           string
  name:         string
  status:       string
  tier:         string
  niche:        string | null
  contact_name: string | null
  notes:        string | null
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

interface FunnelMetrics {
  impressions:         number
  clicks:              number
  leads:               number
  ctr_pct:             number
  click_to_lead_pct:   number
  cost_per_click:      number
  month_spend:         number
  budget_utilisation:  number
  leads_to_target_pct: number
}

interface AdSetProfile {
  name:         string
  total_spend:  number
  impressions:  number
  clicks:       number
  avg_cpl:      number
  cpl_target:   number | null
  ctr_pct:      number
  days_tracked: number
}

interface ClaudeOutput {
  overall_rating:       number
  retention_risk:       string
  next_30_day_priority: string
  campaign_health:      string
  report_html:          string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function monthStart(): { iso: string; date: string } {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  const iso = d.toISOString()
  return { iso, date: iso.slice(0, 10) }
}

function computeTrend(
  logs: SprintLogRow[],
  field: 'cpl' | 'roas',
): TrendResult {
  if (logs.length < 4) {
    return { direction: 'insufficient_data', delta_pct: 0, label: 'Insufficient data (< 4 daily entries)' }
  }

  const sorted   = logs.slice().sort((a, b) => a.logged_at.localeCompare(b.logged_at))
  const mid      = Math.floor(sorted.length / 2)
  const avg      = (arr: SprintLogRow[]) => arr.reduce((s, l) => s + l[field], 0) / arr.length
  const firstAvg = avg(sorted.slice(0, mid))
  const lastAvg  = avg(sorted.slice(mid))

  if (firstAvg === 0) {
    return { direction: 'insufficient_data', delta_pct: 0, label: 'No baseline data' }
  }

  const delta      = ((lastAvg - firstAvg) / firstAvg) * 100
  const improving  = field === 'cpl' ? delta < -5 : delta > 5
  const worsening  = field === 'cpl' ? delta > 5  : delta < -5
  const direction: TrendResult['direction'] = improving ? 'improving' : worsening ? 'worsening' : 'stable'
  const sign       = improving ? '↓' : worsening ? '↑' : '→'
  const qualifier  = improving ? 'improving' : worsening ? 'worsening' : 'stable'

  return {
    direction,
    delta_pct: parseFloat(delta.toFixed(1)),
    label:     `${sign} ${qualifier} (${Math.abs(delta).toFixed(1)}% ${field === 'cpl' ? 'CPL' : 'ROAS'} shift MTD)`,
  }
}

function campaignHealthSummary(logs: SprintLogRow[]): string {
  if (logs.length === 0) return 'No log data available'
  const counts = { on_track: 0, at_risk: 0, off_track: 0 }
  for (const l of logs) {
    if (l.health_status in counts) counts[l.health_status as keyof typeof counts]++
  }
  const total   = logs.length
  const onPct   = ((counts.on_track  / total) * 100).toFixed(0)
  const riskPct = ((counts.at_risk   / total) * 100).toFixed(0)
  const offPct  = ((counts.off_track / total) * 100).toFixed(0)
  return `${onPct}% on-track, ${riskPct}% at-risk, ${offPct}% off-track across ${total} daily checks`
}

// Computes full-funnel efficiency ratios from live sprint data + MTD log delta.
function buildFunnelMetrics(sprint: SprintRow, logs: SprintLogRow[]): FunnelMetrics {
  let monthLeads = sprint.leads_generated
  let monthSpend = sprint.spend

  if (logs.length > 1) {
    const sorted   = logs.slice().sort((a, b) => a.logged_at.localeCompare(b.logged_at))
    monthLeads = Math.max(0, sorted[sorted.length - 1].leads_generated - sorted[0].leads_generated)
    monthSpend = Math.max(0, sorted[sorted.length - 1].spend - sorted[0].spend)
  }

  const ctr              = sprint.impressions > 0 ? (sprint.clicks / sprint.impressions) * 100 : 0
  const clickToLead      = sprint.clicks > 0      ? (sprint.leads_generated / sprint.clicks) * 100 : 0
  const costPerClick     = sprint.clicks > 0      ? sprint.spend / sprint.clicks : 0
  const budgetUtil       = sprint.spend_budget > 0 ? (sprint.spend / sprint.spend_budget) * 100 : 0
  const leadsToTargetPct = sprint.leads_target > 0 ? (monthLeads / sprint.leads_target) * 100 : 0

  return {
    impressions:         sprint.impressions,
    clicks:              sprint.clicks,
    leads:               monthLeads,
    ctr_pct:             parseFloat(ctr.toFixed(2)),
    click_to_lead_pct:   parseFloat(clickToLead.toFixed(2)),
    cost_per_click:      parseFloat(costPerClick.toFixed(2)),
    month_spend:         parseFloat(monthSpend.toFixed(2)),
    budget_utilisation:  parseFloat(budgetUtil.toFixed(1)),
    leads_to_target_pct: parseFloat(leadsToTargetPct.toFixed(1)),
  }
}

// Aggregates ad set logs into ranked profiles for content performance analysis.
function buildAdSetProfiles(adSetLogs: AdSetLogRow[]): AdSetProfile[] {
  const byName = new Map<string, AdSetLogRow[]>()
  for (const l of adSetLogs) {
    const arr = byName.get(l.adset_name) ?? []
    arr.push(l)
    byName.set(l.adset_name, arr)
  }

  const profiles: AdSetProfile[] = []
  for (const [name, days] of byName) {
    const totalSpend  = days.reduce((s, d) => s + d.spend, 0)
    const totalImpr   = days.reduce((s, d) => s + d.impressions, 0)
    const totalClicks = days.reduce((s, d) => s + d.clicks, 0)
    const activeDays  = days.filter(d => d.cpl > 0)
    const avgCpl      = activeDays.length > 0
      ? activeDays.reduce((s, d) => s + d.cpl, 0) / activeDays.length
      : 0
    const ctr         = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0

    profiles.push({
      name,
      total_spend:  parseFloat(totalSpend.toFixed(2)),
      impressions:  totalImpr,
      clicks:       totalClicks,
      avg_cpl:      parseFloat(avgCpl.toFixed(2)),
      cpl_target:   days[0]?.cpl_target ?? null,
      ctr_pct:      parseFloat(ctr.toFixed(2)),
      days_tracked: days.length,
    })
  }

  // Sort by avg CPL ascending (best performers first); zero-CPL profiles last
  return profiles.sort((a, b) => {
    if (a.avg_cpl === 0 && b.avg_cpl === 0) return 0
    if (a.avg_cpl === 0) return 1
    if (b.avg_cpl === 0) return -1
    return a.avg_cpl - b.avg_cpl
  })
}

// ─── Claude call + response parsing ──────────────────────────────────────────

async function generateMonthlyReview(
  client:     ClientRow,
  sprint:     SprintRow | null,
  monthLogs:  SprintLogRow[],
  adSetLogs:  AdSetLogRow[],
  periodStart: string,
  today:      string,
): Promise<ClaudeOutput> {
  const cplTrend      = computeTrend(monthLogs, 'cpl')
  const roasTrend     = computeTrend(monthLogs, 'roas')
  const healthSummary = campaignHealthSummary(monthLogs)
  const adSetProfiles = buildAdSetProfiles(adSetLogs)

  // ── Build the data context string passed to Claude ────────────────────────
  let sprintContext: string

  if (sprint) {
    const funnel = buildFunnelMetrics(sprint, monthLogs)

    const topAdSets = adSetProfiles.slice(0, 5)
      .map((p, i) =>
        `  ${i + 1}. "${p.name}": spend £${p.total_spend} | ` +
        `impressions ${p.impressions.toLocaleString()} | clicks ${p.clicks} | ` +
        `CTR ${p.ctr_pct}% | avg CPL £${p.avg_cpl}` +
        (p.cpl_target ? ` vs £${p.cpl_target} target` : '') +
        ` | ${p.days_tracked} days tracked`,
      ).join('\n')

    const bottomAdSets = adSetProfiles.length > 5
      ? adSetProfiles.slice(-3)
          .map(p =>
            `  "${p.name}": avg CPL £${p.avg_cpl}` +
            (p.cpl_target ? ` (${p.cpl_target > 0 ? ((p.avg_cpl / p.cpl_target - 1) * 100).toFixed(0) : '0'}% ${p.avg_cpl > p.cpl_target ? 'over' : 'under'} target)` : ''),
          ).join('\n')
      : '  (all ad sets shown above)'

    sprintContext = `SPRINT METRICS (Month-to-Date):
  Sprint day: ${sprint.day_number}/14
  Leads MTD: ${funnel.leads} / ${sprint.leads_target} target (${funnel.leads_to_target_pct}% of target)
  Spend MTD: £${funnel.month_spend} / £${sprint.spend_budget} budget (${funnel.budget_utilisation}% utilised)
  CPL: £${sprint.cpl.toFixed(2)} vs £${sprint.cpl_target} target
  ROAS: ${sprint.roas.toFixed(2)}x vs ${sprint.roas_target}x target

FULL FUNNEL (cumulative sprint totals):
  Impressions (top-of-funnel reach): ${funnel.impressions.toLocaleString()}
  Clicks: ${funnel.clicks.toLocaleString()} | CTR: ${funnel.ctr_pct}%
  Leads: ${sprint.leads_generated} | Click-to-lead rate: ${funnel.click_to_lead_pct}%
  Cost-per-click: £${funnel.cost_per_click}
  Cost-per-lead (CPL): £${sprint.cpl.toFixed(2)}
  Revenue efficiency (ROAS): ${sprint.roas.toFixed(2)}x

TRENDS (month-to-date direction):
  CPL:  ${cplTrend.label}
  ROAS: ${roasTrend.label}
  Campaign health: ${healthSummary}

CONTENT PERFORMANCE — Top ad sets by CPL (best → worst):
${topAdSets || '  No ad set data available'}

CONTENT PERFORMANCE — Underperforming ad sets:
${bottomAdSets}`
  } else {
    sprintContext = 'No active sprint found this month.'
  }

  const prompt = `Client: ${client.name}
Tier: ${TIER_LABEL} (${MONTHLY_FEE}/mo | ${CHANNELS})
Niche: ${client.niche ?? 'Local service business'}
Period: ${periodStart} to ${today}
${client.notes ? `\nClient notes: ${client.notes}` : ''}

${sprintContext}`

  const response = await anthropic.messages.create({
    model:      SONNET,
    max_tokens: 3500,
    system: [
      `You produce comprehensive monthly delivery reviews for Attract Acquisition's ${TIER_LABEL} clients.`,
      `${TIER_LABEL} is the highest service tier: ${MONTHLY_FEE}/mo covering ${CHANNELS}.`,
      'These clients receive the most senior strategic attention — the review should reflect that depth.',
      '',
      'Your response MUST follow this exact structure — no deviations:',
      '',
      'REPORT_JSON: {"overall_rating":<1-10>,"retention_risk":"<low|medium|high>","next_30_day_priority":"<one sentence max 20 words>","campaign_health":"<Healthy|Mixed|Underperforming>"}',
      '',
      '<!DOCTYPE html>',
      '<html>... (full HTML report below)',
      '',
      'Rating guide for overall_rating:',
      '  9-10: Exceptional — CPL & ROAS both beating targets, leads ahead of pace',
      '  7-8:  Strong — on or near targets across all metrics',
      '  5-6:  Adequate — mixed results, some metrics underperforming',
      '  3-4:  Concerning — multiple metrics off target, intervention needed',
      '  1-2:  Critical — significant underperformance, client retention at risk',
      '',
      'retention_risk: "high" if overall_rating ≤ 4 OR CPL >30% over target OR ROAS <50% of target.',
      '',
      'HTML report sections (in order, all required):',
      '  1. Executive Summary',
      '     — Overall verdict in 3-4 sentences. Rating badge (from REPORT_JSON). Key metric headline.',
      '     — Is the client getting clear ROI from their £3,000/mo investment?',
      '  2. Full Funnel Performance',
      '     — Present the complete impression → click → lead funnel as a visual flow table.',
      '     — Highlight where drop-off is occurring and what it means for overall efficiency.',
      '     — Include CTR, click-to-lead rate, CPL, ROAS in a metrics table.',
      '  3. Brand Authority Metrics',
      '     — Reach (impressions MTD), engagement (CTR vs niche benchmarks), brand frequency estimate.',
      '     — ROAS trend commentary: is spend becoming more or less efficient over the month?',
      '     — Remarketing signal: are retargeted audiences performing differently? (note if data unavailable)',
      '  4. Content Performance',
      '     — Full ranked ad set table: name, spend, impressions, CTR, CPL, vs target.',
      '     — Identify best performers (scale candidates) and underperformers (pause candidates).',
      '     — Creative angle observations: what themes or ad types are winning?',
      '  5. Market Positioning Analysis',
      '     — Given the client\'s niche and performance data, assess their competitive position.',
      '     — Are CPL/ROAS levels indicative of a competitive or clear-field market?',
      '     — What does the impression volume suggest about market saturation or opportunity?',
      '     — Identify one market opportunity or risk based on the data.',
      '  6. Strategic Recommendations — Next 30 Days',
      '     — Exactly 4 recommendations, each with: Priority level, Action, Expected impact, Owner.',
      '     — Recommendations must be specific and data-driven (reference actual metrics).',
      '     — Cover at least: one budget/scale action, one creative/content action, one strategic action.',
      '',
      'HTML style rules (inline styles only — no <style> blocks):',
      '  - max-width 760px, margin 0 auto, font-family Arial/sans-serif, color #111827, background #fff',
      '  - Header: background #0f172a, white text, padding 28px 36px',
      '    — Two-line: client name (24px bold) + tier badge pill + date range (13px, #94a3b8)',
      '  - Rating badge in Executive Summary: large circle (64px), colour-coded:',
      '    9-10 → #15803d (deep green), 7-8 → #16a34a (green), 5-6 → #d97706 (amber), 1-4 → #dc2626 (red)',
      '  - Section <h2>: color #0f172a, border-left 4px solid #3b82f6, padding-left 12px, margin-top 32px',
      '  - Funnel flow table: horizontal arrow-connected cells, colour gradient top→bottom',
      '  - Ad set table: full width, alternating rows, CPL vs target shown as +/- coloured delta badge',
      '  - Recommendation cards: light border-left (4px solid priority colour: red/amber/blue/green)',
      '  - Retention risk pill: red (#fef2f2 / #dc2626) if high, amber if medium, green if low',
      '  - Footer: #f8fafc background, 12px text, "Generated by AA Operator · Attract Acquisition"',
    ].join('\n'),
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  // Extract REPORT_JSON (single line, same pattern as sop-31 SCORE_JSON)
  const jsonLine = raw.match(/^REPORT_JSON:\s*(\{[^\n]+\})/m)
  let overallRating      = 5
  let retentionRisk      = 'medium'
  let next30DayPriority  = 'Review campaign data and adjust budget allocation based on performance'
  let campaignHealth     = 'Unknown'

  if (jsonLine) {
    try {
      const parsed       = JSON.parse(jsonLine[1])
      overallRating      = Math.min(10, Math.max(1, parseInt(String(parsed.overall_rating), 10) || 5))
      retentionRisk      = String(parsed.retention_risk      ?? retentionRisk)
      next30DayPriority  = String(parsed.next_30_day_priority ?? next30DayPriority)
      campaignHealth     = String(parsed.campaign_health      ?? campaignHealth)
    } catch {
      console.warn(`[sop-43] REPORT_JSON parse failed — using defaults`)
    }
  } else {
    console.warn(`[sop-43] No REPORT_JSON found in response`)
  }

  const htmlMatch  = raw.match(/<!DOCTYPE html>[\s\S]*/i)
  const reportHtml = htmlMatch
    ? htmlMatch[0]
    : `<!DOCTYPE html><html><body><p>Report generation failed.</p></body></html>`

  return {
    overall_rating:       overallRating,
    retention_risk:       retentionRisk,
    next_30_day_priority: next30DayPriority,
    campaign_health:      campaignHealth,
    report_html:          reportHtml,
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

    // ── 1. Fetch active authority_brand clients ───────────────────────────────
    const { data: rawClients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, name, status, tier, niche, contact_name, notes')
      .eq('status', 'active')
      .eq('tier', TIER_VALUE)

    if (clientsErr) throw new Error(`fetch clients: ${clientsErr.message}`)

    const clients = (rawClients ?? []) as ClientRow[]
    console.log(`[sop-43] ${clients.length} active authority_brand clients`)

    if (clients.length === 0) {
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    SONNET,
        status:         'success',
        duration_ms:    Date.now() - startedAt,
        input_summary:  '0 authority_brand clients',
        output_summary: 'No active authority_brand clients — nothing to process',
      })
      return new Response(
        JSON.stringify({ message: 'No active authority_brand clients', processed: 0 }),
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

    console.log(`[sop-43] ${sprints.length} active sprints`)

    // ── 3. Bulk-fetch month-to-date sprint logs (ascending for trend math) ────
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
        console.warn(`[sop-43] ad_set_performance_logs fetch warning: ${adLogsErr.message}`)
      } else {
        for (const log of (rawAdLogs ?? []) as AdSetLogRow[]) {
          const arr = adLogsBySprint.get(log.sprint_id) ?? []
          arr.push(log)
          adLogsBySprint.set(log.sprint_id, arr)
        }
      }
    }

    // ── 5. Process each authority_brand client ────────────────────────────────
    let reportsGenerated     = 0
    let approvalItemsCreated = 0
    const approvalIds: string[]     = []
    const highRiskClients: string[] = []
    const errors: string[]          = []

    for (const client of clients) {
      try {
        console.log(`[sop-43] generating review for ${client.name}...`)

        const sprint    = sprintByClient.get(client.name.toLowerCase().trim()) ?? null
        const monthLogs = sprint ? (logsBySprint.get(sprint.id)   ?? []) : []
        const adSetLogs = sprint ? (adLogsBySprint.get(sprint.id) ?? []) : []

        // ── 5a. Generate comprehensive review via Claude Sonnet ───────────────
        const output = await generateMonthlyReview(
          client, sprint, monthLogs, adSetLogs, mStartDate, today,
        )
        reportsGenerated++

        console.log(
          `[sop-43] ${client.name} — rating ${output.overall_rating}/10, ` +
          `retention risk: ${output.retention_risk}, health: ${output.campaign_health}`,
        )

        if (output.retention_risk === 'high') highRiskClients.push(client.name)

        // ── 5b. Write high-priority approval_queue item ───────────────────────
        const periodLabel = `${mStartDate} – ${today}`

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
              title: `Authority Brand Monthly Review — ${client.name} — ${periodLabel}`,
              body: [
                `Comprehensive monthly delivery review for ${client.name} (${TIER_LABEL}, ${MONTHLY_FEE}/mo).`,
                `Overall rating: ${output.overall_rating}/10.`,
                `Retention risk: ${output.retention_risk}.`,
                `Campaign health: ${output.campaign_health}.`,
                `Next 30-day priority: ${output.next_30_day_priority}`,
              ].join(' '),
              html_report: output.report_html,
              metadata: {
                client_id:            client.id,
                client_name:          client.name,
                tier:                 TIER_VALUE,
                sprint_id:            sprint?.id ?? null,
                sprint_day:           sprint?.day_number ?? null,
                period_label:         periodLabel,
                overall_rating:       output.overall_rating,
                retention_risk:       output.retention_risk,
                next_30_day_priority: output.next_30_day_priority,
                campaign_health:      output.campaign_health,
                cpl:                  sprint?.cpl ?? null,
                cpl_target:           sprint?.cpl_target ?? null,
                roas:                 sprint?.roas ?? null,
                roas_target:          sprint?.roas_target ?? null,
                impressions:          sprint?.impressions ?? null,
                clicks:               sprint?.clicks ?? null,
              },
            },
          })
          .select('id')
          .single()

        if (approvalErr) {
          console.error(`[sop-43] approval_queue insert failed for ${client.name}: ${approvalErr.message}`)
          errors.push(`approval ${client.name}: ${approvalErr.message}`)
        } else {
          approvalItemsCreated++
          approvalIds.push(approvalRow?.id ?? '')
          console.log(`[sop-43] approval item created for ${client.name}: ${approvalRow?.id}`)
        }
      } catch (clientErr) {
        const msg = clientErr instanceof Error ? clientErr.message : String(clientErr)
        console.error(`[sop-43] error processing ${client.name}: ${msg}`)
        errors.push(`${client.name}: ${msg}`)
      }
    }

    // ── 6. Audit log ──────────────────────────────────────────────────────────
    const riskNote = highRiskClients.length > 0
      ? `, ${highRiskClients.length} high retention risk (${highRiskClients.join(', ')})`
      : ''

    const outputSummary =
      `${reportsGenerated} monthly reviews generated, ${approvalItemsCreated} high-priority approval items created` +
      riskNote +
      (errors.length > 0 ? `, ${errors.length} errors: ${errors.slice(0, 3).join('; ')}` : '')

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    SONNET,
      status:         errors.length > 0 && reportsGenerated === 0 ? 'failure' : 'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${clients.length} authority_brand clients, ${sprints.length} active sprints, period: ${mStartDate}–${today}`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({
        processed:              clients.length,
        reports_generated:      reportsGenerated,
        approval_items_created: approvalItemsCreated,
        high_retention_risk:    highRiskClients,
        approval_ids:           approvalIds,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-43] fatal: ${message}`)

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
        input_summary:  'authority_brand monthly ops run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
