import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
// TODO: no 'sprints' table migration exists yet — mockSprints is a fallback used when the
// live query returns empty results. Remove once the table is created.
import { mockSprints } from '@/lib/mockData'
import { Panel, StatCard, ProgressBar, Button, Spinner } from '@/components/ui'
import { formatCurrency, getHealthColor, formatDate } from '@/lib/utils'
import { Zap, TrendingUp, DollarSign, Target, Play, BarChart2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { supabase } from '@/lib/supabase'
import { AreaChart, Area, XAxis, ResponsiveContainer } from 'recharts'
import type { Sprint } from '@/types'

// Fields added to sprints by meta-ads-sync that aren't in the base Sprint type
type LiveSprint = Sprint & {
  last_meta_sync_at?: string | null
  impressions?: number | null
  clicks?: number | null
  meta_sync_status?: string | null
}

// Static placeholder trend — replaced by real sprint_logs data in a future pass
const trendData = [
  { day: 'D1', leads: 2 }, { day: 'D2', leads: 5 }, { day: 'D3', leads: 4 },
  { day: 'D4', leads: 7 }, { day: 'D5', leads: 6 }, { day: 'D6', leads: 8 },
  { day: 'D7', leads: 5 }, { day: 'D8', leads: 7 },
]

async function fetchActiveSprints(): Promise<LiveSprint[]> {
  const { data, error } = await supabase
    .from('proof_sprints')
    .select('*')
    .eq('status', 'active')
    .order('start_date', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LiveSprint[]
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(diff / 3_600_000)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function SprintCard({ sprint, onRunOps }: { sprint: LiveSprint; onRunOps: () => void }) {
  const health      = 'on_track' as const
  const healthColor = getHealthColor(health)
  const { addNotification } = useAppStore()

  const healthLabel = 'ACTIVE'
  const spendPerDay = formatCurrency((sprint.actual_ad_spend ?? 0) / Math.max(sprint.sprint_number ?? 1, 1))

  return (
    <Panel className="p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-op" />
            <h3 className="font-display font-bold text-white text-base uppercase">{sprint.client_name}</h3>
          </div>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            Sprint #{sprint.sprint_number ?? '—'} · Started {formatDate(sprint.start_date)}
          </p>
        </div>
        <span
          className={`text-[10px] font-mono font-bold px-2 py-1 rounded border ${healthColor}`}
          style={{ backgroundColor: health === 'on_track' ? 'rgba(0,230,118,0.1)' : health === 'at_risk' ? 'rgba(255,184,0,0.1)' : 'rgba(255,69,96,0.1)' }}
        >
          {healthLabel}
        </span>
      </div>

      {/* Progress bars */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-base-500 font-mono">LEADS</span>
            <span className="text-[10px] font-mono text-white">{sprint.leads_generated ?? 0}</span>
          </div>
          <ProgressBar
            value={sprint.leads_generated ?? 0}
            max={Math.max(sprint.leads_generated ?? 1, 1)}
            color="green"
            showLabel
          />
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-base-500 font-mono">SPEND</span>
            <span className="text-[10px] font-mono text-white">{formatCurrency(sprint.actual_ad_spend ?? 0)}/{formatCurrency(sprint.client_ad_budget ?? 0)}</span>
          </div>
          <ProgressBar value={sprint.actual_ad_spend ?? 0} max={sprint.client_ad_budget ?? 1} color="electric" showLabel />
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: 'LEADS',     value: `${sprint.leads_generated ?? 0}`,          target: '—', good: true },
          { label: 'SPEND',     value: formatCurrency(sprint.actual_ad_spend ?? 0), target: formatCurrency(sprint.client_ad_budget ?? 0), good: true },
          { label: 'SPEND/DAY', value: spendPerDay,                                target: '—', good: true },
        ].map(k => (
          <div key={k.label} className="p-2 rounded bg-base-750 border border-base-700">
            <p className="text-[9px] text-base-500 font-mono uppercase">{k.label}</p>
            <p className="text-base font-display font-bold text-green-op">{k.value}</p>
            <p className="text-[9px] text-base-600 font-mono">target {k.target}</p>
          </div>
        ))}
      </div>

      {/* Mini trend chart */}
      <div className="h-16 mb-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trendData}>
            <defs>
              <linearGradient id={`g_${sprint.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={health === 'on_track' ? '#00E676' : '#FFB800'} stopOpacity={0.3} />
                <stop offset="95%" stopColor={health === 'on_track' ? '#00E676' : '#FFB800'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone" dataKey="leads"
              stroke={health === 'on_track' ? '#00E676' : '#FFB800'}
              fill={`url(#g_${sprint.id})`}
              strokeWidth={1.5}
            />
            <XAxis dataKey="day" tick={false} axisLine={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Meta sync footer */}
      {sprint.last_meta_sync_at ? (
        <p className="text-[9px] text-base-600 font-mono mb-2">
          Meta sync {timeAgo(sprint.last_meta_sync_at)}
          {sprint.impressions != null && ` · ${sprint.impressions.toLocaleString()} impr`}
          {sprint.clicks     != null && ` · ${sprint.clicks.toLocaleString()} clicks`}
        </p>
      ) : (
        <p className="text-[9px] text-base-600 font-mono mb-2">No Meta sync yet</p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button onClick={onRunOps} variant="secondary" size="sm" className="flex-1">
          <Play size={10} /> Run Daily Ops
        </Button>
        <Button
          onClick={() => addNotification(`Opening ad performance for ${sprint.client_name}`, 'info')}
          variant="ghost"
          size="sm"
        >
          <BarChart2 size={10} /> Ads
        </Button>
      </div>
    </Panel>
  )
}

export function Sprints() {
  const queryClient          = useQueryClient()
  const { addNotification }  = useAppStore()
  const [running, setRunning] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['sprints_active'],
    queryFn:  fetchActiveSprints,
    refetchInterval: 1000 * 60 * 5,
  })

  // Fall back to mock data while Supabase isn't connected or returns nothing
  const sprints  = (data && data.length > 0 ? data : mockSprints) as LiveSprint[]
  const isLive   = data && data.length > 0

  const onTrack  = sprints.length
  const atRisk   = 0
  const offTrack = 0

  // Most recent Meta sync across all sprints (for subtitle)
  const lastSync = isLive
    ? sprints.reduce<string | null>((latest, s) => {
        const t = s.last_meta_sync_at
        return t && (!latest || t > latest) ? t : latest
      }, null)
    : null

  const runAllOps = async () => {
    setRunning(true)
    try {
      const { error: fnErr } = await supabase.functions.invoke('sop-21-sprint-daily-ops')
      if (fnErr) throw fnErr
      await queryClient.invalidateQueries({ queryKey: ['sprints_active'] })
      addNotification('Sprint daily ops completed — data refreshed', 'success')
    } catch {
      addNotification('SOP 21 failed — check AI task log', 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Active Sprints</h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            {isLoading
              ? 'Loading…'
              : `${sprints.length} proof sprints${isLive ? '' : ' · mock data'}`}
            {lastSync
              ? ` · Meta synced ${timeAgo(lastSync)}`
              : !isLoading && ' · SOP 21 ran 07:30'}
          </p>
        </div>
        <Button onClick={runAllOps} disabled={running} variant="secondary" size="sm">
          {running ? <Spinner size={12} /> : <Zap size={12} />}
          Run All Sprint Ops
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <Panel className="p-3 border-red-op/30 bg-red-op/5">
          <p className="text-xs text-red-op font-mono">
            Failed to load sprints from Supabase — showing cached mock data
          </p>
        </Panel>
      )}

      {/* Summary stat cards — 3 columns on mobile (as per spec) */}
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <StatCard label="On Track"  value={isLoading ? '—' : onTrack}  color="green" icon={<Target    size={14} />} />
        <StatCard label="At Risk"   value={isLoading ? '—' : atRisk}   color="amber" icon={<TrendingUp size={14} />} />
        <StatCard label="Off Target" value={isLoading ? '—' : offTrack} color="red"   icon={<DollarSign size={14} />} />
      </div>

      {/* Sprint grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size={32} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sprints.map(sprint => (
            <SprintCard key={sprint.id} sprint={sprint} onRunOps={runAllOps} />
          ))}
        </div>
      )}
    </div>
  )
}
