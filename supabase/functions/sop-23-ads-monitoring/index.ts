import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const GRAPH_BASE = 'https://graph.facebook.com'
const SOP_ID     = '23'
const SOP_NAME   = 'SOP 23 — Proof Sprint Ads Monitoring'

// Kill: CPL > 140% of target for 3+ consecutive days → auto-pause
const KILL_MULTIPLIER  = 1.4
const KILL_CONSECUTIVE = 3
// Scale: CPL < 80% of target (20% under) on most recent day → flag
const SCALE_MULTIPLIER = 0.8

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActionValue { action_type: string; value: string }

interface AdSetInsightRow {
  adset_id: string
  adset_name: string
  campaign_id: string
  spend: string
  impressions: string
  clicks: string
  cost_per_action_type?: ActionValue[]
  effective_status?: string
  date_start: string
  date_stop: string
}

interface MetaPage {
  data: AdSetInsightRow[]
  paging?: { next?: string }
  error?: { message: string; code: number }
}

interface SprintRow {
  id: string
  client_name: string
  meta_campaign_id: string
  cpl_target: number
}

interface DayData {
  date: string
  cpl: number
  spend: number
  impressions: number
  clicks: number
  effective_status: string
}

interface AdSetEntry {
  adset_name: string
  campaign_id: string
  days: DayData[]  // sorted newest-first after grouping
}

// ─── Meta API helpers ─────────────────────────────────────────────────────────

async function fetchAdSetInsights(
  adAccountId: string,
  token: string,
  version: string,
  campaignIds: string[],
): Promise<AdSetInsightRow[]> {
  const params = new URLSearchParams({
    fields: [
      'adset_id', 'adset_name', 'campaign_id',
      'spend', 'impressions', 'clicks',
      'cost_per_action_type', 'effective_status',
      'date_start', 'date_stop',
    ].join(','),
    level:          'adset',
    date_preset:    'last_7d',
    time_increment: '1',
    filtering:      JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]),
    access_token:   token,
    limit:          '200',
  })

  let nextUrl: string | undefined =
    `${GRAPH_BASE}/${version}/act_${adAccountId}/insights?${params}`
  const all: AdSetInsightRow[] = []
  let page = 0

  while (nextUrl) {
    const res  = await fetch(nextUrl)
    const body = await res.json() as MetaPage
    if (!res.ok || body.error) throw new Error(body.error?.message ?? `Meta API HTTP ${res.status}`)
    all.push(...body.data)
    nextUrl = body.paging?.next
    console.log(`[sop-23] page ${++page}: ${body.data.length} rows (total: ${all.length})`)
  }

  return all
}

async function pauseAdSet(adsetId: string, token: string, version: string): Promise<void> {
  const res  = await fetch(`${GRAPH_BASE}/${version}/${adsetId}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ status: 'PAUSED', access_token: token }),
  })
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message ?? `HTTP ${res.status}`)
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const startedAt = Date.now()

  const META_ACCESS_TOKEN      = Deno.env.get('META_ACCESS_TOKEN') ?? ''
  const META_AD_ACCOUNT_ID     = Deno.env.get('META_AD_ACCOUNT_ID') ?? ''
  const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION') ?? 'v21.0'

  if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) {
    return new Response(
      JSON.stringify({ error: 'META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are required' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ── 1. Load active sprints with CPL targets ───────────────────────────────
    const { data: rawSprints, error: sprintsErr } = await supabase
      .from('sprints')
      .select('id, client_name, meta_campaign_id, cpl_target')
      .eq('status', 'active')
      .not('meta_campaign_id', 'is', null)

    if (sprintsErr) throw new Error(`fetch sprints: ${sprintsErr.message}`)

    const sprints          = (rawSprints ?? []) as SprintRow[]
    const campaignToSprint = new Map<string, SprintRow>(sprints.map(s => [s.meta_campaign_id, s]))
    const campaignIds      = sprints.map(s => s.meta_campaign_id)

    if (sprints.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No active sprints with meta_campaign_id', evaluated: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }
    console.log(`[sop-23] ${sprints.length} active sprints, fetching 7-day ad set breakdown`)

    // ── 2. Fetch 7 days of daily ad set insights (paginated) ──────────────────
    const rawInsights = await fetchAdSetInsights(
      META_AD_ACCOUNT_ID, META_ACCESS_TOKEN, META_GRAPH_API_VERSION, campaignIds,
    )
    console.log(`[sop-23] ${rawInsights.length} ad set-day rows received from Meta`)

    // ── 3. Group by adset_id, sort newest-first ───────────────────────────────
    const adSetMap = new Map<string, AdSetEntry>()

    for (const row of rawInsights) {
      const cplEntry = row.cost_per_action_type?.find(a => a.action_type === 'lead')
      const cpl      = cplEntry ? parseFloat(cplEntry.value) : 0

      if (!adSetMap.has(row.adset_id)) {
        adSetMap.set(row.adset_id, {
          adset_name:  row.adset_name,
          campaign_id: row.campaign_id,
          days:        [],
        })
      }
      adSetMap.get(row.adset_id)!.days.push({
        date:             row.date_start,
        cpl,
        spend:            parseFloat(row.spend ?? '0'),
        impressions:      parseInt(row.impressions ?? '0', 10),
        clicks:           parseInt(row.clicks ?? '0', 10),
        effective_status: row.effective_status ?? 'UNKNOWN',
      })
    }

    for (const entry of adSetMap.values()) {
      entry.days.sort((a, b) => b.date.localeCompare(a.date))
    }

    // ── 4. Upsert to ad_set_performance_logs for audit trail (non-fatal) ──────
    const syncedAt  = new Date().toISOString()
    const logRows: Record<string, unknown>[] = []

    for (const [adsetId, entry] of adSetMap) {
      const sprint = campaignToSprint.get(entry.campaign_id)
      for (const day of entry.days) {
        logRows.push({
          adset_id:    adsetId,
          adset_name:  entry.adset_name,
          campaign_id: entry.campaign_id,
          sprint_id:   sprint?.id ?? null,
          client_name: sprint?.client_name ?? null,
          date:        day.date,
          spend:       day.spend,
          impressions: day.impressions,
          clicks:      day.clicks,
          cpl:         day.cpl,
          cpl_target:  sprint?.cpl_target ?? null,
          synced_at:   syncedAt,
        })
      }
    }

    if (logRows.length > 0) {
      const { error: upsertErr } = await supabase
        .from('ad_set_performance_logs')
        .upsert(logRows, { onConflict: 'adset_id,date' })
      if (upsertErr) {
        console.warn(`[sop-23] ad_set_performance_logs upsert warning: ${upsertErr.message}`)
      }
    }

    // ── 5. Kill / scale logic ─────────────────────────────────────────────────
    const now          = new Date().toISOString()
    let pausedCount    = 0
    let scaleCount     = 0
    let alertsCreated  = 0
    const errors: string[] = []

    for (const [adsetId, entry] of adSetMap) {
      const sprint = campaignToSprint.get(entry.campaign_id)
      if (!sprint || sprint.cpl_target <= 0) continue

      const { cpl_target, client_name, id: sprintId } = sprint

      // Only consider days where spend occurred and CPL was recorded
      const activeDays   = entry.days.filter(d => d.cpl > 0)
      if (activeDays.length === 0) continue

      const latestStatus = entry.days[0]?.effective_status ?? 'UNKNOWN'

      // ── Kill: CPL > 140% of target for 3+ consecutive recent active days ───
      const recentActive   = activeDays.slice(0, KILL_CONSECUTIVE)
      const isKillCandidate =
        latestStatus !== 'PAUSED' &&
        recentActive.length >= KILL_CONSECUTIVE &&
        recentActive.every(d => d.cpl > cpl_target * KILL_MULTIPLIER)

      if (isKillCandidate) {
        const avgCpl  = recentActive.reduce((s, d) => s + d.cpl, 0) / recentActive.length
        const overPct = ((avgCpl - cpl_target) / cpl_target) * 100

        console.log(
          `[sop-23] KILL "${entry.adset_name}" (${adsetId}) — ` +
          `avg CPL £${avgCpl.toFixed(2)} (+${overPct.toFixed(1)}%) for ${KILL_CONSECUTIVE} days`,
        )

        // Pause the ad set via Meta API
        try {
          await pauseAdSet(adsetId, META_ACCESS_TOKEN, META_GRAPH_API_VERSION)
          pausedCount++
          console.log(`[sop-23] paused ${adsetId}`)
        } catch (pauseErr) {
          const msg = pauseErr instanceof Error ? pauseErr.message : String(pauseErr)
          console.error(`[sop-23] pause failed for ${adsetId}: ${msg}`)
          errors.push(`pause ${adsetId}: ${msg}`)
          // Continue — still create the alert so the team knows about the failure
        }

        // Critical alert documenting the kill
        const { error: killAlertErr } = await supabase.from('ai_alerts').insert({
          severity:         'critical',
          sop_id:           SOP_ID,
          category:         'Ads Kill/Scale',
          message: [
            `Ad set "${entry.adset_name}" auto-paused —`,
            `CPL £${avgCpl.toFixed(2)} was ${overPct.toFixed(1)}% over target`,
            `(£${cpl_target}) for ${KILL_CONSECUTIVE} consecutive days`,
          ].join(' '),
          suggested_action: [
            `Rebuild or replace creative for "${entry.adset_name}" on ${client_name}`,
            `before re-enabling. Check targeting and audience overlap.`,
          ].join(' '),
          client_name,
          resolved: false,
        })
        if (killAlertErr) {
          errors.push(`kill alert ${adsetId}: ${killAlertErr.message}`)
        } else {
          alertsCreated++
        }

        // Approval queue item so the action is visible and reversible
        const { error: queueErr } = await supabase.from('approval_queue').insert({
          sop_id:       SOP_ID,
          sop_name:     SOP_NAME,
          status:       'pending',
          priority:     'high',
          content_type: 'client_report',
          content_id:   crypto.randomUUID(),
          content: {
            title: `Auto-paused: "${entry.adset_name}" (${client_name})`,
            body: [
              `Ad set "${entry.adset_name}" was automatically paused by SOP 23.`,
              ``,
              `Reason: CPL £${avgCpl.toFixed(2)} exceeded ${((KILL_MULTIPLIER - 1) * 100).toFixed(0)}% over target`,
              `(£${cpl_target}) for ${KILL_CONSECUTIVE} consecutive days.`,
              ``,
              `CPL over the last ${KILL_CONSECUTIVE} days: ${recentActive.map(d => `£${d.cpl.toFixed(2)}`).join(', ')}.`,
              ``,
              `Review performance and replace creative before re-enabling this ad set.`,
            ].join('\n'),
            metadata: {
              adset_id:    adsetId,
              adset_name:  entry.adset_name,
              campaign_id: entry.campaign_id,
              sprint_id:   sprintId,
              avg_cpl:     avgCpl.toFixed(2),
              cpl_target:  String(cpl_target),
              over_pct:    overPct.toFixed(1),
              action:      'auto_paused',
              days_over:   String(KILL_CONSECUTIVE),
            },
          },
        })
        if (queueErr) {
          console.warn(`[sop-23] approval_queue insert warning for ${adsetId}: ${queueErr.message}`)
        }
      }

      // ── Scale: most recent active day CPL < 80% of target ─────────────────
      const latestCpl = activeDays[0].cpl
      if (latestCpl < cpl_target * SCALE_MULTIPLIER) {
        const underPct = ((cpl_target - latestCpl) / cpl_target) * 100
        console.log(
          `[sop-23] SCALE "${entry.adset_name}" — ` +
          `CPL £${latestCpl.toFixed(2)} (${underPct.toFixed(1)}% under target)`,
        )

        const { error: scaleAlertErr } = await supabase.from('ai_alerts').insert({
          severity:         'info',
          sop_id:           SOP_ID,
          category:         'Ads Kill/Scale',
          message: [
            `Scale opportunity: "${entry.adset_name}"`,
            `CPL £${latestCpl.toFixed(2)} is ${underPct.toFixed(1)}% under target (£${cpl_target})`,
          ].join(' — '),
          suggested_action: [
            `Increase daily budget for "${entry.adset_name}" on ${client_name}`,
            `— strong CPL performance with room to scale`,
          ].join(' '),
          client_name,
          resolved: false,
        })
        if (scaleAlertErr) {
          errors.push(`scale alert ${adsetId}: ${scaleAlertErr.message}`)
        } else {
          scaleCount++
          alertsCreated++
        }
      }
    }

    // ── 6. Audit log ──────────────────────────────────────────────────────────
    const adSetCount    = adSetMap.size
    const outputSummary =
      `${adSetCount} ad sets evaluated — ${pausedCount} paused (kill), ` +
      `${scaleCount} scale opportunities flagged, ${alertsCreated} alerts created` +
      (errors.length > 0 ? `, ${errors.length} errors` : '')

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    'meta_marketing_api',
      status:         errors.length > 0 && alertsCreated === 0 ? 'failure' : 'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${sprints.length} sprints, ${adSetCount} ad sets, 7-day daily breakdown`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({
        evaluated:      adSetCount,
        paused:         pausedCount,
        scale_flags:    scaleCount,
        alerts_created: alertsCreated,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-23] fatal: ${message}`)

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    'meta_marketing_api',
        status:         'failure',
        duration_ms:    Date.now() - startedAt,
        input_summary:  'ads monitoring run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
