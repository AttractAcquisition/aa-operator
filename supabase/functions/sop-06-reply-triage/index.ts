// Model: claude-haiku-4-5-20251001 — mechanical classification only, no generation needed.
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
const HAIKU = 'claude-haiku-4-5-20251001'

type Classification = 'warm' | 'cold' | 'not_interested' | 'unsubscribed'

interface ClassifyResult {
  classification: Classification
  reason: string
}

async function classifyReply(
  replyText: string,
  name: string,
  company: string,
): Promise<ClassifyResult> {
  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 128,
    system: [
      'You are a reply classifier for a B2B outreach sequence.',
      'Classify the prospect reply into exactly one of: warm, cold, not_interested, unsubscribed.',
      'warm = expressed interest or asked a follow-up question',
      'cold = neutral, vague, or non-committal reply',
      'not_interested = clearly declined but politely',
      'unsubscribed = asked to be removed / stop contact',
      'Respond with ONLY valid JSON: {"classification":"<label>","reason":"<one sentence>"}',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: `Prospect: ${name} at ${company}\nReply: ${replyText}`,
      },
    ],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as Anthropic.TextBlock).text)
    .join('')
    .trim()

  return JSON.parse(text) as ClassifyResult
}

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

    // Fetch prospects that have replied but haven't been classified yet
    const { data: prospects, error: fetchError } = await supabase
      .from('prospects')
      .select('id, name, company, quality_score, last_reply_text')
      .eq('status', 'replied')
      .is('reply_classification', null)
      .limit(50)

    if (fetchError) throw new Error(`fetch prospects: ${fetchError.message}`)
    if (!prospects || prospects.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No unclassified replies found', classified: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const counts: Record<Classification, number> = {
      warm: 0, cold: 0, not_interested: 0, unsubscribed: 0,
    }
    let approvalItemsCreated = 0

    for (const prospect of prospects) {
      const replyText = (prospect.last_reply_text as string | null) ?? ''
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

      // Map classification to prospect status
      const statusMap: Record<Classification, string> = {
        warm: 'warm',
        cold: 'cold',
        not_interested: 'not_interested',
        unsubscribed: 'unsubscribed',
      }

      await supabase
        .from('prospects')
        .update({
          status: statusMap[classification],
          reply_classification: classification,
        })
        .eq('id', prospect.id)

      // Queue warm replies for human review
      if (classification === 'warm') {
        const priority = (prospect.quality_score ?? 0) >= 7 ? 'high' : 'medium'
        await supabase.from('approval_queue').insert({
          sop_id: '06',
          sop_name: 'SOP 06 — Reply Triage',
          status: 'pending',
          priority,
          content_type: 'whatsapp_message',
          content_id: crypto.randomUUID(),
          content: {
            title: `Warm reply from ${prospect.name} at ${prospect.company}`,
            body: replyText,
            recipient: prospect.name,
            metadata: {
              classification,
              reason,
              prospect_id: prospect.id,
            },
          },
        })
        approvalItemsCreated++
      }
    }

    const totalClassified = Object.values(counts).reduce((a, b) => a + b, 0)
    const outputSummary =
      `${totalClassified} classified — ${counts.warm} warm, ${counts.cold} cold, ` +
      `${counts.not_interested} not_interested, ${counts.unsubscribed} unsubscribed. ` +
      `${approvalItemsCreated} approval items created.`

    await supabase.from('ai_task_log').insert({
      sop_id: '06',
      sop_name: 'SOP 06 — Reply Triage',
      tool_called: HAIKU,
      status: 'success',
      duration_ms: Date.now() - startedAt,
      input_summary: `${prospects.length} unclassified replies`,
      output_summary: outputSummary,
    })

    return new Response(
      JSON.stringify({ classified: totalClassified, counts, approval_items: approvalItemsCreated }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Best-effort failure log
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      )
      await supabase.from('ai_task_log').insert({
        sop_id: '06',
        sop_name: 'SOP 06 — Reply Triage',
        tool_called: HAIKU,
        status: 'failure',
        duration_ms: Date.now() - startedAt,
        input_summary: 'unclassified replies',
        output_summary: `Error: ${message}`,
      })
    } catch { /* ignore logging failure */ }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
