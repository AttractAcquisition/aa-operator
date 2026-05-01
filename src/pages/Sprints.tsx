import { mockSprints } from '@/lib/mockData'
import { Panel, StatCard, ProgressBar, Button } from '@/components/ui'
import { formatCurrency, getHealthColor, getSprintHealth, formatDate } from '@/lib/utils'
import { Zap, TrendingUp, DollarSign, Target, Play, BarChart2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { AreaChart, Area, XAxis, ResponsiveContainer } from 'recharts'

// Mock daily trend data per sprint
const trendData = [
  { day: 'D1', leads: 2 }, { day: 'D2', leads: 5 }, { day: 'D3', leads: 4 },
  { day: 'D4', leads: 7 }, { day: 'D5', leads: 6 }, { day: 'D6', leads: 8 },
  { day: 'D7', leads: 5 }, { day: 'D8', leads: 7 },
]

function SprintCard({ sprint }: { sprint: typeof mockSprints[0] }) {
  const health = getSprintHealth(sprint.cpl, sprint.cpl_target)
  const healthColor = getHealthColor(health)
  const { addNotification } = useAppStore()

  const healthLabel = health === 'on_track' ? 'ON TRACK' : health === 'at_risk' ? 'AT RISK' : 'OFF TRACK'

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
        <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded border ${healthColor} bg-current/10`}
          style={{ backgroundColor: `${health === 'on_track' ? 'rgba(0,230,118,0.1)' : health === 'at_risk' ? 'rgba(255,184,0,0.1)' : 'rgba(255,69,96,0.1)'}` }}>
          {healthLabel}
        </span>
      </div>

      {/* Progress */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-base-500 font-mono">LEADS</span>
            <span className="text-[10px] font-mono text-white">{sprint.leads_generated}/{sprint.leads_target}</span>
          </div>
          <ProgressBar value={sprint.leads_generated} max={sprint.leads_target} color={health === 'on_track' ? 'green' : health === 'at_risk' ? 'amber' : 'red'} showLabel />
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px] text-base-500 font-mono">SPEND</span>
            <span className="text-[10px] font-mono text-white">{formatCurrency(sprint.spend)}/{formatCurrency(sprint.spend_budget)}</span>
          </div>
          <ProgressBar value={sprint.spend} max={sprint.spend_budget} color="electric" showLabel />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: 'CPL', value: `£${sprint.cpl.toFixed(2)}`, target: `£${sprint.cpl_target}`, good: sprint.cpl <= sprint.cpl_target },
          { label: 'ROAS', value: `${sprint.roas}x`, target: `${sprint.roas_target}x`, good: sprint.roas >= sprint.roas_target },
          { label: 'SPEND/DAY', value: formatCurrency(sprint.spend / sprint.day_number), target: '—', good: true },
        ].map(k => (
          <div key={k.label} className="p-2 rounded bg-base-750 border border-base-700">
            <p className="text-[9px] text-base-500 font-mono uppercase">{k.label}</p>
            <p className={`text-base font-display font-bold ${k.good ? 'text-green-op' : 'text-red-op'}`}>{k.value}</p>
            <p className="text-[9px] text-base-600 font-mono">target {k.target}</p>
          </div>
        ))}
      </div>

      {/* Mini chart */}
      <div className="h-16 mb-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trendData}>
            <defs>
              <linearGradient id={`g_${sprint.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={health === 'on_track' ? '#00E676' : '#FFB800'} stopOpacity={0.3} />
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

      {/* Actions */}
      <div className="flex gap-2">
        <Button onClick={() => addNotification(`Running SOP 21 for ${sprint.client_name}`, 'info')} variant="secondary" size="sm" className="flex-1">
          <Play size={10} /> Run Daily Ops
        </Button>
        <Button onClick={() => addNotification('Opening ad performance', 'info')} variant="ghost" size="sm">
          <BarChart2 size={10} /> Ads
        </Button>
      </div>
    </Panel>
  )
}

export function Sprints() {
  const { addNotification } = useAppStore()
  const onTrack = mockSprints.filter(s => getSprintHealth(s.cpl, s.cpl_target) === 'on_track').length
  const atRisk = mockSprints.filter(s => getSprintHealth(s.cpl, s.cpl_target) === 'at_risk').length
  const offTrack = mockSprints.filter(s => getSprintHealth(s.cpl, s.cpl_target) === 'off_track').length

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Active Sprints</h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">{mockSprints.length} proof sprints · SOP 21 ran 07:30</p>
        </div>
        <Button onClick={() => addNotification('Running SOP 21 for all active sprints', 'info')} variant="secondary" size="sm">
          <Zap size={12} /> Run All Sprint Ops
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="On Track" value={onTrack} color="green" icon={<Target size={14} />} />
        <StatCard label="At Risk" value={atRisk} color="amber" icon={<TrendingUp size={14} />} />
        <StatCard label="Off Target" value={offTrack} color="red" icon={<DollarSign size={14} />} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {mockSprints.map(sprint => (
          <SprintCard key={sprint.id} sprint={sprint} />
        ))}
      </div>
    </div>
  )
}
