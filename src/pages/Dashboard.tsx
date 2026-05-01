import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight, Users, Zap, DollarSign, CheckSquare,
  Bell, TrendingUp, Clock, Play, RefreshCw
} from 'lucide-react'
import { mockDailyBriefing } from '@/lib/mockData'
import { supabase } from '@/lib/supabase'
import { StatCard, Panel, SectionHeader, ProgressBar, Button, Spinner } from '@/components/ui'
import { formatDate, formatCurrency, getHealthColor } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { AITaskLog } from '@/types'

const urgencyDot: Record<string, string> = {
  high: 'bg-red-op',
  medium: 'bg-amber-op',
  low: 'bg-electric',
}

interface DashboardKPIs {
  newLeads: number
  warmReplies: number
  activeSprints: number
  pendingApprovals: number
  openAlerts: number
}

async function fetchKPIs(): Promise<DashboardKPIs> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString()
  const [newLeads, warmReplies, activeSprints, pendingApprovals, openAlerts] = await Promise.all([
    supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yesterday),
    supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'warm'),
    supabase
      .from('sprints')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('approval_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('ai_alerts')
      .select('*', { count: 'exact', head: true })
      .eq('resolved', false),
  ])
  return {
    newLeads: newLeads.count ?? 0,
    warmReplies: warmReplies.count ?? 0,
    activeSprints: activeSprints.count ?? 0,
    pendingApprovals: pendingApprovals.count ?? 0,
    openAlerts: openAlerts.count ?? 0,
  }
}

async function fetchRecentTaskLog(): Promise<AITaskLog[]> {
  const { data, error } = await supabase
    .from('ai_task_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw new Error(error.message)
  return (data ?? []) as AITaskLog[]
}

export function Dashboard() {
  const navigate = useNavigate()
  const { addNotification } = useAppStore()
  const [refreshing, setRefreshing] = useState(false)
  const b = mockDailyBriefing

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard_kpis'],
    queryFn: fetchKPIs,
    refetchInterval: 1000 * 60 * 5,
  })

  const { data: taskLog = [], isLoading: logLoading } = useQuery({
    queryKey: ['ai_task_log_recent'],
    queryFn: fetchRecentTaskLog,
    refetchInterval: 1000 * 60 * 2,
  })

  const runBriefing = async () => {
    setRefreshing(true)
    await new Promise(r => setTimeout(r, 2000))
    setRefreshing(false)
    addNotification('Daily briefing refreshed successfully', 'success')
  }

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Briefing header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-5 bg-electric rounded-full" />
            <h1 className="font-display font-bold text-white text-xl uppercase tracking-wide">
              Command Centre
            </h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-green-op/10 text-green-op border border-green-op/20">
              LIVE
            </span>
          </div>
          <p className="text-xs text-base-500 font-mono ml-3">
            Briefing generated {formatDate(b.generated_at)} · SOP 58
          </p>
        </div>
        <Button onClick={runBriefing} variant="secondary" size="sm" disabled={refreshing}>
          {refreshing ? <Spinner size={12} /> : <RefreshCw size={12} />}
          {refreshing ? 'Running SOP 58...' : 'Run Briefing'}
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard
          label="New Leads"
          value={kpisLoading ? '…' : kpis!.newLeads}
          sub="since yesterday"
          color="electric"
          icon={<TrendingUp size={14} />}
        />
        <StatCard
          label="Warm Replies"
          value={kpisLoading ? '…' : kpis!.warmReplies}
          sub="pending follow-up"
          color="green"
          icon={<Users size={14} />}
        />
        <StatCard
          label="Active Sprints"
          value={kpisLoading ? '…' : kpis!.activeSprints}
          sub="proof sprints live"
          color="purple"
          icon={<Zap size={14} />}
        />
        <StatCard
          label="Pending Approval"
          value={kpisLoading ? '…' : kpis!.pendingApprovals}
          sub="items queued"
          color="amber"
          icon={<CheckSquare size={14} />}
        />
        <StatCard
          label="Open Alerts"
          value={kpisLoading ? '…' : kpis!.openAlerts}
          sub="need attention"
          color="red"
          icon={<Bell size={14} />}
        />
        <StatCard
          label="MRR"
          value={formatCurrency(b.mrr)}
          sub="↑12% vs last month"
          color="green"
          icon={<DollarSign size={14} />}
          trend={{ value: 12, label: 'MoM' }}
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Priorities */}
        <div className="lg:col-span-2">
          <Panel className="p-4">
            <SectionHeader title="Today's Priorities" action={
              <span className="text-[10px] font-mono text-base-500">AI RANKED BY URGENCY</span>
            } />
            <div className="space-y-2">
              {b.priorities.map((p) => (
                <div
                  key={p.rank}
                  className="flex items-start gap-3 p-3 rounded-lg bg-base-750 border border-base-600 hover:border-base-500 transition-colors cursor-pointer group"
                >
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${urgencyDot[p.urgency]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] font-mono font-medium text-base-500 uppercase">{p.category}</span>
                    </div>
                    <p className="text-sm text-white">{p.message}</p>
                    <p className="text-xs text-electric mt-0.5">{p.action}</p>
                  </div>
                  <ArrowRight size={14} className="text-base-600 group-hover:text-electric transition-colors flex-shrink-0 mt-0.5" />
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Sprint snapshot */}
        <div>
          <Panel className="p-4">
            <SectionHeader title="Sprint Snapshot" action={
              <button onClick={() => navigate('/sprints')} className="text-[10px] text-electric hover:underline font-mono">
                VIEW ALL →
              </button>
            } />
            <div className="space-y-3">
              {b.sprint_snapshot.map((s) => (
                <div key={s.client} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white font-medium">{s.client}</span>
                    <span className={`text-xs font-mono font-bold ${getHealthColor(s.status)}`}>
                      {s.status === 'on_track' ? '● ON TRACK' : s.status === 'at_risk' ? '◐ AT RISK' : '○ OFF TRACK'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-base-500 font-mono w-10">Day {s.day}/14</span>
                    <ProgressBar
                      value={s.day}
                      max={14}
                      color={s.status === 'on_track' ? 'green' : s.status === 'at_risk' ? 'amber' : 'red'}
                    />
                  </div>
                  <p className="text-[10px] text-base-500 font-mono">{s.leads_today} leads today</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => navigate('/sprints')}
              className="mt-4 w-full py-2 rounded border border-base-600 text-xs text-base-400 hover:text-white hover:border-electric/40 transition-all font-mono"
            >
              FULL SPRINT DASHBOARD →
            </button>
          </Panel>
        </div>
      </div>

      {/* AI Activity Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel className="p-4">
          <SectionHeader title="Overnight AI Activity" action={
            <span className="text-[10px] font-mono text-base-500">LAST 10 RUNS</span>
          } />
          <div className="space-y-1">
            {logLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-base-700 last:border-0 animate-pulse">
                  <div className="w-1.5 h-1.5 rounded-full bg-base-700 flex-shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="h-2.5 bg-base-700 rounded w-3/4" />
                  </div>
                  <div className="h-2 bg-base-750 rounded w-8" />
                </div>
              ))
            ) : taskLog.length === 0 ? (
              <p className="text-xs text-base-500 font-mono py-4 text-center">No task log entries yet</p>
            ) : (
              taskLog.map((log) => (
                <div key={log.id} className="flex items-center gap-3 py-2 border-b border-base-700 last:border-0">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.status === 'success' ? 'bg-green-op' : log.status === 'running' ? 'bg-electric animate-pulse' : 'bg-red-op'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-electric">SOP {log.sop_id}</span>
                      <span className="text-xs text-white truncate">{log.output_summary}</span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-base-500 flex-shrink-0">
                    {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '—'}
                  </span>
                </div>
              ))
            )}
          </div>
        </Panel>

        {/* Quick actions */}
        <Panel className="p-4">
          <SectionHeader title="Quick Actions" />
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Run Reply Triage', sop: '06', icon: RefreshCw, color: 'text-electric' },
              { label: 'Outreach Queue', sop: '01', icon: Play, color: 'text-green-op' },
              { label: 'Sprint Check', sop: '21', icon: Zap, color: 'text-purple-op' },
              { label: 'Approval Queue', sop: '', icon: CheckSquare, color: 'text-amber-op' },
              { label: 'Finance Update', sop: '56', icon: DollarSign, color: 'text-green-op' },
              { label: 'Open Chat', sop: '', icon: Clock, color: 'text-electric' },
            ].map(({ label, sop, icon: Icon, color }) => (
              <button
                key={label}
                onClick={() => {
                  if (label === 'Open Chat') navigate('/chat')
                  else if (label === 'Approval Queue') navigate('/approvals')
                  else addNotification(`Triggered: ${label}${sop ? ` (SOP ${sop})` : ''}`, 'success')
                }}
                className="flex items-center gap-2 p-3 rounded-lg bg-base-750 border border-base-600 hover:border-electric/40 hover:bg-base-700 transition-all text-left group"
              >
                <Icon size={14} className={`${color} flex-shrink-0`} />
                <div className="min-w-0">
                  <p className="text-xs text-white font-medium leading-tight">{label}</p>
                  {sop && <p className="text-[10px] font-mono text-base-500">SOP {sop}</p>}
                </div>
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
