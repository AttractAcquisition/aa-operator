// Model: claude-haiku-4-5-20251001 — mechanical data normalisation and dedup for prospect scraping.
//
// Accepts POST body with:
//   source_list  — e.g. 'checkatrade', 'yell', 'trustatrader'   (required)
//   niche        — e.g. 'plumbing', 'roofing'                    (optional, falls back to 'general')
//   location     — e.g. 'Manchester', 'Leeds'                    (optional)
//   rows         — ProspectInput[] for manual CSV upload          (optional; used when no external scraper is wired)
//
// Two intake modes:
//   SCRAPER MODE  — env var SCRAPER_API_URL is set → POSTs {source_list,niche,location} to that
//                   service and receives a JSON array of raw prospects back.
//   MANUAL MODE   — no SCRAPER_API_URL → accepts a `rows` array in the request body.
//                   Use this to paste a CSV export from any directory source.
//
// After normalisation and dedup, inserts new rows into `prospects` with status='new'.
// The prospect_new_insert_webhook Postgres trigger then fires sop-03-enrichment for each row.

import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const HAIKU     = 'claude-haiku-4-5-20251001'
const SOP_ID    = '02'
const SOP_NAME  = 'SOP 02 — Prospect Scraper & Batch Run'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProspectInput {
  name?:     string
  company?:  string
  phone?:    string
  website?:  string
  address?:  string
  niche?:    string
  location?: string
  notes?:    string
}

interface NormalisedProspect {
  name:        string
  company:     string
  phone:       string
  niche:       string | null
  location:    string | null
  source_list: string
  status:      'new'
  enrichment_data: { website?: string; address?: string; notes?: string }
}

interface ScraperApiResponse {
  prospects: ProspectInput[]
}

// ─── Phone normalisation ──────────────────────────────────────────────────────
// Converts UK local (07xxx / 01xxx) to E.164 (+44) and strips all non-digits.

function normalisePhone(raw: string | undefined): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('44') && digits.length >= 11) return `+${digits}`
  if (digits.startsWith('0') && digits.length >= 10) return `+44${digits.slice(1)}`
  if (digits.length >= 7) return `+44${digits}`
  return digits
}

// ─── Haiku normalisation call ─────────────────────────────────────────────────
// Cleans company names, fills missing name from company, derives niche from
// context if not provided. Returns cleaned rows.

async function normaliseWithHaiku(
  rows: ProspectInput[],
  defaultNiche: string,
  defaultLocation: string,
): Promise<NormalisedProspect[]> {
  // Truncate to 50 rows per call to keep tokens manageable
  const sample = rows.slice(0, 50)

  const prompt = [
    `You are a data cleaner for a B2B lead generation agency.`,
    `Clean these ${sample.length} raw prospect records. For each row:`,
    `  1. Trim whitespace from all fields.`,
    `  2. If "name" is empty, set it to the contact name part of "company" if obvious, else leave blank.`,
    `  3. If "company" is empty, set it to the raw business name.`,
    `  4. Capitalise company names properly (e.g. "ABC plumbing ltd" → "ABC Plumbing Ltd").`,
    `  5. If "niche" is empty, use: "${defaultNiche}".`,
    `  6. If "location" is empty, use: "${defaultLocation}".`,
    `  7. Do NOT invent fields — only fill blanks from context.`,
    ``,
    `Respond with ONLY a JSON array of cleaned objects, same length as input.`,
    `Each object must have: name, company, niche, location.`,
    ``,
    `Input records:`,
    JSON.stringify(sample),
  ].join('\n')

  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 4096,
    system: [{ type: 'text', text: 'You are a precise data cleaning assistant. Output only valid JSON arrays.', cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/```\s*$/, '')

  return JSON.parse(raw) as NormalisedProspect[]
}

// ─── Main handler ─────────────────────────────────────────────────────────────

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

    // ── 1. Parse request body ─────────────────────────────────────────────────
    const body = await req.json().catch(() => ({})) as {
      source_list?: string
      niche?:       string
      location?:    string
      rows?:        ProspectInput[]
    }

    const sourceList    = (body.source_list ?? '').trim()
    const defaultNiche  = (body.niche    ?? 'general').trim()
    const defaultLocation = (body.location ?? '').trim()

    if (!sourceList) {
      return new Response(
        JSON.stringify({ error: 'source_list is required (e.g. checkatrade, yell, trustatrader)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Intake: scraper API or manual rows ─────────────────────────────────
    const scraperUrl = Deno.env.get('SCRAPER_API_URL')
    let rawRows: ProspectInput[]

    if (scraperUrl) {
      // SCRAPER MODE — call external scraping service
      console.log(`[${SOP_NAME}] Calling scraper API for ${sourceList} / ${defaultNiche} / ${defaultLocation}`)

      const scraperRes = await fetch(scraperUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ source_list: sourceList, niche: defaultNiche, location: defaultLocation }),
      })

      if (!scraperRes.ok) {
        const errText = await scraperRes.text().catch(() => scraperRes.statusText)
        throw new Error(`Scraper API returned ${scraperRes.status}: ${errText}`)
      }

      const scraperData = await scraperRes.json() as ScraperApiResponse
      rawRows = Array.isArray(scraperData) ? scraperData : (scraperData.prospects ?? [])

      console.log(`[${SOP_NAME}] Scraper returned ${rawRows.length} raw rows`)
    } else {
      // MANUAL MODE — use rows from request body
      rawRows = Array.isArray(body.rows) ? body.rows : []

      if (rawRows.length === 0) {
        return new Response(
          JSON.stringify({
            mode:    'manual',
            message: 'No SCRAPER_API_URL configured and no rows supplied in body.',
            hint:    'Set SCRAPER_API_URL in Supabase secrets, or POST with a "rows" array to upload prospects manually.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }

      console.log(`[${SOP_NAME}] Manual upload: ${rawRows.length} rows for ${sourceList}`)
    }

    if (rawRows.length === 0) {
      return new Response(
        JSON.stringify({ mode: scraperUrl ? 'scraper' : 'manual', staged: 0, message: 'No rows to process' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 3. Normalise via Haiku ────────────────────────────────────────────────
    // Process in batches of 50 to stay within token limits
    const normalisedAll: NormalisedProspect[] = []

    for (let i = 0; i < rawRows.length; i += 50) {
      const chunk = rawRows.slice(i, i + 50)

      let cleaned: Array<{ name: string; company: string; niche: string; location: string }>
      try {
        cleaned = await normaliseWithHaiku(chunk, defaultNiche, defaultLocation)
      } catch {
        // Fall back to basic normalisation if Haiku fails
        cleaned = chunk.map(r => ({
          name:     (r.name     ?? '').trim(),
          company:  (r.company  ?? '').trim(),
          niche:    (r.niche    ?? defaultNiche).trim(),
          location: (r.location ?? defaultLocation).trim(),
        }))
      }

      for (let j = 0; j < chunk.length; j++) {
        const raw = chunk[j]
        const cl  = cleaned[j] ?? {}
        normalisedAll.push({
          name:        (cl.name    || raw.name    || '').trim(),
          company:     (cl.company || raw.company || '').trim(),
          phone:       normalisePhone(raw.phone),
          niche:       (cl.niche    || raw.niche    || defaultNiche)  || null,
          location:    (cl.location || raw.location || defaultLocation) || null,
          source_list: sourceList,
          status:      'new',
          enrichment_data: {
            ...(raw.website ? { website: raw.website } : {}),
            ...(raw.address ? { address: raw.address } : {}),
            ...(raw.notes   ? { notes:   raw.notes   } : {}),
          },
        })
      }
    }

    // Drop rows with no usable company name AND no phone
    const valid = normalisedAll.filter(r => r.company || r.phone)

    if (valid.length === 0) {
      return new Response(
        JSON.stringify({ staged: 0, message: 'All rows had empty company and phone — nothing to insert' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 4. Deduplication against existing prospects ───────────────────────────
    // Fetch phones and company+niche combos that already exist in the DB.

    const phones    = valid.map(r => r.phone).filter(Boolean)

    const [phoneCheck, companyCheck] = await Promise.all([
      phones.length > 0
        ? supabase.from('prospects').select('phone').in('phone', phones)
        : Promise.resolve({ data: [] as Array<{ phone: string }>, error: null }),
      supabase
        .from('prospects')
        .select('company, niche')
        .in('company', valid.map(r => r.company).filter(Boolean)),
    ])

    const existingPhones = new Set(
      (phoneCheck.data ?? []).map((r: { phone: string }) => r.phone),
    )

    const existingCompanyNiche = new Set(
      (companyCheck.data ?? []).map((r: { company: string; niche: string | null }) =>
        `${r.company}||${r.niche ?? ''}`.toLowerCase()
      ),
    )

    const deduped = valid.filter(r => {
      if (r.phone && existingPhones.has(r.phone))                       return false
      if (existingCompanyNiche.has(`${r.company}||${r.niche ?? ''}`.toLowerCase())) return false
      return true
    })

    const duplicateCount = valid.length - deduped.length

    if (deduped.length === 0) {
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    HAIKU,
        status:         'success',
        duration_ms:    Date.now() - startedAt,
        input_summary:  `${rawRows.length} raw rows from ${sourceList} (${defaultNiche} / ${defaultLocation})`,
        output_summary: `0 inserted — all ${valid.length} rows were duplicates`,
      })

      return new Response(
        JSON.stringify({
          mode:        scraperUrl ? 'scraper' : 'manual',
          raw_rows:    rawRows.length,
          valid_rows:  valid.length,
          duplicates:  duplicateCount,
          inserted:    0,
          message:     'All valid rows already exist in prospects table',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 5. Batch insert (Postgres trigger fires sop-03-enrichment per row) ────
    const { data: inserted, error: insertError } = await supabase
      .from('prospects')
      .insert(deduped)
      .select('id')

    if (insertError) throw new Error(`insert prospects: ${insertError.message}`)

    const insertedIds = (inserted ?? []).map((r: { id: string }) => r.id)

    // ── 6. Record prospect_batches entry ──────────────────────────────────────
    const { error: batchError } = await supabase.from('prospect_batches').insert({
      batch_date:        new Date().toISOString().slice(0, 10),
      count:             insertedIds.length,
      avg_quality_score: 0,
      min_quality_score: 0,
      batch_notes:       `Source: ${sourceList} | Niche: ${defaultNiche} | Location: ${defaultLocation} | Mode: ${scraperUrl ? 'scraper' : 'manual'} | Duplicates skipped: ${duplicateCount}`,
      prospect_ids:      insertedIds,
    })

    if (batchError) {
      // Non-fatal — log but don't fail the run
      console.warn(`[${SOP_NAME}] prospect_batches insert failed: ${batchError.message}`)
    }

    // ── 7. Audit log ──────────────────────────────────────────────────────────
    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    HAIKU,
      status:         'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${rawRows.length} raw rows from ${sourceList} (${defaultNiche} / ${defaultLocation})`,
      output_summary: `${insertedIds.length} inserted, ${duplicateCount} duplicates skipped — sop-03-enrichment triggered per row`,
    })

    return new Response(
      JSON.stringify({
        mode:        scraperUrl ? 'scraper' : 'manual',
        source_list: sourceList,
        niche:       defaultNiche,
        location:    defaultLocation,
        raw_rows:    rawRows.length,
        valid_rows:  valid.length,
        duplicates:  duplicateCount,
        inserted:    insertedIds.length,
        summary:     `${insertedIds.length} new prospects staged from ${sourceList}. sop-03-enrichment will process each row automatically.`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await Promise.all([
        supabase.from('ai_task_log').insert({
          sop_id:         SOP_ID,
          sop_name:       SOP_NAME,
          tool_called:    HAIKU,
          status:         'failure',
          duration_ms:    Date.now() - startedAt,
          input_summary:  'prospect scraper run',
          output_summary: `Error: ${message}`,
        }),
        supabase.from('ai_alerts').insert({
          severity:         'critical',
          category:         'Cron Failure',
          sop_id:           SOP_ID,
          message:          `${SOP_NAME} failed: ${message}`,
          suggested_action: 'Check scraper API connectivity or the raw rows payload. Review Edge Function logs.',
          resolved:         false,
        }),
      ])
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
