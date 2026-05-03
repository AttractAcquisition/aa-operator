import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { mockSprints } from '@/lib/mockData'
import { Panel, StatCard, ProgressBar, Button, Spinner } from '@/components/ui'
import { formatCurrency, getHealthColor, getSprintHealth, formatDate } from '@/lib/utils'
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
    .from('sprints')
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
  const health      = getSprintHealth(sprint.cpl, sprint.cpl_target)
  const healthColor = getHealthColor(health)
  const { addNotification } = useAppStore()

  const healthLabel = health === 'on_track' ? 'ON TRACK' : health === 'at_risk' ? 'AT RISK' : 'OFF TRACK'
  const spendPerDay = formatCurrency(sprint.spend / Math.max(sprint.day_number, 1))

  return (
    <Panel className="p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${health === 'on_track' ? 'bg-green-op' : health === 'at_risk' ? 'bg-amber-op' : 'bg-red-op'}`} />
            <h3 className="font-display font-bold text-white text-base uppercase">{sprint.client_name}</h3>
          </div>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            Day {sprint.day_number}/14 · Started {formatDate(sprint.start_date)}
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
            <span className="text-[10px] font-mono text-white">{sprint.leads_generated}/{sprint.leads_target}</span>
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
            <span className="text-[10px] font-mono text-white">{formatCurrency(sprint.spend)}/{formatCurrency(sprint.spend_budget)}</span>
          </div>
          <ProgressBar value={sprint.spend} max={sprint.spend_budget} color="electric" showLabel />
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: 'CPL',       value: `£${sprint.cpl.toFixed(2)}`,  target: `£${sprint.cpl_target}`,  good: sprint.cpl <= sprint.cpl_target },
          { label: 'ROAS',      value: `${sprint.roas.toFixed(1)}x`, target: `${sprint.roas_target}x`, good: sprint.roas >= sprint.roas_target },
          { label: 'SPEND/DAY', value: spendPerDay,                  target: '—',                       good: true },
        ].map(k => (
          <div key={k.label} className="p-2 rounded bg-base-750 border border-base-700">
            <p className="text-[9px] text-base-500 font-mono uppercase">{k.label}</p>
            <p className={`text-base font-display font-bold ${k.good ? 'text-green-op' : 'text-red-op'}`}>{k.value}</p>
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

  const onTrack  = sprints.filter(s => getSprintHealth(s.cpl, s.cpl_target) === 'on_track').length
  const atRisk   = sprints.filter(s => getSprintHealth(s.cpl, s.cpl_target) === 'at_risk').length
  const offTrack = sprints.filter(s => getSprintHealth(s.cpl, s.cpl_target) === 'off_track').length

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

      {/* Summary stat cards */}
      <div className="grid grid-cols-3 gap-3">
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
