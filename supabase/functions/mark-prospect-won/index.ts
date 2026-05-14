import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { prospect_id, client_id } = await req.json()

    if (!prospect_id) {
      return new Response(
        JSON.stringify({ error: 'prospect_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { error: updateError } = await supabase
      .from('prospects')
      .update({ status: 'closed_won' })
      .eq('id', prospect_id)

    if (updateError) throw new Error(updateError.message)

    await supabase.from('ai_task_log').insert({
      sop_id:         'mark-prospect-won',
      sop_name:       'Mark Prospect Won',
      status:         'success',
      output_summary: `prospect ${prospect_id} marked closed_won${client_id ? ` → client ${client_id}` : ''}`,
    })

    return new Response(
      JSON.stringify({ success: true, prospect_id }),
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
