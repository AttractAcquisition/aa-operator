import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Apify actor for Google Maps scraping
const APIFY_ACTOR_ID = 'compass~crawler-google-places'

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
    } = body

    if (!search_term || !location_query) {
      return new Response(
        JSON.stringify({ error: 'search_term and location_query are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const apifyToken = Deno.env.get('APIFY_API_TOKEN')

    // Stub mode when Apify is not configured
    if (!apifyToken) {
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
      language,
      maxCrawledPlacesPerSearch: max_results,
      skipClosedPlaces: skip_closed_places,
      includeWebResults: include_web_results,
      scrapeContacts: scrape_contacts,
      scrapePlaceDetailPage: scrape_place_detail_page,
      scrapeReviewsPersonalData: scrape_reviews_personal_data,
      ...social_media,
    }

    const apifyRes = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs?token=${apifyToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    )

    if (!apifyRes.ok) {
      const errText = await apifyRes.text()
      throw new Error(`Apify API error ${apifyRes.status}: ${errText}`)
    }

    const apifyData = await apifyRes.json()
    const runId: string = apifyData?.data?.id

    if (!runId) throw new Error('Apify did not return a run ID')

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
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
