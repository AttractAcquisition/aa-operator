import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const APIFY_ACTOR_ID = 'compass~crawler-google-places'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const {
      search_term,
      location_query,
      max_results = 30,
      language = 'en',
      skip_closed_places = true,
      include_web_results = false,
      scrape_contacts = false,
      scrape_place_detail_page = false,
      scrape_reviews_personal_data = false,
      social_media = {},
      test = false,
    } = body

    const apifyToken = Deno.env.get('APIFY_API_TOKEN')
    console.log('APIFY_API_TOKEN present:', !!apifyToken, '| length:', apifyToken?.length ?? 0)

    if (!search_term || !location_query) {
      return new Response(
        JSON.stringify({ error: 'search_term and location_query are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Test mode — return mock data without consuming Apify credits
    if (test === true) {
      return new Response(
        JSON.stringify({ ok: true, run_id: 'test', status: 'RUNNING', message: 'Test mode — mock run started' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Stub mode — only when token is genuinely absent or blank
    if (!apifyToken || apifyToken.trim() === '') {
      console.log('No APIFY_API_TOKEN configured — returning stub run')
      await supabase.from('ai_task_log').insert({
        sop_id:         'apify-start',
        sop_name:       'Apify Start (stub)',
        status:         'success',
        output_summary: `stub run for "${search_term}" in "${location_query}"`,
      })
      return new Response(
        JSON.stringify({ ok: true, run_id: 'stub', status: 'RUNNING', message: 'Apify not configured — returning stub run' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const input = {
      searchStringsArray: [`${search_term} ${location_query}`],
      locationQuery: location_query,
      countryCode: 'za',
      language,
      maxCrawledPlacesPerSearch: max_results,
      skipClosedPlaces: skip_closed_places,
      includeWebResults: include_web_results,
      scrapeContacts: scrape_contacts,
      scrapePlaceDetailPage: scrape_place_detail_page,
      scrapeReviewsPersonalData: scrape_reviews_personal_data,
      ...social_media,
    }

    console.log('Calling Apify actor:', APIFY_ACTOR_ID, '| input:', JSON.stringify(input))

    let apifyRes: Response
    try {
      apifyRes = await fetch(
        `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?token=${apifyToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      )
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      console.error('Apify fetch network error:', errMsg)
      return new Response(
        JSON.stringify({ error: `Apify network error: ${errMsg}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!apifyRes.ok) {
      const errText = await apifyRes.text()
      console.error('Apify API error:', apifyRes.status, errText)
      return new Response(
        JSON.stringify({ error: `Apify API error ${apifyRes.status}: ${errText}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const apifyData = await apifyRes.json()
    const runId: string = apifyData?.data?.id

    if (!runId) {
      console.error('Apify response missing run ID:', JSON.stringify(apifyData))
      return new Response(
        JSON.stringify({ error: 'Apify did not return a run ID', raw: apifyData }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    console.log('Apify run started:', runId)

    await supabase.from('ai_task_log').insert({
      sop_id:         'apify-start',
      sop_name:       'Apify Start',
      status:         'success',
      output_summary: `run ${runId} started: "${search_term}" in "${location_query}" max:${max_results}`,
    })

    return new Response(
      JSON.stringify({ ok: true, run_id: runId, status: 'RUNNING' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('apify-start unhandled error:', msg)
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
