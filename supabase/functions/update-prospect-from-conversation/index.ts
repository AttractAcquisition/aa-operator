import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const STAGE_TO_STATUS: Record<string, string> = {
  needs_reply:    'replied',
  qualified:      'warm',
  quoted:         'call_booked',
  booked:         'call_booked',
  won:            'closed_won',
  lost:           'lost',
  bad_fit:        'not_interested',
  new:            'contacted',
  not_interested: 'not_interested',
  do_not_contact: 'do_not_contact',
  active:         'contacted',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { conversation_id, stage } = await req.json()

    if (!conversation_id || !stage) {
      return new Response(
        JSON.stringify({ error: 'conversation_id and stage are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: conv, error: convError } = await supabase
      .from('whatsapp_conversations')
      .select('prospect_id')
      .eq('id', conversation_id)
      .single()

    if (convError || !conv?.prospect_id) {
      return new Response(
        JSON.stringify({ skipped: true, reason: 'no prospect_id on conversation' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const prospectStatus = STAGE_TO_STATUS[stage]
    if (!prospectStatus) {
      return new Response(
        JSON.stringify({ skipped: true, reason: `unknown stage: ${stage}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { error: updateError } = await supabase
      .from('prospects')
      .update({ status: prospectStatus })
      .eq('id', conv.prospect_id)

    if (updateError) throw new Error(updateError.message)

    await supabase.from('ai_task_log').insert({
      sop_id:         'update-prospect-from-conversation',
      sop_name:       'Update Prospect From Conversation',
      status:         'success',
      output_summary: `prospect ${conv.prospect_id} → ${prospectStatus} (conv stage: ${stage})`,
    })

    return new Response(
      JSON.stringify({ success: true, prospect_id: conv.prospect_id, status: prospectStatus }),
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
