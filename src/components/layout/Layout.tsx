import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { X, CheckCircle, AlertTriangle, Info } from 'lucide-react'

export function Layout() {
  const { sidebarCollapsed, notifications, removeNotification } = useAppStore()

  return (
    <div className="min-h-screen bg-base-950 grid-bg">
      <Sidebar />
      <Header />

      <main
        className={cn(
          'transition-all duration-300 pt-14',
          sidebarCollapsed ? 'pl-[60px]' : 'pl-[220px]'
        )}
      >
        <div className="p-5 min-h-[calc(100vh-56px)]">
          <Outlet />
        </div>
      </main>

      {/* Toast notifications */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-lg border shadow-panel animate-fade-up pointer-events-auto',
              'bg-base-800 backdrop-blur-sm',
              n.type === 'success' && 'border-green-op/30',
              n.type === 'error' && 'border-red-op/30',
              n.type === 'info' && 'border-electric/30',
            )}
          >
            {n.type === 'success' && <CheckCircle size={14} className="text-green-op flex-shrink-0" />}
            {n.type === 'error' && <AlertTriangle size={14} className="text-red-op flex-shrink-0" />}
            {n.type === 'info' && <Info size={14} className="text-electric flex-shrink-0" />}
            <span className="text-sm text-white">{n.message}</span>
            <button
              onClick={() => removeNotification(n.id)}
              className="ml-2 text-base-500 hover:text-white transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
