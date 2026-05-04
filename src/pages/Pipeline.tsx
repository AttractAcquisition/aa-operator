import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { mockPipelineCounts, mockConversionChart } from '@/lib/mockData'
import { Panel, SectionHeader, StatCard, Button, Spinner } from '@/components/ui'
import { TrendingUp, Users, Zap, X, ArrowRight, ChevronRight } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { supabase, updateProspectStatus } from '@/lib/supabase'
import { useAppStore } from '@/store'
import { formatRelative, formatDate, cn } from '@/lib/utils'
import type { Prospect, ProspectStatus } from '@/types'

const stages = [
  { key: 'new',         label: 'New Leads',    color: 'bg-electric' },
  { key: 'enriched',    label: 'Enriched',     color: 'bg-electric/80' },
  { key: 'staged',      label: 'Staged',       color: 'bg-electric/60' },
  { key: 'contacted',   label: 'Contacted',    color: 'bg-purple-op' },
  { key: 'replied',     label: 'Replied',      color: 'bg-purple-op/70' },
  { key: 'warm',        label: 'Warm',         color: 'bg-amber-op' },
  { key: 'mjr_ready',   label: 'MJR Ready',    color: 'bg-amber-op/80' },
  { key: 'mjr_sent',    label: 'MJR Sent',     color: 'bg-amber-op/60' },
  { key: 'call_booked', label: 'Call Booked',  color: 'bg-green-op/80' },
  { key: 'closed',      label: 'Closed ✓',     color: 'bg-green-op' },
] as const

type PipelineCounts = typeof mockPipelineCounts

// Ordered next-status map for the Move Forward action
const NEXT_STATUS: Partial<Record<ProspectStatus, ProspectStatus>> = {
  new:          'enriched',
  enriched:     'staged',
  staged:       'contacted',
  contacted:    'replied',
  replied:      'warm',
  warm:         'mjr_ready',
  mjr_ready:    'mjr_sent',
  mjr_sent:     'call_booked',
  call_booked:  'closed',
}

// All statuses we count — matches mockPipelineCounts keys.
const COUNT_STATUSES = Object.keys(mockPipelineCounts) as (keyof PipelineCounts)[]

// ISO week number (1–53) from a Date.
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

// Statuses that indicate a prospect has progressed at least this far in the funnel.
const REACHED_CONTACTED = new Set(['contacted', 'replied', 'warm', 'mjr_ready', 'mjr_sent', 'spoa_ready', 'spoa_sent', 'call_booked', 'closed'])
const REACHED_REPLIED   = new Set(['replied', 'warm', 'mjr_ready', 'mjr_sent', 'spoa_ready', 'spoa_sent', 'call_booked', 'closed'])
const REACHED_WARM      = new Set(['warm', 'mjr_ready', 'mjr_sent', 'spoa_ready', 'spoa_sent', 'call_booked', 'closed'])
const REACHED_CLOSED    = new Set(['closed'])

interface WeekPoint { week: string; contacted: number; replied: number; warm: number; closed: number }

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchPipelineCounts(): Promise<PipelineCounts> {
  const results = await Promise.all(
    COUNT_STATUSES.map(status =>
      supabase
        .from('prospects')
        .select('*', { count: 'exact', head: true })
        .eq('status', status),
    ),
  )
  return Object.fromEntries(
    COUNT_STATUSES.map((key, i) => [key, results[i].count ?? 0]),
  ) as PipelineCounts
}

async function fetchWeeklyChart(): Promise<WeekPoint[]> {
  const since = new Date(Date.now() - 7 * 7 * 24 * 3600 * 1000).toISOString() // 7 weeks back

  const { data, error } = await supabase
    .from('prospects')
    .select('created_at, status')
    .gte('created_at', since)

  if (error) throw new Error(error.message)

  const byWeek: Record<number, WeekPoint> = {}

  for (const p of data ?? []) {
    const w = isoWeek(new Date(p.created_at))
    if (!byWeek[w]) byWeek[w] = { week: `W${w}`, contacted: 0, replied: 0, warm: 0, closed: 0 }
    const s = p.status as string
    // Cumulative counts: each stage includes all more-advanced stages so bars nest correctly.
    if (REACHED_CONTACTED.has(s)) byWeek[w].contacted++
    if (REACHED_REPLIED.has(s))   byWeek[w].replied++
    if (REACHED_WARM.has(s))      byWeek[w].warm++
    if (REACHED_CLOSED.has(s))    byWeek[w].closed++
  }

  return Object.values(byWeek)
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-6)
}

async function fetchProspectsAtStage(status: string): Promise<Prospect[]> {
  const { data, error } = await supabase
    .from('prospects')
    .select('id, name, company, phone, status, quality_score, created_at, last_reply_at, reply_classification, source_list, enrichment_data')
    .eq('status', status)
    .order('quality_score', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as Prospect[]
}

// ── Sub-components ────────────────────────────────────────────────────────────

function QualityBadge({ score }: { score: number }) {
  const cls = score >= 8
    ? 'text-green-op bg-green-op/10 border-green-op/20'
    : score >= 5
    ? 'text-amber-op bg-amber-op/10 border-amber-op/20'
    : 'text-red-op bg-red-op/10 border-red-op/20'
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border', cls)}>
      {score}
    </span>
  )
}

function ProspectRow({
  prospect,
  onMove,
  isMoving,
}: {
  prospect: Prospect
  onMove: (p: Prospect) => void
  isMoving: boolean
}) {
  const next = NEXT_STATUS[prospect.status]
  const lastActivity = prospect.last_reply_at ?? prospect.created_at

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-base-700 last:border-0 hover:bg-base-750/50 transition-colors">
      {/* Name / company */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white truncate">{prospect.company}</span>
          <QualityBadge score={prospect.quality_score} />
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-base-500 truncate">{prospect.name}</span>
          <span className="text-[10px] text-base-600 font-mono flex-shrink-0">
            {formatRelative(lastActivity)}
          </span>
        </div>
      </div>

      {/* Move forward */}
      {next ? (
        <button
          onClick={() => onMove(prospect)}
          disabled={isMoving}
          title={`Move to ${next}`}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-medium transition-all duration-150 bg-electric/10 text-electric border border-electric/20 hover:bg-electric/20 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          {isMoving ? <Spinner size={10} /> : <ArrowRight size={11} />}
          <span className="hidden sm:inline">{next.replace(/_/g, ' ')}</span>
        </button>
      ) : (
        <span className="text-[10px] font-mono text-base-600 flex-shrink-0">final</span>
      )}
    </div>
  )
}

function StageDrawer({
  stage,
  onClose,
  onMoved,
}: {
  stage: { key: string; label: string; color: string }
  onClose: () => void
  onMoved: () => void
}) {
  const { addNotification } = useAppStore()
  const queryClient = useQueryClient()
  const [movingId, setMovingId] = useState<string | null>(null)

  const { data: prospects = [], isLoading, isError } = useQuery({
    queryKey: ['pipeline_stage_prospects', stage.key],
    queryFn: () => fetchProspectsAtStage(stage.key),
    staleTime: 1000 * 30,
  })

  const handleMove = async (prospect: Prospect) => {
    const next = NEXT_STATUS[prospect.status]
    if (!next || movingId) return
    setMovingId(prospect.id)
    try {
      await updateProspectStatus(prospect.id, next)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pipeline_counts'] }),
        queryClient.invalidateQueries({ queryKey: ['pipeline_stage_prospects', stage.key] }),
      ])
      addNotification(`${prospect.company} → ${next.replace(/_/g, ' ')}`, 'success')
      onMoved()
    } catch (err) {
      addNotification(
        err instanceof Error ? err.message : 'Failed to update prospect',
        'error',
      )
    } finally {
      setMovingId(null)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full z-50 w-full max-w-[420px] flex flex-col bg-base-900 border-l border-base-600 shadow-2xl animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-600">
          <div>
            <h3 className="font-display font-bold text-white text-base uppercase tracking-wide">
              {stage.label}
            </h3>
            <p className="text-[11px] text-base-500 font-mono mt-0.5">
              {isLoading ? 'Loading…' : `${prospects.length} prospect${prospects.length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded text-base-500 hover:text-white hover:bg-base-750 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Next status label */}
        {NEXT_STATUS[stage.key as ProspectStatus] && (
          <div className="px-5 py-2.5 bg-base-800 border-b border-base-700 flex items-center gap-2">
            <span className="text-[11px] text-base-500 font-mono">Move Forward advances to</span>
            <span className="text-[11px] font-mono font-bold text-electric">
              {NEXT_STATUS[stage.key as ProspectStatus]!.replace(/_/g, ' ')}
            </span>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col divide-y divide-base-700">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-base-700 rounded w-3/5" />
                    <div className="h-2 bg-base-750 rounded w-2/5" />
                  </div>
                  <div className="w-20 h-7 bg-base-700 rounded" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <p className="text-white font-medium">Failed to load prospects</p>
              <p className="text-base-500 text-sm mt-1">Check your Supabase connection</p>
            </div>
          ) : prospects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <p className="text-white font-medium">No prospects at this stage</p>
              <p className="text-base-500 text-sm mt-1">They'll appear here as they move through the funnel</p>
            </div>
          ) : (
            prospects.map(p => (
              <ProspectRow
                key={p.id}
                prospect={p}
                onMove={handleMove}
                isMoving={movingId === p.id}
              />
            ))
          )}
        </div>

        {/* Footer count */}
        {prospects.length > 0 && !isLoading && (
          <div className="px-5 py-3 border-t border-base-600 bg-base-800">
            <p className="text-[10px] text-base-600 font-mono">
              Showing top {prospects.length} by quality score · last updated {formatDate(new Date().toISOString())}
            </p>
          </div>
        )}
      </div>
    </>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Pipeline() {
  const queryClient         = useQueryClient()
  const { addNotification } = useAppStore()
  const [enriching, setEnriching] = useState(false)
  const [selectedStage, setSelectedStage] = useState<typeof stages[number] | null>(null)

  const toggleStage = (stage: typeof stages[number]) =>
    setSelectedStage(prev => prev?.key === stage.key ? null : stage)

  const countsQuery = useQuery({
    queryKey: ['pipeline_counts'],
    queryFn:  fetchPipelineCounts,
    refetchInterval: 1000 * 60 * 2,
  })

  const chartQuery = useQuery({
    queryKey: ['pipeline_weekly_chart'],
    queryFn:  fetchWeeklyChart,
    refetchInterval: 1000 * 60 * 5,
  })

  const counts = countsQuery.data ?? mockPipelineCounts
  const chart  = chartQuery.data && chartQuery.data.length > 0
    ? chartQuery.data
    : mockConversionChart
  const isLive = !!countsQuery.data

  const max   = Math.max(...Object.values(counts))
  const total = COUNT_STATUSES.reduce((sum, key) => sum + counts[key], 0)

  const replyRate = counts.contacted > 0
    ? ((counts.replied / counts.contacted) * 100).toFixed(1)
    : '0.0'
  const warmRate = counts.replied > 0
    ? ((counts.warm / counts.replied) * 100).toFixed(1)
    : '0.0'
  const closeRate = counts.contacted > 0
    ? ((counts.closed / counts.contacted) * 100).toFixed(1)
    : '0.0'

  const runEnrichment = async () => {
    setEnriching(true)
    try {
      const { error: fnErr } = await supabase.functions.invoke('sop-03-enrichment')
      if (fnErr) throw fnErr
      await queryClient.invalidateQueries({ queryKey: ['pipeline_counts'] })
      addNotification('Enrichment complete — pipeline refreshed', 'success')
    } catch {
      addNotification('SOP 03 failed — check AI task log', 'error')
    } finally {
      setEnriching(false)
    }
  }

  return (
    <>
    <div className="space-y-4 animate-fade-up">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Live Pipeline</h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            {countsQuery.isLoading
              ? 'Loading…'
              : `Prospect-to-client conversion funnel${isLive ? '' : ' · mock data'}`}
          </p>
        </div>
        <Button onClick={runEnrichment} disabled={enriching} variant="secondary" size="sm">
          {enriching ? <Spinner size={12} /> : <Zap size={12} />}
          Run Enrichment
        </Button>
      </div>

      {countsQuery.error && (
        <Panel className="p-3 border-red-op/30 bg-red-op/5">
          <p className="text-xs text-red-op font-mono">
            Failed to load pipeline counts — showing cached mock data
          </p>
        </Panel>
      )}

      {/* Rate stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Reply Rate"
          value={countsQuery.isLoading ? '—' : `${replyRate}%`}
          sub="contacted → replied"
          color="electric"
          icon={<TrendingUp size={14} />}
        />
        <StatCard
          label="Warm Rate"
          value={countsQuery.isLoading ? '—' : `${warmRate}%`}
          sub="replied → warm"
          color="amber"
          icon={<Users size={14} />}
        />
        <StatCard
          label="Close Rate"
          value={countsQuery.isLoading ? '—' : `${closeRate}%`}
          sub="contacted → closed"
          color="green"
          icon={<TrendingUp size={14} />}
        />
      </div>

      {/* Funnel bars */}
      <Panel className="p-5">
        <SectionHeader
          title="Conversion Funnel"
          action={
            <span className="text-[10px] font-mono text-base-500">
              ALL TIME · {total.toLocaleString()} TOTAL
            </span>
          }
        />
        {countsQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        ) : (
          <div className="space-y-2">
            {stages.map((stage) => {
              const { key, label, color } = stage
              const count     = counts[key]
              const pct       = max > 0 ? Math.round((count / max) * 100) : 0
              const isActive  = selectedStage?.key === key
              return (
                <button
                  key={key}
                  onClick={() => toggleStage(stage)}
                  className={cn(
                    'w-full flex items-center gap-3 rounded px-1 py-0.5 transition-all duration-150 group',
                    isActive
                      ? 'bg-electric/5 ring-1 ring-electric/20'
                      : 'hover:bg-base-750/40',
                  )}
                >
                  <span className={cn(
                    'text-xs font-mono w-28 flex-shrink-0 text-left transition-colors',
                    isActive ? 'text-electric' : 'text-base-500 group-hover:text-base-300',
                  )}>
                    {label}
                  </span>
                  <div className="flex-1 h-6 bg-base-750 rounded overflow-hidden">
                    <div
                      className={`h-full rounded flex items-center pl-2 transition-all duration-700 ${color}`}
                      style={{ width: `${Math.max(pct, 4)}%` }}
                    >
                      <span className="text-[10px] font-mono font-bold text-base-950">
                        {pct > 8 ? count : ''}
                      </span>
                    </div>
                  </div>
                  <span className="text-sm font-mono font-bold text-white w-8 text-right flex-shrink-0">
                    {count}
                  </span>
                  <ChevronRight
                    size={13}
                    className={cn(
                      'flex-shrink-0 transition-all duration-150',
                      isActive ? 'text-electric rotate-90' : 'text-base-700 group-hover:text-base-500',
                    )}
                  />
                </button>
              )
            })}
          </div>
        )}
      </Panel>

      {/* Weekly conversion chart */}
      <Panel className="p-5">
        <SectionHeader title="Weekly Conversion Trend" />
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} barGap={2} barCategoryGap={8}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C1C2E" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fill: '#6B7280', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#6B7280', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: '#12121E', border: '1px solid #252540', borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: '#E2E8F0', fontFamily: 'JetBrains Mono' }}
              />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono' }} />
              <Bar dataKey="contacted" fill="#32325C" name="Contacted" radius={[2, 2, 0, 0]} />
              <Bar dataKey="replied"   fill="#9B6DFF" name="Replied"   radius={[2, 2, 0, 0]} />
              <Bar dataKey="warm"      fill="#FFB800" name="Warm"      radius={[2, 2, 0, 0]} />
              <Bar dataKey="closed"    fill="#00E676" name="Closed"    radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>

    {/* Stage detail drawer */}
    {selectedStage && (
      <StageDrawer
        stage={selectedStage}
        onClose={() => setSelectedStage(null)}
        onMoved={() => {
          queryClient.invalidateQueries({ queryKey: ['pipeline_counts'] })
        }}
      />
    )}
    </>
  )
}
