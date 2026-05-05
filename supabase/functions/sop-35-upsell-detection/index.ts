// Model: claude-sonnet-4-6 — personalised upsell proposals for high-scoring clients.
// Scoring (0–10) is deterministic TypeScript; Claude is called only for qualifying
// clients (score >= 8) to generate the offer document and talking points.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET    = 'claude-sonnet-4-6'
const SOP_ID    = '35'
const SOP_NAME  = 'SOP 35 — Upsell Detection'

const UPSELL_THRESHOLD = 8

// ─── Tier ladder ──────────────────────────────────────────────────────────────
// Prices match sop-15 (the canonical offer-generation source).

interface UpsellPath {
  current_label:  string
  next_tier:      string
  next_label:     string
  monthly_fee:    string
  commitment:     string
  total_min:      string
  channels:       string
  key_additions:  string[]
}

const UPSELL_PATHS: Record<string, UpsellPath> = {
  proof_sprint: {
    current_label: 'Proof Sprint',
    next_tier:     'proof_brand',
    next_label:    'Proof Brand',
    monthly_fee:   '£2,497',
    commitment:    '6-month minimum',
    total_min:     '£14,982',
    channels:      'Google Ads + Meta Ads',
    key_additions: [
      'Meta Ads (Facebook & Instagram) running alongside Google',
      'Landing page A/B testing and conversion rate optimisation',
      'Dual-channel retargeting to reduce lead drop-off',
      'Monthly strategy review and competitor analysis',
    ],
  },
  proof_brand: {
    current_label: 'Proof Brand',
    next_tier:     'authority_brand',
    next_label:    'Authority Brand',
    monthly_fee:   '£3,997',
    commitment:    '12-month minimum',
    total_min:     '£47,964',
    channels:      'Google Ads + Meta Ads + Remarketing',
    key_additions: [
      'Full remarketing stack (Google Display, Meta retargeting)',
      'Content marketing and reputation management',
      'Multi-location and multi-service campaign management',
      'Dedicated account strategist with weekly check-ins',
    ],
  },
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRow {
  id:           string
  name:         string
  status:       string
  tier:         string | null
  niche:        string | null
  contact_name: string | null
  created_at:   string
}

interface SprintRow {
  id:              string
  client_name:     string
  day_number:      number
  leads_generated: number
  leads_target:    number
  spend:           number
  cpl:             number
  cpl_target:      number
  roas:            number
  roas_target:     number
}

interface SprintLogRow {
  sprint_id:    string
  logged_at:    string
  health_status: string
}

interface ScoreBreakdown {
  sprint_completion: number   // 0–3
  cpl_performance:  number   // 0–3
  satisfaction:     number   // 0–2
  client_tenure:    number   // 0–1
  tier_headroom:    number   // 0–1
  total:            number   // 0–10
  rationale:        string
}

interface ProposalOutput {
  next_tier:    string
  monthly_fee:  string
  commitment:   string
  tp1:          string
  tp2:          string
  tp3:          string
  report_html:  string
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreClient(
  client:            ClientRow,
  sprint:            SprintRow | null,
  recentLogs:        SprintLogRow[],
  unresolvedAlerts:  number,
): ScoreBreakdown {
  const reasons: string[] = []

  // 1. Sprint completion rate (0–3)
  let sprintCompletion = 0
  if (sprint && sprint.leads_target > 0) {
    const pct = (sprint.leads_generated / sprint.leads_target) * 100
    if      (pct >= 90) { sprintCompletion = 3; reasons.push(`leads ${pct.toFixed(0)}% of target (+3)`) }
    else if (pct >= 70) { sprintCompletion = 2; reasons.push(`leads ${pct.toFixed(0)}% of target (+2)`) }
    else if (pct >= 50) { sprintCompletion = 1; reasons.push(`leads ${pct.toFixed(0)}% of target (+1)`) }
    else                { reasons.push(`leads ${pct.toFixed(0)}% of target (+0)`) }
  } else {
    reasons.push('no active sprint (+0)')
  }

  // 2. CPL vs target (0–3)
  let cplPerformance = 0
  if (sprint && sprint.cpl_target > 0 && sprint.cpl > 0) {
    const ratio = sprint.cpl / sprint.cpl_target
    if      (ratio <= 1.00) { cplPerformance = 3; reasons.push(`CPL at/below target (+3)`) }
    else if (ratio <= 1.10) { cplPerformance = 2; reasons.push(`CPL ${((ratio - 1) * 100).toFixed(0)}% over target (+2)`) }
    else if (ratio <= 1.25) { cplPerformance = 1; reasons.push(`CPL ${((ratio - 1) * 100).toFixed(0)}% over target (+1)`) }
    else                    { reasons.push(`CPL ${((ratio - 1) * 100).toFixed(0)}% over target (+0)`) }
  } else {
    reasons.push('no CPL data (+0)')
  }

  // 3. Satisfaction signals (0–2): open alerts + recent health distribution
  let satisfaction = 0

  if (unresolvedAlerts === 0) {
    satisfaction++
    reasons.push('no open alerts (+1)')
  } else {
    reasons.push(`${unresolvedAlerts} open alert(s) (+0)`)
  }

  if (recentLogs.length > 0) {
    const onTrack = recentLogs.filter(l => l.health_status === 'on_track').length
    const onTrackPct = onTrack / recentLogs.length
    if (onTrackPct >= 0.70) {
      satisfaction++
      reasons.push(`${(onTrackPct * 100).toFixed(0)}% on-track days (+1)`)
    } else {
      reasons.push(`${(onTrackPct * 100).toFixed(0)}% on-track days (+0)`)
    }
  } else {
    reasons.push('no sprint log data for satisfaction (+0)')
  }

  // 4. Client tenure (0–1): >= 3 months since record created
  const monthsActive = (Date.now() - new Date(client.created_at).getTime()) / (30 * 24 * 3_600_000)
  const clientTenure = monthsActive >= 3 ? 1 : 0
  reasons.push(
    monthsActive >= 3
      ? `${Math.floor(monthsActive)} months as client (+1)`
      : `${Math.floor(monthsActive)} months as client — under 3 months (+0)`,
  )

  // 5. Tier headroom (0–1): not already at the top
  const tierHeadroom = client.tier !== 'authority_brand' ? 1 : 0
  reasons.push(
    client.tier === 'authority_brand'
      ? 'already at Authority Brand — no upsell path (+0)'
      : `on ${client.tier ?? 'unknown'} tier — upsell available (+1)`,
  )

  const total = sprintCompletion + cplPerformance + satisfaction + clientTenure + tierHeadroom

  return {
    sprint_completion: sprintCompletion,
    cpl_performance:   cplPerformance,
    satisfaction,
    client_tenure:     clientTenure,
    tier_headroom:     tierHeadroom,
    total,
    rationale:         reasons.join('; '),
  }
}

// ─── Offer generation (Claude — only called for qualifying clients) ────────────

async function generateUpsellProposal(
  client:  ClientRow,
  sprint:  SprintRow | null,
  path:    UpsellPath,
  score:   ScoreBreakdown,
): Promise<ProposalOutput> {
  const monthsActive = Math.floor(
    (Date.now() - new Date(client.created_at).getTime()) / (30 * 24 * 3_600_000),
  )

  const perfContext = sprint
    ? [
        `Current CPL: £${sprint.cpl.toFixed(2)} vs £${sprint.cpl_target} target`,
        `ROAS: ${sprint.roas.toFixed(2)}x vs ${sprint.roas_target}x target`,
        `Leads this sprint: ${sprint.leads_generated} / ${sprint.leads_target} target`,
        `Total ad spend: £${sprint.spend.toFixed(2)}`,
        `Sprint day: ${sprint.day_number}/14`,
      ].join('\n')
    : 'No active sprint data available.'

  const prompt = [
    `Client: ${client.name}`,
    `Current tier: ${path.current_label}`,
    `Niche: ${client.niche ?? 'local service business'}`,
    `Months as client: ${monthsActive}`,
    `Upsell readiness score: ${score.total}/10`,
    `Score breakdown: ${score.rationale}`,
    ``,
    `CURRENT PERFORMANCE:`,
    perfContext,
    ``,
    `UPGRADE PROPOSAL:`,
    `  From: ${path.current_label}`,
    `  To:   ${path.next_label} (${path.monthly_fee}/mo, ${path.commitment})`,
    `  Channels added: ${path.channels}`,
    `  Key additions: ${path.key_additions.join('; ')}`,
  ].join('\n')

  const response = await anthropic.messages.create({
    model:      SONNET,
    max_tokens: 3200,
    system: [
      'You are a senior account strategist at Attract Acquisition, a UK performance marketing agency.',
      `You are preparing a personalised upgrade proposal for an existing client moving from ${path.current_label} to ${path.next_label}.`,
      '',
      'This client is already getting results — your job is to show them what MORE looks like.',
      'Anchor on their actual performance numbers. Be specific, confident, and peer-to-peer.',
      '',
      'Your response MUST follow this exact structure:',
      '',
      `PROPOSAL_JSON: {"next_tier":"${path.next_tier}","monthly_fee":"${path.monthly_fee}","commitment":"${path.commitment}","tp1":"<data-backed talking point 1, max 15 words>","tp2":"<data-backed talking point 2, max 15 words>","tp3":"<data-backed talking point 3, max 15 words>"}`,
      '',
      '<!DOCTYPE html>',
      '<html>... (full upgrade proposal HTML below)',
      '',
      'HTML offer document sections (in order):',
      '  1. Header — client name, "Upgrade Proposal", current tier → next tier arrow, date',
      '  2. What You Have Achieved — 3 bullet points anchored to actual performance data',
      '  3. What the Next Level Unlocks — specific new channels/capabilities with impact statements',
      '  4. Side-by-Side Comparison — table: current tier vs next tier (channels, reporting, support)',
      '  5. Investment — monthly fee, commitment period, total investment, expected ROI uplift',
      '  6. Three Reasons to Upgrade Now — data-backed, specific to this client',
      '  7. Next Steps — two sentences: conversation prompt and call to action',
      '',
      'HTML style (inline styles only):',
      '  - max-width 740px, margin auto, font-family Arial/sans-serif, color #111827, background #fff',
      '  - Header: background #0F1B2D, white text, padding 28px 36px',
      '    Tier arrow badge: current tier → next tier, white pills with blue (#2563EB) arrow',
      '  - Section <h2>: color #0F1B2D, border-left 4px solid #2563EB, padding-left 12px, margin-top 28px',
      '  - Achievement bullets: ✓ prefix, green (#16a34a)',
      '  - Comparison table: width 100%, current tier column in #f8fafc, next tier column in #eff6ff (highlighted)',
      '  - Investment box: border 2px solid #2563EB, border-radius 8px, padding 24px, text-align center',
      '  - CTA section: background #0F1B2D, white text, padding 24px, border-radius 8px',
      '  - Footer: #f8fafc, 12px text, "Prepared by AA Operator · Attract Acquisition"',
    ].join('\n'),
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  // Extract PROPOSAL_JSON single line
  const jsonLine = raw.match(/^PROPOSAL_JSON:\s*(\{[^\n]+\})/m)
  let nextTier   = path.next_tier
  let monthlyFee = path.monthly_fee
  let commitment = path.commitment
  let tp1        = `${client.name} is achieving strong results on ${path.current_label} — scaling up is logical next step`
  let tp2        = `${path.next_label} adds ${path.key_additions[0].toLowerCase()}`
  let tp3        = `Investment is ${path.monthly_fee}/mo — justified by current ROAS trajectory`

  if (jsonLine) {
    try {
      const parsed = JSON.parse(jsonLine[1])
      nextTier   = String(parsed.next_tier   ?? nextTier)
      monthlyFee = String(parsed.monthly_fee ?? monthlyFee)
      commitment = String(parsed.commitment  ?? commitment)
      if (parsed.tp1) tp1 = String(parsed.tp1)
      if (parsed.tp2) tp2 = String(parsed.tp2)
      if (parsed.tp3) tp3 = String(parsed.tp3)
    } catch {
      console.warn(`[sop-35] PROPOSAL_JSON parse failed for ${client.name} — using defaults`)
    }
  } else {
    console.warn(`[sop-35] No PROPOSAL_JSON found for ${client.name}`)
  }

  const htmlMatch  = raw.match(/<!DOCTYPE html>[\s\S]*/i)
  const reportHtml = htmlMatch
    ? htmlMatch[0]
    : `<!DOCTYPE html><html><body><p>Offer document generation failed for ${client.name}.</p></body></html>`

  return { next_tier: nextTier, monthly_fee: monthlyFee, commitment, tp1, tp2, tp3, report_html: reportHtml }
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

    const now            = new Date().toISOString()
    const thirtyDaysAgo  = new Date(Date.now() - 30 * 86_400_000).toISOString()

    // ── 1. Fetch all active clients ───────────────────────────────────────────
    const { data: rawClients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, name, status, tier, niche, contact_name, created_at')
      .eq('status', 'active')
      .order('name')

    if (clientsErr) throw new Error(`fetch clients: ${clientsErr.message}`)

    const clients = (rawClients ?? []) as ClientRow[]
    console.log(`[sop-35] ${clients.length} active clients`)

    if (clients.length === 0) {
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    SONNET,
        status:         'success',
        duration_ms:    Date.now() - startedAt,
        input_summary:  '0 active clients',
        output_summary: 'No active clients — nothing to score',
      })
      return new Response(
        JSON.stringify({ message: 'No active clients', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Bulk-fetch active sprints indexed by client_name ───────────────────
    const { data: rawSprints, error: sprintsErr } = await supabase
      .from('sprints')
      .select('id, client_name, day_number, leads_generated, leads_target, spend, cpl, cpl_target, roas, roas_target')
      .eq('status', 'active')

    if (sprintsErr) throw new Error(`fetch sprints: ${sprintsErr.message}`)

    const sprints        = (rawSprints ?? []) as SprintRow[]
    const sprintByClient = new Map<string, SprintRow>(
      sprints.map(s => [s.client_name.toLowerCase().trim(), s]),
    )
    const sprintIds = sprints.map(s => s.id)

    // ── 3. Bulk-fetch 30-day sprint logs for health distribution ─────────────
    const logsBySprint = new Map<string, SprintLogRow[]>()

    if (sprintIds.length > 0) {
      const { data: rawLogs, error: logsErr } = await supabase
        .from('sprint_logs')
        .select('sprint_id, logged_at, health_status')
        .in('sprint_id', sprintIds)
        .gte('logged_at', thirtyDaysAgo)

      if (logsErr) throw new Error(`fetch sprint_logs: ${logsErr.message}`)

      for (const log of (rawLogs ?? []) as SprintLogRow[]) {
        const arr = logsBySprint.get(log.sprint_id) ?? []
        arr.push(log)
        logsBySprint.set(log.sprint_id, arr)
      }
    }

    // ── 4. Bulk-fetch unresolved alerts per client ────────────────────────────
    const { data: rawAlerts, error: alertsErr } = await supabase
      .from('ai_alerts')
      .select('client_name')
      .eq('resolved', false)
      .not('client_name', 'is', null)

    if (alertsErr) throw new Error(`fetch ai_alerts: ${alertsErr.message}`)

    const alertCountByClient = new Map<string, number>()
    for (const a of rawAlerts ?? []) {
      const key = (a.client_name as string).toLowerCase().trim()
      alertCountByClient.set(key, (alertCountByClient.get(key) ?? 0) + 1)
    }

    // ── 5. Bulk-fetch clients that already have an open upsell alert ──────────
    // Prevents re-alerting on the same client every weekly run.
    const { data: existingUpsellAlerts, error: upsellAlertsErr } = await supabase
      .from('ai_alerts')
      .select('client_name')
      .eq('category', 'Upsell Opportunity')
      .eq('resolved', false)

    if (upsellAlertsErr) throw new Error(`fetch existing upsell alerts: ${upsellAlertsErr.message}`)

    const clientsWithOpenUpsell = new Set(
      (existingUpsellAlerts ?? []).map(a => (a.client_name as string).toLowerCase().trim()),
    )

    // ── 6. Score every client and process qualifying ones ─────────────────────
    let scoresComputed      = 0
    let proposalsGenerated  = 0
    let alertsCreated       = 0
    let approvalItemsCreated = 0
    let skippedDuplicate    = 0
    let skippedNoPath       = 0
    const qualifyingClients: string[] = []
    const errors: string[]            = []
    const scoreLog: Array<{ name: string; score: number; tier: string | null; outcome: string }> = []

    for (const client of clients) {
      try {
        const clientKey   = client.name.toLowerCase().trim()
        const sprint      = sprintByClient.get(clientKey) ?? null
        const recentLogs  = sprint ? (logsBySprint.get(sprint.id) ?? []) : []
        const alertCount  = alertCountByClient.get(clientKey) ?? 0

        // Compute deterministic upsell readiness score
        const score = scoreClient(client, sprint, recentLogs, alertCount)
        scoresComputed++

        console.log(
          `[sop-35] ${client.name} — score ${score.total}/10 (tier: ${client.tier ?? 'none'}) — ${score.rationale}`,
        )

        // Persist score back to clients table
        await supabase
          .from('clients')
          .update({ last_upsell_score: score.total, last_upsell_check_at: now })
          .eq('id', client.id)

        const upsellPath = client.tier ? UPSELL_PATHS[client.tier] ?? null : null

        if (score.total < UPSELL_THRESHOLD) {
          scoreLog.push({ name: client.name, score: score.total, tier: client.tier ?? null, outcome: 'below_threshold' })
          continue
        }

        if (!upsellPath) {
          // Already at top tier or unknown tier — no path forward
          skippedNoPath++
          scoreLog.push({ name: client.name, score: score.total, tier: client.tier ?? null, outcome: 'no_upsell_path' })
          console.log(`[sop-35] ${client.name} qualifies (${score.total}/10) but has no upsell path — skipping`)
          continue
        }

        if (clientsWithOpenUpsell.has(clientKey)) {
          skippedDuplicate++
          scoreLog.push({ name: client.name, score: score.total, tier: client.tier ?? null, outcome: 'alert_already_open' })
          console.log(`[sop-35] ${client.name} qualifies (${score.total}/10) but already has open upsell alert — skipping`)
          continue
        }

        qualifyingClients.push(client.name)
        scoreLog.push({ name: client.name, score: score.total, tier: client.tier ?? null, outcome: 'generating_proposal' })

        // ── 6a. Generate personalised offer document via Claude ───────────────
        const proposal = await generateUpsellProposal(client, sprint, upsellPath, score)
        proposalsGenerated++

        const contactName  = client.contact_name ?? client.name
        const talkingPoints = [proposal.tp1, proposal.tp2, proposal.tp3]
          .map((tp, i) => `${i + 1}. ${tp}`)
          .join(' ')

        // ── 6b. High-priority ai_alert with upsell path and talking points ────
        const { error: alertErr } = await supabase.from('ai_alerts').insert({
          severity:         'info',
          sop_id:           SOP_ID,
          category:         'Upsell Opportunity',
          message: [
            `${client.name} upsell-ready — score ${score.total}/10.`,
            `Recommended upgrade: ${upsellPath.current_label} → ${upsellPath.next_label}`,
            `(${upsellPath.monthly_fee}/mo, ${upsellPath.commitment}).`,
          ].join(' '),
          suggested_action: [
            `Book upgrade conversation with ${contactName}.`,
            `Talking points: ${talkingPoints}`,
          ].join(' '),
          client_name: client.name,
          resolved:    false,
        })

        if (alertErr) {
          console.error(`[sop-35] alert insert failed for ${client.name}: ${alertErr.message}`)
          errors.push(`alert ${client.name}: ${alertErr.message}`)
        } else {
          alertsCreated++
          console.log(`[sop-35] upsell alert created for ${client.name}`)
        }

        // ── 6c. High-priority approval_queue with offer document ──────────────
        const { data: approvalRow, error: approvalErr } = await supabase
          .from('approval_queue')
          .insert({
            sop_id:       SOP_ID,
            sop_name:     SOP_NAME,
            status:       'pending',
            priority:     'high',
            content_type: 'offer_document',
            content_id:   crypto.randomUUID(),
            content: {
              title: `Upsell Proposal — ${client.name} — ${upsellPath.current_label} → ${upsellPath.next_label}`,
              body: [
                `Personalised upgrade proposal for ${client.name}.`,
                `Upsell readiness score: ${score.total}/10.`,
                `Proposed upgrade: ${upsellPath.next_label} at ${upsellPath.monthly_fee}/mo (${upsellPath.commitment}).`,
                `Review, personalise if needed, and send to ${contactName}.`,
              ].join(' '),
              html_report: proposal.report_html,
              metadata: {
                client_id:       client.id,
                client_name:     client.name,
                current_tier:    client.tier,
                next_tier:       proposal.next_tier,
                monthly_fee:     proposal.monthly_fee,
                commitment:      proposal.commitment,
                upsell_score:    score.total,
                score_breakdown: {
                  sprint_completion: score.sprint_completion,
                  cpl_performance:   score.cpl_performance,
                  satisfaction:      score.satisfaction,
                  client_tenure:     score.client_tenure,
                  tier_headroom:     score.tier_headroom,
                },
                talking_points:  [proposal.tp1, proposal.tp2, proposal.tp3],
                rationale:       score.rationale,
              },
            },
          })
          .select('id')
          .single()

        if (approvalErr) {
          console.error(`[sop-35] approval_queue insert failed for ${client.name}: ${approvalErr.message}`)
          errors.push(`approval ${client.name}: ${approvalErr.message}`)
        } else {
          approvalItemsCreated++
          console.log(`[sop-35] offer document queued for ${client.name}: ${approvalRow?.id}`)
        }
      } catch (clientErr) {
        const msg = clientErr instanceof Error ? clientErr.message : String(clientErr)
        console.error(`[sop-35] error processing ${client.name}: ${msg}`)
        errors.push(`${client.name}: ${msg}`)
      }
    }

    // ── 7. Audit log ──────────────────────────────────────────────────────────
    const qualifyNote = qualifyingClients.length > 0
      ? `, ${qualifyingClients.length} qualifying (${qualifyingClients.join(', ')})`
      : ', none qualifying'

    const skipNotes: string[] = []
    if (skippedDuplicate > 0) skipNotes.push(`${skippedDuplicate} duplicate-skipped`)
    if (skippedNoPath    > 0) skipNotes.push(`${skippedNoPath} no-path-skipped`)

    const outputSummary = [
      `${scoresComputed} clients scored`,
      qualifyNote,
      `${alertsCreated} upsell alerts created`,
      `${approvalItemsCreated} offer documents queued`,
      ...(skipNotes.length > 0 ? [skipNotes.join(', ')] : []),
      ...(errors.length > 0 ? [`${errors.length} errors: ${errors.slice(0, 3).join('; ')}`] : []),
    ].join(', ')

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    SONNET,
      status:         errors.length > 0 && proposalsGenerated === 0 && scoresComputed === 0 ? 'failure' : 'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${clients.length} active clients, ${sprints.length} active sprints`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({
        clients_scored:          scoresComputed,
        qualifying_clients:      qualifyingClients,
        proposals_generated:     proposalsGenerated,
        alerts_created:          alertsCreated,
        approval_items_created:  approvalItemsCreated,
        skipped_duplicate_alert: skippedDuplicate,
        skipped_no_upsell_path:  skippedNoPath,
        score_log:               scoreLog,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-35] fatal: ${message}`)

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
        input_summary:  'weekly upsell detection run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
