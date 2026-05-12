// Web Push notification sender using npm:web-push via Deno npm compat.
// Fetches all push_subscriptions and sends to each. Removes expired endpoints (404/410).
// Deploy with: supabase functions deploy send-push-notification --no-verify-jwt
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

interface PushPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  url: string
  tag: string
  data?: Record<string, unknown>
  requireInteraction?: boolean
}

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? ''
  const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
  const VAPID_EMAIL       = Deno.env.get('VAPID_EMAIL')       ?? 'mailto:admin@attractacquisition.com'

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(
      JSON.stringify({ error: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  try {
    const payload: PushPayload = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: subs, error: fetchError } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')

    if (fetchError) throw new Error(`fetch subscriptions: ${fetchError.message}`)

    const subscriptions = (subs ?? []) as SubscriptionRow[]

    let sent = 0
    let failed = 0
    let removed = 0

    const notification = JSON.stringify({
      title:               payload.title,
      body:                payload.body,
      icon:                payload.icon  ?? '/icon-192.png',
      badge:               payload.badge ?? '/favicon.svg',
      tag:                 payload.tag,
      url:                 payload.url,
      data:                payload.data  ?? {},
      requireInteraction:  payload.requireInteraction ?? false,
    })

    await Promise.all(subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          notification,
        )
        sent++
        // Update last_used_at
        await supabase
          .from('push_subscriptions')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', sub.id)
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          // Endpoint expired or unsubscribed — remove it
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          removed++
        } else {
          console.error(`push failed for ${sub.id}: ${err}`)
          failed++
        }
      }
    }))

    return new Response(
      JSON.stringify({ sent, failed, removed, total: subscriptions.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
