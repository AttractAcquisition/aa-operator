// sop-41-weekly-review — runs every Friday at 16:00 (cron: 0 16 * * 5)
// Model: claude-sonnet-4-6 — week-in-review synthesis across all operational data.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET   = 'claude-sonnet-4-6'
const SOP_ID   = '41'
const SOP_NAME = 'SOP 41 — Weekly Review'

// Tier MRR values — kept in sync with migration 20260505100000
const TIER_MRR: Record<string, number> = {
  proof_sprint:    800,
  proof_brand:    1500,
  authority_brand: 3000,
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  id:                  string
  name:                string
  status:              string
  tier:                string | null
  mrr:                 number | null
  niche:               string | null
  last_upsell_score:   number | null
  next_review_date:    string | null
}

interface SprintRow {
  id:              string
  client_name:     string
  status:          string
  day_number:      number
  leads_generated: number
  leads_target:    number
  spend:           number
  spend_budget:    number
  cpl:             number
  cpl_target:      number
  roas:            number
  roas_target:     number
  updated_at:      string | null
}

interface AlertRow {
  severity:         string
  category:         string
  message:          string
  client_name:      string | null
  suggested_action: string
  resolved:         boolean
  created_at:       string
}

interface ProspectCount {
  status: string
  count:  number
}

interface ApprovalRow {
  status:       string
  priority:     string | null
  content_type: string | null
  reviewed_at:  string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcHealth(cpl: number, cplTarget: number, leads: number, leadsTarget: number): string {
  const pacePct = leadsTarget > 0 ? (leads / leadsTarget) * 100 : 100
  const cplPct  = cplTarget  > 0 ? (cpl  / cplTarget)  * 100 : 100
  if (pacePct >= 90 && cplPct <= 110) return 'on_track'
  if (pacePct >= 70 || cplPct <= 120) return 'at_risk'
  return 'off_track'
}

function weekLabel(from: Date, to: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `${fmt(from)} – ${fmt(to)}`
}

// ─── Claude synthesis ─────────────────────────────────────────────────────────

async function synthesise(context: string, now: string): Promise<Record<string, unknown>> {
  const response = await anthropic.messages.create({
    model:      SONNET,
    max_tokens: 2500,
    system: [
      'You generate a structured weekly review JSON for the AA Operator dashboard.',
      'AA Operator is the AI management system for Attract Acquisition, a performance',
      'marketing agency running Meta/Google Ads for UK local service businesses.',
      '',
      'Rules:',
      '  1. Use EXACTLY the numeric values provided — never recalculate or estimate them.',
      '  2. Set generated_at to the ISO timestamp from "Generated at:" in the context.',
      '  3. wins: 2–4 specific positive things that happened this week (data-driven).',
      '  4. issues: 2–4 items that need addressing — be direct and specific.',
      '  5. clients_needing_attention: only clients with off-track sprints, missed targets,',
      '     CPL > 20% over target, or high upsell score that is unacted on.',
      '  6. pipeline_health: "strong" (calls_booked≥3 OR closed≥1), "moderate" (calls_booked 1–2),',
      '     "weak" (calls_booked=0 AND closed=0).',
      '  7. forecast_note: 1–2 sentences on revenue trajectory based on the data.',
      '  8. priorities: exactly 5, ranked by urgency (high before medium before low).',
      '  9. Output ONLY valid JSON — no markdown fences, no commentary.',
      '',
      'JSON schema (follow exactly):',
      '{',
      '  "type": "weekly_review",',
      '  "generated_at": "<ISO>",',
      '  "week_label": "<from context>",',
      '  "wins": [{"title":"<str>","detail":"<str>"}],',
      '  "issues": [{"severity":"<high|medium|low>","title":"<str>","action":"<str>"}],',
      '  "clients_needing_attention": [{"client":"<name>","reason":"<str>","action":"<str>"}],',
      '  "pipeline_progress": {',
      '    "new_leads":<n>,"warm_replies":<n>,"calls_booked":<n>,"closed_this_week":<n>,',
      '    "pipeline_health":"<strong|moderate|weak>"',
      '  },',
      '  "revenue_forecast": {',
      '    "current_mrr":<n>,"active_clients":<n>,',
      '    "tier_breakdown":{"proof_sprint":<n>,"proof_brand":<n>,"authority_brand":<n>},',
      '    "upsell_candidates":<n>,"forecast_note":"<str>"',
      '  },',
      '  "sprint_summary": {',
      '    "active":<n>,"on_track":<n>,"at_risk":<n>,"off_track":<n>,"completed_this_week":<n>',
      '  },',
      '  "priorities": [{"rank":1,"priority":"<str>","urgency":"<high|medium|low>","owner":"<Account Manager|AI System|Both>"}]',
      '}',
    ].join('\n'),
    messages: [{ role: 'user', content: context }],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  return JSON.parse(raw) as Record<string, unknown>
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

    const now       = new Date()
    const nowISO    = now.toISOString()
    const weekStart = new Date(now.getTime() - 7 * 86_400_000)
    const weekStartISO = weekStart.toISOString()
    const label    = weekLabel(weekStart, now)

    console.log(`[sop-41] weekly review for ${label}`)

    // ── 1. Parallel data fetch ────────────────────────────────────────────────

    const [
      clientsRes,
      activeSprintsRes,
      completedSprintsRes,
      openAlertsRes,
      weekAlertsRes,
      pendingApprovalsRes,
      weekApprovalsRes,
      prospectStatusRes,
      newProspectsRes,
    ] = await Promise.all([
      // All active clients with tier + upsell info
      supabase
        .from('clients')
        .select('id, name, status, tier, mrr, niche, last_upsell_score, next_review_date')
        .eq('status', 'active'),

      // Active sprints with full metrics
      supabase
        .from('sprints')
        .select('id, client_name, status, day_number, leads_generated, leads_target, spend, spend_budget, cpl, cpl_target, roas, roas_target, updated_at')
        .eq('status', 'active'),

      // Sprints that completed this week
      supabase
        .from('sprints')
        .select('id, client_name, leads_generated, leads_target, cpl, cpl_target, roas, roas_target, updated_at')
        .eq('status', 'complete')
        .gte('updated_at', weekStartISO),

      // Open alerts (unresolved)
      supabase
        .from('ai_alerts')
        .select('severity, category, message, client_name, suggested_action, resolved, created_at')
        .eq('resolved', false)
        .order('created_at', { ascending: false })
        .limit(20),

      // All alerts raised this week (for context on resolved vs open)
      supabase
        .from('ai_alerts')
        .select('severity, category, message, client_name, suggested_action, resolved, created_at')
        .gte('created_at', weekStartISO)
        .order('created_at', { ascending: false }),

      // Pending approval items
      supabase
        .from('approval_queue')
        .select('status, priority, content_type, reviewed_at')
        .eq('status', 'pending'),

      // Approvals reviewed this week
      supabase
        .from('approval_queue')
        .select('status, priority, content_type, reviewed_at')
        .gte('reviewed_at', weekStartISO)
        .neq('status', 'pending'),

      // Prospect counts by status — for pipeline snapshot
      supabase
        .from('prospects')
        .select('status')
        .in('status', ['warm', 'call_booked', 'closed', 'new', 'enriched', 'staged']),

      // New prospects created this week
      supabase
        .from('prospects')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', weekStartISO),
    ])

    // ── 2. Process raw data ───────────────────────────────────────────────────

    const clients         = (clientsRes.data ?? []) as ClientRow[]
    const activeSprints   = (activeSprintsRes.data ?? []) as SprintRow[]
    const completedSprints = (completedSprintsRes.data ?? []) as SprintRow[]
    const openAlerts      = (openAlertsRes.data ?? []) as AlertRow[]
    const weekAlerts      = (weekAlertsRes.data ?? []) as AlertRow[]
    const pendingApprovals = (pendingApprovalsRes.data ?? []) as ApprovalRow[]
    const weekApprovals   = (weekApprovalsRes.data ?? []) as ApprovalRow[]
    const allProspects    = (prospectStatusRes.data ?? []) as { status: string }[]
    const newProspects    = newProspectsRes.count ?? 0

    // Prospect status counts
    const statusCounts = allProspects.reduce<Record<string, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1
      return acc
    }, {})

    // Revenue aggregates
    const tierMRR: Record<string, number> = { proof_sprint: 0, proof_brand: 0, authority_brand: 0 }
    let totalMRR = 0

    for (const c of clients) {
      const tier = c.tier ?? 'proof_sprint'
      // Use stored mrr if present, otherwise look up tier rate
      const mrr  = c.mrr ?? TIER_MRR[tier] ?? 0
      totalMRR += mrr
      if (tier in tierMRR) tierMRR[tier] += mrr
    }

    const upsellCandidates = clients.filter(c => (c.last_upsell_score ?? 0) >= 7).length

    // Sprint health roll-up
    const sprintHealth = activeSprints.map(s => ({
      ...s,
      health: calcHealth(s.cpl, s.cpl_target, s.leads_generated, s.leads_target),
    }))

    const onTrack  = sprintHealth.filter(s => s.health === 'on_track').length
    const atRisk   = sprintHealth.filter(s => s.health === 'at_risk').length
    const offTrack = sprintHealth.filter(s => s.health === 'off_track').length

    // Clients with off-track sprints (for attention section)
    const offTrackClients = sprintHealth
      .filter(s => s.health === 'off_track')
      .map(s => s.client_name)

    // Prospects closed this week: prospects with status=closed and created/updated this week
    // We don't have updated_at on prospects — use 'closed' status count as proxy
    const closedThisWeek = 0 // prospects table doesn't expose closed_at; keep as 0

    // ── 3. Build context for Claude ───────────────────────────────────────────

    const sprintLines = sprintHealth.length > 0
      ? sprintHealth.map(s => {
          const cplDelta = s.cpl_target > 0 ? ((s.cpl / s.cpl_target - 1) * 100).toFixed(1) : '0'
          const leadPct  = s.leads_target > 0 ? ((s.leads_generated / s.leads_target) * 100).toFixed(1) : '0'
          return `  ${s.client_name} — Day ${s.day_number}/14, ${s.leads_generated}/${s.leads_target} leads (${leadPct}%), ` +
            `CPL £${s.cpl.toFixed(2)} vs £${s.cpl_target} target (${Number(cplDelta) >= 0 ? '+' : ''}${cplDelta}%), ` +
            `ROAS ${s.roas.toFixed(2)}x vs ${s.roas_target}x, health: ${s.health}`
        }).join('\n')
      : '  (none)'

    const completedLines = completedSprints.length > 0
      ? completedSprints.map(s => {
          const cplDelta = s.cpl_target > 0 ? ((s.cpl / s.cpl_target - 1) * 100).toFixed(1) : '0'
          return `  ${s.client_name} — ${s.leads_generated}/${s.leads_target} leads, ` +
            `CPL £${s.cpl.toFixed(2)} (${Number(cplDelta) >= 0 ? '+' : ''}${cplDelta}% vs target), ` +
            `ROAS ${s.roas.toFixed(2)}x vs ${s.roas_target}x`
        }).join('\n')
      : '  (none)'

    const alertLines = openAlerts.length > 0
      ? openAlerts.slice(0, 10).map(a =>
          `  [${a.severity.toUpperCase()}] ${a.category}${a.client_name ? ` (${a.client_name})` : ''}: ${a.message}`
        ).join('\n')
      : '  (none)'

    const clientLines = clients.map(c => {
      const tier  = c.tier ?? 'proof_sprint'
      const mrr   = c.mrr ?? TIER_MRR[tier] ?? 0
      const upsell = c.last_upsell_score != null ? `, upsell score: ${c.last_upsell_score}/10` : ''
      const attn  = offTrackClients.includes(c.name) ? ' ⚠ OFF-TRACK SPRINT' : ''
      return `  ${c.name} — ${tier.replace('_', ' ')}, MRR £${mrr}${upsell}${attn}`
    }).join('\n')

    const context = `Generated at: ${nowISO}
Week: ${label}

CLIENTS (${clients.length} active):
${clientLines}

REVENUE:
  Total MRR: £${totalMRR}
  Proof Sprint clients: ${clients.filter(c => c.tier === 'proof_sprint').length} (£${tierMRR.proof_sprint} MRR)
  Proof Brand clients: ${clients.filter(c => c.tier === 'proof_brand').length} (£${tierMRR.proof_brand} MRR)
  Authority Brand clients: ${clients.filter(c => c.tier === 'authority_brand').length} (£${tierMRR.authority_brand} MRR)
  Upsell candidates (score ≥ 7): ${upsellCandidates}

ACTIVE SPRINTS (${activeSprints.length} total — ${onTrack} on track, ${atRisk} at risk, ${offTrack} off track):
${sprintLines}

SPRINTS COMPLETED THIS WEEK (${completedSprints.length}):
${completedLines}

PIPELINE:
  New prospects sourced this week: ${newProspects}
  Currently warm (replied positively): ${statusCounts['warm'] ?? 0}
  Calls booked: ${statusCounts['call_booked'] ?? 0}
  Closed this week: ${closedThisWeek}

APPROVAL QUEUE:
  Pending items: ${pendingApprovals.length}
  High-priority pending: ${pendingApprovals.filter(a => a.priority === 'high').length}
  Approved/reviewed this week: ${weekApprovals.length}

ALERTS:
  Open (unresolved): ${openAlerts.length}
  Raised this week: ${weekAlerts.length}
  Resolved this week: ${weekAlerts.filter(a => a.resolved).length}
  Critical open: ${openAlerts.filter(a => a.severity === 'critical').length}
  Warning open: ${openAlerts.filter(a => a.severity === 'warning').length}

OPEN ALERT DETAIL:
${alertLines}
`

    console.log(`[sop-41] context built — ${clients.length} clients, ${activeSprints.length} active sprints, ${openAlerts.length} open alerts`)

    // ── 4. Claude synthesis ───────────────────────────────────────────────────

    const briefing = await synthesise(context, nowISO)

    // Ensure numeric fields are hard-set from ground-truth data, not hallucinated
    ;(briefing as Record<string, unknown>).pipeline_progress = {
      ...((briefing.pipeline_progress as Record<string, unknown>) ?? {}),
      new_leads:       newProspects,
      warm_replies:    statusCounts['warm'] ?? 0,
      calls_booked:    statusCounts['call_booked'] ?? 0,
      closed_this_week: closedThisWeek,
    }
    ;(briefing as Record<string, unknown>).revenue_forecast = {
      ...((briefing.revenue_forecast as Record<string, unknown>) ?? {}),
      current_mrr:     totalMRR,
      active_clients:  clients.length,
      tier_breakdown:  { ...tierMRR },
      upsell_candidates: upsellCandidates,
    }
    ;(briefing as Record<string, unknown>).sprint_summary = {
      active:               activeSprints.length,
      on_track:             onTrack,
      at_risk:              atRisk,
      off_track:            offTrack,
      completed_this_week:  completedSprints.length,
    }

    // ── 5. Persist to daily_briefings ─────────────────────────────────────────

    const { error: insertErr } = await supabase.from('daily_briefings').insert({
      generated_at: nowISO,
      briefing,
    })
    if (insertErr) throw new Error(`insert daily_briefings: ${insertErr.message}`)

    console.log(`[sop-41] weekly review written to daily_briefings`)

    // ── 6. Audit log ──────────────────────────────────────────────────────────

    const wins      = ((briefing.wins  as unknown[]) ?? []).length
    const issues    = ((briefing.issues as unknown[]) ?? []).length
    const priorities = ((briefing.priorities as unknown[]) ?? []).length

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    SONNET,
      status:         'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${clients.length} clients, ${activeSprints.length} active sprints, ${openAlerts.length} open alerts`,
      output_summary: `Weekly review written — ${wins} wins, ${issues} issues, ${priorities} priorities`,
    })

    return new Response(JSON.stringify(briefing), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-41] fatal: ${message}`)

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
        input_summary:  'weekly review run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
