// Model: claude-haiku-4-5-20251001 — finance aggregation and insight generation.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const HAIKU    = 'claude-haiku-4-5-20251001'
const SOP_ID   = '56'
const SOP_NAME = 'SOP 56 — Finance Dashboard'

const TIER_MRR: Record<string, number> = {
  proof_sprint:    800,
  proof_brand:    1500,
  authority_brand: 3000,
}

// Close-rate weights for 90-day pipeline conversion estimate
const CLOSE_RATE: Record<string, number> = {
  warm:        0.20,
  call_booked: 0.40,
}
const AVG_NEW_CLIENT_MRR = 1500

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  id:   string
  name: string
  tier: string | null
}

interface LedgerIncome {
  client_id: string
  amount:    number
}

interface LedgerAmount {
  amount: number
}

interface LedgerOverdue {
  amount:   number
  due_date: string
}

interface FinanceSummary {
  period:            string
  period_label:      string
  generated_at:      string
  mrr: {
    total:           number
    by_tier:         Record<string, number>
    client_count:    number
  }
  income: {
    total_paid:      number
    by_tier:         Record<string, number>
  }
  expenses: {
    total:           number
  }
  net_profit:        number
  profit_margin_pct: number
  outstanding: {
    invoice_count:   number
    total:           number
  }
  overdue: {
    invoice_count:   number
    total:           number
    oldest_days:     number
  }
  forecast_90d: {
    conservative:    number
    base:            number
    optimistic:      number
  }
  pipeline: {
    warm:            number
    call_booked:     number
    weighted_value:  number
  }
  insights:          string[]
  health_score:      number
}

// ─── Claude insights ──────────────────────────────────────────────────────────

async function generateInsights(
  summary: Omit<FinanceSummary, 'insights' | 'health_score'>,
): Promise<{ insights: string[]; health_score: number }> {
  const context = `FINANCE SNAPSHOT — ${summary.period_label}

MRR: £${summary.mrr.total.toLocaleString()} across ${summary.mrr.client_count} active clients
By tier: ${Object.entries(summary.mrr.by_tier).map(([k, v]) => `${k}: £${v}`).join(', ')}

INCOME (paid this month): £${summary.income.total_paid.toLocaleString()}
EXPENSES (this month): £${summary.expenses.total.toLocaleString()}
NET PROFIT: £${summary.net_profit.toLocaleString()} (${summary.profit_margin_pct.toFixed(1)}% margin)

OUTSTANDING: ${summary.outstanding.invoice_count} invoice(s) totalling £${summary.outstanding.total.toLocaleString()}
OVERDUE: ${summary.overdue.invoice_count} invoice(s) totalling £${summary.overdue.total.toLocaleString()}, oldest ${summary.overdue.oldest_days} days

90-DAY FORECAST:
  Conservative (status quo): £${summary.forecast_90d.conservative.toLocaleString()}
  Base (with pipeline closures): £${summary.forecast_90d.base.toLocaleString()}
  Optimistic: £${summary.forecast_90d.optimistic.toLocaleString()}

PIPELINE: ${summary.pipeline.warm} warm leads, ${summary.pipeline.call_booked} calls booked`

  const response = await anthropic.messages.create({
    model:      HAIKU,
    max_tokens: 500,
    system: [
      'You are a finance analyst for Attract Acquisition, a paid advertising agency.',
      'Analyse the monthly finance snapshot and return a JSON object with exactly these keys:',
      '  insights     — string[]: 3-5 concise bullet points covering margin health, overdue risk,',
      '                 MRR stability, forecast confidence, and any action items',
      '  health_score — integer 1-10: overall financial health (10 = excellent, 1 = critical)',
      '',
      'Output ONLY valid JSON — no markdown fences, no explanation.',
    ].join('\n'),
    messages: [
      {
        role:    'user',
        content: `Analyse this finance snapshot:\n\n${context}`,
      },
    ],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  return JSON.parse(raw) as { insights: string[]; health_score: number }
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
    const now          = new Date()
    const monthStart   = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd     = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const monthStartISO = monthStart.toISOString().slice(0, 10)
    const monthEndISO   = monthEnd.toISOString().slice(0, 10)
    const todayISO      = now.toISOString().slice(0, 10)
    const period        = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const periodLabel   = monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

    console.log(`[sop-56] building finance snapshot for ${period}`)

    // ── 1. Parallel data fetch ───────────────────────────────────────────────
    const [
      clientsRes,
      incomeRes,
      expensesRes,
      outstandingRes,
      overdueRes,
      prospectsRes,
    ] = await Promise.all([
      supabase
        .from('clients')
        .select('id, name, tier')
        .eq('status', 'active'),

      supabase
        .from('finance_ledger')
        .select('client_id, amount')
        .eq('entry_type', 'income')
        .eq('status', 'paid')
        .gte('invoice_date', monthStartISO)
        .lte('invoice_date', monthEndISO),

      supabase
        .from('finance_ledger')
        .select('amount')
        .eq('entry_type', 'expense')
        .gte('invoice_date', monthStartISO)
        .lte('invoice_date', monthEndISO),

      supabase
        .from('finance_ledger')
        .select('amount')
        .in('status', ['pending', 'partial']),

      supabase
        .from('finance_ledger')
        .select('amount, due_date')
        .eq('status', 'overdue'),

      supabase
        .from('prospects')
        .select('status')
        .in('status', ['warm', 'call_booked']),
    ])

    if (clientsRes.error)  throw new Error(`clients: ${clientsRes.error.message}`)
    if (incomeRes.error)   throw new Error(`income: ${incomeRes.error.message}`)
    if (expensesRes.error) throw new Error(`expenses: ${expensesRes.error.message}`)
    if (outstandingRes.error) throw new Error(`outstanding: ${outstandingRes.error.message}`)
    if (overdueRes.error)  throw new Error(`overdue: ${overdueRes.error.message}`)

    const clients      = (clientsRes.data ?? []) as ClientRow[]
    const incomeLedger = (incomeRes.data ?? []) as LedgerIncome[]
    const expenses     = (expensesRes.data ?? []) as LedgerAmount[]
    const outstanding  = (outstandingRes.data ?? []) as LedgerAmount[]
    const overdue      = (overdueRes.data ?? []) as LedgerOverdue[]
    const prospects    = (prospectsRes.data ?? []) as { status: string }[]

    // ── 2. MRR by tier ───────────────────────────────────────────────────────
    const mrrByTier: Record<string, number> = {}
    let totalMRR = 0

    for (const client of clients) {
      const tier = client.tier ?? 'unknown'
      const mrr  = TIER_MRR[tier] ?? 0
      mrrByTier[tier] = (mrrByTier[tier] ?? 0) + mrr
      totalMRR += mrr
    }

    // ── 3. Income by tier (join via client_id) ───────────────────────────────
    const clientMap = new Map(clients.map(c => [c.id, c]))
    const incomeByTier: Record<string, number> = {}
    let totalIncome = 0

    for (const entry of incomeLedger) {
      const tier = clientMap.get(entry.client_id)?.tier ?? 'unknown'
      incomeByTier[tier] = (incomeByTier[tier] ?? 0) + entry.amount
      totalIncome += entry.amount
    }

    // ── 4. Expenses ──────────────────────────────────────────────────────────
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)

    // ── 5. Net profit ────────────────────────────────────────────────────────
    const netProfit       = totalIncome - totalExpenses
    const profitMarginPct = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0

    // ── 6. Outstanding & overdue ─────────────────────────────────────────────
    const outstandingTotal = outstanding.reduce((sum, e) => sum + e.amount, 0)
    const overdueTotal     = overdue.reduce((sum, e) => sum + e.amount, 0)
    const todayMs          = now.getTime()
    const oldestOverdueDays = overdue.length > 0
      ? Math.max(...overdue.map(e =>
          Math.floor((todayMs - new Date(e.due_date).getTime()) / 86_400_000),
        ))
      : 0

    // ── 7. 90-day revenue forecast ───────────────────────────────────────────
    const pipelineCounts: Record<string, number> = {}
    for (const p of prospects) {
      pipelineCounts[p.status] = (pipelineCounts[p.status] ?? 0) + 1
    }

    const pipelineWeightedValue = Object.entries(CLOSE_RATE).reduce((sum, [status, rate]) => {
      return sum + (pipelineCounts[status] ?? 0) * rate * AVG_NEW_CLIENT_MRR * 3
    }, 0)

    const conservativeForecast = totalMRR * 3
    const baseForecast         = conservativeForecast + pipelineWeightedValue
    const optimisticForecast   = conservativeForecast + pipelineWeightedValue * 1.5

    // ── 8. Build partial summary, then call Haiku for insights ───────────────
    const partialSummary: Omit<FinanceSummary, 'insights' | 'health_score'> = {
      period,
      period_label:      periodLabel,
      generated_at:      now.toISOString(),
      mrr: {
        total:           totalMRR,
        by_tier:         mrrByTier,
        client_count:    clients.length,
      },
      income: {
        total_paid:      totalIncome,
        by_tier:         incomeByTier,
      },
      expenses: {
        total:           totalExpenses,
      },
      net_profit:        netProfit,
      profit_margin_pct: Math.round(profitMarginPct * 10) / 10,
      outstanding: {
        invoice_count:   outstanding.length,
        total:           outstandingTotal,
      },
      overdue: {
        invoice_count:   overdue.length,
        total:           overdueTotal,
        oldest_days:     oldestOverdueDays,
      },
      forecast_90d: {
        conservative: Math.round(conservativeForecast),
        base:         Math.round(baseForecast),
        optimistic:   Math.round(optimisticForecast),
      },
      pipeline: {
        warm:           pipelineCounts['warm'] ?? 0,
        call_booked:    pipelineCounts['call_booked'] ?? 0,
        weighted_value: Math.round(pipelineWeightedValue),
      },
    }

    console.log(`[sop-56] MRR £${totalMRR}, income £${totalIncome}, profit £${netProfit} — calling Haiku for insights`)

    const { insights, health_score } = await generateInsights(partialSummary)
    const financeSummary: FinanceSummary = { ...partialSummary, insights, health_score }

    // ── 9. Write finance_snapshot ────────────────────────────────────────────
    const { error: snapshotErr } = await supabase
      .from('finance_snapshots')
      .insert({
        snapshot_date:   todayISO,
        period_start:    monthStartISO,
        period_end:      monthEndISO,
        finance_summary: financeSummary,
      })

    if (snapshotErr) throw new Error(`write snapshot: ${snapshotErr.message}`)

    console.log(`[sop-56] snapshot written — health score ${health_score}/10`)

    // ── 10. Audit log ─────────────────────────────────────────────────────────
    const outputSummary =
      `MRR £${totalMRR.toLocaleString()}, income £${totalIncome.toLocaleString()}, ` +
      `profit £${netProfit.toLocaleString()} (${profitMarginPct.toFixed(0)}% margin), ` +
      `${overdue.length} overdue invoices, 90d forecast £${Math.round(baseForecast).toLocaleString()}, ` +
      `health ${health_score}/10`

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    HAIKU,
      status:         'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${clients.length} active clients, ${incomeLedger.length + expenses.length} ledger entries`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({ finance_summary: financeSummary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-56] fatal: ${message}`)

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
        input_summary:  'finance dashboard run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
