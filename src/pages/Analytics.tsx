import { useQuery } from '@tanstack/react-query'
import { Panel, StatCard, SectionHeader, Spinner } from '@/components/ui'
import { Activity, Clock, DollarSign } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskLogRow {
  sop_id:      string
  sop_name:    string
  tool_called: string
  status:      string
  duration_ms: number | null
  created_at:  string
}

interface SopStats {
  sop_id:         string
  sop_name:       string
  model:          string
  total_calls:    number
  success_calls:  number
  avg_duration_ms: number
  success_rate:   number
  est_cost_usd:   number
}

// ─── Cost model ───────────────────────────────────────────────────────────────
// Rough per-call estimate: typical system prompt (~800 tokens) + context (~1200) + output (~600)
// Input tokens: 2000, Output tokens: 600 per call

const MODEL_PRICE: Array<{ match: string; inputPer1M: number; outputPer1M: number }> = [
  { match: 'haiku',  inputPer1M: 1.00,  outputPer1M: 5.00  },
  { match: 'sonnet', inputPer1M: 3.00,  outputPer1M: 15.00 },
  { match: 'opus',   inputPer1M: 5.00,  outputPer1M: 25.00 },
]

const AVG_INPUT_TOKENS  = 2000
const AVG_OUTPUT_TOKENS =  600

function estCostPerCall(model: string): number {
  const m = model.toLowerCase()
  const tier = MODEL_PRICE.find(p => m.includes(p.match)) ?? MODEL_PRICE[0]
  return (AVG_INPUT_TOKENS / 1_000_000) * tier.inputPer1M
       + (AVG_OUTPUT_TOKENS / 1_000_000) * tier.outputPer1M
}

// ─── Mock fallback ────────────────────────────────────────────────────────────

const MOCK_STATS: SopStats[] = [
  { sop_id:'58', sop_name:'SOP 58 — Daily Briefing',    model:'claude-sonnet-4-6',         total_calls:30, success_calls:29, avg_duration_ms:3200, success_rate:96.7, est_cost_usd:0 },
  { sop_id:'05', sop_name:'SOP 05 — Lead Sourcing',     model:'claude-sonnet-4-6',         total_calls:4,  success_calls:4,  avg_duration_ms:5100, success_rate:100,  est_cost_usd:0 },
  { sop_id:'06', sop_name:'SOP 06 — Reply Triage',      model:'claude-haiku-4-5-20251001', total_calls:62, success_calls:60, avg_duration_ms:1800, success_rate:96.8, est_cost_usd:0 },
  { sop_id:'01', sop_name:'SOP 01 — Outreach Drafts',   model:'claude-sonnet-4-6',         total_calls:18, success_calls:18, avg_duration_ms:4400, success_rate:100,  est_cost_usd:0 },
  { sop_id:'56', sop_name:'SOP 56 — Finance Dashboard', model:'claude-haiku-4-5-20251001', total_calls:4,  success_calls:4,  avg_duration_ms:2900, success_rate:100,  est_cost_usd:0 },
  { sop_id:'51', sop_name:'SOP 51 — Admin Check',       model:'claude-haiku-4-5-20251001', total_calls:4,  success_calls:3,  avg_duration_ms:2100, success_rate:75.0, est_cost_usd:0 },
  { sop_id:'07', sop_name:'SOP 07 — Call Brief',        model:'claude-sonnet-4-6',         total_calls:8,  success_calls:8,  avg_duration_ms:6200, success_rate:100,  est_cost_usd:0 },
  { sop_id:'53', sop_name:'SOP 53 — KPI Review',        model:'claude-sonnet-4-6',         total_calls:4,  success_calls:4,  avg_duration_ms:3800, success_rate:100,  est_cost_usd:0 },
].map(s => ({ ...s, est_cost_usd: estCostPerCall(s.model) * s.total_calls }))

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchTaskLogs(): Promise<SopStats[]> {
  const now        = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data, error } = await supabase
    .from('ai_task_log')
    .select('sop_id, sop_name, tool_called, status, duration_ms, created_at')
    .gte('created_at', monthStart)
    .order('created_at', { ascending: false })
    .limit(2000)

  if (error) throw new Error(error.message)

  const rows = (data ?? []) as TaskLogRow[]
  if (rows.length === 0) return []

  // Group by sop_id
  const groups: Record<string, TaskLogRow[]> = {}
  for (const row of rows) {
    const key = row.sop_id
    if (!groups[key]) groups[key] = []
    groups[key].push(row)
  }

  return Object.entries(groups).map(([sop_id, group]) => {
    const first          = group[0]
    const total_calls    = group.length
    const success_calls  = group.filter(r => r.status === 'success').length
    const durations      = group.map(r => r.duration_ms ?? 0).filter(d => d > 0)
    const avg_duration_ms = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0
    const success_rate   = Math.round((success_calls / total_calls) * 1000) / 10
    const model          = first.tool_called ?? ''
    const est_cost_usd   = estCostPerCall(model) * total_calls

    return {
      sop_id,
      sop_name:  first.sop_name,
      model,
      total_calls,
      success_calls,
      avg_duration_ms,
      success_rate,
      est_cost_usd,
    }
  }).sort((a, b) => b.total_calls - a.total_calls)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function successRateBadge(rate: number) {
  if (rate >= 95) return 'text-green-op bg-green-op/10 border-green-op/20'
  if (rate >= 80) return 'text-amber-op bg-amber-op/10 border-amber-op/20'
  return 'text-red-op bg-red-op/10 border-red-op/20'
}

function modelLabel(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('haiku'))  return 'Haiku'
  if (m.includes('sonnet')) return 'Sonnet'
  if (m.includes('opus'))   return 'Opus'
  return model.split('-').slice(1, 3).join(' ')
}

function modelColor(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('haiku'))  return 'text-purple-op border-purple-op/20 bg-purple-op/5'
  if (m.includes('sonnet')) return 'text-electric border-electric/20 bg-electric/5'
  return 'text-amber-op border-amber-op/20 bg-amber-op/5'
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}¢`
  return `$${usd.toFixed(3)}`
}

// ─── Custom tooltip for bar chart ─────────────────────────────────────────────

function DurationTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: SopStats; value: number }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-base-800 border border-base-600 rounded px-3 py-2 text-xs font-mono">
      <p className="text-white font-bold mb-1">{d.sop_name}</p>
      <p className="text-base-400">Avg duration: <span className="text-electric">{fmtDuration(d.avg_duration_ms)}</span></p>
      <p className="text-base-400">Calls: <span className="text-white">{d.total_calls}</span></p>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Analytics() {
  const { data: liveStats, isLoading, error } = useQuery({
    queryKey:        ['ai_task_log', 'analytics', 'month'],
    queryFn:         fetchTaskLogs,
    refetchInterval: 1000 * 60 * 5,
  })

  const isLive  = !error && liveStats !== undefined
  const stats   = (isLive && liveStats!.length > 0) ? liveStats! : MOCK_STATS
  const isMock  = !isLive || liveStats!.length === 0

  const now          = new Date()
  const monthLabel   = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  // ── Aggregate KPIs ─────────────────────────────────────────────────────────
  const totalCalls     = stats.reduce((s, r) => s + r.total_calls, 0)
  const totalSuccess   = stats.reduce((s, r) => s + r.success_calls, 0)
  const overallRate    = totalCalls > 0 ? Math.round((totalSuccess / totalCalls) * 1000) / 10 : 0
  const totalCostUSD   = stats.reduce((s, r) => s + r.est_cost_usd, 0)
  const avgDurationAll = stats.length > 0
    ? Math.round(stats.reduce((s, r) => s + r.avg_duration_ms, 0) / stats.length)
    : 0

  // ── Chart data: top 10 by avg duration ────────────────────────────────────
  const chartData = [...stats]
    .sort((a, b) => b.avg_duration_ms - a.avg_duration_ms)
    .slice(0, 10)
    .map(s => ({
      ...s,
      label: `SOP ${s.sop_id}`,
      seconds: Math.round(s.avg_duration_ms / 100) / 10,
    }))

  return (
    <div className="space-y-4 animate-fade-up">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Performance Analytics</h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            {isLoading ? 'Loading…' : `ai_task_log · ${monthLabel}${isMock ? ' · mock data' : ` · ${totalCalls} calls`}`}
          </p>
        </div>
        {isLoading && <Spinner size={16} />}
      </div>

      {error && (
        <Panel className="p-3 border-amber-op/30 bg-amber-op/5">
          <p className="text-xs text-amber-op font-mono">Supabase unavailable — showing mock data</p>
        </Panel>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label={`${monthLabel} API Calls`}
          value={totalCalls}
          color="electric"
          icon={<Activity size={14} />}
          sub={`${stats.length} SOPs active`}
        />
        <StatCard
          label="Overall Success Rate"
          value={`${overallRate}%`}
          color={overallRate >= 95 ? 'green' : overallRate >= 80 ? 'amber' : 'red'}
          sub={`${totalSuccess} / ${totalCalls} calls`}
        />
        <StatCard
          label="Avg Duration"
          value={fmtDuration(avgDurationAll)}
          color="purple"
          icon={<Clock size={14} />}
          sub="across all SOPs"
        />
        <StatCard
          label="Est. Monthly Cost"
          value={`$${totalCostUSD.toFixed(2)}`}
          color="amber"
          icon={<DollarSign size={14} />}
          sub="Anthropic API spend"
        />
      </div>

      {/* Horizontal bar chart — avg duration per SOP */}
      <Panel className="p-5">
        <SectionHeader title="Avg Response Duration by SOP (top 10)" />
        <div style={{ height: Math.max(220, chartData.length * 36) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 60, left: 10, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1C1C2E" horizontal={false} />
              <XAxis
                type="number"
                dataKey="seconds"
                unit="s"
                tick={{ fill: '#6B7280', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={52}
                tick={{ fill: '#9CA3AF', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<DurationTooltip />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
              <Bar dataKey="seconds" radius={[0, 3, 3, 0]} maxBarSize={18}>
                {chartData.map((entry) => (
                  <Cell
                    key={entry.sop_id}
                    fill={
                      entry.seconds > 5 ? '#FF4444'
                      : entry.seconds > 3 ? '#F5A623'
                      : '#2563EB'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-4 mt-3 text-[10px] font-mono text-base-500">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-electric inline-block" /> &lt;3s (fast)</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-amber-op inline-block" /> 3–5s (normal)</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-red-op inline-block" /> &gt;5s (slow)</span>
        </div>
      </Panel>

      {/* Per-SOP breakdown table */}
      <Panel className="overflow-hidden">
        <div className="p-4 border-b border-base-600">
          <SectionHeader title="SOP Breakdown" />
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 px-4 py-2 border-b border-base-700 text-[10px] font-mono uppercase text-base-500">
          <span>SOP</span>
          <span className="text-right w-16">Model</span>
          <span className="text-right w-12">Calls</span>
          <span className="text-right w-16">Avg Dur.</span>
          <span className="text-right w-16">Success</span>
          <span className="text-right w-16">Est. Cost</span>
        </div>

        <div className="divide-y divide-base-700/50">
          {stats.map(row => (
            <div
              key={row.sop_id}
              className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-x-4 px-4 py-3 hover:bg-base-750 transition-colors items-center"
            >
              {/* SOP name */}
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{row.sop_name}</p>
              </div>

              {/* Model badge */}
              <span className={cn(
                'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border w-16 text-center',
                modelColor(row.model),
              )}>
                {modelLabel(row.model)}
              </span>

              {/* Call count */}
              <span className="text-sm font-mono text-white text-right w-12">
                {row.total_calls}
              </span>

              {/* Avg duration */}
              <span className={cn(
                'text-sm font-mono text-right w-16',
                row.avg_duration_ms > 5000 ? 'text-red-op'
                : row.avg_duration_ms > 3000 ? 'text-amber-op'
                : 'text-green-op',
              )}>
                {fmtDuration(row.avg_duration_ms)}
              </span>

              {/* Success rate badge */}
              <span className={cn(
                'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border w-16 text-center',
                successRateBadge(row.success_rate),
              )}>
                {row.success_rate.toFixed(1)}%
              </span>

              {/* Estimated cost */}
              <span className="text-sm font-mono text-base-400 text-right w-16">
                {fmtCost(row.est_cost_usd)}
              </span>
            </div>
          ))}
        </div>

        {/* Footer: total cost */}
        <div className="px-4 py-3 border-t border-base-600 flex items-center justify-between">
          <span className="text-xs font-mono text-base-500 uppercase">
            Total estimated cost · {monthLabel}
          </span>
          <span className="text-sm font-mono font-bold text-amber-op">
            ${totalCostUSD.toFixed(3)} USD
          </span>
        </div>
      </Panel>

      {/* Cost note */}
      <p className="text-[10px] text-base-600 font-mono px-1">
        * Cost estimates assume ~2,000 input + ~600 output tokens per call. Haiku $1/$5 · Sonnet $3/$15 · Opus $5/$25 per 1M tokens. Actual spend may vary.
      </p>
    </div>
  )
}
