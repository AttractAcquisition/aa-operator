import { useState } from 'react'
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react'
import { mockAlerts } from '@/lib/mockData'
import { Panel, SeverityBadge, Button, EmptyState } from '@/components/ui'
import { formatRelative, cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { AIAlert } from '@/types'

const SevIcon = ({ severity }: { severity: AIAlert['severity'] }) => {
  if (severity === 'critical') return <AlertTriangle size={16} className="text-red-op" />
  if (severity === 'warning') return <AlertTriangle size={16} className="text-amber-op" />
  return <Info size={16} className="text-electric" />
}

export function Alerts() {
  const { addNotification } = useAppStore()
  const [alerts, setAlerts] = useState<AIAlert[]>(mockAlerts)
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('open')

  const resolve = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, resolved: true, resolved_at: new Date().toISOString() } : a))
    addNotification('Alert resolved', 'success')
  }

  const open = alerts.filter(a => !a.resolved)
  const filtered = alerts.filter(a => {
    if (filter === 'open') return !a.resolved
    if (filter === 'resolved') return a.resolved
    return true
  })

  return (
    <div className="space-y-4 animate-fade-up">
      <div>
        <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Alerts & Escalations</h2>
        <p className="text-xs text-base-500 font-mono mt-0.5">
          {open.filter(a => a.severity === 'critical').length} critical · {open.filter(a => a.severity === 'warning').length} warnings · {open.filter(a => a.severity === 'info').length} info
        </p>
      </div>

      {/* Filter */}
      <div className="flex gap-1">
        {(['open', 'all', 'resolved'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('px-3 py-1.5 rounded text-xs font-mono uppercase transition-all',
              filter === f ? 'bg-electric/15 text-electric border border-electric/25' : 'text-base-500 hover:text-white border border-transparent hover:border-base-600'
            )}>
            {f} ({f === 'open' ? open.length : f === 'resolved' ? alerts.filter(a => a.resolved).length : alerts.length})
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Panel className="p-8">
            <EmptyState icon={<CheckCircle size={32} />} title="All clear" sub="No alerts matching this filter" />
          </Panel>
        ) : (
          filtered.map(alert => (
            <Panel key={alert.id} className={cn(
              'p-4 border transition-all',
              alert.severity === 'critical' && !alert.resolved && 'border-red-op/30 bg-red-op/5',
              alert.severity === 'warning' && !alert.resolved && 'border-amber-op/20',
              alert.resolved && 'opacity-50'
            )}>
              <div className="flex items-start gap-3">
                <SevIcon severity={alert.severity} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <SeverityBadge severity={alert.severity} />
                    <span className="text-[10px] font-mono text-base-500">{alert.category}</span>
                    {alert.client_name && (
                      <span className="text-[10px] font-mono text-electric">{alert.client_name}</span>
                    )}
                    <span className="text-[10px] font-mono text-base-600 ml-auto">{formatRelative(alert.created_at)}</span>
                  </div>
                  <p className="text-sm text-white mb-2">{alert.message}</p>
                  <div className="p-2.5 rounded bg-base-750 border border-base-700">
                    <p className="text-[10px] text-base-500 font-mono uppercase mb-1">Suggested Action</p>
                    <p className="text-xs text-electric">{alert.suggested_action}</p>
                  </div>
                </div>
                {!alert.resolved && (
                  <button
                    onClick={() => resolve(alert.id)}
                    className="p-1.5 rounded text-base-500 hover:text-green-op hover:bg-green-op/10 transition-colors flex-shrink-0"
                    title="Mark resolved"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              {alert.resolved && (
                <div className="mt-2 flex items-center gap-1.5">
                  <CheckCircle size={10} className="text-green-op" />
                  <span className="text-[10px] font-mono text-green-op">Resolved {alert.resolved_at ? formatRelative(alert.resolved_at) : ''}</span>
                </div>
              )}
            </Panel>
          ))
        )}
      </div>
    </div>
  )
}
