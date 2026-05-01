// ─── Clients Page ─────────────────────────────────────────────────────────────
import { mockClients, mockSprints } from '@/lib/mockData'
import { Panel, StatCard, SectionHeader, Button, ProgressBar } from '@/components/ui'
import { Users, Zap, TrendingUp, DollarSign, ExternalLink } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'
import { useAppStore } from '@/store'

const tierLabel: Record<string, string> = {
  proof_sprint: 'Proof Sprint',
  proof_brand: 'Proof Brand',
  authority_brand: 'Authority Brand',
}
const tierColor: Record<string, string> = {
  proof_sprint: 'text-electric border-electric/20 bg-electric/5',
  proof_brand: 'text-purple-op border-purple-op/20 bg-purple-op/5',
  authority_brand: 'text-amber-op border-amber-op/20 bg-amber-op/5',
}

export function Clients() {
  const { addNotification } = useAppStore()
  const totalMRR = mockClients.reduce((a, c) => a + c.mrr, 0)
  const active = mockClients.filter(c => c.status === 'active').length

  return (
    <div className="space-y-4 animate-fade-up">
      <div>
        <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Client Workspace</h2>
        <p className="text-xs text-base-500 font-mono mt-0.5">{active} active clients · AI managing all delivery</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Active Clients" value={active} color="electric" icon={<Users size={14} />} />
        <StatCard label="Monthly MRR" value={formatCurrency(totalMRR)} color="green" icon={<DollarSign size={14} />} trend={{ value: 12 }} />
        <StatCard label="Sprints Active" value={mockSprints.length} color="purple" icon={<Zap size={14} />} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {mockClients.map(client => {
          const sprint = client.active_sprint_id ? mockSprints.find(s => s.id === client.active_sprint_id) : null
          return (
            <Panel key={client.id} className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-display font-bold text-white uppercase">{client.company}</h3>
                  <p className="text-xs text-base-500 mt-0.5">{client.name} · {client.niche}</p>
                </div>
                <span className={cn('text-[10px] font-mono font-bold px-2 py-0.5 rounded border', tierColor[client.tier])}>
                  {tierLabel[client.tier]}
                </span>
              </div>

              <div className="space-y-2 mb-3">
                <div className="flex justify-between">
                  <span className="text-[10px] text-base-500 font-mono">MRR</span>
                  <span className="text-sm font-mono font-bold text-green-op">{formatCurrency(client.mrr)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] text-base-500 font-mono">STATUS</span>
                  <span className={cn('text-[10px] font-mono font-bold', client.status === 'active' ? 'text-green-op' : 'text-amber-op')}>
                    {client.status.toUpperCase()}
                  </span>
                </div>
              </div>

              {sprint && (
                <div className="p-2.5 rounded bg-base-750 border border-base-700 mb-3">
                  <div className="flex justify-between mb-1.5">
                    <span className="text-[10px] text-base-500 font-mono">SPRINT DAY {sprint.day_number}/14</span>
                    <span className="text-[10px] font-mono text-white">{sprint.leads_generated} leads</span>
                  </div>
                  <ProgressBar value={sprint.day_number} max={14} color="electric" showLabel />
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={() => addNotification(`Opening ${client.company} workspace`, 'info')} variant="secondary" size="sm" className="flex-1">
                  <ExternalLink size={10} /> Workspace
                </Button>
                <Button onClick={() => addNotification(`Generating report for ${client.company}`, 'info')} variant="ghost" size="sm">
                  Report
                </Button>
              </div>
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
