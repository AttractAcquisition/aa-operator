import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, MessageSquare, Clock, CheckSquare, Activity,
  ListChecks, Users, BarChart2, Bell, Settings, ChevronLeft,
  Zap, Circle, FileText, BookOpen, TrendingUp, MessageCircle, X,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { supabase } from '@/lib/supabase'

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'Command Centre', exact: true },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat' },
  { to: '/conversations', icon: MessageCircle, label: 'Conversations' },
  { to: '/approvals', icon: CheckSquare, label: 'Approval Queue' },
  { to: '/pipeline', icon: Activity, label: 'Pipeline' },
  { to: '/sprints', icon: Zap, label: 'Sprints' },
  { to: '/crons', icon: Clock, label: 'Cron Manager' },
  { to: '/sops', icon: ListChecks, label: 'SOP Control' },
  { to: '/clients', icon: Users, label: 'Clients' },
  { to: '/finance', icon: BarChart2, label: 'Finance' },
  { to: '/alerts', icon: Bell, label: 'Alerts' },
  { to: '/documents', icon: FileText, label: 'Documents' },
  { to: '/knowledge-base', icon: BookOpen, label: 'Knowledge Base' },
  { to: '/analytics', icon: TrendingUp, label: 'Analytics' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export function Sidebar() {
  const { sidebarCollapsed, setSidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen } = useAppStore()
  const location = useLocation()

  const { data: badges } = useQuery({
    queryKey: ['sidebar_badges'],
    queryFn: async () => {
      const [approvals, alerts] = await Promise.all([
        supabase.from('approval_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('ai_alerts').select('*', { count: 'exact', head: true }).eq('resolved', false),
      ])
      return { approvals: approvals.count ?? 0, alerts: alerts.count ?? 0 }
    },
    refetchInterval: 1000 * 60 * 5,
  })

  return (
    <>
      {/* Mobile backdrop — visible only when sidebar is open on small screens */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/60 transition-opacity duration-300 lg:hidden',
          mobileSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={() => setMobileSidebarOpen(false)}
      />

      <aside
        className={cn(
          'fixed left-0 top-0 h-screen flex flex-col transition-all duration-300',
          'bg-base-900 border-r border-base-600',
          // Mobile: slide-over overlay, always 280px, high z-index
          'w-[280px] z-50',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: always visible, z-40, respect collapsed width
          'lg:translate-x-0 lg:z-40',
          sidebarCollapsed ? 'lg:w-[60px]' : 'lg:w-[220px]',
        )}
      >
        {/* Logo row */}
        <div className={cn(
          'flex items-center gap-3 px-4 py-4 border-b border-base-600',
          sidebarCollapsed && 'lg:justify-center lg:px-0',
        )}>
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded bg-electric/20 border border-electric/30 flex items-center justify-center">
              <span className="font-display font-bold text-electric text-sm">AA</span>
            </div>
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-op border border-base-900">
              <div className="absolute inset-0 rounded-full bg-green-op animate-ping opacity-40" />
            </div>
          </div>
          {/* Label: always show on mobile, hide when desktop-collapsed */}
          <div className={cn('min-w-0 flex-1', sidebarCollapsed && 'lg:hidden')}>
            <div className="font-display font-bold text-white text-sm uppercase tracking-wider truncate">Operator</div>
            <div className="text-[10px] text-base-500 font-mono">AI-FIRST · LIVE</div>
          </div>
          {/* Close button — mobile only */}
          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden p-2 text-base-500 hover:text-white transition-colors flex-shrink-0"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {nav.map(({ to, icon: Icon, label, exact }) => {
            const isActive = exact ? location.pathname === to : location.pathname.startsWith(to)
            const badge = to === '/approvals' ? (badges?.approvals ?? 0)
                        : to === '/alerts' ? (badges?.alerts ?? 0)
                        : undefined
            return (
              <NavLink
                key={to}
                to={to}
                title={sidebarCollapsed ? label : undefined}
                onClick={() => setMobileSidebarOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-2.5 rounded-md mb-0.5 text-sm transition-all duration-150 group relative',
                  // Mobile: 48px min tap target; desktop: normal size
                  'min-h-[48px] py-3 lg:min-h-0 lg:py-2',
                  isActive
                    ? 'bg-electric/10 text-electric border border-electric/20'
                    : 'text-base-500 hover:text-white hover:bg-base-750 border border-transparent',
                  sidebarCollapsed && 'lg:justify-center',
                )}
              >
                <Icon size={16} className="flex-shrink-0" />
                {/* Always show label on mobile; hide when desktop-collapsed */}
                <span className={cn('font-body font-medium truncate', sidebarCollapsed && 'lg:hidden')}>
                  {label}
                </span>
                {badge !== undefined && badge > 0 && (
                  <span className={cn(
                    'ml-auto flex-shrink-0 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold',
                    isActive ? 'bg-electric text-base-950' : 'bg-red-op text-white',
                    sidebarCollapsed && 'lg:absolute lg:top-1 lg:right-1 lg:min-w-[14px] lg:h-[14px] lg:text-[8px]',
                  )}>
                    {badge}
                  </span>
                )}
                {/* Tooltip for desktop-collapsed state only */}
                {sidebarCollapsed && (
                  <div className="absolute left-full ml-3 px-2 py-1 bg-base-700 border border-base-600 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 hidden lg:block">
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

        {/* System status — always show on mobile, hide when desktop-collapsed */}
        <div className={cn('px-3 py-3 border-t border-base-600', sidebarCollapsed && 'lg:hidden')}>
          <div className="flex items-center gap-2 mb-1.5">
            <Circle size={6} className="text-green-op fill-green-op flex-shrink-0" />
            <span className="text-[10px] text-green-op font-mono font-medium">ALL SYSTEMS OPERATIONAL</span>
          </div>
          <div className="text-[10px] text-base-500 font-mono">
            9 crons active · Last run 06:00
          </div>
        </div>

        {/* Collapse toggle — desktop only */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className={cn(
            'hidden lg:flex items-center justify-center h-10 border-t border-base-600',
            'text-base-500 hover:text-white hover:bg-base-750 transition-colors',
          )}
        >
          <ChevronLeft
            size={16}
            className={cn('transition-transform duration-300', sidebarCollapsed && 'rotate-180')}
          />
        </button>
      </aside>
    </>
  )
}
