import { supabase } from './supabase'

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}

export function isStandalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

export async function subscribeToPush(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription> {
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!vapidKey) throw new Error('VITE_VAPID_PUBLIC_KEY is not set')

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey) as Uint8Array<ArrayBuffer>,
  })
}

export async function savePushSubscription(subscription: PushSubscription): Promise<void> {
  const key  = subscription.getKey('p256dh')
  const auth = subscription.getKey('auth')

  if (!key || !auth) throw new Error('Push subscription missing keys')

  const p256dh = btoa(String.fromCharCode(...new Uint8Array(key)))
  const authB64 = btoa(String.fromCharCode(...new Uint8Array(auth)))

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint:   subscription.endpoint,
      p256dh,
      auth:       authB64,
      user_agent: navigator.userAgent,
    },
    { onConflict: 'endpoint' },
  )

  if (error) throw new Error(`save subscription: ${error.message}`)
}

export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!registration) return

  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()

  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
}

export async function requestPushPermission(): Promise<'granted' | 'denied' | 'needs-install'> {
  if (isIOS() && !isStandalone()) return 'needs-install'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  const registration = await registerServiceWorker()
  const subscription = await subscribeToPush(registration)
  await savePushSubscription(subscription)

  return 'granted'
}

export async function checkExistingSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false

  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!registration) return false

  const subscription = await registration.pushManager.getSubscription()
  return subscription !== null
}
