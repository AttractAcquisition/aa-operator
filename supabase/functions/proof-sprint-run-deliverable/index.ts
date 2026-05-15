import { createClient } from 'npm:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.36.3'
import { corsHeaders } from '../_shared/cors.ts'

const DELIVERABLE_LABELS: Record<string, string> = {
  D1:  'Market Positioning Analysis',
  D2:  'Ad Creative Concepts',
  D3:  'Landing Page Copy',
  D4:  'Lead Magnet / Guide',
  D5:  'Keyword & Trigger Strategy',
  D6:  'WhatsApp Outreach Sequence',
  D7:  'Call Brief & Discovery Script',
  D8:  'Offer Document',
  D9:  'Sprint Daily Reporting',
  D10: 'Week 1 Performance Analysis',
  D11: 'Week 2 Performance Analysis',
  D12: 'Conversion Rate Optimisation',
  D13: 'Proof Package',
  D14: 'Sprint Closeout Report',
  D15: 'Client Handover & Next Steps',
}

function buildPrompt(deliverableKey: string, clientName: string, input: Record<string, unknown>): string {
  const label = DELIVERABLE_LABELS[deliverableKey] ?? deliverableKey
  return `You are an expert performance marketing strategist working on a Proof Sprint for ${clientName}.

Generate the following deliverable: **${deliverableKey} — ${label}**

Sprint context (input data):
${JSON.stringify(input, null, 2)}

Instructions:
- Produce structured, actionable output appropriate for this deliverable type
- Where relevant, return a JSON block at the end of your response wrapped in <json>...</json> tags with key structured fields
- Keep prose concise and UK English
- The output will be displayed in an operator dashboard and potentially shown to the client`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { client_id, deliverable_key, input_json } = await req.json()

    if (!client_id || !deliverable_key) {
      return new Response(
        JSON.stringify({ error: 'client_id and deliverable_key are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: client } = await supabase
      .from('clients')
      .select('id, business_name, owner_name')
      .eq('id', client_id)
      .single()

    const clientName = client?.business_name ?? client?.owner_name ?? client_id

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: buildPrompt(deliverableKey, clientName, input_json ?? {}),
        },
      ],
    })

    const rawText = message.content[0].type === 'text' ? message.content[0].text : ''

    // Extract structured JSON from <json>...</json> tags if present
    let outputJson: Record<string, unknown> | null = null
    const jsonMatch = rawText.match(/<json>([\s\S]*?)<\/json>/)
    if (jsonMatch) {
      try { outputJson = JSON.parse(jsonMatch[1].trim()) } catch { /* ignore parse errors */ }
    }

    const outputMd = rawText.replace(/<json>[\s\S]*?<\/json>/g, '').trim()

    // Upsert output back to proof_sprint_client_data
    await (supabase as any).from('proof_sprint_client_data').upsert(
      {
        client_id,
        deliverable_key,
        output_md: outputMd,
        output_json: outputJson,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,deliverable_key' },
    )

    await supabase.from('ai_task_log').insert({
      sop_id:         'proof-sprint-run-deliverable',
      sop_name:       `Proof Sprint ${deliverableKey}`,
      status:         'success',
      output_summary: `${deliverableKey} generated for client ${clientName}`,
    })

    return new Response(
      JSON.stringify({
        output: outputMd,
        row: { output_md: outputMd, output_json: outputJson },
      }),
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
