import { useLocation } from 'react-router-dom'
import { Bell, RefreshCw, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { mockDailyBriefing } from '@/lib/mockData'

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
  const { sidebarCollapsed, addNotification } = useAppStore()
  const location = useLocation()
  const page = titles[location.pathname] || { label: 'Operator', sub: '' }
  const now = new Date()

  return (
    <header
      className={cn(
        'fixed top-0 right-0 z-30 h-14 flex items-center px-5 border-b border-base-600 bg-base-900/90 backdrop-blur-sm transition-all duration-300',
        sidebarCollapsed ? 'left-[60px]' : 'left-[220px]'
      )}
    >
      {/* Page title */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="font-display font-bold text-white text-lg uppercase tracking-wide leading-none">
            {page.label}
          </h1>
        </div>
        <p className="text-[11px] text-base-500 font-mono mt-0.5 truncate">{page.sub}</p>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3 ml-4">
        {/* Timestamp */}
        <div className="hidden md:flex items-center gap-1.5 text-base-500">
          <Clock size={12} />
          <span className="font-mono text-xs">{format(now, 'EEE dd MMM · HH:mm')}</span>
        </div>

        {/* Refresh */}
        <button
          onClick={() => addNotification('Data refreshed', 'success')}
          className="p-1.5 rounded text-base-500 hover:text-white hover:bg-base-700 transition-colors"
          title="Refresh data"
        >
          <RefreshCw size={14} />
        </button>

        {/* Alerts bell */}
        <button className="relative p-1.5 rounded text-base-500 hover:text-white hover:bg-base-700 transition-colors">
          <Bell size={14} />
          {mockDailyBriefing.open_alerts > 0 && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-op">
              <span className="absolute inset-0 rounded-full bg-red-op animate-ping opacity-60" />
            </span>
          )}
        </button>

        {/* Briefing time */}
        <div className="hidden lg:block">
          <div className="px-2.5 py-1 rounded bg-base-750 border border-base-600">
            <span className="text-[10px] font-mono text-base-500">BRIEFING </span>
            <span className="text-[10px] font-mono text-green-op font-medium">06:00 ✓</span>
          </div>
        </div>
      </div>
    </header>
  )
}
