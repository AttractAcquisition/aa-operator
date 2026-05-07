import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, Edit2, Eye, X, Check, Search, Tag,
} from 'lucide-react'
import { Panel, Button, EmptyState, Spinner } from '@/components/ui'
import { formatDate, cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { supabase } from '@/lib/supabase'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface KBEntry {
  id:         string
  created_at: string
  updated_at: string
  type:       'sop' | 'template' | 'script' | 'reference' | 'client_context'
  title:      string
  content:    string
  metadata:   Record<string, unknown>
  tags:       string[]
  is_active:  boolean
}

// ─── Config ────────────────────────────────────────────────────────────────────

const TYPE_ORDER: KBEntry['type'][] = ['sop', 'template', 'reference', 'script', 'client_context']

const TYPE_CONFIG: Record<KBEntry['type'], { label: string; color: keyof typeof COLOR_CLASSES }> = {
  sop:            { label: 'SOP',            color: 'electric' },
  template:       { label: 'Template',       color: 'purple'   },
  reference:      { label: 'Reference',      color: 'green'    },
  script:         { label: 'Script',         color: 'amber'    },
  client_context: { label: 'Client Context', color: 'red'      },
}

const COLOR_CLASSES = {
  electric: {
    badge:   'bg-electric/10 text-electric border border-electric/25',
    section: 'text-electric',
    border:  'border-electric/20',
  },
  purple: {
    badge:   'bg-purple-op/10 text-purple-op border border-purple-op/25',
    section: 'text-purple-op',
    border:  'border-purple-op/20',
  },
  green: {
    badge:   'bg-green-op/10 text-green-op border border-green-op/25',
    section: 'text-green-op',
    border:  'border-green-op/20',
  },
  amber: {
    badge:   'bg-amber-op/10 text-amber-op border border-amber-op/25',
    section: 'text-amber-op',
    border:  'border-amber-op/20',
  },
  red: {
    badge:   'bg-red-op/10 text-red-op border border-red-op/25',
    section: 'text-red-op',
    border:  'border-red-op/20',
  },
}

const FILTER_LABELS: Record<KBEntry['type'] | 'all', string> = {
  all:            'All',
  sop:            'SOPs',
  template:       'Templates',
  reference:      'Reference',
  script:         'Scripts',
  client_context: 'Client Context',
}

// ─── Data ──────────────────────────────────────────────────────────────────────

async function fetchKB(): Promise<KBEntry[]> {
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('*')
    .eq('is_active', true)
    .order('type')
    .order('title')
  if (error) throw new Error(error.message)
  return (data ?? []) as KBEntry[]
}

async function updateContent({ id, content }: { id: string; content: string }): Promise<void> {
  const { error } = await supabase
    .from('knowledge_base')
    .update({ content })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: KBEntry['type'] }) {
  const cfg = TYPE_CONFIG[type]
  const cls = COLOR_CLASSES[cfg.color]
  return (
    <span className={cn('px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase', cls.badge)}>
      {cfg.label}
    </span>
  )
}

function TagPill({ tag }: { tag: string }) {
  return (
    <span className="px-1.5 py-0.5 rounded bg-base-700 text-base-400 text-[10px] font-mono border border-base-600">
      {tag}
    </span>
  )
}

// ─── Preview modal ─────────────────────────────────────────────────────────────

function PreviewModal({ entry, onClose }: { entry: KBEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-base-950/80 backdrop-blur-sm">
      <div className="flex flex-col w-full max-w-4xl h-[80vh] bg-base-900 border border-base-600 rounded-lg shadow-panel overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-base-600 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Eye size={14} className="text-purple-op flex-shrink-0" />
            <span className="font-display font-bold text-white text-sm truncate">{entry.title}</span>
            <TypeBadge type={entry.type} />
          </div>
          <button
            onClick={onClose}
            className="text-base-500 hover:text-white transition-colors flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>
        {/* iframe */}
        <iframe
          srcDoc={entry.content}
          sandbox="allow-same-origin"
          title={`Preview: ${entry.title}`}
          className="flex-1 w-full bg-white"
        />
      </div>
    </div>
  )
}

// ─── Entry card ────────────────────────────────────────────────────────────────

interface EntryCardProps {
  entry:       KBEntry
  isEditing:   boolean
  onEditStart: () => void
  onEditCancel: () => void
  onPreview:   () => void
}

function EntryCard({ entry, isEditing, onEditStart, onEditCancel, onPreview }: EntryCardProps) {
  const queryClient         = useQueryClient()
  const { addNotification } = useAppStore()
  const [draft, setDraft]   = useState(entry.content)
  const cfg = TYPE_CONFIG[entry.type]
  const cls = COLOR_CLASSES[cfg.color]

  const saveMutation = useMutation({
    mutationFn: updateContent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge_base'] })
      addNotification('Entry updated', 'success')
      onEditCancel()
    },
    onError: (err: Error) => {
      addNotification(`Save failed: ${err.message}`, 'error')
    },
  })

  const handleEditStart = () => {
    setDraft(entry.content)
    onEditStart()
  }

  const isTemplate = entry.type === 'template'

  return (
    <Panel className={cn('p-4 border', cls.border)}>
      {/* ── Top row: badge + title + actions ── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <TypeBadge type={entry.type} />
          <div className="min-w-0">
            <p className="text-white font-medium text-sm leading-tight">{entry.title}</p>
            {entry.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                <Tag size={10} className="text-base-500 flex-shrink-0" />
                {entry.tags.map(tag => <TagPill key={tag} tag={tag} />)}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isTemplate && (
            <Button size="sm" variant="ghost" onClick={onPreview}>
              <Eye size={12} />
              Preview
            </Button>
          )}
          {!isEditing && (
            <Button size="sm" variant="ghost" onClick={handleEditStart}>
              <Edit2 size={12} />
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* ── Content display (non-editing, non-template) ── */}
      {!isEditing && !isTemplate && (
        <div className="mt-3 p-3 bg-base-900 rounded border border-base-700 overflow-auto max-h-48">
          <pre className="text-xs text-base-300 font-mono whitespace-pre-wrap leading-relaxed">
            {entry.content}
          </pre>
        </div>
      )}

      {/* ── Template content hint ── */}
      {!isEditing && isTemplate && (
        <p className="mt-2 text-xs text-base-500 font-mono">
          HTML template · {entry.content.length.toLocaleString()} chars
          {entry.metadata?.subject ? ` · Subject: ${String(entry.metadata.subject)}` : ''}
        </p>
      )}

      {/* ── Edit textarea ── */}
      {isEditing && (
        <div className="mt-3 space-y-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={12}
            className={cn(
              'w-full bg-base-900 border border-base-600 rounded px-3 py-2',
              'text-xs text-white font-mono resize-y',
              'focus:outline-none focus:border-electric/50 transition-colors',
            )}
            spellCheck={false}
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="success"
              disabled={saveMutation.isPending || draft === entry.content}
              onClick={() => saveMutation.mutate({ id: entry.id, content: draft })}
            >
              {saveMutation.isPending ? <Spinner size={12} /> : <Check size={12} />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={onEditCancel} disabled={saveMutation.isPending}>
              <X size={12} />
              Cancel
            </Button>
            <span className="ml-auto text-[10px] text-base-500 font-mono">
              {draft.length.toLocaleString()} chars
            </span>
          </div>
        </div>
      )}

      {/* ── Footer: updated timestamp ── */}
      <p className="mt-2 text-[10px] text-base-600 font-mono">
        Updated {formatDate(entry.updated_at)}
      </p>
    </Panel>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export function KnowledgeBase() {
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [previewId,  setPreviewId]  = useState<string | null>(null)
  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState<KBEntry['type'] | 'all'>('all')

  const { data, isLoading, error } = useQuery({
    queryKey:  ['knowledge_base'],
    queryFn:   fetchKB,
    staleTime: 1000 * 60 * 5,
  })

  const entries = data ?? []

  const filtered = entries.filter(e => {
    if (typeFilter !== 'all' && e.type !== typeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
    }
    return true
  })

  // Group visible entries by type in fixed order
  const grouped = TYPE_ORDER.reduce<Record<string, KBEntry[]>>((acc, type) => {
    const group = filtered.filter(e => e.type === type)
    if (group.length > 0) acc[type] = group
    return acc
  }, {})

  const previewEntry = previewId ? entries.find(e => e.id === previewId) : null

  const totalByType = TYPE_ORDER.reduce<Record<string, number>>((acc, t) => {
    acc[t] = entries.filter(e => e.type === t).length
    return acc
  }, {})

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">
            Knowledge Base
          </h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            {isLoading
              ? 'Loading…'
              : `${entries.length} entries · SOPs, templates, reference docs`}
          </p>
        </div>
        {/* Search */}
        <div className="relative w-56 flex-shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search entries…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={cn(
              'w-full pl-8 pr-3 py-1.5 rounded bg-base-800 border border-base-600',
              'text-sm text-white placeholder:text-base-600',
              'focus:outline-none focus:border-electric/50 transition-colors',
            )}
          />
        </div>
      </div>

      {/* ── Type filter tabs ── */}
      <div className="flex items-center gap-1 flex-wrap">
        {(['all', ...TYPE_ORDER] as const).map(type => {
          const isActive = typeFilter === type
          const count    = type === 'all' ? entries.length : (totalByType[type] ?? 0)
          if (type !== 'all' && count === 0) return null
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={cn(
                'px-3 py-1 rounded text-xs font-mono font-medium transition-all',
                isActive
                  ? 'bg-electric/10 text-electric border border-electric/30'
                  : 'bg-base-800 text-base-400 border border-base-700 hover:text-white hover:border-base-600',
              )}
            >
              {FILTER_LABELS[type]}
              {count > 0 && (
                <span className={cn('ml-1.5 text-[10px]', isActive ? 'text-electric/70' : 'text-base-600')}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Body ── */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}

      {error && (
        <Panel className="p-4 border border-red-op/20">
          <p className="text-sm text-red-op">Failed to load knowledge base: {(error as Error).message}</p>
        </Panel>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          icon={<BookOpen size={32} />}
          title={search ? 'No entries match your search' : 'No entries yet'}
          sub={search ? 'Try a different search term' : 'Knowledge base entries will appear here'}
        />
      )}

      {/* ── Grouped sections ── */}
      {!isLoading && Object.entries(grouped).map(([type, group]) => {
        const kbType = type as KBEntry['type']
        const cfg    = TYPE_CONFIG[kbType]
        const cls    = COLOR_CLASSES[cfg.color]
        return (
          <section key={type}>
            {/* Section header */}
            <div className="flex items-center gap-2 mb-2">
              <h3 className={cn('text-xs font-mono font-bold uppercase tracking-widest', cls.section)}>
                {cfg.label}s
              </h3>
              <span className="text-xs text-base-600 font-mono">({group.length})</span>
              <div className="flex-1 h-px bg-base-800" />
            </div>

            <div className="space-y-2">
              {group.map(entry => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  isEditing={editingId === entry.id}
                  onEditStart={() => {
                    setPreviewId(null)
                    setEditingId(entry.id)
                  }}
                  onEditCancel={() => setEditingId(null)}
                  onPreview={() => {
                    setEditingId(null)
                    setPreviewId(entry.id)
                  }}
                />
              ))}
            </div>
          </section>
        )
      })}

      {/* ── Preview modal ── */}
      {previewEntry && (
        <PreviewModal entry={previewEntry} onClose={() => setPreviewId(null)} />
      )}
    </div>
  )
}
