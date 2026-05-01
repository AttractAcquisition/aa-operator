// Model: claude-sonnet-4-6 — all chat interface completions use Sonnet because
// the chat loop requires generation, reasoning, and tool-result synthesis.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

// ─── Tool definitions ────────────────────────────────────────────────────────

const tools: Anthropic.Tool[] = [
  {
    name: 'get_new_leads',
    description: 'Get new prospects scraped in the last N hours, with quality scores and source info.',
    input_schema: {
      type: 'object' as const,
      properties: {
        hours: { type: 'number', description: 'How many hours to look back (default 24)' },
      },
    },
  },
  {
    name: 'get_active_sprints',
    description: 'Get all currently active proof sprints with live performance metrics (CPL, ROAS, pacing).',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_pending_approvals',
    description: 'Get all items in the approval queue that are pending review.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_finance_summary',
    description: 'Get finance summary: MRR, income vs expenses, overdue invoices.',
    input_schema: {
      type: 'object' as const,
      properties: {
        month: { type: 'string', description: 'Optional month filter in YYYY-MM format' },
      },
    },
  },
  {
    name: 'get_open_alerts',
    description: 'Get all unresolved AI-generated alerts (sprint issues, finance flags, etc).',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'run_daily_briefing',
    description: 'Aggregate all key metrics for a daily command centre briefing: new leads, sprint snapshot, pending approvals, open alerts.',
    input_schema: { type: 'object' as const, properties: {} },
  },
]

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
): Promise<unknown> {
  switch (name) {
    case 'get_new_leads': {
      const hours = (input.hours as number) ?? 24
      const since = new Date(Date.now() - hours * 3600_000).toISOString()
      const { data, error } = await supabase
        .from('prospects')
        .select('id, name, company, status, quality_score, created_at, source_list')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
      if (error) return { error: error.message }
      const byStatus = (data ?? []).reduce<Record<string, number>>((acc, p) => {
        acc[p.status] = (acc[p.status] ?? 0) + 1
        return acc
      }, {})
      const scores = (data ?? []).map(p => p.quality_score).filter(Boolean)
      return {
        count: data?.length ?? 0,
        avg_quality: scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null,
        by_status: byStatus,
        leads: data ?? [],
      }
    }

    case 'get_active_sprints': {
      const { data, error } = await supabase
        .from('sprints')
        .select('*')
        .eq('status', 'active')
        .order('start_date', { ascending: false })
      if (error) return { error: error.message }
      return { count: data?.length ?? 0, sprints: data ?? [] }
    }

    case 'get_pending_approvals': {
      const { data, error } = await supabase
        .from('approval_queue')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) return { error: error.message }
      const byPriority = (data ?? []).reduce<Record<string, number>>((acc, item) => {
        acc[item.priority] = (acc[item.priority] ?? 0) + 1
        return acc
      }, {})
      return { count: data?.length ?? 0, by_priority: byPriority, items: data ?? [] }
    }

    case 'get_finance_summary': {
      let query = supabase.from('finance_ledger').select('*').order('date', { ascending: false })
      if (input.month) {
        query = query.gte('date', `${input.month}-01`).lt('date', `${input.month}-32`)
      }
      const { data, error } = await query.limit(200)
      if (error) return { error: error.message }
      const income = (data ?? []).filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0)
      const expenses = (data ?? []).filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0)
      const overdue = (data ?? []).filter(e => e.invoice_status === 'overdue')
      return {
        mrr: income,
        expenses,
        net: income - expenses,
        overdue_count: overdue.length,
        overdue_total: overdue.reduce((s, e) => s + e.amount, 0),
        overdue_clients: overdue.map(e => ({ client: e.client_name, amount: e.amount, invoice: e.notes })),
      }
    }

    case 'get_open_alerts': {
      const { data, error } = await supabase
        .from('ai_alerts')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false })
      if (error) return { error: error.message }
      return { count: data?.length ?? 0, alerts: data ?? [] }
    }

    case 'run_daily_briefing': {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString()
      const [leads, sprints, approvals, alerts] = await Promise.all([
        supabase.from('prospects').select('id, status, quality_score').gte('created_at', yesterday),
        supabase.from('sprints').select('id, client_name, day_number, leads_generated, leads_target, cpl, cpl_target, roas, roas_target, status').eq('status', 'active'),
        supabase.from('approval_queue').select('id, priority').eq('status', 'pending'),
        supabase.from('ai_alerts').select('id, severity, category, message, suggested_action, client_name').eq('resolved', false),
      ])
      const sprintSnapshot = (sprints.data ?? []).map(s => ({
        client: s.client_name,
        day: s.day_number,
        leads: s.leads_generated,
        leads_target: s.leads_target,
        cpl: s.cpl,
        cpl_target: s.cpl_target,
        roas: s.roas,
        status: s.cpl <= s.cpl_target ? 'on_track' : s.cpl <= s.cpl_target * 1.2 ? 'at_risk' : 'off_track',
      }))
      return {
        new_leads: leads.data?.length ?? 0,
        active_sprints: sprints.data?.length ?? 0,
        pending_approvals: approvals.data?.length ?? 0,
        open_alerts: alerts.data?.length ?? 0,
        critical_alerts: (alerts.data ?? []).filter(a => a.severity === 'critical').length,
        sprint_snapshot: sprintSnapshot,
        top_alerts: (alerts.data ?? []).slice(0, 3),
      }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { messages, system } = await req.json()

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Agentic loop: run until stop_reason is 'end_turn' or we hit max iterations
    const loopMessages: Anthropic.MessageParam[] = [...messages]
    const toolCallLog: Array<{ tool: string; result_summary: string }> = []
    let finalText = ''
    const MAX_ITERATIONS = 10

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: system ?? '',
        messages: loopMessages,
        tools,
      })

      if (response.stop_reason === 'end_turn' || !response.content.some(b => b.type === 'tool_use')) {
        finalText = response.content
          .filter(b => b.type === 'text')
          .map(b => (b as Anthropic.TextBlock).text)
          .join('')
        break
      }

      // Push assistant turn into history
      loopMessages.push({ role: 'assistant', content: response.content })

      // Execute all tool calls and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const result = await executeTool(
          block.name,
          block.input as Record<string, unknown>,
          supabase,
        )
        const resultStr = JSON.stringify(result)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: resultStr })
        toolCallLog.push({
          tool: block.name,
          result_summary: summarise(block.name, result),
        })
      }

      loopMessages.push({ role: 'user', content: toolResults })
    }

    return new Response(
      JSON.stringify({ content: finalText, tool_calls: toolCallLog }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function summarise(tool: string, result: unknown): string {
  const r = result as Record<string, unknown>
  switch (tool) {
    case 'get_new_leads':
      return `Fetched ${r.count ?? 0} new leads (avg quality: ${r.avg_quality ?? 'n/a'})`
    case 'get_active_sprints':
      return `Fetched ${r.count ?? 0} active sprints`
    case 'get_pending_approvals':
      return `Found ${r.count ?? 0} pending approvals`
    case 'get_finance_summary':
      return `MRR £${r.mrr ?? 0}, ${r.overdue_count ?? 0} overdue invoices`
    case 'get_open_alerts':
      return `Found ${r.count ?? 0} open alerts`
    case 'run_daily_briefing':
      return `Briefing: ${r.new_leads ?? 0} new leads, ${r.active_sprints ?? 0} sprints, ${r.open_alerts ?? 0} alerts`
    default:
      return JSON.stringify(result).slice(0, 120)
  }
}
