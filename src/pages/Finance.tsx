import { mockFinance, mockRevenueChart } from '@/lib/mockData'
import { Panel, StatCard, SectionHeader, Button } from '@/components/ui'
import { DollarSign, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export function Finance() {
  const { addNotification } = useAppStore()
  const income = mockFinance.filter(f => f.type === 'income').reduce((a, f) => a + f.amount, 0)
  const expenses = mockFinance.filter(f => f.type === 'expense').reduce((a, f) => a + f.amount, 0)
  const outstanding = mockFinance.filter(f => f.invoice_status === 'pending' || f.invoice_status === 'overdue').reduce((a, f) => a + f.amount, 0)
  const overdue = mockFinance.filter(f => f.invoice_status === 'overdue').reduce((a, f) => a + f.amount, 0)

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Finance Dashboard</h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">SOP 56 · Updated Monday 07:00</p>
        </div>
        <Button onClick={() => addNotification('Running SOP 56 finance update', 'info')} variant="secondary" size="sm">
          <RefreshCw size={12} /> Run SOP 56
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="April Income" value={formatCurrency(income)} color="green" icon={<DollarSign size={14} />} trend={{ value: 12 }} />
        <StatCard label="Expenses" value={formatCurrency(expenses)} color="red" />
        <StatCard label="Net Profit" value={formatCurrency(income - expenses)} color="electric" icon={<TrendingUp size={14} />} />
        <StatCard label="Outstanding" value={formatCurrency(outstanding)} sub={overdue > 0 ? `${formatCurrency(overdue)} overdue` : 'All current'} color={overdue > 0 ? 'amber' : 'green'} icon={overdue > 0 ? <AlertTriangle size={14} /> : undefined} />
      </div>

      {/* Revenue chart */}
      <Panel className="p-5">
        <SectionHeader title="Revenue vs Target — Last 6 Months" />
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={mockRevenueChart}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00E676" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00E676" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C1C2E" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#6B7280', fontSize: 11, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6B7280', fontSize: 11, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `£${(v/1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: '#12121E', border: '1px solid #252540', borderRadius: 6, fontSize: 11 }}
                formatter={(value: number) => [formatCurrency(value)]}
              />
              <Area type="monotone" dataKey="revenue" stroke="#00E676" strokeWidth={2} fill="url(#revGrad)" name="Revenue" />
              <Area type="monotone" dataKey="target" stroke="#00D4FF" strokeWidth={1} strokeDasharray="4 2" fill="none" name="Target" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {/* Transaction ledger */}
      <Panel className="overflow-hidden">
        <div className="p-4 border-b border-base-600">
          <SectionHeader title="April Ledger" />
        </div>
        <div className="divide-y divide-base-700">
          {mockFinance.map(entry => (
            <div key={entry.id} className="flex items-center gap-4 px-4 py-3 hover:bg-base-750 transition-colors">
              <div className={cn(
                'w-1.5 h-1.5 rounded-full flex-shrink-0',
                entry.type === 'income' ? 'bg-green-op' : 'bg-red-op'
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white">{entry.client_name || entry.notes}</p>
                <p className="text-[10px] text-base-500 font-mono">{entry.category} · {formatDate(entry.date)}</p>
              </div>
              {entry.invoice_status && (
                <span className={cn(
                  'text-[10px] font-mono font-bold px-2 py-0.5 rounded border',
                  entry.invoice_status === 'paid' ? 'text-green-op border-green-op/20 bg-green-op/5' :
                  entry.invoice_status === 'overdue' ? 'text-red-op border-red-op/20 bg-red-op/5' :
                  'text-amber-op border-amber-op/20 bg-amber-op/5'
                )}>
                  {entry.invoice_status.toUpperCase()}
                </span>
              )}
              <span className={cn(
                'font-mono font-bold text-sm',
                entry.type === 'income' ? 'text-green-op' : 'text-red-op'
              )}>
                {entry.type === 'income' ? '+' : '-'}{formatCurrency(entry.amount)}
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
