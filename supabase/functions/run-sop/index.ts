// Model routing: getModel(sopId) returns the correct model for each SOP.
// Haiku (claude-haiku-4-5-20251001) — mechanical tasks: scraping, dedup, CRM staging,
//   reply classification, backup checks, finance rollup, structured-data writes.
// Sonnet (claude-sonnet-4-6) — generation/reasoning: message drafts, document builds,
//   sprint analysis, ads monitoring, client reports, daily briefings.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

// ─── Model routing ────────────────────────────────────────────────────────────

const SONNET = 'claude-sonnet-4-6'
const HAIKU = 'claude-haiku-4-5-20251001'

// SOPs that use Haiku: mechanical tasks with structured output only, no text generation.
const HAIKU_SOPS = new Set(['02', '03', '04', '06', '52', '56'])

function getModel(sopId: string): string {
  return HAIKU_SOPS.has(sopId) ? HAIKU : SONNET
}

// ─── SOP registry ────────────────────────────────────────────────────────────
// Defines the task instruction and tools for each automated SOP.

const SOP_REGISTRY: Record<string, { name: string; domain: string; task: string; tools: string[] }> = {
  '58': {
    name: 'Admin Command Centre & Daily Review',
    domain: 'Principal',
    task: 'Generate the daily command centre briefing. Check new leads from the last 24 hours, review all active sprints and flag any performance issues, count pending approvals, and list all unresolved alerts. Create a prioritised briefing with the top 5 actions needed today.',
    tools: ['get_new_leads', 'get_active_sprints', 'get_pending_approvals', 'get_open_alerts', 'create_daily_briefing'],
  },
  '21': {
    name: 'Proof Sprint Daily Ops',
    domain: 'Delivery',
    task: 'Process all active sprints. For each sprint, check current performance against targets (CPL, ROAS, leads generated vs target). Flag any sprint where CPL is >10% over target as at-risk, and >20% over target as off-track. Create an alert for any critical performance issues.',
    tools: ['get_active_sprints', 'create_sprint_log', 'create_alert'],
  },
  '23': {
    name: 'Proof Sprint Ads Monitoring',
    domain: 'Delivery',
    task: 'Monitor ad performance for all active sprints. Identify any ad sets where CPL is significantly above target. Apply kill/scale logic: flag underperforming ad sets (CPL >150% of target) for pausing, and identify top performing ad sets for budget scaling. Create alerts for any actions required.',
    tools: ['get_active_sprints', 'get_open_alerts', 'create_alert'],
  },
  '06': {
    name: 'Reply Triage & CRM Hygiene',
    domain: 'Distribution',
    task: 'Triage all unread WhatsApp replies and classify them as warm (interested), cold (not interested), or not_interested. Update prospect status accordingly. For warm leads, create an approval item for follow-up action. Update CRM to ensure clean data.',
    tools: ['get_new_leads', 'get_pending_approvals', 'create_approval_item'],
  },
  '01': {
    name: 'WhatsApp Outreach Draft Queue',
    domain: 'Distribution',
    task: 'Draft the daily WhatsApp outreach batch. Check staged prospects ready for outreach, generate personalised messages using their company name, niche, and location. Create a single approval item with the full batch for review before sending. Do not send without approval.',
    tools: ['get_new_leads', 'create_approval_item'],
  },
  '47': {
    name: 'Weekly Client Reporting',
    domain: 'Delivery',
    task: 'Generate weekly performance reports for all active clients. For each client with an active sprint, compile this week\'s metrics: leads generated, CPL, ROAS, spend vs budget, trend vs last week. Create an approval item per client report before publishing.',
    tools: ['get_active_sprints', 'get_open_alerts', 'create_approval_item'],
  },
  '56': {
    name: 'Finance Dashboard & Income Tracking',
    domain: 'Finance',
    task: 'Update the finance dashboard for the week. Summarise income vs expenses, calculate current MRR, flag any overdue invoices, and identify clients approaching renewal. Create alerts for any invoices overdue >7 days.',
    tools: ['get_finance_summary', 'create_alert'],
  },
  '52': {
    name: 'Backup & Security Check',
    domain: 'Operations',
    task: 'Perform the weekly backup and security check. Verify all automated systems ran successfully this week by checking the task log and cron schedule for failures. Create alerts for any recurring failures or anomalies.',
    tools: ['get_open_alerts', 'get_cron_status'],
  },
  '02': {
    name: 'Prospect Scraper & Batch Run',
    domain: 'Distribution',
    task: 'Trigger the weekly prospect scraping batch. Check current pipeline volumes and identify which source lists need replenishing. Stage results for enrichment and quality scoring. Report on batch size and quality distribution.',
    tools: ['get_new_leads', 'create_alert'],
  },
  '35': {
    name: 'Upsell Detection',
    domain: 'Delivery',
    task: 'Run the weekly upsell detection scan across all active clients. For each client, score upsell readiness (0–10) based on sprint completion rate, CPL vs target, satisfaction signals, client tenure, and tier headroom. For any client scoring 8 or above with an available upsell path, create a high-priority alert with talking points and an offer_document approval item.',
    tools: ['get_active_sprints', 'get_open_alerts', 'create_approval_item', 'create_alert'],
  },
  '43': {
    name: 'Authority Brand Monthly Ops',
    domain: 'Delivery',
    task: 'Generate comprehensive monthly delivery reviews for all active authority_brand clients (£3,000/mo, Google + Meta + Remarketing). Cover full funnel performance, brand authority metrics, content performance, market positioning, and strategic recommendations for the next 30 days. Create a high-priority approval item per client.',
    tools: ['get_active_sprints', 'get_open_alerts', 'create_approval_item'],
  },
  '31': {
    name: 'Proof Brand Monthly Ops',
    domain: 'Delivery',
    task: 'Run monthly delivery status checks for all active proof_brand clients. For each client, analyse month-to-date leads vs target, CPL trend, ROAS trend, and campaign health. Score upsell readiness (1-10) and create an alert for any client scoring 8 or above. Create an approval item per client report.',
    tools: ['get_active_sprints', 'get_open_alerts', 'create_approval_item', 'create_alert'],
  },
  '53': {
    name: 'Performance Review & KPI Cadence',
    domain: 'Operations',
    task: 'Run the weekly performance review. Analyse KPIs across all active sprints and clients. Compare against targets and prior week. Identify trends and flag any systemic issues. Generate a summary report for the weekly review meeting.',
    tools: ['get_active_sprints', 'get_finance_summary', 'get_open_alerts'],
  },
}

// ─── Tools ───────────────────────────────────────────────────────────────────

const tools: Anthropic.Tool[] = [
  {
    name: 'get_new_leads',
    description: 'Get new and staged prospects from the database.',
    input_schema: {
      type: 'object' as const,
      properties: { hours: { type: 'number' } },
    },
  },
  {
    name: 'get_active_sprints',
    description: 'Get all active proof sprints with performance data.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_pending_approvals',
    description: 'Get all pending approval queue items.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_open_alerts',
    description: 'Get all unresolved AI alerts.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_finance_summary',
    description: 'Get finance summary including MRR and overdue invoices.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_cron_status',
    description: 'Get the run status of all cron schedules this week.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'create_alert',
    description: 'Create a new AI alert for an issue that needs attention.',
    input_schema: {
      type: 'object' as const,
      properties: {
        severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
        category: { type: 'string' },
        message: { type: 'string' },
        suggested_action: { type: 'string' },
        client_name: { type: 'string' },
        sop_id: { type: 'string' },
      },
      required: ['severity', 'category', 'message', 'suggested_action'],
    },
  },
  {
    name: 'create_approval_item',
    description: 'Create a new item in the approval queue for human review.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sop_name: { type: 'string' },
        type: { type: 'string', enum: ['whatsapp_message', 'client_report', 'call_brief', 'mjr_document', 'spoa_document', 'delivery_sequence', 'offer_document'] },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        title: { type: 'string' },
        body: { type: 'string' },
        recipient: { type: 'string' },
        metadata: { type: 'object' },
      },
      required: ['sop_name', 'type', 'priority', 'title', 'body'],
    },
  },
  {
    name: 'create_sprint_log',
    description: 'Log the daily metrics for an active sprint.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sprint_id: { type: 'string' },
        notes: { type: 'string' },
        health_status: { type: 'string', enum: ['on_track', 'at_risk', 'off_track'] },
      },
      required: ['sprint_id', 'health_status'],
    },
  },
  {
    name: 'create_daily_briefing',
    description: 'Store the generated daily briefing summary.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string' },
        priorities: { type: 'array', items: { type: 'object' } },
      },
      required: ['summary'],
    },
  },
]

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  supabase: ReturnType<typeof createClient>,
  sopId: string,
): Promise<unknown> {
  switch (name) {
    case 'get_new_leads': {
      const hours = (input.hours as number) ?? 24
      const since = new Date(Date.now() - hours * 3600_000).toISOString()
      const { data } = await supabase.from('prospects')
        .select('id, name, company, status, quality_score, source_list')
        .gte('created_at', since)
      return { count: data?.length ?? 0, leads: data ?? [] }
    }
    case 'get_active_sprints': {
      const { data } = await supabase.from('sprints').select('*').eq('status', 'active')
      return { count: data?.length ?? 0, sprints: data ?? [] }
    }
    case 'get_pending_approvals': {
      const { data } = await supabase.from('approval_queue').select('*').eq('status', 'pending')
      return { count: data?.length ?? 0, items: data ?? [] }
    }
    case 'get_open_alerts': {
      const { data } = await supabase.from('ai_alerts').select('*').eq('resolved', false)
      return { count: data?.length ?? 0, alerts: data ?? [] }
    }
    case 'get_finance_summary': {
      const { data } = await supabase.from('finance_ledger').select('*').order('date', { ascending: false }).limit(100)
      const income = (data ?? []).filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0)
      const expenses = (data ?? []).filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0)
      const overdue = (data ?? []).filter(e => e.invoice_status === 'overdue')
      return { mrr: income, expenses, overdue_count: overdue.length, overdue_total: overdue.reduce((s, e) => s + e.amount, 0) }
    }
    case 'get_cron_status': {
      const week_ago = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const { data } = await supabase.from('cron_schedule').select('sop_name, last_status, last_run, run_count, last_error').gte('last_run', week_ago)
      const failures = (data ?? []).filter(c => c.last_status === 'failure')
      return { total: data?.length ?? 0, failures: failures.length, crons: data ?? [] }
    }
    case 'create_alert': {
      const { data } = await supabase.from('ai_alerts').insert({
        severity: input.severity,
        sop_id: sopId,
        category: input.category,
        message: input.message,
        suggested_action: input.suggested_action,
        client_name: input.client_name ?? null,
      }).select().single()
      return { created: true, id: data?.id }
    }
    case 'create_approval_item': {
      const { data } = await supabase.from('approval_queue').insert({
        sop_id: sopId,
        sop_name: input.sop_name,
        status: 'pending',
        priority: input.priority,
        content: {
          title: input.title,
          body: input.body,
          recipient: input.recipient ?? null,
          metadata: input.metadata ?? null,
        },
        content_type: input.type,
        content_id: crypto.randomUUID(),
      }).select().single()
      return { created: true, id: data?.id }
    }
    case 'create_sprint_log': {
      await supabase.from('ai_task_log').insert({
        sop_id: sopId,
        sop_name: SOP_REGISTRY[sopId]?.name ?? `SOP ${sopId}`,
        tool_called: 'create_sprint_log',
        status: 'success',
        input_summary: `Sprint ${input.sprint_id} — ${input.health_status}`,
        output_summary: input.notes as string ?? 'Logged',
      })
      return { logged: true }
    }
    case 'create_daily_briefing': {
      await supabase.from('ai_task_log').insert({
        sop_id: sopId,
        sop_name: 'Admin Command Centre & Daily Review',
        tool_called: 'create_daily_briefing',
        status: 'success',
        input_summary: 'Daily briefing generated',
        output_summary: (input.summary as string).slice(0, 500),
      })
      return { stored: true }
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

    const { sop_id } = await req.json()

    const sop = SOP_REGISTRY[sop_id]
    if (!sop) {
      return new Response(JSON.stringify({ error: `Unknown SOP: ${sop_id}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const systemPrompt = `You are the AI operating system for Attract Acquisition, a performance marketing agency.
You are executing SOP ${sop_id}: ${sop.name} (${sop.domain} domain).

Your task: ${sop.task}

Always query live data before taking any action. Be concise and action-oriented.
When creating alerts or approval items, include specific numbers and context.
After completing all actions, provide a brief summary of what was done.`

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: `Execute SOP ${sop_id}: ${sop.name}. Complete all required tasks now.` },
    ]

    let finalSummary = ''
    const MAX_ITERATIONS = 8

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await anthropic.messages.create({
        model: getModel(sop_id),
        max_tokens: 2048,
        system: systemPrompt,
        messages,
        tools,
      })

      if (response.stop_reason === 'end_turn' || !response.content.some(b => b.type === 'tool_use')) {
        finalSummary = response.content
          .filter(b => b.type === 'text')
          .map(b => (b as Anthropic.TextBlock).text)
          .join('')
        break
      }

      messages.push({ role: 'assistant', content: response.content })

      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const result = await executeTool(block.name, block.input as Record<string, unknown>, supabase, sop_id)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      }

      messages.push({ role: 'user', content: toolResults })
    }

    return new Response(
      JSON.stringify({ sop_id, sop_name: sop.name, summary: finalSummary }),
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
