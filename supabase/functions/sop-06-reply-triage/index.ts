// Model: claude-haiku-4-5-20251001 — mechanical classification only, no generation needed.
//
// For each unclassified replied prospect:
//   1. Classifies the reply as warm / cold / not_interested / unsubscribed via Haiku.
//   2. Updates prospects.status + prospects.reply_classification.
//   3. Updates the matching whatsapp_conversations row:
//        ai_intent    ← classification
//        needs_human  ← true for warm; false for not_interested / unsubscribed / cold
//        stage        ← 'qualified' for warm; 'lost' for not_interested;
//                       'blocked' for unsubscribed; unchanged for cold
//   4. Queues warm replies in approval_queue for human follow-up.
//
// Conversations are pre-fetched in one query to avoid N+1 round trips.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const HAIKU    = 'claude-haiku-4-5-20251001'
const SOP_ID   = '06'
const SOP_NAME = 'SOP 06 — Reply Triage'

type Classification = 'warm' | 'cold' | 'not_interested' | 'unsubscribed'

interface ClassifyResult {
  classification: Classification
  reason:         string
}

interface ProspectRow {
  id:               string
  name:             string
  company:          string
  quality_score:    number
  last_reply_text:  string | null
}

interface ConversationRow {
  id:          string
  prospect_id: string
}

// ─── Stage + needs_human mapping ─────────────────────────────────────────────
// Returns the conversation fields to set for a given classification.
// stage = null means "do not change stage" (cold — already at 'replied').

const CONV_UPDATES: Record<Classification, { needs_human: boolean; stage: string | null }> = {
  warm:           { needs_human: true,  stage: 'qualified' },
  cold:           { needs_human: false, stage: null        },
  not_interested: { needs_human: false, stage: 'lost'      },
  unsubscribed:   { needs_human: false, stage: 'blocked'   },
}

// ─── Haiku classifier ─────────────────────────────────────────────────────────

async function classifyReply(
  replyText: string,
  name:      string,
  company:   string,
): Promise<ClassifyResult> {
  const response = await anthropic.messages.create({
    model:      HAIKU,
    max_tokens: 128,
    system: [{ type: 'text', text: [
      'You are a reply classifier for a B2B outreach sequence.',
      'Classify the prospect reply into exactly one of: warm, cold, not_interested, unsubscribed.',
      'warm = expressed interest or asked a follow-up question',
      'cold = neutral, vague, or non-committal reply',
      'not_interested = clearly declined but politely',
      'unsubscribed = asked to be removed / stop contact',
      'Respond with ONLY valid JSON: {"classification":"<label>","reason":"<one sentence>"}',
    ].join('\n'), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Prospect: ${name} at ${company}\nReply: ${replyText}` }],
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  return JSON.parse(text) as ClassifyResult
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

    // ── 1. Fetch unclassified replied prospects ───────────────────────────────
    const { data: rawProspects, error: fetchError } = await supabase
      .from('prospects')
      .select('id, name, company, quality_score, last_reply_text')
      .eq('status', 'replied')
      .is('reply_classification', null)
      .limit(50)

    if (fetchError) throw new Error(`fetch prospects: ${fetchError.message}`)

    const prospects = (rawProspects ?? []) as ProspectRow[]

    if (prospects.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No unclassified replies found', classified: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ── 2. Pre-fetch conversations for all prospect IDs (single query) ────────
    const prospectIds = prospects.map(p => p.id)

    const { data: convRows, error: convFetchError } = await supabase
      .from('whatsapp_conversations')
      .select('id, prospect_id')
      .in('prospect_id', prospectIds)

    if (convFetchError) throw new Error(`fetch conversations: ${convFetchError.message}`)

    // prospect_id → conversation_id lookup map
    const convMap = new Map(
      ((convRows ?? []) as ConversationRow[]).map(c => [c.prospect_id, c.id]),
    )

    // ── 3. Classify each reply and apply updates ──────────────────────────────
    const counts: Record<Classification, number> = {
      warm: 0, cold: 0, not_interested: 0, unsubscribed: 0,
    }
    let approvalItemsCreated = 0
    let conversationsUpdated = 0

    for (const prospect of prospects) {
      const replyText = prospect.last_reply_text ?? ''
      if (!replyText) continue

      let result: ClassifyResult
      try {
        result = await classifyReply(replyText, prospect.name, prospect.company)
      } catch {
        continue
      }

      const { classification, reason } = result
      if (!['warm', 'cold', 'not_interested', 'unsubscribed'].includes(classification)) continue

      counts[classification]++

      // 3a. Update prospect status + classification
      const statusMap: Record<Classification, string> = {
        warm:           'warm',
        cold:           'cold',
        not_interested: 'not_interested',
        unsubscribed:   'unsubscribed',
      }

      await supabase
        .from('prospects')
        .update({ status: statusMap[classification], reply_classification: classification })
        .eq('id', prospect.id)

      // 3b. Update whatsapp_conversations if a matching row exists
      const convId = convMap.get(prospect.id)
      if (convId) {
        const { needs_human, stage } = CONV_UPDATES[classification]

        const convUpdate: Record<string, unknown> = {
          ai_intent:   classification,
          needs_human,
        }
        // Only set stage when the mapping specifies a new value
        if (stage !== null) convUpdate.stage = stage

        await supabase
          .from('whatsapp_conversations')
          .update(convUpdate)
          .eq('id', convId)

        conversationsUpdated++
      }

      // 3c. Queue warm replies for human review via approval_queue
      if (classification === 'warm') {
        const priority = (prospect.quality_score ?? 0) >= 7 ? 'high' : 'medium'
        await supabase.from('approval_queue').insert({
          sop_id:       SOP_ID,
          sop_name:     SOP_NAME,
          status:       'pending',
          priority,
          content_type: 'whatsapp_message',
          content_id:   crypto.randomUUID(),
          content: {
            title:     `Warm reply from ${prospect.name} at ${prospect.company}`,
            body:      replyText,
            recipient: prospect.name,
            metadata: {
              classification,
              reason,
              prospect_id:     prospect.id,
              conversation_id: convId ?? null,
            },
          },
        })
        approvalItemsCreated++

        // Fire-and-forget push notification for warm lead
        supabase.functions.invoke('send-push-notification', {
          body: {
            title: '🔥 Warm lead',
            body:  `${prospect.name} — ${prospect.company} replied`,
            url:   '/approvals',
            tag:   `warm-lead-${prospect.id}`,
          },
        })
      }
    }

    // ── 4. Audit log ──────────────────────────────────────────────────────────
    const totalClassified = Object.values(counts).reduce((a, b) => a + b, 0)
    const outputSummary =
      `${totalClassified} classified — ${counts.warm} warm, ${counts.cold} cold, ` +
      `${counts.not_interested} not_interested, ${counts.unsubscribed} unsubscribed. ` +
      `${conversationsUpdated} conversations updated. ` +
      `${approvalItemsCreated} approval items created.`

    await supabase.from('ai_task_log').insert({
      sop_id:         SOP_ID,
      sop_name:       SOP_NAME,
      tool_called:    HAIKU,
      status:         'success',
      duration_ms:    Date.now() - startedAt,
      input_summary:  `${prospects.length} unclassified replies`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({
        classified:             totalClassified,
        counts,
        conversations_updated:  conversationsUpdated,
        approval_items:         approvalItemsCreated,
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
      await supabase.from('ai_task_log').insert({
        sop_id:         SOP_ID,
        sop_name:       SOP_NAME,
        tool_called:    HAIKU,
        status:         'failure',
        duration_ms:    Date.now() - startedAt,
        input_summary:  'unclassified replies',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
