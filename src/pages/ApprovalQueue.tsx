import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, Edit3, ChevronDown, ChevronUp, MessageSquare, FileText, Send } from 'lucide-react'
import { mockApprovals } from '@/lib/mockData'
import { Panel, SectionHeader, Button, EmptyState, TierBadge } from '@/components/ui'
import { formatDate, cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { ApprovalItem } from '@/types'

const typeIcon: Record<string, React.ElementType> = {
  whatsapp_message: MessageSquare,
  mjr_document: FileText,
  spoa_document: FileText,
  client_report: FileText,
  delivery_sequence: Send,
  offer_document: FileText,
  call_brief: MessageSquare,
}

const priorityColor: Record<string, string> = {
  high: 'text-red-op border-red-op/30 bg-red-op/5',
  medium: 'text-amber-op border-amber-op/30 bg-amber-op/5',
  low: 'text-base-500 border-base-600 bg-base-750',
}

function ApprovalCard({ item, onApprove, onReject }: {
  item: ApprovalItem
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(item.priority === 'high')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(item.content.body)
  const Icon = typeIcon[item.type] || FileText

  const isActioned = item.status === 'approved' || item.status === 'rejected'

  return (
    <div className={cn(
      'panel border transition-all duration-200',
      item.status === 'approved' && 'opacity-60 border-green-op/20',
      item.status === 'rejected' && 'opacity-60 border-red-op/20',
      item.status === 'pending' && priorityColor[item.priority],
    )}>
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={cn(
          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
          item.priority === 'high' ? 'bg-red-op/10' : item.priority === 'medium' ? 'bg-amber-op/10' : 'bg-base-700'
        )}>
          <Icon size={14} className={item.priority === 'high' ? 'text-red-op' : item.priority === 'medium' ? 'text-amber-op' : 'text-base-400'} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-white text-sm">{item.content.title}</span>
            <span className="text-[10px] font-mono text-electric">SOP {item.sop_id}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {item.content.recipient && (
              <span className="text-[11px] text-base-500">→ {item.content.recipient}</span>
            )}
            <span className="text-[11px] text-base-600 font-mono">{formatDate(item.created_at)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isActioned ? (
            <span className={cn(
              'px-2 py-1 rounded text-[10px] font-mono font-bold border',
              item.status === 'approved' ? 'text-green-op bg-green-op/10 border-green-op/20' : 'text-red-op bg-red-op/10 border-red-op/20'
            )}>
              {item.status.toUpperCase()}
            </span>
          ) : (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onApprove(item.id) }}
                className="p-1.5 rounded text-green-op hover:bg-green-op/10 transition-colors"
                title="Approve"
              >
                <CheckCircle size={16} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onReject(item.id) }}
                className="p-1.5 rounded text-red-op hover:bg-red-op/10 transition-colors"
                title="Reject"
              >
                <XCircle size={16} />
              </button>
            </>
          )}
          {expanded ? <ChevronUp size={14} className="text-base-500" /> : <ChevronDown size={14} className="text-base-500" />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-base-700">
          <div className="mt-3 space-y-3">
            {/* Metadata */}
            {item.content.metadata && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(item.content.metadata).map(([k, v]) => (
                  <span key={k} className="px-2 py-0.5 rounded bg-base-700 text-[10px] font-mono">
                    <span className="text-base-500">{k}: </span>
                    <span className="text-white">{v}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Content body */}
            {editing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full h-32 bg-base-750 border border-electric/30 rounded-lg p-3 text-sm text-white font-body resize-none focus:outline-none focus:border-electric/60"
              />
            ) : (
              <div className="p-3 rounded-lg bg-base-750 border border-base-700">
                <p className="text-sm text-base-300 leading-relaxed whitespace-pre-wrap">{editContent}</p>
              </div>
            )}

            {/* Actions */}
            {!isActioned && (
              <div className="flex items-center gap-2">
                <Button onClick={() => onApprove(item.id)} variant="success" size="sm">
                  <CheckCircle size={12} /> Approve & Send
                </Button>
                <Button onClick={() => setEditing(!editing)} variant="secondary" size="sm">
                  <Edit3 size={12} /> {editing ? 'Cancel Edit' : 'Edit'}
                </Button>
                {editing && (
                  <Button
                    onClick={() => { setEditing(false); onApprove(item.id) }}
                    variant="primary" size="sm"
                  >
                    Save & Approve
                  </Button>
                )}
                <Button onClick={() => onReject(item.id)} variant="danger" size="sm">
                  <XCircle size={12} /> Reject
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ApprovalQueue() {
  const { addNotification } = useAppStore()
  const [items, setItems] = useState<ApprovalItem[]>(mockApprovals)
  const [filter, setFilter] = useState<'all' | 'pending' | 'actioned'>('pending')

  const pending = items.filter(i => i.status === 'pending').length
  const actioned = items.filter(i => i.status !== 'pending').length

  const approve = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'approved' as const } : i))
    addNotification('Item approved and queued for action', 'success')
  }

  const reject = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'rejected' as const } : i))
    addNotification('Item rejected', 'info')
  }

  const approveAll = () => {
    setItems(prev => prev.map(i => i.status === 'pending' ? { ...i, status: 'approved' as const } : i))
    addNotification(`${pending} items approved`, 'success')
  }

  const filtered = items.filter(i => {
    if (filter === 'pending') return i.status === 'pending'
    if (filter === 'actioned') return i.status !== 'pending'
    return true
  })

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Approval Queue</h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            {pending} pending · {actioned} actioned
          </p>
        </div>
        {pending > 0 && (
          <Button onClick={approveAll} variant="success" size="sm">
            <CheckCircle size={12} /> Approve All ({pending})
          </Button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1">
        {(['all', 'pending', 'actioned'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-mono font-medium uppercase transition-all',
              filter === f
                ? 'bg-electric/15 text-electric border border-electric/25'
                : 'text-base-500 hover:text-white border border-transparent hover:border-base-600'
            )}
          >
            {f} {f === 'pending' ? `(${pending})` : f === 'actioned' ? `(${actioned})` : `(${items.length})`}
          </button>
        ))}
      </div>

      {/* Items */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Panel className="p-8">
            <EmptyState
              icon={<CheckCircle size={32} />}
              title="Queue clear"
              sub="No items matching this filter"
            />
          </Panel>
        ) : (
          filtered.map(item => (
            <ApprovalCard key={item.id} item={item} onApprove={approve} onReject={reject} />
          ))
        )}
      </div>
    </div>
  )
}
