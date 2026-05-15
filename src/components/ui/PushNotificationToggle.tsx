import { useState, useEffect, useRef } from 'react'
import { Bell, BellOff } from 'lucide-react'
import {
  isPushSupported,
  isIOS,
  isStandalone,
  checkExistingSubscription,
  registerServiceWorker,
  subscribeToPush,
  savePushSubscription,
  unsubscribeFromPush,
  testPushSetup,
} from '@/lib/pushNotifications'
import { useAppStore } from '@/store'

export function PushNotificationToggle() {
  const { addNotification } = useAppStore()
  const [supported, setSupported]     = useState(false)
  const [subscribed, setSubscribed]   = useState(false)
  const [loading, setLoading]         = useState(false)
  const [permission, setPermission]   = useState<NotificationPermission | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    console.log('[Push] Checking support...')
    if (!isPushSupported()) {
      console.log('[Push] Not supported on this browser/OS')
      return
    }
    setSupported(true)
    console.log('[Push] Push supported')

    const perm = Notification.permission
    setPermission(perm)
    console.log('[Push] Current permission state:', perm)

    checkExistingSubscription().then(sub => {
      setSubscribed(sub)
      console.log('[Push] Existing subscription found:', sub)
    })
  }, [])

  if (!supported) return null

  async function handleClick() {
    if (loading) return
    console.log('[Push] Bell clicked — permission:', Notification.permission, '| iOS:', isIOS(), '| standalone:', isStandalone())

    // iOS outside standalone mode — push is not supported, show install instructions
    if (isIOS() && !isStandalone()) {
      console.log('[Push] iOS non-standalone — showing Add to Home Screen instructions')
      addNotification(
        'To enable notifications on iPhone: tap the Share button in Safari, then Add to Home Screen, then open the app from your home screen icon',
        'info',
      )
      return
    }

    // Permission already denied — explain how to re-enable
    if (Notification.permission === 'denied') {
      console.log('[Push] Permission is denied — cannot prompt, explaining settings path')
      addNotification(
        'Notifications are blocked. To re-enable: open browser Settings → Site Settings → Notifications, find this site and set to Allow.',
        'error',
      )
      return
    }

    // Unsubscribe flow
    if (subscribed) {
      setLoading(true)
      try {
        console.log('[Push] Unsubscribing...')
        await unsubscribeFromPush()
        setSubscribed(false)
        setPermission(Notification.permission)
        addNotification('Notifications disabled', 'info')
        console.log('[Push] Unsubscribed successfully')
      } catch (err) {
        console.error('[Push] Unsubscribe error:', err)
        addNotification('Could not disable notifications — check console', 'error')
      } finally {
        setLoading(false)
      }
      return
    }

    // Subscribe flow — Notification.requestPermission() is called here directly
    // in the click handler to preserve the iOS Safari user gesture requirement.
    // Any await before this call breaks the gesture chain on iOS Safari.
    setLoading(true)
    console.log('[Push] Calling Notification.requestPermission() directly in click handler...')

    let perm: NotificationPermission
    try {
      perm = await Notification.requestPermission()
      console.log('[Push] Permission result:', perm)
      setPermission(perm)
    } catch (err) {
      console.error('[Push] requestPermission threw:', err)
      addNotification('Could not request notification permission', 'error')
      setLoading(false)
      return
    }

    if (perm !== 'granted') {
      addNotification(
        perm === 'denied'
          ? 'Notifications blocked. Enable in browser Settings → Site permissions.'
          : 'Notification permission was not granted.',
        'error',
      )
      setLoading(false)
      return
    }

    try {
      console.log('[Push] Registering service worker at /sw.js...')
      const registration = await registerServiceWorker()
      console.log('[Push] SW registered, scope:', registration.scope)

      console.log('[Push] Subscribing to push manager...')
      const subscription = await subscribeToPush(registration)
      console.log('[Push] Subscribed, endpoint:', subscription.endpoint)

      console.log('[Push] Saving subscription to Supabase...')
      await savePushSubscription(subscription)
      console.log('[Push] Subscription saved to push_subscriptions table')

      setSubscribed(true)
      addNotification('Push notifications enabled', 'success')
    } catch (err) {
      console.error('[Push] Subscribe/save error:', err)
      addNotification('Notification setup failed — check console for details', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Hold bell for 2 seconds to show diagnostic report
  function handleLongPressStart() {
    longPressTimer.current = setTimeout(async () => {
      console.log('[Push] Long press — running diagnostic...')
      try {
        const report = await testPushSetup()
        console.log('[Push] Diagnostic report:', JSON.stringify(report, null, 2))
        const summary = [
          `Supported: ${report.supported}`,
          `Permission: ${report.permission}`,
          `SW: ${report.swRegistered}`,
          `Subscribed: ${report.subscribed}`,
          `VAPID: ${report.vapidKeyPresent}`,
          report.issues.length > 0 ? `Issues: ${report.issues.join(' | ')}` : 'No issues',
        ].join(' · ')
        addNotification(summary, report.issues.length > 0 ? 'error' : 'success')
      } catch (err) {
        console.error('[Push] Diagnostic failed:', err)
      }
    }, 2000)
  }

  function handleLongPressEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  const isDenied = permission === 'denied'
  const isIOSNoInstall = isIOS() && !isStandalone()

  let buttonTitle = subscribed ? 'Notifications on (click to disable)' : 'Enable push notifications'
  if (isDenied) buttonTitle = 'Notifications blocked — tap for instructions'
  if (isIOSNoInstall) buttonTitle = 'Add to Home Screen to enable notifications'

  return (
    <button
      onClick={handleClick}
      onMouseDown={handleLongPressStart}
      onMouseUp={handleLongPressEnd}
      onMouseLeave={handleLongPressEnd}
      onTouchStart={handleLongPressStart}
      onTouchEnd={handleLongPressEnd}
      onTouchCancel={handleLongPressEnd}
      disabled={loading}
      title={buttonTitle}
      className={
        'flex items-center justify-center p-1.5 rounded transition-colors ' +
        (subscribed
          ? 'text-electric hover:bg-electric/10'
          : isDenied
          ? 'text-red-500 hover:bg-red-500/10'
          : 'text-base-500 hover:text-white hover:bg-base-700')
      }
    >
      {subscribed
        ? <Bell size={14} fill="currentColor" />
        : <BellOff size={14} />
      }
    </button>
  )
}
