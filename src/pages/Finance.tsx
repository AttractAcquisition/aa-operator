import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Panel, StatCard, SectionHeader, Button, Spinner } from '@/components/ui'
import { DollarSign, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '@/lib/supabase'

// ─── DB row shapes ────────────────────────────────────────────────────────────

interface LedgerRow {
  id: string
  invoice_date: string
  entry_type: 'income' | 'expense'
  client_id: string | null
  client_name: string
  invoice_number: string
  amount: number
  status: string
  description: string
  notes: string | null
}

interface FinanceSummary {
  period_label: string
  mrr:         { total: number; client_count: number }
  income:      { total_paid: number }
  expenses:    { total: number }
  net_profit:  number
  outstanding: { invoice_count: number; total: number }
  overdue:     { invoice_count: number; total: number }
  forecast_90d: { base: number }
  health_score: number
}

interface SnapshotRow {
  id: string
  snapshot_date:   string
  finance_summary: FinanceSummary
}

interface ChartPoint {
  month:    string
  income:   number
  expenses: number
}

// ─── Fetch functions ──────────────────────────────────────────────────────────

async function fetchLatestSnapshot(): Promise<SnapshotRow | null> {
  const { data, error } = await supabase
    .from('finance_snapshots')
    .select('id, snapshot_date, finance_summary')
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as SnapshotRow | null
}

function currentMonthBounds() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  return { start, end }
}

async function fetchMonthLedger(): Promise<LedgerRow[]> {
  const { start, end } = currentMonthBounds()
  const { data, error } = await supabase
    .from('finance_ledger')
    .select('id, invoice_date, entry_type, client_id, client_name, invoice_number, amount, status, description, notes')
    .gte('invoice_date', start)
    .lte('invoice_date', end)
    .order('invoice_date', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as LedgerRow[]
}

async function fetchChartData(): Promise<ChartPoint[]> {
  const now         = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const startISO    = sixMonthsAgo.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('finance_ledger')
    .select('invoice_date, entry_type, amount')
    .gte('invoice_date', startISO)

  if (error) throw new Error(error.message)

  // Build ordered month buckets for the last 6 months
  const buckets: Record<string, ChartPoint> = {}
  for (let i = 5; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    buckets[key] = {
      month:    d.toLocaleDateString('en-GB', { month: 'short' }),
      income:   0,
      expenses: 0,
    }
  }

  for (const row of (data ?? []) as Pick<LedgerRow, 'invoice_date' | 'entry_type' | 'amount'>[]) {
    const key = row.invoice_date.slice(0, 7)
    if (!buckets[key]) continue
    if (row.entry_type === 'income') buckets[key].income   += row.amount
    else                             buckets[key].expenses += row.amount
  }

  return Object.values(buckets)
}

async function runSop56(): Promise<void> {
  const { error } = await supabase.functions.invoke('sop-56-finance-dashboard', { body: {} })
  if (error) throw error
}

// ─── Status badge helper ──────────────────────────────────────────────────────

function statusBadgeClass(status: string) {
  if (status === 'paid')    return 'text-green-op border-green-op/20 bg-green-op/5'
  if (status === 'overdue') return 'text-red-op border-red-op/20 bg-red-op/5'
  return 'text-amber-op border-amber-op/20 bg-amber-op/5'
}

function statusLabel(status: string): string {
  if (status === 'partial') return 'PARTIAL'
  return status.toUpperCase()
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Finance() {
  const { addNotification } = useAppStore()
  const queryClient         = useQueryClient()

  const { data: snapshot, isLoading: snapshotLoading, error: snapshotError } = useQuery({
    queryKey:       ['finance_snapshots', 'latest'],
    queryFn:        fetchLatestSnapshot,
    refetchInterval: 1000 * 60 * 5,
  })

  const { data: ledger, isLoading: ledgerLoading, error: ledgerError } = useQuery({
    queryKey:       ['finance_ledger', 'month'],
    queryFn:        fetchMonthLedger,
    refetchInterval: 1000 * 60 * 5,
  })

  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ['finance_ledger', 'chart'],
    queryFn:  fetchChartData,
    refetchInterval: 1000 * 60 * 10,
  })

  const runMutation = useMutation({
    mutationFn: runSop56,
    onSuccess: () => {
      addNotification('SOP 56 finance update complete', 'success')
      queryClient.invalidateQueries({ queryKey: ['finance_snapshots'] })
      queryClient.invalidateQueries({ queryKey: ['finance_ledger'] })
    },
    onError: (err: Error) => {
      addNotification(`SOP 56 failed: ${err.message}`, 'error')
    },
  })

  // ── KPI values: snapshot → live; no snapshot → ledger aggregation → mock ──

  const fs = snapshot?.finance_summary

  const kpiIncome      = fs?.income.total_paid
    ?? (ledger && ledger.length > 0
      ? ledger.filter(r => r.entry_type === 'income').reduce((s, r) => s + r.amount, 0)
      : 0)

  const kpiExpenses    = fs?.expenses.total
    ?? (ledger && ledger.length > 0
      ? ledger.filter(r => r.entry_type === 'expense').reduce((s, r) => s + r.amount, 0)
      : 0)

  const kpiNetProfit   = fs?.net_profit ?? (kpiIncome - kpiExpenses)

  const kpiOutstanding = fs?.outstanding.total ?? 0

  const kpiOverdue     = fs?.overdue.total ?? 0

  const periodLabel    = fs?.period_label
    ?? new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  const isLive         = !!snapshot || (ledger && ledger.length > 0)

  // Ledger rows: live data or null (empty state shown in JSX)
  const ledgerRows = ledger && ledger.length > 0 ? ledger : null

  // Chart: live data or empty
  const chartPoints  = chartData && chartData.some(p => p.income > 0 || p.expenses > 0)
    ? chartData
    : null

  const isLoading = snapshotLoading || ledgerLoading || chartLoading

  return (
    <div className="space-y-4 animate-fade-up">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Finance Dashboard</h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            {snapshotLoading
              ? 'Loading…'
              : `SOP 56 · ${snapshot ? `Snapshot ${snapshot.snapshot_date}` : 'Monday 07:00'}${isLive ? '' : ' · no data yet'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <Spinner size={14} />}
          <Button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            variant="secondary"
            size="sm"
          >
            <RefreshCw size={12} className={runMutation.isPending ? 'animate-spin' : ''} />
            {runMutation.isPending ? 'Running…' : 'Run SOP 56'}
          </Button>
        </div>
      </div>

      {(snapshotError || ledgerError) && (
        <Panel className="p-3 border-amber-op/30 bg-amber-op/5">
          <p className="text-xs text-amber-op font-mono">Supabase unavailable — finance data may be incomplete</p>
        </Panel>
      )}

      {/* KPI stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label={`${periodLabel} Income`}
          value={formatCurrency(kpiIncome)}
          color="green"
          icon={<DollarSign size={14} />}
          sub={fs ? `MRR £${fs.mrr.total.toLocaleString()} · ${fs.mrr.client_count} clients` : undefined}
        />
        <StatCard
          label="Expenses"
          value={formatCurrency(kpiExpenses)}
          color="red"
        />
        <StatCard
          label="Net Profit"
          value={formatCurrency(kpiNetProfit)}
          color="electric"
          icon={<TrendingUp size={14} />}
          sub={fs ? `${fs.net_profit >= 0 ? '' : '-'}${Math.abs(Math.round((fs.net_profit / (kpiIncome || 1)) * 100))}% margin` : undefined}
        />
        <StatCard
          label="Outstanding"
          value={formatCurrency(kpiOutstanding)}
          sub={kpiOverdue > 0 ? `${formatCurrency(kpiOverdue)} overdue` : 'All current'}
          color={kpiOverdue > 0 ? 'amber' : 'green'}
          icon={kpiOverdue > 0 ? <AlertTriangle size={14} /> : undefined}
        />
      </div>

      {/* Health score strip — only when snapshot present */}
      {fs?.health_score !== undefined && (
        <Panel className="px-5 py-3 flex items-center gap-4">
          <span className="text-[10px] font-mono text-base-500 uppercase">Financial Health</span>
          <div className="flex-1 h-1.5 rounded-full bg-base-700 overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                fs.health_score >= 8 ? 'bg-green-op' :
                fs.health_score >= 5 ? 'bg-amber-op' : 'bg-red-op',
              )}
              style={{ width: `${fs.health_score * 10}%` }}
            />
          </div>
          <span className={cn(
            'font-mono font-bold text-sm',
            fs.health_score >= 8 ? 'text-green-op' :
            fs.health_score >= 5 ? 'text-amber-op' : 'text-red-op',
          )}>
            {fs.health_score}/10
          </span>
          {fs?.forecast_90d?.base && (
            <span className="text-[10px] font-mono text-base-500">
              90d forecast: <span className="text-electric">{formatCurrency(fs.forecast_90d.base)}</span>
            </span>
          )}
        </Panel>
      )}

      {/* Revenue vs Expenses chart */}
      <Panel className="p-5">
        <SectionHeader title="Income vs Expenses — Last 6 Months" />
        <div className="h-56">
          {chartLoading ? (
            <div className="h-full flex items-center justify-center">
              <Spinner size={20} />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartPoints ?? []}>
                <defs>
                  <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#00E676" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#00E676" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#FF4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#FF4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1C1C2E" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fill: '#6B7280', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#6B7280', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={v => `£${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{ background: '#12121E', border: '1px solid #252540', borderRadius: 6, fontSize: 11 }}
                  formatter={(value: number) => [formatCurrency(value)]}
                />
                <Area type="monotone" dataKey="income"   stroke="#00E676" strokeWidth={2} fill="url(#incGrad)" name="Income" />
                <Area type="monotone" dataKey="expenses" stroke="#FF4444" strokeWidth={1} strokeDasharray="4 2" fill="url(#expGrad)" name="Expenses" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      {/* Transaction ledger */}
      <Panel className="overflow-hidden">
        <div className="p-4 border-b border-base-600 flex items-center justify-between">
          <SectionHeader title={`${periodLabel} Ledger`} />
          {ledgerLoading && <Spinner size={14} />}
        </div>
        <div className="divide-y divide-base-700">
          {ledgerLoading ? (
            <div className="px-4 py-8 flex justify-center"><Spinner size={20} /></div>
          ) : !ledgerRows ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-base-500 font-mono">No ledger entries this month</p>
              <p className="text-[10px] text-base-600 font-mono mt-1">Run SOP 56 to populate finance data</p>
            </div>
          ) : ledgerRows.map(row => (
                <div key={row.id} className="flex items-center gap-4 px-4 py-3 hover:bg-base-750 transition-colors">
                  <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', row.entry_type === 'income' ? 'bg-green-op' : 'bg-red-op')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{row.client_name || row.description || row.notes}</p>
                    <p className="text-[10px] text-base-500 font-mono">
                      {row.invoice_number} · {formatDate(row.invoice_date)}
                    </p>
                  </div>
                  {row.status && row.status !== 'cancelled' && (
                    <span className={cn('text-[10px] font-mono font-bold px-2 py-0.5 rounded border', statusBadgeClass(row.status))}>
                      {statusLabel(row.status)}
                    </span>
                  )}
                  <span className={cn('font-mono font-bold text-sm', row.entry_type === 'income' ? 'text-green-op' : 'text-red-op')}>
                    {row.entry_type === 'income' ? '+' : '-'}{formatCurrency(row.amount)}
                  </span>
                </div>
              ))
          }
        </div>
      </Panel>
    </div>
  )
}
