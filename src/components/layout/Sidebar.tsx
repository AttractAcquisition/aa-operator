import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, MessageSquare, Clock, CheckSquare, Activity,
  ListChecks, Users, BarChart2, Bell, Settings, ChevronLeft,
  Zap, Circle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { mockDailyBriefing } from '@/lib/mockData'

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Command Centre', exact: true },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat' },
  { to: '/approvals', icon: CheckSquare, label: 'Approval Queue', badge: mockDailyBriefing.pending_approvals },
  { to: '/pipeline', icon: Activity, label: 'Pipeline' },
  { to: '/sprints', icon: Zap, label: 'Sprints' },
  { to: '/crons', icon: Clock, label: 'Cron Manager' },
  { to: '/sops', icon: ListChecks, label: 'SOP Control' },
  { to: '/clients', icon: Users, label: 'Clients' },
  { to: '/finance', icon: BarChart2, label: 'Finance' },
  { to: '/alerts', icon: Bell, label: 'Alerts', badge: mockDailyBriefing.open_alerts },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export function Sidebar() {
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore()
  const location = useLocation()

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen z-40 flex flex-col transition-all duration-300',
        'bg-base-900 border-r border-base-600',
        sidebarCollapsed ? 'w-[60px]' : 'w-[220px]'
      )}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center gap-3 px-4 py-4 border-b border-base-600',
        sidebarCollapsed && 'justify-center px-0'
      )}>
        <div className="relative flex-shrink-0">
          <div className="w-8 h-8 rounded bg-electric/20 border border-electric/30 flex items-center justify-center">
            <span className="font-display font-bold text-electric text-sm">AA</span>
          </div>
          <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-op border border-base-900">
            <div className="absolute inset-0 rounded-full bg-green-op animate-ping opacity-40" />
          </div>
        </div>
        {!sidebarCollapsed && (
          <div className="min-w-0">
            <div className="font-display font-bold text-white text-sm uppercase tracking-wider truncate">Operator</div>
            <div className="text-[10px] text-base-500 font-mono">AI-FIRST · LIVE</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {nav.map(({ to, icon: Icon, label, badge, exact }) => {
          const isActive = exact ? location.pathname === to : location.pathname.startsWith(to)
          return (
            <NavLink
              key={to}
              to={to}
              title={sidebarCollapsed ? label : undefined}
              className={cn(
                'flex items-center gap-3 px-2.5 py-2 rounded-md mb-0.5 text-sm transition-all duration-150 group relative',
                isActive
                  ? 'bg-electric/10 text-electric border border-electric/20'
                  : 'text-base-500 hover:text-white hover:bg-base-750 border border-transparent',
                sidebarCollapsed && 'justify-center'
              )}
            >
              <Icon size={16} className="flex-shrink-0" />
              {!sidebarCollapsed && (
                <span className="font-body font-medium truncate">{label}</span>
              )}
              {badge !== undefined && badge > 0 && (
                <span className={cn(
                  'ml-auto flex-shrink-0 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold',
                  isActive ? 'bg-electric text-base-950' : 'bg-red-op text-white',
                  sidebarCollapsed && 'absolute top-1 right-1 min-w-[14px] h-[14px] text-[8px]'
                )}>
                  {badge}
                </span>
              )}
              {/* Tooltip for collapsed */}
              {sidebarCollapsed && (
                <div className="absolute left-full ml-3 px-2 py-1 bg-base-700 border border-base-600 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                  {label}
                  {badge !== undefined && badge > 0 && (
                    <span className="ml-1 text-red-op font-bold">({badge})</span>
                  )}
                </div>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* System status */}
      {!sidebarCollapsed && (
        <div className="px-3 py-3 border-t border-base-600">
          <div className="flex items-center gap-2 mb-1.5">
            <Circle size={6} className="text-green-op fill-green-op flex-shrink-0" />
            <span className="text-[10px] text-green-op font-mono font-medium">ALL SYSTEMS OPERATIONAL</span>
          </div>
          <div className="text-[10px] text-base-500 font-mono">
            9 crons active · Last run 06:00
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className={cn(
          'flex items-center justify-center h-10 border-t border-base-600',
          'text-base-500 hover:text-white hover:bg-base-750 transition-colors'
        )}
      >
        <ChevronLeft
          size={16}
          className={cn('transition-transform duration-300', sidebarCollapsed && 'rotate-180')}
        />
      </button>
    </aside>
  )
}
