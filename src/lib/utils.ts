import { clsx, type ClassValue } from 'clsx'
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns'
import type { AutomationTier, AlertSeverity, SprintStatus } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (isToday(d)) return `Today ${format(d, 'HH:mm')}`
  if (isYesterday(d)) return `Yesterday ${format(d, 'HH:mm')}`
  return format(d, 'dd MMM HH:mm')
}

export function formatRelative(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return formatDistanceToNow(d, { addSuffix: true })
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-GB').format(n)
}

export function getTierColor(tier: AutomationTier) {
  switch (tier) {
    case 'AUTO': return { text: 'text-green-op', bg: 'bg-green-op/10', border: 'border-green-op/20' }
    case 'ASSISTED': return { text: 'text-amber-op', bg: 'bg-amber-op/10', border: 'border-amber-op/20' }
    case 'HUMAN': return { text: 'text-red-op', bg: 'bg-red-op/10', border: 'border-red-op/20' }
  }
}

export function getTierLabel(tier: AutomationTier) {
  switch (tier) {
    case 'AUTO': return '🟢 AUTO'
    case 'ASSISTED': return '🟡 ASSISTED'
    case 'HUMAN': return '🔴 HUMAN'
  }
}

export function getSeverityColor(severity: AlertSeverity) {
  switch (severity) {
    case 'critical': return { text: 'text-red-op', bg: 'bg-red-op/10', border: 'border-red-op/30', dot: 'bg-red-op' }
    case 'warning': return { text: 'text-amber-op', bg: 'bg-amber-op/10', border: 'border-amber-op/30', dot: 'bg-amber-op' }
    case 'info': return { text: 'text-electric', bg: 'bg-electric/10', border: 'border-electric/30', dot: 'bg-electric' }
  }
}

export function getSprintStatusColor(status: SprintStatus) {
  switch (status) {
    case 'active': return 'text-green-op'
    case 'setup': return 'text-electric'
    case 'paused': return 'text-amber-op'
    case 'complete': return 'text-base-500'
  }
}

export function getSprintHealth(cpl: number, cplTarget: number): 'on_track' | 'at_risk' | 'off_track' {
  const ratio = cpl / cplTarget
  if (ratio <= 1.1) return 'on_track'
  if (ratio <= 1.4) return 'at_risk'
  return 'off_track'
}

export function getHealthColor(health: 'on_track' | 'at_risk' | 'off_track') {
  switch (health) {
    case 'on_track': return 'text-green-op'
    case 'at_risk': return 'text-amber-op'
    case 'off_track': return 'text-red-op'
  }
}

export function parseCronExpression(expr: string): string {
  const presets: Record<string, string> = {
    '0 6 * * *': 'Daily 06:00',
    '30 7 * * *': 'Daily 07:30',
    '0 8 * * *': 'Daily 08:00',
    '30 8 * * *': 'Daily 08:30',
    '0 9 * * 1-5': 'Weekdays 09:00',
    '0 9 * * *': 'Daily 09:00',
    '0 12 * * *': 'Daily 12:00',
    '0 17 * * 5': 'Friday 17:00',
    '30 17 * * 5': 'Friday 17:30',
    '0 18 * * 5': 'Friday 18:00',
    '0 7 * * 1': 'Monday 07:00',
    '0 9 * * 1': 'Monday 09:00',
    '0 2 * * 0': 'Sunday 02:00',
  }
  return presets[expr] || expr
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 11)
}

// Simple markdown → plain text for previews
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/#{1,6} /g, '')
    .replace(/`(.*?)`/g, '$1')
    .slice(0, 120)
}
