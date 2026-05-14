import { useLocation } from 'react-router-dom'
import { Bell, RefreshCw, Clock, LogOut, Menu } from 'lucide-react'
import { format } from 'date-fns'
import { PushNotificationToggle } from '@/components/ui/PushNotificationToggle'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'

const titles: Record<string, { label: string; sub: string }> = {
  '/': { label: 'Command Centre', sub: 'SOP 58 — Daily operational overview' },
  '/chat': { label: 'AI Chat', sub: 'Natural language interface to all live data' },
  '/approvals': { label: 'Approval Queue', sub: 'Items Claude has prepared for your review' },
  '/pipeline': { label: 'Live Pipeline', sub: 'Prospect-to-client conversion funnel' },
  '/sprints': { label: 'Active Sprints', sub: 'Proof Sprint monitoring and daily ops' },
  '/crons': { label: 'Cron Manager', sub: 'Scheduled automation control centre' },
  '/sops': { label: 'SOP Control', sub: 'All 58 SOPs — automation status and run history' },
  '/clients': { label: 'Client Workspace', sub: 'Per-client delivery and communication hub' },
  '/finance': { label: 'Finance Dashboard', sub: 'SOP 56 — Revenue, invoices, and cash position' },
  '/alerts': { label: 'Alerts & Escalations', sub: 'Issues flagged by Claude requiring attention' },
  '/settings': { label: 'Settings', sub: 'API keys, permissions, and system configuration' },
}

export function Header() {
  const { sidebarCollapsed, addNotification, setMobileSidebarOpen } = useAppStore()
  const { signOut } = useAuth()
  const location = useLocation()
  const page = titles[location.pathname] || { label: 'Operator', sub: '' }
  const now = new Date()

  const { data: openAlerts = 0 } = useQuery({
    queryKey: ['header_open_alerts'],
    queryFn: async () => {
      const { count } = await supabase
        .from('ai_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('resolved', false)
      return count ?? 0
    },
    refetchInterval: 1000 * 60 * 5,
  })

  return (
    <header
      className={cn(
        'fixed top-0 right-0 z-30 h-14 flex items-center px-4 border-b border-base-600 bg-base-900/90 backdrop-blur-sm transition-all duration-300',
        // Mobile: full width from left edge
        // Desktop: offset by sidebar width
        'left-0',
        sidebarCollapsed ? 'lg:left-[60px]' : 'lg:left-[220px]',
      )}
    >
      {/* Hamburger menu — mobile only */}
      <button
        onClick={() => setMobileSidebarOpen(true)}
        className="lg:hidden flex items-center justify-center min-w-[44px] min-h-[44px] -ml-1 mr-1 text-base-500 hover:text-white transition-colors"
        aria-label="Open navigation"
      >
        <Menu size={20} />
      </button>

      {/* Page title — centred on mobile, left-aligned on desktop */}
      <div className="flex-1 min-w-0 text-center lg:text-left">
        <h1 className="font-display font-bold text-white text-base lg:text-lg uppercase tracking-wide leading-none truncate">
          {page.label}
        </h1>
        <p className="hidden lg:block text-[11px] text-base-500 font-mono mt-0.5 truncate">{page.sub}</p>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-1 lg:gap-3 ml-2">
        {/* Timestamp — hidden on mobile */}
        <div className="hidden md:flex items-center gap-1.5 text-base-500">
          <Clock size={12} />
          <span className="font-mono text-xs">{format(now, 'EEE dd MMM · HH:mm')}</span>
        </div>

        {/* Refresh — hidden on mobile */}
        <button
          onClick={() => addNotification('Data refreshed', 'success')}
          className="hidden md:flex items-center justify-center p-1.5 rounded text-base-500 hover:text-white hover:bg-base-700 transition-colors"
          title="Refresh data"
        >
          <RefreshCw size={14} />
        </button>

        <PushNotificationToggle />

        {/* Alerts bell — always shown */}
        <button className="relative flex items-center justify-center min-w-[44px] min-h-[44px] rounded text-base-500 hover:text-white hover:bg-base-700 transition-colors">
          <Bell size={14} />
          {openAlerts > 0 && (
            <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-red-op">
              <span className="absolute inset-0 rounded-full bg-red-op animate-ping opacity-60" />
            </span>
          )}
        </button>

        {/* Briefing time — desktop only */}
        <div className="hidden lg:block">
          <div className="px-2.5 py-1 rounded bg-base-750 border border-base-600">
            <span className="text-[10px] font-mono text-base-500">BRIEFING </span>
            <span className="text-[10px] font-mono text-green-op font-medium">06:00 ✓</span>
          </div>
        </div>

        {/* Sign out — always shown */}
        <button
          onClick={signOut}
          className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded text-base-500 hover:text-red-op hover:bg-red-op/10 transition-colors"
          title="Sign out"
        >
          <LogOut size={14} />
        </button>
      </div>
    </header>
  )
}
