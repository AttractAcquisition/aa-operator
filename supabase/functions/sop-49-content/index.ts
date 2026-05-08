// sop-49-content — runs every Monday at 08:00 UTC (cron: 0 8 * * 1)
// Model: claude-sonnet-4-6 — weekly social media content generation for Attract Acquisition.
// Pulls recent sprint wins, client results, and industry insights from knowledge_base,
// generates 5 platform-specific content pieces, and queues one medium-priority approval item.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const SONNET   = 'claude-sonnet-4-6'
const SOP_ID   = '49'
const SOP_NAME = 'SOP 49 — Weekly Content Generation'

const PLATFORMS = ['LinkedIn', 'Instagram', 'Facebook'] as const
type Platform = typeof PLATFORMS[number]

// ─── Types ────────────────────────────────────────────────────────────────────

interface KBRow {
  id:      string
  title:   string
  content: string
  tags:    string[]
  type:    string
}

interface ContentPiece {
  platform: Platform
  hook:     string
  body:     string
  cta:      string
}

// ─── Claude generation ────────────────────────────────────────────────────────

async function generateContentPieces(
  sprintWins:       KBRow[],
  clientResults:    KBRow[],
  industryInsights: KBRow[],
  weekLabel:        string,
): Promise<ContentPiece[]> {
  const formatEntries = (rows: KBRow[], label: string): string => {
    if (rows.length === 0) return `${label}:\n  (none available this week)`
    return `${label}:\n` + rows.map(r => `  - ${r.title}: ${r.content.slice(0, 300).replace(/\n/g, ' ')}`).join('\n')
  }

  const context = [
    formatEntries(sprintWins,       'RECENT SPRINT WINS'),
    formatEntries(clientResults,    'CLIENT RESULTS'),
    formatEntries(industryInsights, 'INDUSTRY INSIGHTS'),
  ].join('\n\n')

  const response = await anthropic.messages.create({
    model:      SONNET,
    max_tokens: 2500,
    system: [
      'You are the content strategist for Attract Acquisition, a UK-based paid advertising agency.',
      'Attract Acquisition helps local service businesses (trades, clinics, consultants) generate leads via Meta and Google Ads.',
      'Your tone is confident, results-focused, and credible — no hype, no fluff.',
      '',
      'Generate exactly 5 social media content pieces for Attract Acquisition\'s own brand channels.',
      'Distribute across LinkedIn, Instagram, and Facebook — no single platform may appear more than twice.',
      '',
      'Each piece must follow this exact JSON structure:',
      '{"platform":"<LinkedIn|Instagram|Facebook>","hook":"<1-2 sentence attention-grabber>","body":"<2-4 sentences of value/proof/insight>","cta":"<1 clear call to action>"}',
      '',
      'Output ONLY a JSON array of 5 objects — no markdown, no prose, no extra keys.',
      'Example structure: [{"platform":"LinkedIn","hook":"...","body":"...","cta":"..."},...]',
      '',
      'Guidelines per platform:',
      '  LinkedIn: Professional tone, specific metrics when available, speaks to business owners and decision-makers.',
      '  Instagram: Punchy and visual-first, short sentences, hook must stop the scroll, emojis acceptable.',
      '  Facebook: Conversational, community-focused, slightly longer body copy, relatable pain points.',
      '',
      'Use the sprint wins, client results, and industry insights provided to ground each piece in real proof.',
      'If specific numbers are available (CPL, ROAS, lead counts), use them — vague claims are weak.',
      'Each piece should stand alone as compelling content without requiring context from the others.',
    ].join('\n'),
    messages: [{
      role:    'user',
      content: `Week: ${weekLabel}\n\n${context}\n\nGenerate 5 content pieces now.`,
    }],
  })

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  // Strip optional markdown code fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let pieces: ContentPiece[]
  try {
    pieces = JSON.parse(cleaned)
  } catch {
    throw new Error(`Claude response was not valid JSON: ${cleaned.slice(0, 200)}`)
  }

  if (!Array.isArray(pieces) || pieces.length !== 5) {
    throw new Error(`Expected 5 content pieces, got ${Array.isArray(pieces) ? pieces.length : 'non-array'}`)
  }

  for (const p of pieces) {
    if (!PLATFORMS.includes(p.platform as Platform)) {
      throw new Error(`Invalid platform "${p.platform}" — must be LinkedIn, Instagram, or Facebook`)
    }
    if (!p.hook || !p.body || !p.cta) {
      throw new Error(`Content piece missing required fields: ${JSON.stringify(p)}`)
    }
  }

  return pieces as ContentPiece[]
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

    const today     = new Date()
    const weekLabel = `Week of ${today.toISOString().slice(0, 10)}`

    // ── 1. Pull recent sprint wins, client results, industry insights ──────────
    // Query the last 30 days of active reference/client_context entries tagged with
    // sprint_win, client_result, or industry_insight for content grounding.
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: rawKB, error: kbErr } = await supabase
      .from('knowledge_base')
      .select('id, title, content, tags, type')
      .eq('is_active', true)
      .in('type', ['reference', 'client_context'])
      .gte('updated_at', thirtyDaysAgo)
      .order('updated_at', { ascending: false })
      .limit(30)

    if (kbErr) throw new Error(`knowledge_base fetch: ${kbErr.message}`)

    const kb = (rawKB ?? []) as KBRow[]

    const sprintWins       = kb.filter(r => r.tags.includes('sprint_win'))
    const clientResults    = kb.filter(r => r.tags.includes('client_result'))
    const industryInsights = kb.filter(r => r.tags.includes('industry_insight'))

    console.log(
      `[sop-49] knowledge_base: ${sprintWins.length} sprint wins, ` +
      `${clientResults.length} client results, ${industryInsights.length} industry insights`,
    )

    // ── 2. Generate 5 content pieces via Claude ────────────────────────────────
    const pieces = await generateContentPieces(
      sprintWins, clientResults, industryInsights, weekLabel,
    )

    console.log(`[sop-49] generated ${pieces.length} content pieces`)
    for (const p of pieces) console.log(`[sop-49]  → ${p.platform}: "${p.hook.slice(0, 60)}..."`)

    // ── 3. Create one medium-priority approval_queue item ─────────────────────
    const platformBreakdown = pieces.reduce<Record<string, number>>((acc, p) => {
      acc[p.platform] = (acc[p.platform] ?? 0) + 1
      return acc
    }, {})

    const { data: approvalRow, error: approvalErr } = await supabase
      .from('approval_queue')
      .insert({
        sop_id:       SOP_ID,
        sop_name:     SOP_NAME,
        status:       'pending',
        priority:     'medium',
        content_type: 'client_report',
        content_id:   crypto.randomUUID(),
        content: {
          title: `Weekly Social Content — Attract Acquisition — ${weekLabel}`,
          body:  `5 platform-specific content pieces ready for review and scheduling. ` +
                 `Platforms: ${Object.entries(platformBreakdown).map(([k, v]) => `${k} ×${v}`).join(', ')}.`,
          pieces,
          metadata: {
            week_label:         weekLabel,
            pieces_count:       pieces.length,
            platform_breakdown: platformBreakdown,
            kb_sprint_wins:     sprintWins.length,
            kb_client_results:  clientResults.length,
            kb_industry_insights: industryInsights.length,
          },
        },
      })
      .select('id')
      .single()

    if (approvalErr) throw new Error(`approval_queue insert: ${approvalErr.message}`)

    console.log(`[sop-49] approval item created: ${approvalRow?.id}`)

    // ── 4. Audit log ──────────────────────────────────────────────────────────
    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    SONNET,
      status:         'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${kb.length} KB entries (${sprintWins.length} wins, ${clientResults.length} results, ${industryInsights.length} insights)`,
      output_summary: `5 content pieces generated, 1 medium-priority approval item created (${approvalRow?.id})`,
    })

    return new Response(
      JSON.stringify({
        pieces_generated:    pieces.length,
        approval_id:         approvalRow?.id,
        platform_breakdown:  platformBreakdown,
        kb_entries_used: {
          sprint_wins:       sprintWins.length,
          client_results:    clientResults.length,
          industry_insights: industryInsights.length,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[sop-49] fatal: ${message}`)

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
        input_summary:  'weekly content generation run',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
