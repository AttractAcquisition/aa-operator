import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, ExternalLink, RefreshCw, AlertCircle, FolderOpen } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Panel, Button, EmptyState, Spinner } from '@/components/ui'
import { formatDate, cn } from '@/lib/utils'

// ── Document type config ──────────────────────────────────────────────────────

const DOC_TYPES = [
  { key: 'mjr',        label: 'MJR',        fullLabel: 'Missed Jobs Report',        color: 'electric' },
  { key: 'spoa',       label: 'SPOA',       fullLabel: 'Strategic Plan of Action',  color: 'purple'   },
  { key: 'offer',      label: 'Offer',      fullLabel: 'Offer Document',            color: 'green'    },
  { key: 'call-prep',  label: 'Call Prep',  fullLabel: 'Call Prep Summary',         color: 'amber'    },
  { key: 'onboarding', label: 'Onboarding', fullLabel: 'Onboarding Brief',          color: 'red'      },
] as const

type DocTypeKey = typeof DOC_TYPES[number]['key']
type FilterKey = 'all' | DocTypeKey

const COLOR_MAP: Record<string, { text: string; bg: string; border: string }> = {
  electric: { text: 'text-electric',   bg: 'bg-electric/10',   border: 'border-electric/25'   },
  purple:   { text: 'text-purple-op',  bg: 'bg-purple-op/10',  border: 'border-purple-op/25'  },
  green:    { text: 'text-green-op',   bg: 'bg-green-op/10',   border: 'border-green-op/25'   },
  amber:    { text: 'text-amber-op',   bg: 'bg-amber-op/10',   border: 'border-amber-op/25'   },
  red:      { text: 'text-red-op',     bg: 'bg-red-op/10',     border: 'border-red-op/25'     },
}

// ── Data fetching ─────────────────────────────────────────────────────────────

interface DocumentRow {
  key: string
  type: DocTypeKey
  typeLabel: string
  typeFullLabel: string
  typeColor: string
  prospectId: string
  storagePath: string
  createdAt: string
  company: string
  prospectName: string | null
  signedUrl: string | null
}

async function fetchDocuments(): Promise<DocumentRow[]> {
  // 1. List all type folders simultaneously
  const listings = await Promise.all(
    DOC_TYPES.map(({ key }) =>
      supabase.storage.from('documents').list(key).then(r => ({ key, ...r }))
    )
  )

  // 2. Flatten into file entries, skip non-HTML and empty folders
  const files: { type: DocTypeKey; path: string; prospectId: string; createdAt: string }[] = []

  for (const { key, data, error } of listings) {
    if (error || !data) continue
    for (const file of data) {
      if (!file.name.endsWith('.html')) continue
      files.push({
        type: key as DocTypeKey,
        path: `${key}/${file.name}`,
        prospectId: file.name.replace('.html', ''),
        createdAt: (file as { created_at?: string }).created_at
          ?? (file as { updated_at?: string }).updated_at
          ?? new Date().toISOString(),
      })
    }
  }

  if (files.length === 0) return []

  // 3. Batch-fetch prospect names and companies
  const prospectIds = [...new Set(files.map(f => f.prospectId))]
  const { data: prospects } = await supabase
    .from('prospects')
    .select('id, name, company')
    .in('id', prospectIds)

  const prospectMap = new Map(
    (prospects ?? []).map(p => [p.id, p as { id: string; name: string; company: string }])
  )

  // 4. Generate signed URLs in one batch call (1-hour session TTL)
  const paths = files.map(f => f.path)
  const { data: signedData } = await supabase.storage
    .from('documents')
    .createSignedUrls(paths, 60 * 60)

  const urlMap = new Map(
    (signedData ?? []).map(s => [s.path, s.signedUrl ?? null])
  )

  // 5. Assemble final rows, newest first
  const typeInfo = Object.fromEntries(DOC_TYPES.map(t => [t.key, t]))

  return files
    .map(f => {
      const info = typeInfo[f.type]
      const prospect = prospectMap.get(f.prospectId)
      return {
        key: f.path,
        type: f.type,
        typeLabel: info.label,
        typeFullLabel: info.fullLabel,
        typeColor: info.color,
        prospectId: f.prospectId,
        storagePath: f.path,
        createdAt: f.createdAt,
        company: prospect?.company ?? `ID: ${f.prospectId.slice(0, 8)}…`,
        prospectName: prospect?.name ?? null,
        signedUrl: urlMap.get(f.path) ?? null,
      }
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="panel border border-base-700 p-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-base-700 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-base-700 rounded w-2/5" />
          <div className="h-2 bg-base-750 rounded w-1/3" />
        </div>
        <div className="w-14 h-7 bg-base-700 rounded" />
      </div>
    </div>
  )
}

function TypeBadge({ label, color }: { label: string; color: string }) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.electric
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border uppercase tracking-wide', c.text, c.bg, c.border)}>
      {label}
    </span>
  )
}

function DocumentCard({ doc }: { doc: DocumentRow }) {
  const c = COLOR_MAP[doc.typeColor] ?? COLOR_MAP.electric

  return (
    <div className={cn('panel border transition-all duration-150 hover:border-base-500', c.border, c.bg.replace('/10', '/5'))}>
      <div className="flex items-center gap-3 p-3.5">
        {/* Icon */}
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', c.bg)}>
          <FileText size={15} className={c.text} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-white text-sm truncate">{doc.company}</span>
            <TypeBadge label={doc.typeLabel} color={doc.typeColor} />
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {doc.prospectName && (
              <span className="text-[11px] text-base-500 truncate">{doc.prospectName}</span>
            )}
            <span className="text-[11px] text-base-600 font-mono flex-shrink-0">
              {formatDate(doc.createdAt)}
            </span>
          </div>
        </div>

        {/* View button */}
        {doc.signedUrl ? (
          <a
            href={doc.signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-all duration-150',
              'bg-base-700 text-white border border-base-600 hover:bg-base-600 hover:border-base-500 flex-shrink-0'
            )}
          >
            <ExternalLink size={11} />
            View
          </a>
        ) : (
          <span className="px-2.5 py-1.5 rounded text-xs font-medium text-base-600 border border-base-700 flex-shrink-0 cursor-not-allowed">
            Unavailable
          </span>
        )}
      </div>
    </div>
  )
}

function TypeSection({ type, docs }: { type: typeof DOC_TYPES[number]; docs: DocumentRow[] }) {
  const c = COLOR_MAP[type.color] ?? COLOR_MAP.electric

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className={cn('font-display font-bold text-sm uppercase tracking-wide', c.text)}>
          {type.fullLabel}
        </h3>
        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-mono border', c.text, c.bg, c.border)}>
          {docs.length}
        </span>
      </div>
      {docs.length === 0 ? (
        <div className="panel border border-base-700 p-4 text-center">
          <p className="text-xs text-base-600 font-mono">No {type.label} documents yet</p>
        </div>
      ) : (
        docs.map(doc => <DocumentCard key={doc.key} doc={doc} />)
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function Documents() {
  const [filter, setFilter] = useState<FilterKey>('all')

  const { data: docs = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['documents'],
    queryFn: fetchDocuments,
    staleTime: 1000 * 60 * 5,
  })

  const countByType = Object.fromEntries(
    DOC_TYPES.map(t => [t.key, docs.filter(d => d.type === t.key).length])
  )

  const filtered = filter === 'all' ? docs : docs.filter(d => d.type === filter)

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Documents</h2>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            {isLoading
              ? 'Loading…'
              : `${docs.length} document${docs.length !== 1 ? 's' : ''} across ${DOC_TYPES.length} types`}
          </p>
        </div>
        <Button
          onClick={() => refetch()}
          variant="secondary"
          size="sm"
          disabled={isFetching}
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {/* Stats row */}
      {!isLoading && docs.length > 0 && (
        <div className="grid grid-cols-5 gap-2">
          {DOC_TYPES.map(t => {
            const c = COLOR_MAP[t.color]
            const count = countByType[t.key] ?? 0
            return (
              <button
                key={t.key}
                onClick={() => setFilter(filter === t.key ? 'all' : t.key)}
                className={cn(
                  'panel border p-3 text-left transition-all duration-150',
                  filter === t.key ? cn(c.border, c.bg) : 'border-base-700 hover:border-base-500'
                )}
              >
                <div className={cn('font-display font-bold text-lg leading-none', filter === t.key ? c.text : 'text-white')}>
                  {count}
                </div>
                <div className="text-[10px] font-mono text-base-500 mt-1 uppercase">{t.label}</div>
              </button>
            )
          })}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {(['all', ...DOC_TYPES.map(t => t.key)] as FilterKey[]).map(f => {
          const typeInfo = f === 'all' ? null : DOC_TYPES.find(t => t.key === f)
          const count = f === 'all' ? docs.length : (countByType[f] ?? 0)
          return (
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
              {typeInfo?.label ?? 'All'} ({count})
            </button>
          )
        })}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : isError ? (
        <Panel className="p-8">
          <EmptyState
            icon={<AlertCircle size={32} />}
            title="Failed to load documents"
            sub="Check your Supabase Storage configuration"
          />
        </Panel>
      ) : docs.length === 0 ? (
        <Panel className="p-8">
          <EmptyState
            icon={<FolderOpen size={32} />}
            title="No documents yet"
            sub="Documents appear here after SOP 08, 12, 15, or 17 runs"
          />
        </Panel>
      ) : filter === 'all' ? (
        // Grouped by type
        <div className="space-y-6">
          {DOC_TYPES.map(type => (
            <TypeSection
              key={type.key}
              type={type}
              docs={docs.filter(d => d.type === type.key)}
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Panel className="p-8">
          <EmptyState
            icon={<FileText size={32} />}
            title={`No ${DOC_TYPES.find(t => t.key === filter)?.fullLabel ?? filter} documents`}
            sub="Run the relevant SOP to generate documents for this type"
          />
        </Panel>
      ) : (
        // Flat list for a specific type
        <div className="space-y-2">
          {filtered.map(doc => <DocumentCard key={doc.key} doc={doc} />)}
        </div>
      )}

      {/* Loading overlay for refetch */}
      {isFetching && !isLoading && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Spinner size={12} />
          <span className="text-xs text-base-500 font-mono">Refreshing…</span>
        </div>
      )}
    </div>
  )
}
