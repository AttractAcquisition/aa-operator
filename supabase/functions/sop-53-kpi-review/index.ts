// Model: claude-haiku-4-5-20251001 — monthly KPI analysis and trend commentary.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const HAIKU   = 'claude-haiku-4-5-20251001'
const SOP_ID   = '53'
const SOP_NAME = 'SOP 53 — Monthly KPI Review'

const TIER_MRR: Record<string, number> = {
  proof_sprint:    800,
  proof_brand:    1500,
  authority_brand: 3000,
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProspectStatus { status: string }
interface SprintLogRow  { cpl: number | null; roas: number | null }
interface LedgerPaid    { amount: number }
interface ClientRow     { status: string; tier: string | null }

interface KpiMetric {
  current:    number
  previous:   number
  change_pct: number
  trend:      '↑' | '↓' | '→'
  commentary: string
}

interface KpiReport {
  period:          string
  period_label:    string
  generated_at:    string
  kpis: {
    reply_rate:         KpiMetric
    warm_rate:          KpiMetric
    close_rate:         KpiMetric
    avg_cpl:            KpiMetric
    avg_roas:           KpiMetric
    mrr_growth_rate:    KpiMetric
    client_retention:   KpiMetric
    revenue_per_client: KpiMetric
  }
  overall_commentary: string
  health_score:       number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trendArrow(current: number, previous: number, lowerIsBetter = false): '↑' | '↓' | '→' {
  if (previous === 0 && current === 0) return '→'
  const pct = previous === 0
    ? (current > 0 ? 100 : -100)
    : ((current - previous) / Math.abs(previous)) * 100
  if (Math.abs(pct) < 2) return '→'
  const improving = lowerIsBetter ? pct < 0 : pct > 0
  return improving ? '↑' : '↓'
}

function changePct(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
}

function avg(vals: (number | null)[]): number {
  const valid = vals.filter((v): v is number => v !== null && !isNaN(v))
  return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : 0
}

function countStatuses(rows: ProspectStatus[], ...statuses: string[]): number {
  return rows.filter(p => statuses.includes(p.status)).length
}

// ─── Claude commentary ────────────────────────────────────────────────────────

interface RawKpiSnapshot {
  name: string
  current: number
  previous: number
  change_pct: number
  trend: string
  unit: string
}

async function generateCommentary(
  kpiSnapshots: RawKpiSnapshot[],
  periodLabel: string,
): Promise<{ kpi_commentary: Record<string, string>; overall_commentary: string; health_score: number }> {
  const lines = kpiSnapshots.map(k =>
    `${k.name}: ${k.current}${k.unit} vs ${k.previous}${k.unit} prev period (${k.change_pct > 0 ? '+' : ''}${k.change_pct}% ${k.trend})`,
  ).join('\n')

  const response = await anthropic.messages.create({
    model:      HAIKU,
    max_tokens: 1000,
    system: [{ type: 'text', text: [
      'You are a performance analyst for Attract Acquisition, a paid advertising agency.',
      `Analyse the monthly KPI snapshot for ${periodLabel} and return a JSON object with exactly these keys:`,
      '  kpi_commentary   — object mapping each KPI name to a 1-sentence insight (max 20 words)',
      '  overall_commentary — 2-3 sentence executive summary of business health and top priority',
      '  health_score       — integer 1-10 overall performance health (10 = excellent, 1 = critical)',
      '',
      'KPI names to use as keys: reply_rate, warm_rate, close_rate, avg_cpl, avg_roas,',
      '  mrr_growth_rate, client_retention, revenue_per_client',
      '',
      'Output ONLY valid JSON — no markdown fences, no explanation.',
    ].join('\n'), cache_control: { type: 'ephemeral' } }],
    messages: [{
      role:    'user',
      content: `KPI data for ${periodLabel}:\n\n${lines}`,
    }],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  return JSON.parse(raw)
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

    // ── Period bounds ────────────────────────────────────────────────────────
    const now         = new Date()
    const todayISO    = now.toISOString().slice(0, 10)

    // current: last 30 days
    const currEnd   = new Date(now); currEnd.setHours(23, 59, 59, 999)
    const currStart = new Date(now); currStart.setDate(currStart.getDate() - 30)
    const currStartISO = currStart.toISOString().slice(0, 10)
    const currEndISO   = currEnd.toISOString().slice(0, 10)

    // previous: 30-60 days ago
    const prevEnd   = new Date(currStart); prevEnd.setDate(prevEnd.getDate() - 1)
    const prevStart = new Date(prevEnd);   prevStart.setDate(prevStart.getDate() - 29)
    const prevStartISO = prevStart.toISOString().slice(0, 10)
    const prevEndISO   = prevEnd.toISOString().slice(0, 10)

    const period      = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const periodLabel = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

    console.log(`[sop-53] building KPI snapshot for ${period}`)
    console.log(`[sop-53] current: ${currStartISO} → ${currEndISO}`)
    console.log(`[sop-53] previous: ${prevStartISO} → ${prevEndISO}`)

    // ── 1. Parallel data fetch ───────────────────────────────────────────────
    const [
      currProspectsRes,
      prevProspectsRes,
      currSprintLogsRes,
      prevSprintLogsRes,
      currIncomeRes,
      prevIncomeRes,
      clientsRes,
    ] = await Promise.all([
      supabase.from('prospects').select('status')
        .gte('created_at', currStartISO).lte('created_at', currEndISO),

      supabase.from('prospects').select('status')
        .gte('created_at', prevStartISO).lte('created_at', prevEndISO),

      supabase.from('sprint_logs').select('cpl, roas')
        .gte('logged_at', currStart.toISOString()).lte('logged_at', currEnd.toISOString()),

      supabase.from('sprint_logs').select('cpl, roas')
        .gte('logged_at', prevStart.toISOString()).lte('logged_at', prevEnd.toISOString()),

      supabase.from('finance_ledger').select('amount')
        .eq('entry_type', 'income').eq('status', 'paid')
        .gte('invoice_date', currStartISO).lte('invoice_date', currEndISO),

      supabase.from('finance_ledger').select('amount')
        .eq('entry_type', 'income').eq('status', 'paid')
        .gte('invoice_date', prevStartISO).lte('invoice_date', prevEndISO),

      supabase.from('clients').select('status, tier'),
    ])

    if (currProspectsRes.error) throw new Error(`curr prospects: ${currProspectsRes.error.message}`)
    if (prevProspectsRes.error) throw new Error(`prev prospects: ${prevProspectsRes.error.message}`)
    if (currSprintLogsRes.error) throw new Error(`curr sprint_logs: ${currSprintLogsRes.error.message}`)
    if (prevSprintLogsRes.error) throw new Error(`prev sprint_logs: ${prevSprintLogsRes.error.message}`)
    if (currIncomeRes.error) throw new Error(`curr income: ${currIncomeRes.error.message}`)
    if (prevIncomeRes.error) throw new Error(`prev income: ${prevIncomeRes.error.message}`)
    if (clientsRes.error) throw new Error(`clients: ${clientsRes.error.message}`)

    const currProspects = (currProspectsRes.data ?? []) as ProspectStatus[]
    const prevProspects = (prevProspectsRes.data ?? []) as ProspectStatus[]
    const currLogs      = (currSprintLogsRes.data ?? []) as SprintLogRow[]
    const prevLogs      = (prevSprintLogsRes.data ?? []) as SprintLogRow[]
    const currIncome    = (currIncomeRes.data ?? []) as LedgerPaid[]
    const prevIncome    = (prevIncomeRes.data ?? []) as LedgerPaid[]
    const clients       = (clientsRes.data ?? []) as ClientRow[]

    // ── 2. Prospect funnel KPIs ──────────────────────────────────────────────
    // reply_rate: prospects showing interest (warm+) / all created in period
    // warm_rate:  warm leads still pre-close / all created in period
    // close_rate: closed / (call_booked + closed)

    const calcFunnelKpis = (prospects: ProspectStatus[]) => {
      const total      = prospects.length
      const interested = countStatuses(prospects, 'warm', 'call_booked', 'closed')
      const warm       = countStatuses(prospects, 'warm')
      const closed     = countStatuses(prospects, 'closed')
      const callBooked = countStatuses(prospects, 'call_booked')

      const replyRate  = total > 0 ? (interested / total) * 100 : 0
      const warmRate   = total > 0 ? (warm / total) * 100 : 0
      const closeRate  = (callBooked + closed) > 0 ? (closed / (callBooked + closed)) * 100 : 0

      return { replyRate, warmRate, closeRate }
    }

    const curr = calcFunnelKpis(currProspects)
    const prev = calcFunnelKpis(prevProspects)

    // ── 3. Sprint performance KPIs ───────────────────────────────────────────
    const currAvgCpl  = avg(currLogs.map(l => l.cpl))
    const prevAvgCpl  = avg(prevLogs.map(l => l.cpl))
    const currAvgRoas = avg(currLogs.map(l => l.roas))
    const prevAvgRoas = avg(prevLogs.map(l => l.roas))

    // ── 4. Financial KPIs ────────────────────────────────────────────────────
    const currTotalIncome = currIncome.reduce((s, e) => s + e.amount, 0)
    const prevTotalIncome = prevIncome.reduce((s, e) => s + e.amount, 0)

    const activeClients  = clients.filter(c => c.status === 'active')
    const churnedClients = clients.filter(c => c.status === 'churned')
    const totalTracked   = activeClients.length + churnedClients.length

    const currMrr = activeClients.reduce((s, c) => s + (TIER_MRR[c.tier ?? ''] ?? 0), 0)
    // MRR growth rate: income growth as proxy (MRR itself is a snapshot, income shows movement)
    const mrrGrowthRate = changePct(currTotalIncome, prevTotalIncome)

    const clientRetention  = totalTracked > 0 ? (activeClients.length / totalTracked) * 100 : 100
    const revenuePerClient = activeClients.length > 0 ? currTotalIncome / activeClients.length : 0
    const prevRevenuePerClient = prevTotalIncome > 0 && activeClients.length > 0
      ? prevTotalIncome / activeClients.length
      : 0

    console.log(`[sop-53] reply ${curr.replyRate.toFixed(1)}%, close ${curr.closeRate.toFixed(1)}%, CPL £${currAvgCpl.toFixed(0)}, ROAS ${currAvgRoas.toFixed(2)}, MRR £${currMrr}`)

    // ── 5. Build KPI snapshots for Claude ────────────────────────────────────
    const kpiSnapshots: RawKpiSnapshot[] = [
      { name: 'reply_rate',         current: Math.round(curr.replyRate * 10) / 10,    previous: Math.round(prev.replyRate * 10) / 10,    change_pct: changePct(curr.replyRate, prev.replyRate),          trend: trendArrow(curr.replyRate, prev.replyRate),         unit: '%'  },
      { name: 'warm_rate',          current: Math.round(curr.warmRate * 10) / 10,     previous: Math.round(prev.warmRate * 10) / 10,     change_pct: changePct(curr.warmRate, prev.warmRate),           trend: trendArrow(curr.warmRate, prev.warmRate),           unit: '%'  },
      { name: 'close_rate',         current: Math.round(curr.closeRate * 10) / 10,    previous: Math.round(prev.closeRate * 10) / 10,    change_pct: changePct(curr.closeRate, prev.closeRate),         trend: trendArrow(curr.closeRate, prev.closeRate),         unit: '%'  },
      { name: 'avg_cpl',            current: Math.round(currAvgCpl * 100) / 100,      previous: Math.round(prevAvgCpl * 100) / 100,      change_pct: changePct(currAvgCpl, prevAvgCpl),                 trend: trendArrow(currAvgCpl, prevAvgCpl, true),           unit: '£'  },
      { name: 'avg_roas',           current: Math.round(currAvgRoas * 100) / 100,     previous: Math.round(prevAvgRoas * 100) / 100,     change_pct: changePct(currAvgRoas, prevAvgRoas),               trend: trendArrow(currAvgRoas, prevAvgRoas),               unit: 'x'  },
      { name: 'mrr_growth_rate',    current: mrrGrowthRate,                           previous: 0,                                       change_pct: mrrGrowthRate,                                     trend: trendArrow(currTotalIncome, prevTotalIncome),       unit: '%'  },
      { name: 'client_retention',   current: Math.round(clientRetention * 10) / 10,   previous: Math.round(clientRetention * 10) / 10,   change_pct: 0,                                                 trend: '→',                                                unit: '%'  },
      { name: 'revenue_per_client', current: Math.round(revenuePerClient),            previous: Math.round(prevRevenuePerClient),        change_pct: changePct(revenuePerClient, prevRevenuePerClient), trend: trendArrow(revenuePerClient, prevRevenuePerClient), unit: '£'  },
    ]

    // ── 6. Claude commentary ─────────────────────────────────────────────────
    const { kpi_commentary, overall_commentary, health_score } =
      await generateCommentary(kpiSnapshots, periodLabel)

    // ── 7. Assemble full report ───────────────────────────────────────────────
    const makeMetric = (snap: RawKpiSnapshot): KpiMetric => ({
      current:    snap.current,
      previous:   snap.previous,
      change_pct: snap.change_pct,
      trend:      snap.trend as '↑' | '↓' | '→',
      commentary: kpi_commentary[snap.name] ?? '',
    })

    const snapMap = Object.fromEntries(kpiSnapshots.map(s => [s.name, s]))

    const kpiReport: KpiReport = {
      period,
      period_label:    periodLabel,
      generated_at:    now.toISOString(),
      kpis: {
        reply_rate:         makeMetric(snapMap['reply_rate']),
        warm_rate:          makeMetric(snapMap['warm_rate']),
        close_rate:         makeMetric(snapMap['close_rate']),
        avg_cpl:            makeMetric(snapMap['avg_cpl']),
        avg_roas:           makeMetric(snapMap['avg_roas']),
        mrr_growth_rate:    makeMetric(snapMap['mrr_growth_rate']),
        client_retention:   makeMetric(snapMap['client_retention']),
        revenue_per_client: makeMetric(snapMap['revenue_per_client']),
      },
      overall_commentary,
      health_score,
    }

    // ── 8. Write kpi_snapshot ─────────────────────────────────────────────────
    const { error: snapshotErr } = await supabase
      .from('kpi_snapshots')
      .insert({
        snapshot_date: todayISO,
        period_start:  currStartISO,
        period_end:    currEndISO,
        kpi_report:    kpiReport,
      })

    if (snapshotErr) throw new Error(`write snapshot: ${snapshotErr.message}`)

    console.log(`[sop-53] snapshot written — health score ${health_score}/10`)

    // ── 9. Audit log ──────────────────────────────────────────────────────────
    const outputSummary =
      `Reply ${curr.replyRate.toFixed(1)}%, close ${curr.closeRate.toFixed(1)}%, ` +
      `CPL £${currAvgCpl.toFixed(0)}, ROAS ${currAvgRoas.toFixed(2)}x, ` +
      `MRR growth ${mrrGrowthRate > 0 ? '+' : ''}${mrrGrowthRate.toFixed(1)}%, ` +
      `health ${health_score}/10`

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    HAIKU,
      status:         'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${currProspects.length} curr prospects, ${currLogs.length} sprint logs, £${currTotalIncome} income`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({ kpi_report: kpiReport }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-53] fatal: ${message}`)

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
        input_summary:  'kpi review run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
