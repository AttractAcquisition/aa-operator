import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight, Users, Zap, DollarSign, CheckSquare,
  Bell, TrendingUp, Clock, Play, RefreshCw, Shield
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { StatCard, Panel, SectionHeader, ProgressBar, Button, Spinner } from '@/components/ui'
import { cn, formatDate, formatCurrency, getHealthColor } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { AITaskLog, CronJob, DailyBriefing } from '@/types'

const EMPTY_BRIEFING: DailyBriefing = {
  generated_at: new Date(0).toISOString(),
  new_leads: 0,
  warm_replies: 0,
  active_sprints: 0,
  pending_approvals: 0,
  open_alerts: 0,
  mrr: 0,
  overdue_invoices: 0,
  priorities: [],
  sprint_snapshot: [],
}

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
      .from('proof_sprints')
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

async function fetchLatestBriefing(): Promise<DailyBriefing | null> {
  const { data, error } = await supabase
    .from('daily_briefings')
    .select('briefing')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data.briefing as DailyBriefing
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

async function fetchActiveCronJobs(): Promise<CronJob[]> {
  const { data, error } = await supabase
    .from('cron_schedule')
    .select('id, sop_id, sop_name, domain, last_run, last_status, next_run, avg_duration_ms, run_count, last_error')
    .eq('is_active', true)
    .order('next_run', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as CronJob[]
}

function jobRowStyle(job: CronJob): string {
  if (job.last_status === 'failure') return 'border-red-op/30 bg-red-op/5'
  const stale = job.last_run && (Date.now() - new Date(job.last_run).getTime() > 26 * 3_600_000)
  if (stale) return 'border-amber-op/30 bg-amber-op/5'
  return 'border-base-700'
}

function statusDotClass(status?: string): string {
  if (status === 'success') return 'bg-green-op'
  if (status === 'failure') return 'bg-red-op'
  if (status === 'running') return 'bg-electric animate-pulse'
  return 'bg-base-500'
}

export function Dashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { addNotification } = useAppStore()
  const [refreshing, setRefreshing] = useState(false)

  const { data: liveBriefing } = useQuery({
    queryKey: ['daily_briefing'],
    queryFn: fetchLatestBriefing,
    refetchInterval: 1000 * 60 * 5,
  })

  const b = liveBriefing ?? EMPTY_BRIEFING

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard_kpis'],
    queryFn: fetchKPIs,
    refetchInterval: 1000 * 60 * 5,
  })

  const { data: taskLog = [], isLoading: logLoading } = useQuery({
    queryKey: ['ai_task_log_recent'],
    queryFn: fetchRecentTaskLog,
    refetchInterval: 1000 * 60 * 5,
  })

  const { data: cronJobs = [], isLoading: cronLoading } = useQuery({
    queryKey: ['cron_schedule', 'active'],
    queryFn: fetchActiveCronJobs,
    refetchInterval: 1000 * 60 * 5,
  })

  // Realtime: immediately refresh task log when a new SOP run completes
  useEffect(() => {
    const channel = supabase
      .channel('dashboard_task_log_inserts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ai_task_log' },
        () => { queryClient.invalidateQueries({ queryKey: ['ai_task_log_recent'] }) })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [queryClient])

  const [backupRunning, setBackupRunning] = useState(false)

  const runBackupCheck = async () => {
    setBackupRunning(true)
    try {
      const { error } = await supabase.functions.invoke('sop-52-backup-check')
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: ['cron_schedule'] })
      addNotification('Backup check complete', 'success')
    } catch {
      addNotification('Backup check failed — see task log', 'error')
    } finally {
      setBackupRunning(false)
    }
  }

  const runBriefing = async () => {
    setRefreshing(true)
    try {
      const { error } = await supabase.functions.invoke('sop-58-daily-briefing')
      if (error) throw error
      await queryClient.invalidateQueries({ queryKey: ['daily_briefing'] })
      addNotification('Daily briefing refreshed successfully', 'success')
    } catch {
      addNotification('Failed to run briefing — check AI task log', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Briefing header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-5 bg-electric rounded-full flex-shrink-0" />
            <h1 className="font-display font-bold text-white text-lg md:text-xl uppercase tracking-wide truncate">
              Command Centre
            </h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-green-op/10 text-green-op border border-green-op/20 flex-shrink-0">
              LIVE
            </span>
          </div>
          <p className="text-xs text-base-500 font-mono ml-3 truncate">
            Briefing generated {formatDate(b.generated_at)} · SOP 58
            {liveBriefing ? '' : ' · (no briefing yet — click Run Briefing)'}
          </p>
        </div>
        <Button onClick={runBriefing} variant="secondary" size="sm" disabled={refreshing} className="flex-shrink-0">
          {refreshing ? <Spinner size={12} /> : <RefreshCw size={12} />}
          <span className="hidden sm:inline">{refreshing ? 'Running SOP 58...' : 'Run Briefing'}</span>
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

      {/* AI Activity Log + Quick Actions */}
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

      {/* System Health */}
      <Panel className="overflow-hidden">
        <div className="p-4 border-b border-base-600 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SectionHeader title="System Health" />
            {cronLoading && <Spinner size={12} />}
          </div>
          <Button onClick={runBackupCheck} disabled={backupRunning} variant="secondary" size="sm">
            {backupRunning ? <Spinner size={12} /> : <Shield size={12} />}
            {backupRunning ? 'Running…' : 'Run Backup Check'}
          </Button>
        </div>

        <div className="overflow-x-auto">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-6 px-4 py-2 border-b border-base-700 text-[10px] font-mono uppercase text-base-500 min-w-[520px]">
            <span>SOP / Domain</span>
            <span className="w-28 text-right">Last Run</span>
            <span className="w-16 text-center">Status</span>
            <span className="w-28 text-right">Next Run</span>
            <span className="w-16 text-right">Avg Dur.</span>
          </div>

          <div className="divide-y divide-base-700/50 min-w-[520px]">
            {cronLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 animate-pulse">
                  <div className="flex-1 h-3 bg-base-750 rounded" />
                  <div className="w-24 h-3 bg-base-750 rounded" />
                  <div className="w-6 h-3 bg-base-750 rounded" />
                  <div className="w-24 h-3 bg-base-750 rounded" />
                  <div className="w-10 h-3 bg-base-750 rounded" />
                </div>
              ))
            ) : cronJobs.length === 0 ? (
              <p className="text-xs text-base-500 font-mono py-6 text-center px-4">
                No active cron jobs found — add jobs in Cron Manager
              </p>
            ) : (
              cronJobs.map(job => (
                <div
                  key={job.id}
                  className={cn(
                    'grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-6 px-4 py-3 items-center border-l-2 hover:bg-base-750 transition-colors',
                    jobRowStyle(job),
                  )}
                >
                  {/* SOP name + domain */}
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{job.sop_name}</p>
                    <p className="text-[10px] font-mono text-base-500">{job.domain}</p>
                  </div>

                  {/* Last run */}
                  <span className="text-xs font-mono text-base-400 text-right w-28">
                    {job.last_run ? formatDate(job.last_run) : '—'}
                  </span>

                  {/* Status dot + label */}
                  <div className="flex items-center justify-center gap-1.5 w-16">
                    <span className={cn('w-2 h-2 rounded-full flex-shrink-0', statusDotClass(job.last_status))} />
                    <span className={cn(
                      'text-[10px] font-mono font-bold',
                      job.last_status === 'success' ? 'text-green-op'
                      : job.last_status === 'failure' ? 'text-red-op'
                      : job.last_status === 'running' ? 'text-electric'
                      : 'text-base-500',
                    )}>
                      {job.last_status?.toUpperCase() ?? '—'}
                    </span>
                  </div>

                  {/* Next run */}
                  <span className="text-xs font-mono text-base-400 text-right w-28">
                    {job.next_run ? formatDate(job.next_run) : '—'}
                  </span>

                  {/* Avg duration */}
                  <span className="text-xs font-mono text-base-500 text-right w-16">
                    {job.avg_duration_ms
                      ? job.avg_duration_ms < 1000
                        ? `${job.avg_duration_ms}ms`
                        : `${(job.avg_duration_ms / 1000).toFixed(1)}s`
                      : '—'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </Panel>
    </div>
  )
}
