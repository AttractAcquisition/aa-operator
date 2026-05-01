import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import type { AutomationTier, AlertSeverity } from '@/types'

// ─── Panel ────────────────────────────────────────────────────────────────────
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('panel', className)}>
      {children}
    </div>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  trend?: { value: number; label?: string }
  color?: 'electric' | 'green' | 'amber' | 'red' | 'purple'
  icon?: ReactNode
}

export function StatCard({ label, value, sub, trend, color = 'electric', icon }: StatCardProps) {
  const colorMap = {
    electric: { text: 'text-electric', glow: 'shadow-electric', border: 'border-electric/20', bg: 'bg-electric/5' },
    green: { text: 'text-green-op', glow: 'shadow-green', border: 'border-green-op/20', bg: 'bg-green-op/5' },
    amber: { text: 'text-amber-op', glow: 'shadow-amber', border: 'border-amber-op/20', bg: 'bg-amber-op/5' },
    red: { text: 'text-red-op', glow: 'shadow-red', border: 'border-red-op/20', bg: 'bg-red-op/5' },
    purple: { text: 'text-purple-op', glow: '', border: 'border-purple-op/20', bg: 'bg-purple-op/5' },
  }
  const c = colorMap[color]

  return (
    <div className={cn('panel p-4 flex flex-col gap-1', c.bg, 'border', c.border)}>
      <div className="flex items-start justify-between">
        <span className="text-xs text-base-500 font-mono uppercase tracking-wider">{label}</span>
        {icon && <span className={cn('opacity-60', c.text)}>{icon}</span>}
      </div>
      <div className={cn('font-display font-bold text-3xl leading-none', c.text, 'text-glow-electric')}>
        {value}
      </div>
      {(sub || trend) && (
        <div className="flex items-center gap-2 mt-1">
          {sub && <span className="text-[11px] text-base-500">{sub}</span>}
          {trend && (
            <span className={cn(
              'text-[10px] font-mono font-medium px-1.5 py-0.5 rounded',
              trend.value >= 0 ? 'text-green-op bg-green-op/10' : 'text-red-op bg-red-op/10'
            )}>
              {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%{trend.label ? ` ${trend.label}` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Section Header ───────────────────────────────────────────────────────────
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-display font-bold text-white text-base uppercase tracking-wide">{title}</h2>
      {action}
    </div>
  )
}

// ─── Tier Badge ───────────────────────────────────────────────────────────────
export function TierBadge({ tier }: { tier: AutomationTier }) {
  const map = {
    AUTO: { label: '🟢 AUTO', class: 'text-green-op bg-green-op/10 border-green-op/20' },
    ASSISTED: { label: '🟡 ASSISTED', class: 'text-amber-op bg-amber-op/10 border-amber-op/20' },
    HUMAN: { label: '🔴 HUMAN', class: 'text-red-op bg-red-op/10 border-red-op/20' },
  }
  const m = map[tier]
  return (
    <span className={cn('px-2 py-0.5 rounded text-[10px] font-mono font-bold border', m.class)}>
      {m.label}
    </span>
  )
}

// ─── Alert Severity Badge ──────────────────────────────────────────────────────
export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const map = {
    critical: 'text-red-op bg-red-op/10 border-red-op/20',
    warning: 'text-amber-op bg-amber-op/10 border-amber-op/20',
    info: 'text-electric bg-electric/10 border-electric/20',
  }
  return (
    <span className={cn('px-2 py-0.5 rounded text-[10px] font-mono font-bold border uppercase', map[severity])}>
      {severity}
    </span>
  )
}

// ─── Status Dot ───────────────────────────────────────────────────────────────
export function StatusDot({ status }: { status: 'success' | 'failure' | 'running' | 'active' | 'paused' | 'idle' }) {
  const map = {
    success: 'bg-green-op',
    active: 'bg-green-op',
    running: 'bg-electric animate-pulse',
    failure: 'bg-red-op',
    paused: 'bg-amber-op',
    idle: 'bg-base-500',
  }
  return <span className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', map[status])} />
}

// ─── Button ───────────────────────────────────────────────────────────────────
interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
  type?: 'button' | 'submit'
}

export function Button({
  children, onClick, variant = 'secondary', size = 'md',
  disabled, className, type = 'button'
}: ButtonProps) {
  const base = 'inline-flex items-center gap-1.5 font-body font-medium rounded transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed'

  const sizes = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3.5 py-1.5 text-sm',
  }

  const variants = {
    primary: 'bg-electric text-base-950 hover:bg-electric/90 shadow-electric',
    secondary: 'bg-base-700 text-white border border-base-600 hover:bg-base-600 hover:border-base-500',
    ghost: 'text-base-400 hover:text-white hover:bg-base-750',
    danger: 'bg-red-op/10 text-red-op border border-red-op/30 hover:bg-red-op/20',
    success: 'bg-green-op/10 text-green-op border border-green-op/30 hover:bg-green-op/20',
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(base, sizes[size], variants[variant], className)}
    >
      {children}
    </button>
  )
}

// ─── Empty State ─────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, sub }: { icon?: ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="text-base-600 mb-3">{icon}</div>}
      <p className="text-white font-medium">{title}</p>
      {sub && <p className="text-base-500 text-sm mt-1">{sub}</p>}
    </div>
  )
}

// ─── Loading Spinner ─────────────────────────────────────────────────────────
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24" fill="none"
      className="animate-spin text-electric"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// ─── Data Row ─────────────────────────────────────────────────────────────────
export function DataRow({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-base-700 last:border-0">
      <span className="text-xs text-base-500 font-mono uppercase">{label}</span>
      <span className={cn('text-sm text-white', mono && 'font-mono')}>{value}</span>
    </div>
  )
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
export function ProgressBar({
  value, max, color = 'electric', showLabel = false
}: {
  value: number; max: number; color?: 'electric' | 'green' | 'amber' | 'red'; showLabel?: boolean
}) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  const colorMap = {
    electric: 'bg-electric',
    green: 'bg-green-op',
    amber: 'bg-amber-op',
    red: 'bg-red-op',
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-base-700 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', colorMap[color])}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && <span className="text-[10px] font-mono text-base-500 w-8 text-right">{pct}%</span>}
    </div>
  )
}
