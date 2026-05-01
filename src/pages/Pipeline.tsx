import { mockPipelineCounts, mockConversionChart } from '@/lib/mockData'
import { Panel, SectionHeader, StatCard } from '@/components/ui'
import { TrendingUp, Users } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

const stages = [
  { key: 'new', label: 'New Leads', color: 'bg-electric' },
  { key: 'enriched', label: 'Enriched', color: 'bg-electric/80' },
  { key: 'staged', label: 'Staged', color: 'bg-electric/60' },
  { key: 'contacted', label: 'Contacted', color: 'bg-purple-op' },
  { key: 'replied', label: 'Replied', color: 'bg-purple-op/70' },
  { key: 'warm', label: 'Warm', color: 'bg-amber-op' },
  { key: 'mjr_ready', label: 'MJR Ready', color: 'bg-amber-op/80' },
  { key: 'mjr_sent', label: 'MJR Sent', color: 'bg-amber-op/60' },
  { key: 'call_booked', label: 'Call Booked', color: 'bg-green-op/80' },
  { key: 'closed', label: 'Closed ✓', color: 'bg-green-op' },
] as const

type StageKey = keyof typeof mockPipelineCounts

export function Pipeline() {
  const max = Math.max(...Object.values(mockPipelineCounts))
  const replyRate = ((mockPipelineCounts.replied / mockPipelineCounts.contacted) * 100).toFixed(1)
  const warmRate = ((mockPipelineCounts.warm / mockPipelineCounts.replied) * 100).toFixed(1)
  const closeRate = ((mockPipelineCounts.closed / mockPipelineCounts.contacted) * 100).toFixed(1)

  return (
    <div className="space-y-4 animate-fade-up">
      <div>
        <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Live Pipeline</h2>
        <p className="text-xs text-base-500 font-mono mt-0.5">Prospect-to-client conversion funnel — live data</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Reply Rate" value={`${replyRate}%`} sub="contacted → replied" color="electric" icon={<TrendingUp size={14} />} />
        <StatCard label="Warm Rate" value={`${warmRate}%`} sub="replied → warm" color="amber" icon={<Users size={14} />} />
        <StatCard label="Close Rate" value={`${closeRate}%`} sub="contacted → closed" color="green" icon={<TrendingUp size={14} />} />
      </div>

      {/* Funnel */}
      <Panel className="p-5">
        <SectionHeader title="Conversion Funnel" action={
          <span className="text-[10px] font-mono text-base-500">ALL TIME · {Object.values(mockPipelineCounts).reduce((a, b) => a + b, 0)} TOTAL</span>
        } />
        <div className="space-y-2">
          {stages.map(({ key, label, color }) => {
            const count = mockPipelineCounts[key as StageKey]
            const pct = Math.round((count / max) * 100)
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-xs text-base-500 font-mono w-28 flex-shrink-0">{label}</span>
                <div className="flex-1 h-6 bg-base-750 rounded overflow-hidden">
                  <div
                    className={`h-full rounded flex items-center pl-2 transition-all duration-700 ${color}`}
                    style={{ width: `${Math.max(pct, 4)}%` }}
                  >
                    <span className="text-[10px] font-mono font-bold text-base-950">{pct > 8 ? count : ''}</span>
                  </div>
                </div>
                <span className="text-sm font-mono font-bold text-white w-8 text-right flex-shrink-0">{count}</span>
              </div>
            )
          })}
        </div>
      </Panel>

      {/* Weekly conversion chart */}
      <Panel className="p-5">
        <SectionHeader title="Weekly Conversion Trend" />
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={mockConversionChart} barGap={2} barCategoryGap={8}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C1C2E" vertical={false} />
              <XAxis dataKey="week" tick={{ fill: '#6B7280', fontSize: 11, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6B7280', fontSize: 11, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#12121E', border: '1px solid #252540', borderRadius: 6, fontSize: 11 }}
                labelStyle={{ color: '#E2E8F0', fontFamily: 'JetBrains Mono' }}
              />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono' }} />
              <Bar dataKey="contacted" fill="#32325C" name="Contacted" radius={[2, 2, 0, 0]} />
              <Bar dataKey="replied" fill="#9B6DFF" name="Replied" radius={[2, 2, 0, 0]} />
              <Bar dataKey="warm" fill="#FFB800" name="Warm" radius={[2, 2, 0, 0]} />
              <Bar dataKey="closed" fill="#00E676" name="Closed" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  )
}
