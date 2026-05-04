import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { mockPipelineCounts, mockConversionChart } from '@/lib/mockData'
import { Panel, SectionHeader, StatCard, Button, Spinner } from '@/components/ui'
import { TrendingUp, Users, Zap } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAppStore } from '@/store'

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

// ── Component ─────────────────────────────────────────────────────────────────

export function Pipeline() {
  const queryClient         = useQueryClient()
  const { addNotification } = useAppStore()
  const [enriching, setEnriching] = useState(false)

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
            {stages.map(({ key, label, color }) => {
              const count = counts[key]
              const pct   = max > 0 ? Math.round((count / max) * 100) : 0
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-base-500 font-mono w-28 flex-shrink-0">{label}</span>
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
                </div>
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
  )
}
