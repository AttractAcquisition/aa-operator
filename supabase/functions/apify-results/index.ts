import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const APIFY_ACTOR_ID = 'compass~crawler-google-places'

const STUB_PROSPECTS = [
  {
    business_name: 'Cape Town Auto Detailing Co.',
    vertical: 'Auto Detailing',
    city: 'Cape Town',
    suburb: 'Woodstock',
    address: '12 Albert Rd, Woodstock, Cape Town',
    phone: '+27 21 000 0001',
    whatsapp: '+27 21 000 0001',
    website: 'https://example.com',
    google_rating: 4.6,
    google_review_count: 43,
    status: 'new',
    data_source: 'apify_stub',
    apify_run_id: 'stub',
    last_scraped_at: new Date().toISOString(),
  },
  {
    business_name: 'Sparkle Detail Studio',
    vertical: 'Auto Detailing',
    city: 'Cape Town',
    suburb: 'Mowbray',
    address: '88 Main Rd, Mowbray, Cape Town',
    phone: '+27 21 000 0002',
    whatsapp: '+27 21 000 0002',
    website: '',
    google_rating: 4.2,
    google_review_count: 18,
    status: 'new',
    data_source: 'apify_stub',
    apify_run_id: 'stub',
    last_scraped_at: new Date().toISOString(),
  },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { run_id } = await req.json()

    if (!run_id) {
      return new Response(
        JSON.stringify({ error: 'run_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const apifyToken = Deno.env.get('APIFY_API_TOKEN')

    // Stub mode
    if (!apifyToken || run_id === 'stub') {
      return new Response(
        JSON.stringify({ status: 'SUCCEEDED', prospects: STUB_PROSPECTS, count: STUB_PROSPECTS.length }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Check run status
    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${run_id}?token=${apifyToken}`,
    )
    if (!statusRes.ok) {
      const errText = await statusRes.text()
      throw new Error(`Apify status error ${statusRes.status}: ${errText}`)
    }

    const statusData = await statusRes.json()
    const runStatus: string = statusData?.data?.status ?? 'RUNNING'

    if (runStatus !== 'SUCCEEDED') {
      return new Response(
        JSON.stringify({ status: runStatus, prospects: [], count: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Fetch dataset items
    const defaultDatasetId: string = statusData?.data?.defaultDatasetId
    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${apifyToken}&clean=true&format=json`,
    )
    if (!itemsRes.ok) {
      const errText = await itemsRes.text()
      throw new Error(`Apify dataset error ${itemsRes.status}: ${errText}`)
    }

    const items: any[] = await itemsRes.json()

    const prospects = items.map((item) => ({
      business_name:       item.title ?? item.name ?? '',
      vertical:            item.categoryName ?? '',
      city:                item.city ?? '',
      suburb:              item.neighborhood ?? item.district ?? '',
      address:             item.address ?? '',
      phone:               item.phone ?? '',
      whatsapp:            item.phone ?? '',
      website:             item.website ?? '',
      google_rating:       item.totalScore ?? null,
      google_review_count: item.reviewsCount ?? 0,
      status:              'new',
      data_source:         'apify',
      apify_run_id:        run_id,
      last_scraped_at:     new Date().toISOString(),
    }))

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    await supabase.from('ai_task_log').insert({
      sop_id:         'apify-results',
      sop_name:       'Apify Results',
      status:         'success',
      output_summary: `run ${run_id} complete — ${prospects.length} prospects fetched`,
    })

    return new Response(
      JSON.stringify({ status: 'SUCCEEDED', prospects, count: prospects.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
