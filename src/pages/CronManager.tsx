import { useState } from 'react'
import { Play, Pause, RotateCcw, Clock, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { mockCronJobs } from '@/lib/mockData'
import { Panel, SectionHeader, Button, StatusDot, TierBadge } from '@/components/ui'
import { formatDate, formatRelative, cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { CronJob } from '@/types'

export function CronManager() {
  const { addNotification } = useAppStore()
  const [jobs, setJobs] = useState<CronJob[]>(mockCronJobs)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)

  const toggle = (id: string) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, is_active: !j.is_active } : j))
    const job = jobs.find(j => j.id === id)
    addNotification(`${job?.sop_name} ${job?.is_active ? 'paused' : 'resumed'}`, job?.is_active ? 'info' : 'success')
  }

  const trigger = async (id: string) => {
    const job = jobs.find(j => j.id === id)
    setRunning(id)
    setJobs(prev => prev.map(j => j.id === id ? { ...j, last_status: 'running' } : j))
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000))
    setRunning(null)
    setJobs(prev => prev.map(j => j.id === id ? {
      ...j,
      last_status: 'success',
      last_run: new Date().toISOString(),
      run_count: j.run_count + 1,
    } : j))
    addNotification(`SOP ${job?.sop_id} — ${job?.sop_name} completed successfully`, 'success')
  }

  const active = jobs.filter(j => j.is_active).length
  const failed = jobs.filter(j => j.last_status === 'failure').length

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Cron Manager</h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            {active}/{jobs.length} active · {failed} failed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded bg-base-800 border border-base-600 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-op animate-pulse" />
            <span className="text-xs font-mono text-green-op">SCHEDULER ONLINE</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Active Jobs', value: active, color: 'text-green-op' },
          { label: 'Paused', value: jobs.length - active, color: 'text-amber-op' },
          { label: 'Failed (last run)', value: failed, color: 'text-red-op' },
          { label: 'Total Runs Today', value: jobs.reduce((a, j) => a + (j.last_status === 'success' && j.last_run && new Date(j.last_run) > new Date(Date.now() - 86400000) ? 1 : 0), 0), color: 'text-electric' },
        ].map(s => (
          <Panel key={s.label} className="p-3">
            <p className="text-[10px] text-base-500 font-mono uppercase">{s.label}</p>
            <p className={`font-display font-bold text-2xl ${s.color}`}>{s.value}</p>
          </Panel>
        ))}
      </div>

      {/* Job list */}
      <Panel className="overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-2.5 bg-base-800 border-b border-base-600">
          {['SOP', 'Name / Schedule', 'Status', 'Last Run', 'Runs', 'Actions'].map(h => (
            <span key={h} className="text-[10px] font-mono text-base-500 uppercase">{h}</span>
          ))}
        </div>

        {jobs.map(job => {
          const isExpanded = expanded === job.id
          const isRunning = running === job.id

          return (
            <div key={job.id} className="border-b border-base-700 last:border-0">
              <div
                className={cn(
                  'grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-3',
                  'hover:bg-base-750 transition-colors cursor-pointer',
                  !job.is_active && 'opacity-50',
                  job.last_status === 'failure' && 'bg-red-op/5'
                )}
                onClick={() => setExpanded(isExpanded ? null : job.id)}
              >
                {/* SOP number */}
                <span className="text-xs font-mono font-bold text-electric w-8">{job.sop_id}</span>

                {/* Name */}
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate">{job.sop_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Clock size={10} className="text-base-500" />
                    <span className="text-[10px] font-mono text-base-500">{job.schedule_label}</span>
                    <span className="text-[10px] text-base-600">·</span>
                    <span className="text-[10px] font-mono text-base-600">{job.domain}</span>
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center gap-1.5">
                  {isRunning ? (
                    <span className="flex items-center gap-1.5 text-[10px] font-mono text-electric">
                      <div className="w-1.5 h-1.5 rounded-full bg-electric animate-pulse" />
                      RUNNING
                    </span>
                  ) : job.is_active ? (
                    <span className="flex items-center gap-1.5 text-[10px] font-mono text-green-op">
                      <StatusDot status="active" />
                      ACTIVE
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[10px] font-mono text-amber-op">
                      <StatusDot status="paused" />
                      PAUSED
                    </span>
                  )}
                </div>

                {/* Last run */}
                <div className="min-w-[100px]">
                  {job.last_run ? (
                    <div className="flex items-center gap-1.5">
                      {job.last_status === 'success' && <CheckCircle size={12} className="text-green-op flex-shrink-0" />}
                      {job.last_status === 'failure' && <XCircle size={12} className="text-red-op flex-shrink-0" />}
                      {job.last_status === 'running' && <div className="w-3 h-3 rounded-full border border-electric border-t-transparent animate-spin flex-shrink-0" />}
                      <span className="text-[11px] text-base-500 font-mono">{formatRelative(job.last_run)}</span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-base-600 font-mono">Never</span>
                  )}
                </div>

                {/* Run count */}
                <span className="text-sm font-mono text-base-400 w-8 text-center">{job.run_count}</span>

                {/* Actions */}
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => trigger(job.id)}
                    disabled={isRunning}
                    className="p-1.5 rounded text-electric hover:bg-electric/10 transition-colors disabled:opacity-40"
                    title="Run now"
                  >
                    <Play size={12} />
                  </button>
                  <button
                    onClick={() => toggle(job.id)}
                    className={cn(
                      'p-1.5 rounded transition-colors',
                      job.is_active
                        ? 'text-amber-op hover:bg-amber-op/10'
                        : 'text-green-op hover:bg-green-op/10'
                    )}
                    title={job.is_active ? 'Pause' : 'Resume'}
                  >
                    {job.is_active ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  {isExpanded
                    ? <ChevronUp size={12} className="text-base-500" />
                    : <ChevronDown size={12} className="text-base-500" />
                  }
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-4 pb-4 bg-base-850/50 border-t border-base-700">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                    <div>
                      <p className="text-[10px] text-base-500 font-mono uppercase mb-1">Cron Expression</p>
                      <code className="text-xs text-electric font-mono">{job.cron_expression}</code>
                    </div>
                    <div>
                      <p className="text-[10px] text-base-500 font-mono uppercase mb-1">Next Run</p>
                      <p className="text-xs text-white font-mono">{formatRelative(job.next_run)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-base-500 font-mono uppercase mb-1">Avg Duration</p>
                      <p className="text-xs text-white font-mono">
                        {job.avg_duration_ms ? `${(job.avg_duration_ms / 1000).toFixed(1)}s` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-base-500 font-mono uppercase mb-1">Domain</p>
                      <p className="text-xs text-white">{job.domain}</p>
                    </div>
                  </div>
                  {job.last_error && (
                    <div className="mt-3 p-2.5 rounded bg-red-op/10 border border-red-op/20">
                      <p className="text-[10px] text-red-op font-mono uppercase mb-1">Last Error</p>
                      <p className="text-xs text-red-op/80">{job.last_error}</p>
                      <Button onClick={() => trigger(job.id)} variant="danger" size="sm" className="mt-2">
                        <RotateCcw size={10} /> Retry
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </Panel>

      {/* Next runs preview */}
      <Panel className="p-4">
        <SectionHeader title="Upcoming Scheduled Runs" />
        <div className="space-y-2">
          {jobs
            .filter(j => j.is_active)
            .sort((a, b) => new Date(a.next_run).getTime() - new Date(b.next_run).getTime())
            .slice(0, 5)
            .map(job => (
              <div key={job.id} className="flex items-center gap-3 py-2 border-b border-base-700 last:border-0">
                <Clock size={12} className="text-electric flex-shrink-0" />
                <span className="text-xs font-mono text-white w-28 flex-shrink-0">{formatRelative(job.next_run)}</span>
                <span className="text-xs font-mono text-electric mr-1">SOP {job.sop_id}</span>
                <span className="text-xs text-base-400 truncate">{job.sop_name}</span>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  )
}
