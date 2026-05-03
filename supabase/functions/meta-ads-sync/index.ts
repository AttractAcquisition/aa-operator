import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const GRAPH_BASE = 'https://graph.facebook.com'

// ─── Meta API types ───────────────────────────────────────────────────────────

interface ActionValue {
  action_type: string
  value: string
}

interface MetaInsight {
  campaign_id: string
  campaign_name: string
  spend: string
  impressions: string
  clicks: string
  actions?: ActionValue[]
  cost_per_action_type?: ActionValue[]
  purchase_roas?: ActionValue[]
  date_start: string
  date_stop: string
}

interface MetaApiResponse {
  data: MetaInsight[]
  paging?: {
    cursors?: { before: string; after: string }
    next?: string
  }
  error?: { message: string; type: string; code: number }
}

interface SprintRow {
  id: string
  meta_campaign_id: string
  client_name: string
}

// ─── Pagination helper ────────────────────────────────────────────────────────

async function fetchInsightsPage(url: string): Promise<MetaApiResponse> {
  const res = await fetch(url)
  const body: MetaApiResponse = await res.json()

  if (!res.ok || body.error) {
    throw new Error(
      body.error?.message ?? `Meta API returned HTTP ${res.status}`,
    )
  }
  return body
}

async function fetchAllInsights(
  adAccountId: string,
  accessToken: string,
  apiVersion: string,
  campaignIds: string[],
  datePreset: string,
): Promise<MetaInsight[]> {
  const params = new URLSearchParams({
    fields: [
      'campaign_id',
      'campaign_name',
      'spend',
      'impressions',
      'clicks',
      'actions',
      'cost_per_action_type',
      'purchase_roas',
      'date_start',
      'date_stop',
    ].join(','),
    level: 'campaign',
    date_preset: datePreset,
    filtering: JSON.stringify([
      { field: 'campaign.id', operator: 'IN', value: campaignIds },
    ]),
    access_token: accessToken,
    limit: '100',
  })

  let nextUrl: string | undefined =
    `${GRAPH_BASE}/${apiVersion}/act_${adAccountId}/insights?${params}`

  const all: MetaInsight[] = []
  let pageCount = 0

  while (nextUrl) {
    const page = await fetchInsightsPage(nextUrl)
    all.push(...page.data)
    nextUrl = page.paging?.next
    pageCount++
    console.log(`[meta-ads-sync] page ${pageCount}: ${page.data.length} rows (total so far: ${all.length})`)
  }

  return all
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startedAt = Date.now()

  const META_ACCESS_TOKEN     = Deno.env.get('META_ACCESS_TOKEN') ?? ''
  const META_AD_ACCOUNT_ID    = Deno.env.get('META_AD_ACCOUNT_ID') ?? ''
  const META_GRAPH_API_VERSION = Deno.env.get('META_GRAPH_API_VERSION') ?? 'v21.0'

  if (!META_ACCESS_TOKEN || !META_AD_ACCOUNT_ID) {
    return new Response(
      JSON.stringify({ error: 'META_ACCESS_TOKEN and META_AD_ACCOUNT_ID env vars are required' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Accept optional date_preset override from request body
    let datePreset = 'last_30d'
    try {
      const body = await req.json()
      if (typeof body?.date_preset === 'string') datePreset = body.date_preset
    } catch { /* no body — use default */ }

    // ── 1. Load active sprints that have a linked Meta campaign ───────────────
    const { data: rawSprints, error: sprintsError } = await supabase
      .from('sprints')
      .select('id, meta_campaign_id, client_name')
      .eq('status', 'active')
      .not('meta_campaign_id', 'is', null)

    if (sprintsError) throw new Error(`fetch sprints: ${sprintsError.message}`)

    const sprints = (rawSprints ?? []) as SprintRow[]

    if (sprints.length === 0) {
      console.log('[meta-ads-sync] no active sprints with meta_campaign_id — nothing to sync')
      return new Response(
        JSON.stringify({ message: 'No active sprints with meta_campaign_id', synced: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const campaignIds = sprints.map(s => s.meta_campaign_id)
    console.log(
      `[meta-ads-sync] ${sprints.length} active sprints — campaigns: ${campaignIds.join(', ')}`,
    )

    // ── 2. Fetch insights from Meta Marketing API (paginated) ─────────────────
    const insights = await fetchAllInsights(
      META_AD_ACCOUNT_ID,
      META_ACCESS_TOKEN,
      META_GRAPH_API_VERSION,
      campaignIds,
      datePreset,
    )

    console.log(`[meta-ads-sync] ${insights.length} insight rows received from Meta`)

    // ── 3. Index insights by campaign_id for O(1) lookup ──────────────────────
    const insightMap = new Map<string, MetaInsight>()
    for (const insight of insights) {
      insightMap.set(insight.campaign_id, insight)
    }

    // ── 4. Update each sprint row ─────────────────────────────────────────────
    const now = new Date().toISOString()
    let updatedCount = 0
    let skippedCount = 0
    const errors: string[] = []

    for (const sprint of sprints) {
      const insight = insightMap.get(sprint.meta_campaign_id)

      if (!insight) {
        console.warn(
          `[meta-ads-sync] no insight data for campaign ${sprint.meta_campaign_id} ` +
          `(sprint ${sprint.id} — ${sprint.client_name})`,
        )
        await supabase
          .from('sprints')
          .update({ meta_sync_status: 'no_data', last_meta_sync_at: now })
          .eq('id', sprint.id)
        skippedCount++
        continue
      }

      const spend       = parseFloat(insight.spend ?? '0')
      const impressions = parseInt(insight.impressions ?? '0', 10)
      const clicks      = parseInt(insight.clicks ?? '0', 10)

      // CPL: cost_per_action_type where action_type === 'lead'
      const cplEntry = insight.cost_per_action_type?.find(a => a.action_type === 'lead')
      const cpl = cplEntry ? parseFloat(cplEntry.value) : 0

      // ROAS: purchase_roas, prefer 'omni_purchase', fall back to first entry
      const roasEntry =
        insight.purchase_roas?.find(a => a.action_type === 'omni_purchase') ??
        insight.purchase_roas?.[0]
      const roas = roasEntry ? parseFloat(roasEntry.value) : 0

      const { error: updateError } = await supabase
        .from('sprints')
        .update({
          spend,
          cpl,
          roas,
          impressions,
          clicks,
          last_meta_sync_at: now,
          meta_sync_status: 'ok',
        })
        .eq('id', sprint.id)

      if (updateError) {
        const msg = `sprint ${sprint.id} (${sprint.client_name}): ${updateError.message}`
        console.error(`[meta-ads-sync] update error — ${msg}`)
        errors.push(msg)
        await supabase
          .from('sprints')
          .update({ meta_sync_status: 'error', last_meta_sync_at: now })
          .eq('id', sprint.id)
      } else {
        console.log(
          `[meta-ads-sync] ✓ ${sprint.client_name} — ` +
          `spend=${spend} cpl=${cpl} roas=${roas} impressions=${impressions} clicks=${clicks}`,
        )
        updatedCount++
      }
    }

    // ── 5. Audit log ──────────────────────────────────────────────────────────
    const outputSummary =
      `${updatedCount} sprints updated, ${skippedCount} skipped (no Meta data)` +
      (errors.length > 0 ? `, ${errors.length} update errors` : '')

    await supabase.from('ai_task_log').insert({
      sop_id: 'meta-ads-sync',
      sop_name: 'Meta Ads Sync',
      tool_called: 'meta_marketing_api',
      status: errors.length > 0 ? 'failure' : 'success',
      duration_ms: Date.now() - startedAt,
      input_summary:
        `${sprints.length} active sprints, ${campaignIds.length} campaign IDs, date_preset=${datePreset}`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({ synced: updatedCount, skipped: skippedCount, errors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[meta-ads-sync] fatal: ${message}`)

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await supabase.from('ai_task_log').insert({
        sop_id: 'meta-ads-sync',
        sop_name: 'Meta Ads Sync',
        tool_called: 'meta_marketing_api',
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: 'meta ads sync run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
