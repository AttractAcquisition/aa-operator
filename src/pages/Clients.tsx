import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { mockClients, mockSprints } from '@/lib/mockData'
import { Panel, StatCard, Button, ProgressBar, Spinner } from '@/components/ui'
import { Users, Zap, DollarSign, ExternalLink, X, TrendingUp, Target } from 'lucide-react'
import { formatCurrency, cn, getSprintHealth, getHealthColor } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import type { Client, Sprint } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type ClientWithSprint = Client & { sprint: Sprint | null }

// ── Display maps ──────────────────────────────────────────────────────────────

const tierLabel: Record<string, string> = {
  proof_sprint:    'Proof Sprint',
  proof_brand:     'Proof Brand',
  authority_brand: 'Authority Brand',
}

const tierColor: Record<string, string> = {
  proof_sprint:    'text-electric border-electric/20 bg-electric/5',
  proof_brand:     'text-purple-op border-purple-op/20 bg-purple-op/5',
  authority_brand: 'text-amber-op border-amber-op/20 bg-amber-op/5',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Parse YYYY-MM-DD without timezone shift
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// Mock data pre-joined for fallback
const MOCK: ClientWithSprint[] = mockClients.map(c => ({
  ...c,
  sprint: c.active_sprint_id
    ? (mockSprints.find(s => s.id === c.active_sprint_id) ?? null)
    : null,
}))

// ── Data fetcher ──────────────────────────────────────────────────────────────

async function fetchClientsWithSprints(): Promise<ClientWithSprint[]> {
  const [clientsRes, sprintsRes] = await Promise.all([
    supabase.from('clients').select('*').order('start_date', { ascending: false }),
    supabase.from('sprints').select('*').eq('status', 'active'),
  ])

  if (clientsRes.error) throw new Error(clientsRes.error.message)

  const clients = (clientsRes.data ?? []) as Client[]
  const sprints = (sprintsRes.data ?? []) as Sprint[]

  // Index active sprints by client_id for O(1) lookup
  const sprintByClient = new Map(sprints.map(s => [s.client_id, s]))

  return clients.map(c => ({ ...c, sprint: sprintByClient.get(c.id) ?? null }))
}

// ── Client detail drawer ──────────────────────────────────────────────────────

function ClientDrawer({ client, onClose }: { client: ClientWithSprint; onClose: () => void }) {
  const { sprint } = client
  const health = sprint ? getSprintHealth(sprint.cpl, sprint.cpl_target) : null
  const healthLabel = health
    ? { on_track: 'ON TRACK', at_risk: 'AT RISK', off_track: 'OFF TRACK' }[health]
    : null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 animate-fade-in"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-base-900 border-l border-base-700 z-50 overflow-y-auto">
        <div className="p-5 space-y-5">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">
                {client.company}
              </h2>
              <p className="text-xs text-base-500 font-mono mt-0.5">
                {client.name} · {client.niche}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded text-base-500 hover:text-white hover:bg-base-750 transition-colors flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>

          {/* Tier + status badges */}
          <div className="flex gap-2 flex-wrap">
            <span className={cn('text-[10px] font-mono font-bold px-2 py-0.5 rounded border', tierColor[client.tier])}>
              {tierLabel[client.tier]}
            </span>
            <span className={cn(
              'text-[10px] font-mono font-bold px-2 py-0.5 rounded border',
              client.status === 'active'
                ? 'text-green-op border-green-op/20 bg-green-op/5'
                : 'text-amber-op border-amber-op/20 bg-amber-op/5',
            )}>
              {client.status.toUpperCase()}
            </span>
          </div>

          {/* Key financials */}
          <Panel className="p-4">
            <p className="text-[10px] font-mono text-base-500 uppercase mb-3">Account Details</p>
            <div className="space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-base-500 font-mono">MRR</span>
                <span className="text-base font-display font-bold text-green-op">
                  {formatCurrency(client.mrr)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-base-500 font-mono">STARTED</span>
                <span className="text-xs font-mono text-white">{fmtDate(client.start_date)}</span>
              </div>
              {client.next_review_date && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-base-500 font-mono">NEXT REVIEW</span>
                  <span className="text-xs font-mono text-white">{fmtDate(client.next_review_date)}</span>
                </div>
              )}
              {client.account_manager && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-base-500 font-mono">ACCOUNT MGR</span>
                  <span className="text-xs font-mono text-white">{client.account_manager}</span>
                </div>
              )}
            </div>
          </Panel>

          {/* Active sprint */}
          {sprint ? (
            <div>
              <p className="text-[10px] font-mono text-base-500 uppercase mb-2">Active Sprint</p>
              <Panel className="p-4 space-y-3">
                {/* Sprint header */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-white">Day {sprint.day_number}/14</span>
                  <span className={cn('text-[10px] font-mono font-bold', health ? getHealthColor(health) : '')}>
                    {healthLabel}
                  </span>
                </div>

                {/* Progress bars */}
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] text-base-500 font-mono">LEADS</span>
                      <span className="text-[10px] font-mono text-white">
                        {sprint.leads_generated}/{sprint.leads_target}
                      </span>
                    </div>
                    <ProgressBar
                      value={sprint.leads_generated}
                      max={sprint.leads_target}
                      color={health === 'on_track' ? 'green' : health === 'at_risk' ? 'amber' : 'red'}
                      showLabel
                    />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-[10px] text-base-500 font-mono">SPEND</span>
                      <span className="text-[10px] font-mono text-white">
                        {formatCurrency(sprint.spend)}/{formatCurrency(sprint.spend_budget)}
                      </span>
                    </div>
                    <ProgressBar value={sprint.spend} max={sprint.spend_budget} color="electric" showLabel />
                  </div>
                </div>

                {/* KPI tiles */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded bg-base-750 border border-base-700">
                    <p className="text-[9px] text-base-500 font-mono uppercase">CPL</p>
                    <p className={cn(
                      'text-lg font-display font-bold',
                      sprint.cpl <= sprint.cpl_target ? 'text-green-op' : 'text-red-op',
                    )}>
                      £{sprint.cpl.toFixed(2)}
                    </p>
                    <p className="text-[9px] text-base-600 font-mono">target £{sprint.cpl_target}</p>
                  </div>
                  <div className="p-2.5 rounded bg-base-750 border border-base-700">
                    <p className="text-[9px] text-base-500 font-mono uppercase">ROAS</p>
                    <p className={cn(
                      'text-lg font-display font-bold',
                      sprint.roas >= sprint.roas_target ? 'text-green-op' : 'text-red-op',
                    )}>
                      {sprint.roas.toFixed(1)}x
                    </p>
                    <p className="text-[9px] text-base-600 font-mono">target {sprint.roas_target}x</p>
                  </div>
                </div>

                <p className="text-[9px] text-base-600 font-mono">
                  {sprint.start_date} → {sprint.end_date}
                </p>
              </Panel>
            </div>
          ) : (
            <Panel className="p-4">
              <p className="text-xs text-base-500 font-mono text-center py-2">No active sprint</p>
            </Panel>
          )}

          {/* Actions */}
          <div className="flex gap-2 pb-4">
            <Button variant="secondary" size="sm" className="flex-1">
              <TrendingUp size={10} /> Generate Report
            </Button>
            <Button variant="ghost" size="sm">
              <Target size={10} /> View Sprint
            </Button>
          </div>

        </div>
      </div>
    </>
  )
}

// ── Client card ───────────────────────────────────────────────────────────────

function ClientCard({
  client,
  onOpenWorkspace,
}: {
  client: ClientWithSprint
  onOpenWorkspace: () => void
}) {
  const { sprint } = client

  return (
    <Panel className="p-4">
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
          <span className={cn(
            'text-[10px] font-mono font-bold',
            client.status === 'active' ? 'text-green-op' : 'text-amber-op',
          )}>
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
        <Button onClick={onOpenWorkspace} variant="secondary" size="sm" className="flex-1">
          <ExternalLink size={10} /> Workspace
        </Button>
        <Button variant="ghost" size="sm">
          Report
        </Button>
      </div>
    </Panel>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function Clients() {
  const [selected, setSelected] = useState<ClientWithSprint | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['clients_with_sprints'],
    queryFn:  fetchClientsWithSprints,
    refetchInterval: 1000 * 60 * 5,
  })

  const clients  = data && data.length > 0 ? data : MOCK
  const isLive   = !!data && data.length > 0

  const active       = clients.filter(c => c.status === 'active').length
  const totalMRR     = clients.reduce((a, c) => a + c.mrr, 0)
  const activeSpints = clients.filter(c => c.sprint !== null).length

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Header */}
      <div>
        <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">
          Client Workspace
        </h2>
        <p className="text-xs text-base-500 font-mono mt-0.5">
          {isLoading
            ? 'Loading…'
            : `${active} active clients · AI managing all delivery${isLive ? '' : ' · mock data'}`}
        </p>
      </div>

      {error && (
        <Panel className="p-3 border-red-op/30 bg-red-op/5">
          <p className="text-xs text-red-op font-mono">
            Failed to load clients — showing cached mock data
          </p>
        </Panel>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Active Clients"
          value={isLoading ? '—' : active}
          color="electric"
          icon={<Users size={14} />}
        />
        <StatCard
          label="Monthly MRR"
          value={isLoading ? '—' : formatCurrency(totalMRR)}
          color="green"
          icon={<DollarSign size={14} />}
          trend={{ value: 12 }}
        />
        <StatCard
          label="Sprints Active"
          value={isLoading ? '—' : activeSpints}
          color="purple"
          icon={<Zap size={14} />}
        />
      </div>

      {/* Client grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size={32} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(client => (
            <ClientCard
              key={client.id}
              client={client}
              onOpenWorkspace={() => setSelected(client)}
            />
          ))}
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <ClientDrawer client={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
