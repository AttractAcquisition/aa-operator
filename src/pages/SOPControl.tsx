import { useState } from 'react'
import { Play, Search } from 'lucide-react'
import { mockSOPs } from '@/lib/mockData'
import { Panel, TierBadge, Button, StatusDot } from '@/components/ui'
import { formatRelative, cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { AutomationTier } from '@/types'

const domains = ['All', 'Distribution', 'Delivery', 'Operations', 'Finance', 'Admin', 'Principal']

export function SOPControl() {
  const { addNotification } = useAppStore()
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState('All')
  const [tierFilter, setTierFilter] = useState<AutomationTier | 'All'>('All')
  const [running, setRunning] = useState<string | null>(null)

  const trigger = async (sop: typeof mockSOPs[0]) => {
    setRunning(sop.id)
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000))
    setRunning(null)
    addNotification(`SOP ${sop.num} — ${sop.name} completed`, 'success')
  }

  const filtered = mockSOPs.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.num.includes(search) || s.description.toLowerCase().includes(search.toLowerCase())
    const matchDomain = domainFilter === 'All' || s.domain === domainFilter
    const matchTier = tierFilter === 'All' || s.tier === tierFilter
    return matchSearch && matchDomain && matchTier
  })

  const counts = {
    AUTO: mockSOPs.filter(s => s.tier === 'AUTO').length,
    ASSISTED: mockSOPs.filter(s => s.tier === 'ASSISTED').length,
    HUMAN: mockSOPs.filter(s => s.tier === 'HUMAN').length,
  }

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">SOP Control Centre</h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">{mockSOPs.length} SOPs mapped · {mockSOPs.filter(s => s.is_active).length} active automations</p>
        </div>
      </div>

      {/* Tier summary */}
      <div className="grid grid-cols-3 gap-3">
        {(['AUTO', 'ASSISTED', 'HUMAN'] as AutomationTier[]).map(tier => {
          const colorMap = { AUTO: 'text-green-op border-green-op/20 bg-green-op/5', ASSISTED: 'text-amber-op border-amber-op/20 bg-amber-op/5', HUMAN: 'text-red-op border-red-op/20 bg-red-op/5' }
          return (
            <Panel key={tier} className={cn('p-3 border cursor-pointer transition-all', colorMap[tier], tierFilter === tier && 'ring-1 ring-current')}
              onClick={() => setTierFilter(tierFilter === tier ? 'All' : tier)}>
              <p className="text-[10px] font-mono uppercase text-current opacity-70">{tier === 'AUTO' ? '🟢 Fully Automated' : tier === 'ASSISTED' ? '🟡 AI-Assisted' : '🔴 Human-Led'}</p>
              <p className="font-display font-bold text-3xl text-current">{counts[tier]}</p>
              <p className="text-[10px] text-current opacity-50 font-mono">SOPs</p>
            </Panel>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search SOPs..."
            className="pl-7 pr-3 py-1.5 bg-base-800 border border-base-600 rounded text-sm text-white placeholder-base-600 focus:outline-none focus:border-electric/60 w-52"
          />
        </div>
        <div className="flex gap-1">
          {domains.map(d => (
            <button
              key={d}
              onClick={() => setDomainFilter(d)}
              className={cn(
                'px-2.5 py-1.5 rounded text-[10px] font-mono uppercase transition-all',
                domainFilter === d
                  ? 'bg-electric/15 text-electric border border-electric/25'
                  : 'text-base-500 hover:text-white border border-transparent hover:border-base-600'
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* SOP table */}
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-[32px_40px_1fr_80px_80px_110px_90px] gap-2 items-center px-4 py-2.5 bg-base-800 border-b border-base-600">
          {['', 'SOP#', 'Name & Description', 'Domain', 'Tier', 'Last Run', 'Action'].map(h => (
            <span key={h} className="text-[10px] font-mono text-base-500 uppercase">{h}</span>
          ))}
        </div>

        <div className="divide-y divide-base-700">
          {filtered.map(sop => {
            const isRunning = running === sop.id
            return (
              <div
                key={sop.id}
                className={cn(
                  'grid grid-cols-[32px_40px_1fr_80px_80px_110px_90px] gap-2 items-center px-4 py-3',
                  'hover:bg-base-750 transition-colors',
                  !sop.is_active && 'opacity-50'
                )}
              >
                {/* Active dot */}
                <StatusDot status={isRunning ? 'running' : sop.is_active ? 'active' : 'idle'} />

                {/* Number */}
                <span className="text-xs font-mono font-bold text-electric">{sop.num}</span>

                {/* Name */}
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate">{sop.name}</p>
                  <p className="text-[10px] text-base-500 truncate mt-0.5">{sop.description}</p>
                </div>

                {/* Domain */}
                <span className="text-[10px] text-base-500 font-mono">{sop.domain}</span>

                {/* Tier */}
                <TierBadge tier={sop.tier} />

                {/* Last run */}
                <span className="text-[10px] font-mono text-base-500">
                  {sop.last_run ? formatRelative(sop.last_run) : '—'}
                </span>

                {/* Action */}
                <Button
                  onClick={() => trigger(sop)}
                  variant="ghost"
                  size="sm"
                  disabled={isRunning || sop.tier === 'HUMAN' || !sop.is_active}
                >
                  {isRunning ? (
                    <span className="flex items-center gap-1 text-electric">
                      <div className="w-2 h-2 rounded-full border border-electric border-t-transparent animate-spin" />
                      Running
                    </span>
                  ) : sop.tier === 'HUMAN' ? (
                    <span className="text-base-600">Manual</span>
                  ) : (
                    <><Play size={10} /> Run Now</>
                  )}
                </Button>
              </div>
            )
          })}
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-base-500">No SOPs match your filter</p>
          </div>
        )}
      </Panel>
    </div>
  )
}
