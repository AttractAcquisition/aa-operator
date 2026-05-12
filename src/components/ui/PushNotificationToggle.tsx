import { useState, useEffect } from 'react'
import { Bell, BellOff } from 'lucide-react'
import {
  isPushSupported,
  checkExistingSubscription,
  requestPushPermission,
  unsubscribeFromPush,
} from '@/lib/pushNotifications'
import { useAppStore } from '@/store'

export function PushNotificationToggle() {
  const { addNotification } = useAppStore()
  const [supported, setSupported]   = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading]       = useState(false)

  useEffect(() => {
    if (!isPushSupported()) return
    setSupported(true)
    checkExistingSubscription().then(setSubscribed)
  }, [])

  if (!supported) return null

  async function handleClick() {
    if (loading) return
    setLoading(true)
    try {
      if (subscribed) {
        await unsubscribeFromPush()
        setSubscribed(false)
        addNotification('Notifications disabled', 'info')
      } else {
        const result = await requestPushPermission()
        if (result === 'granted') {
          setSubscribed(true)
          addNotification('Push notifications enabled', 'success')
        } else if (result === 'denied') {
          addNotification('Please allow notifications in browser settings', 'error')
        } else {
          addNotification('Add to home screen first: Safari → Share → Add to Home Screen', 'info')
        }
      }
    } catch (err) {
      addNotification('Notification error — check console', 'error')
      console.error('Push toggle error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title={subscribed ? 'Notifications on' : 'Enable notifications'}
      className={
        'hidden md:flex items-center justify-center p-1.5 rounded transition-colors ' +
        (subscribed
          ? 'text-[#00D4FF] hover:bg-[#00D4FF]/10'
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
