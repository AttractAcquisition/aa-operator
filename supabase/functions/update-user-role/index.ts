import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const VALID_ROLES = ['admin', 'delivery', 'distribution', 'client']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { user_id, role, metadata_id } = await req.json()

    if (!user_id || typeof user_id !== 'string') {
      return new Response(
        JSON.stringify({ error: 'user_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!role || !VALID_ROLES.includes(role)) {
      return new Response(
        JSON.stringify({ error: `role must be one of: ${VALID_ROLES.join(', ')}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const appMetadata: Record<string, string | null> = { role }
    if (metadata_id) appMetadata.metadata_id = metadata_id

    const { error: authError } = await supabase.auth.admin.updateUserById(user_id, {
      app_metadata: appMetadata,
    })

    if (authError) throw new Error(authError.message)

    await supabase.from('ai_task_log').insert({
      sop_id:         'update-user-role',
      sop_name:       'Update User Role',
      status:         'success',
      output_summary: `user ${user_id} → role:${role}${metadata_id ? ` metadata_id:${metadata_id}` : ''}`,
    })

    return new Response(
      JSON.stringify({ ok: true, user_id, role }),
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
