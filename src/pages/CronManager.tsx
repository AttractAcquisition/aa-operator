import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Pause, RotateCcw, Clock, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { mockCronJobs } from '@/lib/mockData'
import { Panel, SectionHeader, Button, StatusDot, Spinner } from '@/components/ui'
import { formatRelative, cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { supabase, updateCronStatus } from '@/lib/supabase'
import type { CronJob } from '@/types'

// ── SOP → Edge Function routing ───────────────────────────────────────────────
// SOPs with a dedicated function are invoked directly.
// All others fall back to run-sop with { sop_id } in the body.

const SOP_FUNCTION: Record<string, string> = {
  '01': 'sop-01-outreach-drafts',
  '03': 'sop-03-enrichment',
  '04': 'sop-04-crm-staging',
  '05': 'sop-05-lead-sourcing',
  '06': 'sop-06-reply-triage',
  '07': 'sop-07-call-brief',
  '08': 'sop-08-mjr-build',
  '21': 'sop-21-sprint-daily-ops',
  '23': 'sop-23-ads-monitoring',
  '58': 'sop-58-daily-briefing',
}

// ── Data fetcher ──────────────────────────────────────────────────────────────

async function fetchCronJobs(): Promise<CronJob[]> {
  const { data, error } = await supabase
    .from('cron_schedule')
    .select('*')
    .order('domain')
    .order('sop_id')
  if (error) throw new Error(error.message)
  return (data ?? []) as CronJob[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CronManager() {
  const queryClient         = useQueryClient()
  const { addNotification } = useAppStore()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [running, setRunning]   = useState<string | null>(null)  // job.id currently executing

  // ── Query ────────────────────────────────────────────────────────────────────

  const { data, isLoading, error: fetchError } = useQuery({
    queryKey: ['cron_jobs'],
    queryFn:  fetchCronJobs,
    refetchInterval: 1000 * 30,
  })

  const jobs   = data && data.length > 0 ? data : mockCronJobs
  const isLive = !!data && data.length > 0

  // ── Toggle mutation (optimistic) ─────────────────────────────────────────────

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      updateCronStatus(id, isActive),
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: ['cron_jobs'] })
      const previous = queryClient.getQueryData<CronJob[]>(['cron_jobs'])
      queryClient.setQueryData<CronJob[]>(['cron_jobs'], old =>
        (old ?? []).map(j => j.id === id ? { ...j, is_active: isActive } : j),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['cron_jobs'], context.previous)
      addNotification('Failed to update schedule', 'error')
    },
    onSuccess: (updated, { isActive }) => {
      queryClient.invalidateQueries({ queryKey: ['cron_jobs'] })
      addNotification(
        `${updated.sop_name} ${isActive ? 'resumed' : 'paused'}`,
        isActive ? 'success' : 'info',
      )
    },
  })

  // ── Run Now ───────────────────────────────────────────────────────────────────

  const trigger = async (job: CronJob) => {
    setRunning(job.id)

    // Optimistic: mark as running in cache
    queryClient.setQueryData<CronJob[]>(['cron_jobs'], old =>
      (old ?? []).map(j => j.id === job.id ? { ...j, last_status: 'running' as const } : j),
    )

    const fnName  = SOP_FUNCTION[job.sop_id]
    let success   = true
    let lastError: string | null = null

    try {
      const { error: fnErr } = fnName
        ? await supabase.functions.invoke(fnName)
        : await supabase.functions.invoke('run-sop', { body: { sop_id: job.sop_id } })

      if (fnErr) throw fnErr
    } catch (err) {
      success   = false
      lastError = err instanceof Error ? err.message : String(err)
    }

    // Persist run result to cron_schedule when connected to a real DB
    if (isLive) {
      await supabase
        .from('cron_schedule')
        .update({
          last_run:    new Date().toISOString(),
          last_status: success ? 'success' : 'failure',
          run_count:   job.run_count + 1,
          last_error:  success ? null : lastError,
        })
        .eq('id', job.id)
    }

    await queryClient.invalidateQueries({ queryKey: ['cron_jobs'] })
    setRunning(null)

    addNotification(
      success
        ? `SOP ${job.sop_id} — ${job.sop_name} completed`
        : `SOP ${job.sop_id} failed — check AI task log`,
      success ? 'success' : 'error',
    )
  }

  // ── Derived counts ────────────────────────────────────────────────────────────

  const activeCount = jobs.filter(j => j.is_active).length
  const failedCount = jobs.filter(j => j.last_status === 'failure').length
  const todayRuns   = jobs.reduce((n, j) =>
    n + (
      j.last_status === 'success' &&
      j.last_run &&
      new Date(j.last_run) > new Date(Date.now() - 86_400_000)
        ? 1 : 0
    ), 0)

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 animate-fade-up">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Cron Manager</h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            {isLoading
              ? 'Loading…'
              : `${activeCount}/${jobs.length} active · ${failedCount} failed${isLive ? '' : ' · mock data'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <Spinner size={14} />}
          <div className="px-3 py-1.5 rounded bg-base-800 border border-base-600 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-op animate-pulse" />
            <span className="text-xs font-mono text-green-op">SCHEDULER ONLINE</span>
          </div>
        </div>
      </div>

      {fetchError && (
        <Panel className="p-3 border-red-op/30 bg-red-op/5">
          <p className="text-xs text-red-op font-mono">
            Failed to load schedules — showing cached mock data
          </p>
        </Panel>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Active Jobs',       value: isLoading ? '—' : activeCount,              color: 'text-green-op' },
          { label: 'Paused',            value: isLoading ? '—' : jobs.length - activeCount, color: 'text-amber-op' },
          { label: 'Failed (last run)', value: isLoading ? '—' : failedCount,               color: 'text-red-op' },
          { label: 'Total Runs Today',  value: isLoading ? '—' : todayRuns,                 color: 'text-electric' },
        ].map(s => (
          <Panel key={s.label} className="p-3">
            <p className="text-[10px] text-base-500 font-mono uppercase">{s.label}</p>
            <p className={`font-display font-bold text-2xl ${s.color}`}>{s.value}</p>
          </Panel>
        ))}
      </div>

      {/* Job list */}
      <Panel className="overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-2.5 bg-base-800 border-b border-base-600">
          {['SOP', 'Name / Schedule', 'Status', 'Last Run', 'Runs', 'Actions'].map(h => (
            <span key={h} className="text-[10px] font-mono text-base-500 uppercase">{h}</span>
          ))}
        </div>

        {jobs.map(job => {
          const isExpanded = expanded === job.id
          const isRunning  = running === job.id

          return (
            <div key={job.id} className="border-b border-base-700 last:border-0">
              <div
                className={cn(
                  'grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-3',
                  'hover:bg-base-750 transition-colors cursor-pointer',
                  !job.is_active && 'opacity-50',
                  job.last_status === 'failure' && 'bg-red-op/5',
                )}
                onClick={() => setExpanded(isExpanded ? null : job.id)}
              >
                {/* SOP number */}
                <span className="text-xs font-mono font-bold text-electric w-8">{job.sop_id}</span>

                {/* Name + schedule */}
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate">{job.sop_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Clock size={10} className="text-base-500" />
                    <span className="text-[10px] font-mono text-base-500">{job.schedule_label}</span>
                    <span className="text-[10px] text-base-600">·</span>
                    <span className="text-[10px] font-mono text-base-600">{job.domain}</span>
                  </div>
                </div>

                {/* Active / paused / running */}
                <div className="flex items-center gap-1.5">
                  {isRunning ? (
                    <span className="flex items-center gap-1.5 text-[10px] font-mono text-electric">
                      <div className="w-1.5 h-1.5 rounded-full bg-electric animate-pulse" />
                      RUNNING
                    </span>
                  ) : job.is_active ? (
                    <span className="flex items-center gap-1.5 text-[10px] font-mono text-green-op">
                      <StatusDot status="active" /> ACTIVE
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-[10px] font-mono text-amber-op">
                      <StatusDot status="paused" /> PAUSED
                    </span>
                  )}
                </div>

                {/* Last run */}
                <div className="min-w-[100px]">
                  {job.last_run ? (
                    <div className="flex items-center gap-1.5">
                      {job.last_status === 'success' && (
                        <CheckCircle size={12} className="text-green-op flex-shrink-0" />
                      )}
                      {job.last_status === 'failure' && (
                        <XCircle size={12} className="text-red-op flex-shrink-0" />
                      )}
                      {job.last_status === 'running' && (
                        <div className="w-3 h-3 rounded-full border border-electric border-t-transparent animate-spin flex-shrink-0" />
                      )}
                      <span className="text-[11px] text-base-500 font-mono">
                        {formatRelative(job.last_run)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-base-600 font-mono">Never</span>
                  )}
                </div>

                {/* Run count */}
                <span className="text-sm font-mono text-base-400 w-8 text-center">{job.run_count}</span>

                {/* Actions — stop propagation so clicks don't toggle expand */}
                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => trigger(job)}
                    disabled={running !== null}
                    title={SOP_FUNCTION[job.sop_id]
                      ? `Invoke ${SOP_FUNCTION[job.sop_id]}`
                      : `Invoke run-sop (sop_id: ${job.sop_id})`}
                    className="p-1.5 rounded text-electric hover:bg-electric/10 transition-colors disabled:opacity-40"
                  >
                    {isRunning ? <Spinner size={12} /> : <Play size={12} />}
                  </button>
                  <button
                    onClick={() => toggleMutation.mutate({ id: job.id, isActive: !job.is_active })}
                    disabled={toggleMutation.isPending && toggleMutation.variables?.id === job.id}
                    title={job.is_active ? 'Pause schedule' : 'Resume schedule'}
                    className={cn(
                      'p-1.5 rounded transition-colors disabled:opacity-40',
                      job.is_active
                        ? 'text-amber-op hover:bg-amber-op/10'
                        : 'text-green-op hover:bg-green-op/10',
                    )}
                  >
                    {job.is_active ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  {isExpanded
                    ? <ChevronUp size={12} className="text-base-500" />
                    : <ChevronDown size={12} className="text-base-500" />}
                </div>
              </div>

              {/* Expanded detail row */}
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
                      <p className="text-[10px] text-base-500 font-mono uppercase mb-1">Function</p>
                      <p className="text-xs text-electric font-mono">
                        {SOP_FUNCTION[job.sop_id] ?? `run-sop (${job.sop_id})`}
                      </p>
                    </div>
                  </div>
                  {job.last_error && (
                    <div className="mt-3 p-2.5 rounded bg-red-op/10 border border-red-op/20">
                      <p className="text-[10px] text-red-op font-mono uppercase mb-1">Last Error</p>
                      <p className="text-xs text-red-op/80">{job.last_error}</p>
                      <Button
                        onClick={() => trigger(job)}
                        disabled={running !== null}
                        variant="danger"
                        size="sm"
                        className="mt-2"
                      >
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

      {/* Upcoming runs */}
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
                <span className="text-xs font-mono text-white w-28 flex-shrink-0">
                  {formatRelative(job.next_run)}
                </span>
                <span className="text-xs font-mono text-electric mr-1">SOP {job.sop_id}</span>
                <span className="text-xs text-base-400 truncate">{job.sop_name}</span>
              </div>
            ))}
        </div>
      </Panel>

    </div>
  )
}
