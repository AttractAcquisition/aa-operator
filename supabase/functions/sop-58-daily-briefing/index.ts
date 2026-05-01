// Model: claude-sonnet-4-6 — analytical synthesis of live operational data.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET = 'claude-sonnet-4-6'

interface SprintRow {
  client_name: string
  day_number: number
  leads_generated: number
  leads_target: number
  cpl: number
  cpl_target: number
}

interface AlertRow {
  severity: string
  category: string
  message: string
  client_name: string | null
  suggested_action: string
}

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

    const yesterday = new Date(Date.now() - 86_400_000).toISOString()

    // ── 1. Parallel count queries ─────────────────────────────────────────────
    const [newLeadsRes, warmRes, sprintsCountRes, pendingRes, alertsCountRes] = await Promise.all([
      supabase
        .from('prospects')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', yesterday),
      supabase
        .from('prospects')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'warm'),
      supabase
        .from('sprints')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active'),
      supabase
        .from('approval_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('ai_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('resolved', false),
    ])

    // ── 2. Detail queries for analytical context ──────────────────────────────
    const [sprintsRes, alertsRes] = await Promise.all([
      supabase
        .from('sprints')
        .select('client_name, day_number, leads_generated, leads_target, cpl, cpl_target')
        .eq('status', 'active')
        .limit(10),
      supabase
        .from('ai_alerts')
        .select('severity, category, message, client_name, suggested_action')
        .eq('resolved', false)
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    const newLeads = newLeadsRes.count ?? 0
    const warmLeads = warmRes.count ?? 0
    const activeSprintsCount = sprintsCountRes.count ?? 0
    const pendingApprovals = pendingRes.count ?? 0
    const openAlerts = alertsCountRes.count ?? 0
    const sprints: SprintRow[] = (sprintsRes.data ?? []) as SprintRow[]
    const alerts: AlertRow[] = (alertsRes.data ?? []) as AlertRow[]
    const now = new Date().toISOString()

    // ── 3. Build context for Claude ───────────────────────────────────────────
    const context = `Today: ${now}

COUNTS (use these exact values in the JSON — do not alter them):
  new_leads: ${newLeads}
  warm_replies: ${warmLeads}
  active_sprints: ${activeSprintsCount}
  pending_approvals: ${pendingApprovals}
  open_alerts: ${openAlerts}
  mrr: 0
  overdue_invoices: 0

OPEN ALERTS (${openAlerts} total):
${alerts.length > 0
  ? alerts.map(a =>
      `  [${a.severity.toUpperCase()}] ${a.category}${a.client_name ? ` — ${a.client_name}` : ''}: ${a.message}`
    ).join('\n')
  : '  (none)'}

ACTIVE SPRINTS (${activeSprintsCount} total):
${sprints.length > 0
  ? sprints.map(s => {
      const pace = s.day_number > 0 ? s.leads_generated / s.day_number : 0
      const targetPace = s.leads_target / 14
      return `  ${s.client_name} — Day ${s.day_number}/14, ${s.leads_generated}/${s.leads_target} leads, ` +
        `CPL £${s.cpl.toFixed(2)} vs £${s.cpl_target} target, pace ${pace.toFixed(1)}/day vs ${targetPace.toFixed(1)} needed`
    }).join('\n')
  : '  (none)'}
`

    // ── 4. Call Claude Sonnet 4.6 ─────────────────────────────────────────────
    const response = await anthropic.messages.create({
      model: SONNET,
      max_tokens: 2048,
      system: [
        'You generate structured daily briefing JSON for the AA Operator dashboard (B2B lead generation agency).',
        '',
        'Rules:',
        '  1. Use EXACTLY the count values provided — do not recalculate them.',
        '  2. Set generated_at to the exact ISO timestamp from "Today:" in the context.',
        '  3. Generate 3–5 priorities ranked by urgency from the alert and sprint data.',
        '  4. Generate sprint_snapshot from the sprint data:',
        '       status: on_track (pace≥90% of target AND cpl≤cpl_target)',
        '               at_risk  (70–90% pace OR cpl slightly over)',
        '               off_track (pace<70% OR cpl significantly over)',
        '       leads_today: round(leads_generated / day_number), min 0',
        '  5. Respond with ONLY valid JSON — no markdown fences, no explanation.',
        '',
        'JSON schema:',
        '{"generated_at":"<ISO>","new_leads":0,"warm_replies":0,"active_sprints":0,"pending_approvals":0,"open_alerts":0,"mrr":0,"overdue_invoices":0',
        ',"priorities":[{"rank":1,"category":"<Sprint Performance|Finance|Approval Queue|Pipeline|Upcoming>","message":"<specific insight>","action":"<actionable step>","urgency":"<high|medium|low>"}]',
        ',"sprint_snapshot":[{"client":"<name>","day":0,"status":"<on_track|at_risk|off_track>","leads_today":0}]}',
      ].join('\n'),
      messages: [
        { role: 'user', content: context },
      ],
    })

    const raw = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('')
      .trim()

    const briefing = JSON.parse(raw)

    // ── 5. Persist to daily_briefings ─────────────────────────────────────────
    const { error: insertError } = await supabase.from('daily_briefings').insert({
      generated_at: briefing.generated_at ?? now,
      briefing,
    })
    if (insertError) throw new Error(`insert daily_briefings: ${insertError.message}`)

    // ── 6. Audit log ──────────────────────────────────────────────────────────
    const priorityCount = briefing.priorities?.length ?? 0
    const snapshotCount = briefing.sprint_snapshot?.length ?? 0

    await supabase.from('ai_task_log').insert({
      sop_id: '58',
      sop_name: 'SOP 58 — Daily Briefing',
      tool_called: SONNET,
      status: 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${activeSprintsCount} sprints, ${openAlerts} alerts, ${pendingApprovals} pending`,
      output_summary: `${priorityCount} priorities, ${snapshotCount} sprint snapshots written to daily_briefings`,
    })

    return new Response(JSON.stringify(briefing), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await supabase.from('ai_task_log').insert({
        sop_id: '58',
        sop_name: 'SOP 58 — Daily Briefing',
        tool_called: SONNET,
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: 'daily briefing run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
