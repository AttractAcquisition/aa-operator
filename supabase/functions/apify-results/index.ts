import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const TEST_PROSPECTS = [
  {
    business_name: 'Cape Town Plumbing Pros',
    vertical: 'Plumbing',
    city: 'Cape Town',
    suburb: 'Observatory',
    address: '14 Lower Main Rd, Observatory, Cape Town, 7925',
    phone: '+27721234567',
    whatsapp: '+27721234567',
    website: 'https://ctplumbingpros.co.za',
    google_rating: 4.8,
    google_review_count: 112,
    status: 'new',
    data_source: 'apify_test',
    apify_run_id: 'test',
    last_scraped_at: new Date().toISOString(),
  },
  {
    business_name: 'Atlantic Plumbing & Gas',
    vertical: 'Plumbing',
    city: 'Cape Town',
    suburb: 'Sea Point',
    address: '3 Regent Rd, Sea Point, Cape Town, 8005',
    phone: '+27839876543',
    whatsapp: '+27839876543',
    website: '',
    google_rating: 4.5,
    google_review_count: 67,
    status: 'new',
    data_source: 'apify_test',
    apify_run_id: 'test',
    last_scraped_at: new Date().toISOString(),
  },
  {
    business_name: 'Southern Suburbs Plumbers',
    vertical: 'Plumbing',
    city: 'Cape Town',
    suburb: 'Claremont',
    address: '22 Protea Rd, Claremont, Cape Town, 7708',
    phone: '+27611112233',
    whatsapp: '+27611112233',
    website: 'https://ssplumbers.co.za',
    google_rating: 4.3,
    google_review_count: 29,
    status: 'new',
    data_source: 'apify_test',
    apify_run_id: 'test',
    last_scraped_at: new Date().toISOString(),
  },
]

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
    const body = await req.json()
    const { run_id, test = false } = body

    console.log('apify-results called | run_id:', run_id, '| test:', test)

    if (!run_id) {
      return new Response(
        JSON.stringify({ error: 'run_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Test mode — return mock plumbing businesses without consuming Apify credits
    if (test === true || run_id === 'test') {
      return new Response(
        JSON.stringify({ status: 'SUCCEEDED', prospects: TEST_PROSPECTS, count: TEST_PROSPECTS.length }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const apifyToken = Deno.env.get('APIFY_API_TOKEN')
    console.log('APIFY_API_TOKEN present:', !!apifyToken)

    // Stub mode — token absent or stub run_id
    if (!apifyToken || apifyToken.trim() === '' || run_id === 'stub') {
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

    console.log('Apify run status:', runStatus)

    if (runStatus !== 'SUCCEEDED') {
      return new Response(
        JSON.stringify({ status: runStatus, prospects: [], count: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Fetch dataset items via actor-runs endpoint — avoids null defaultDatasetId issue
    const itemsRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${run_id}/dataset/items?token=${apifyToken}&clean=true&format=json`,
    )
    if (!itemsRes.ok) {
      const errText = await itemsRes.text()
      throw new Error(`Apify dataset error ${itemsRes.status}: ${errText}`)
    }

    const raw = await itemsRes.json()

    if (!Array.isArray(raw)) {
      throw new Error(`Apify dataset returned unexpected shape: ${JSON.stringify(raw).slice(0, 200)}`)
    }

    const prospects = raw.map((item: any) => ({
      business_name:       item.title ?? item.name ?? '',
      vertical:            item.categoryName ?? '',
      city:                item.city ?? '',
      suburb:              item.neighborhood ?? item.district ?? '',
      address:             item.address ?? '',
      phone:               item.phoneUnformatted ?? item.phone ?? '',
      whatsapp:            item.phoneUnformatted ?? item.phone ?? '',
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
    console.error('apify-results error:', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
