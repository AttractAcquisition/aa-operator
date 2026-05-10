import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MessageCircle, Wand2, ChevronRight, Search } from 'lucide-react'
import { supabase, createApprovalItem } from '@/lib/supabase'
import { Panel, Button, Spinner, EmptyState } from '@/components/ui'
import { cn, formatDate, formatRelative } from '@/lib/utils'
import { useAppStore } from '@/store'

// ─── Types aligned with actual DB schema ─────────────────────────────────────

interface ProspectJoin {
  id: string
  owner_name: string | null
  business_name: string | null
  vertical: string | null
  quality_score: number | null
  phone: string | null
  status: string | null
}

interface WaConversation {
  id: string
  prospect_id: string | null
  contact_name: string | null
  phone_number: string | null
  last_message_preview: string | null
  last_message_at: string | null
  unread_count: number
  stage: string | null         // warm | cold | replied | call_booked | not_interested | contacted
  needs_human: boolean | null
  ai_intent: string | null
  created_at: string
  prospect: ProspectJoin | null
}

interface WaMessage {
  id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  created_at: string
  status: string | null
  sender_type: string | null
  ai_generated: boolean | null
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  warm:           'text-green-op   bg-green-op/10   border-green-op/25',
  call_booked:    'text-electric   bg-electric/10   border-electric/25',
  cold:           'text-base-500   bg-base-750      border-base-600',
  not_interested: 'text-red-op     bg-red-op/10     border-red-op/25',
  replied:        'text-amber-op   bg-amber-op/10   border-amber-op/25',
  contacted:      'text-base-400   bg-base-750      border-base-600',
}

function statusStyle(s: string | null) {
  return STATUS_STYLE[s ?? ''] ?? 'text-base-500 bg-base-750 border-base-600'
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

async function fetchConversations(): Promise<WaConversation[]> {
  const { data, error } = await supabase
    .from('whatsapp_conversations')
    .select('id, prospect_id, contact_name, phone_number, last_message_preview, last_message_at, unread_count, stage, needs_human, ai_intent, created_at, prospect:prospect_id(id, owner_name, business_name, vertical, quality_score, phone, status)')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100)

  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as WaConversation[]
}

async function fetchMessages(conversationId: string): Promise<WaMessage[]> {
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('id, conversation_id, direction, body, created_at, status, sender_type, ai_generated')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as WaMessage[]
}

// ─── Generate reply via claude-chat ──────────────────────────────────────────

async function callGenerateReply(conv: WaConversation, messages: WaMessage[]): Promise<string> {
  const name    = conv.contact_name ?? conv.prospect?.owner_name ?? 'the prospect'
  const company = conv.prospect?.business_name
  const vertical = conv.prospect?.vertical
  const qualityScore = conv.prospect?.quality_score

  const history = messages
    .map(m => `${m.direction === 'inbound' ? name : 'AA Operator'}: ${m.body ?? ''}`)
    .join('\n')

  const prompt = [
    `Suggest a WhatsApp follow-up reply to ${name}${company ? ` at ${company}` : ''}.`,
    [
      `Stage: ${conv.stage ?? 'unknown'}.`,
      `Intent: ${conv.ai_intent ?? 'unknown'}.`,
      vertical ? `Niche: ${vertical}.` : '',
      qualityScore != null ? `Quality score: ${qualityScore}/10.` : '',
    ].filter(Boolean).join(' '),
    '',
    'WhatsApp conversation so far:',
    history,
    '',
    'Write ONLY the reply message text — brief (2–3 sentences max), warm, conversational.',
    'Goal: book a 15-minute discovery call. No emojis. No explanation — just the message.',
  ].join('\n')

  const { data, error } = await supabase.functions.invoke('claude-chat', {
    body: {
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a WhatsApp sales assistant for Attract Acquisition, a B2B lead generation agency that helps local trades and service businesses. Generate natural, brief, warm follow-up messages that move prospects toward a discovery call. Match the tone of the existing conversation. Never sound salesy or formal.',
    },
  })

  if (error) throw error
  return (data?.content as string | undefined)?.trim() ?? ''
}

// ─── Initials avatar ──────────────────────────────────────────────────────────

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const hue = name.split('').reduce((n, c) => n + c.charCodeAt(0), 0) % 360
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center flex-shrink-0 font-mono font-bold',
        size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm',
      )}
      style={{ background: `hsl(${hue},40%,22%)`, border: `1px solid hsl(${hue},40%,30%)`, color: `hsl(${hue},70%,70%)` }}
    >
      {initials}
    </div>
  )
}

// ─── Thread list item ─────────────────────────────────────────────────────────

function ThreadItem({ conv, active, onClick }: { conv: WaConversation; active: boolean; onClick: () => void }) {
  const name    = conv.contact_name ?? conv.prospect?.owner_name ?? conv.phone_number ?? 'Unknown'
  const company = conv.prospect?.business_name
  const vertical = conv.prospect?.vertical

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-3 text-left transition-all border-b border-base-700/50',
        active
          ? 'bg-electric/8 border-l-2 border-l-electric'
          : 'hover:bg-base-750 border-l-2 border-l-transparent',
      )}
    >
      <div className="relative">
        <Avatar name={name} size="md" />
        {conv.unread_count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-op border border-base-900 flex items-center justify-center text-[9px] font-bold text-base-950">
            {conv.unread_count}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className={cn('text-sm font-medium truncate', conv.unread_count > 0 ? 'text-white' : 'text-base-300')}>
            {name}
          </span>
          <span className="text-[10px] font-mono text-base-600 flex-shrink-0">
            {conv.last_message_at ? formatRelative(conv.last_message_at) : '—'}
          </span>
        </div>
        {(company || vertical) && (
          <div className="flex items-center gap-1 mb-1">
            {company && <span className="text-[10px] text-base-500 truncate">{company}</span>}
            {company && vertical && <span className="text-[10px] text-base-700">·</span>}
            {vertical && <span className="text-[10px] text-base-600 truncate">{vertical}</span>}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className={cn(
            'text-xs truncate flex-1',
            conv.unread_count > 0 ? 'text-base-300' : 'text-base-600',
          )}>
            {conv.last_message_preview ?? ''}
          </p>
          {conv.stage && (
            <span className={cn('text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border flex-shrink-0', statusStyle(conv.stage))}>
              {conv.stage.replace('_', ' ').toUpperCase()}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MsgBubble({ msg, contactName }: { msg: WaMessage; contactName: string }) {
  const isOut = msg.direction === 'outbound'
  return (
    <div className={cn('flex gap-2 items-end', isOut ? 'flex-row-reverse' : 'flex-row')}>
      {!isOut && <Avatar name={contactName} size="sm" />}
      <div className={cn('max-w-[72%] space-y-1', isOut ? 'items-end' : 'items-start', 'flex flex-col')}>
        <div className={cn(
          'px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed',
          isOut
            ? 'bg-electric/15 border border-electric/25 text-white rounded-br-sm'
            : 'bg-base-750 border border-base-600 text-base-200 rounded-bl-sm',
        )}>
          {msg.body ?? ''}
          {msg.ai_generated && (
            <span className="ml-2 text-[9px] font-mono text-electric/60">AI</span>
          )}
        </div>
        <div className={cn('flex items-center gap-1.5', isOut && 'flex-row-reverse')}>
          <span className="text-[10px] font-mono text-base-600">{formatDate(msg.created_at)}</span>
          {isOut && msg.status && (
            <span className={cn(
              'text-[9px] font-mono',
              msg.status === 'read' ? 'text-electric' : 'text-base-600',
            )}>
              {msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Conversation panel ───────────────────────────────────────────────────────

function ConversationPanel({ conv }: { conv: WaConversation }) {
  const { addNotification } = useAppStore()
  const [generating, setGenerating] = useState(false)
  const [draftReply, setDraftReply] = useState<string | null>(null)
  const [queueing, setQueueing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: messages = [], isLoading: msgsLoading } = useQuery({
    queryKey: ['whatsapp_messages', conv.id],
    queryFn: () => fetchMessages(conv.id),
    refetchInterval: 30_000,
  })

  const name     = conv.contact_name ?? conv.prospect?.owner_name ?? conv.phone_number ?? 'Unknown'
  const company  = conv.prospect?.business_name
  const vertical = conv.prospect?.vertical
  const qualityScore = conv.prospect?.quality_score
  const isWarm   = ['warm', 'replied', 'call_booked'].includes(conv.stage ?? '')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conv.id, messages.length])

  const handleGenerate = async () => {
    setGenerating(true)
    setDraftReply(null)
    try {
      const reply = await callGenerateReply(conv, messages)
      setDraftReply(reply)
    } catch (err) {
      addNotification(`Reply generation failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  const handleQueueApproval = async () => {
    if (!draftReply) return
    setQueueing(true)
    try {
      await createApprovalItem({
        sop_id: '01',
        sop_name: 'SOP 01 — Outreach Drafts',
        type: 'whatsapp_message',
        priority: conv.stage === 'warm' ? 'high' : 'medium',
        content: {
          title: `WhatsApp reply — ${name}${company ? ` (${company})` : ''}`,
          body: draftReply,
          recipient: conv.phone_number ?? conv.prospect?.phone ?? name,
          metadata: {
            conversation_id: conv.id,
            prospect_id: conv.prospect_id ?? '',
            stage: conv.stage ?? 'unknown',
            niche: vertical ?? 'unknown',
            quality_score: String(qualityScore ?? 0),
            model: 'claude-sonnet-4-6',
          },
        },
      })
      addNotification(`Reply queued for approval — ${name}`, 'success')
      setDraftReply(null)
    } catch (err) {
      addNotification(`Failed to queue: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
    } finally {
      setQueueing(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Thread header */}
      <div className="px-5 py-3 border-b border-base-600 flex items-center gap-3 flex-shrink-0">
        <Avatar name={name} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white">{name}</span>
            {conv.stage && (
              <span className={cn('text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border', statusStyle(conv.stage))}>
                {conv.stage.replace('_', ' ').toUpperCase()}
              </span>
            )}
            {conv.needs_human && (
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border text-amber-op bg-amber-op/10 border-amber-op/25">
                NEEDS HUMAN
              </span>
            )}
          </div>
          <p className="text-xs text-base-500 font-mono">
            {[company, vertical, qualityScore != null ? `Q${qualityScore}` : null]
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="text-[10px] font-mono text-base-600">{messages.length} messages</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {msgsLoading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner size={20} />
          </div>
        ) : messages.length === 0 ? (
          <div className="py-10 px-4 text-center">
            <p className="text-xs text-base-500">No messages in this conversation yet</p>
          </div>
        ) : (
          messages.map(msg => (
            <MsgBubble key={msg.id} msg={msg} contactName={name} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply area */}
      <div className="flex-shrink-0 border-t border-base-600 p-4 space-y-3">
        {draftReply !== null && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-electric uppercase">AI Draft — Review before sending</span>
              <button onClick={() => setDraftReply(null)} className="text-[10px] text-base-500 hover:text-white font-mono">dismiss</button>
            </div>
            <textarea
              value={draftReply}
              onChange={e => setDraftReply(e.target.value)}
              rows={3}
              className="w-full bg-electric/5 border border-electric/20 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:border-electric/50 font-body leading-relaxed"
            />
            <Button
              onClick={handleQueueApproval}
              disabled={queueing || !draftReply.trim()}
              variant="primary"
              size="sm"
            >
              {queueing ? <Spinner size={12} /> : <ChevronRight size={12} />}
              {queueing ? 'Queueing…' : 'Queue for Approval'}
            </Button>
          </div>
        )}

        {isWarm && draftReply === null && (
          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate} disabled={generating} variant="secondary" size="sm">
              {generating ? <Spinner size={12} /> : <Wand2 size={12} />}
              {generating ? 'Generating…' : 'Generate Reply'}
            </Button>
            <span className="text-[10px] font-mono text-base-600">claude-sonnet-4-6 · creates approval item</span>
          </div>
        )}

        {!isWarm && (
          <p className="text-[11px] font-mono text-base-600">
            Reply generation available for warm / replied / call_booked leads only.
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Conversations() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const { data: conversations = [], isLoading, error } = useQuery({
    queryKey: ['whatsapp_conversations'],
    queryFn: fetchConversations,
    refetchInterval: 30_000,
  })

  const filtered = conversations.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (c.contact_name ?? '').toLowerCase().includes(q) ||
      (c.prospect?.owner_name ?? '').toLowerCase().includes(q) ||
      (c.prospect?.business_name ?? '').toLowerCase().includes(q) ||
      (c.phone_number ?? '').includes(q) ||
      (c.last_message_preview ?? '').toLowerCase().includes(q)
    )
  })

  const selected = filtered.find(c => c.id === selectedId) ?? filtered[0] ?? null

  const totalUnread = conversations.reduce((n, c) => n + (c.unread_count ?? 0), 0)

  return (
    <div className="animate-fade-up flex flex-col" style={{ height: 'calc(100vh - 104px)' }}>
      {/* Page header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display font-bold text-white text-xl uppercase tracking-wide">Conversations</h2>
            {totalUnread > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-green-op/15 text-green-op border border-green-op/25">
                {totalUnread} new
              </span>
            )}
          </div>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            {isLoading
              ? 'Loading…'
              : error
              ? 'Error loading conversations'
              : `${conversations.length} thread${conversations.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0 rounded-xl border border-base-600 overflow-hidden bg-base-900">

        {/* Left: thread list */}
        <div className="w-72 flex-shrink-0 flex flex-col border-r border-base-600">
          {/* Search */}
          <div className="p-3 border-b border-base-600">
            <div className="flex items-center gap-2 bg-base-750 border border-base-600 rounded-lg px-2.5 py-1.5">
              <Search size={12} className="text-base-500 flex-shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search conversations…"
                className="flex-1 bg-transparent text-xs text-white placeholder-base-600 focus:outline-none font-body"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3 border-b border-base-700/50 animate-pulse">
                  <div className="w-10 h-10 rounded-full bg-base-750 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-base-750 rounded w-2/3" />
                    <div className="h-2 bg-base-800 rounded w-1/2" />
                    <div className="h-2 bg-base-800 rounded w-3/4" />
                  </div>
                </div>
              ))
            ) : error ? (
              <div className="py-10 px-4 text-center">
                <MessageCircle size={24} className="text-red-op/50 mx-auto mb-2" />
                <p className="text-xs text-red-op/70">Failed to load conversations</p>
                <p className="text-[10px] text-base-600 mt-1 font-mono">
                  {error instanceof Error ? error.message : 'Unknown error'}
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <MessageCircle size={24} className="text-base-700 mx-auto mb-2" />
                <p className="text-xs text-base-400 font-medium">
                  {search
                    ? 'No conversations found'
                    : 'No conversations yet — messages sent to your WhatsApp number will appear here'}
                </p>
              </div>
            ) : (
              filtered.map(conv => (
                <ThreadItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === (selected?.id ?? null)}
                  onClick={() => setSelectedId(conv.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: conversation */}
        <div className="flex-1 flex flex-col min-w-0">
          {selected ? (
            <ConversationPanel key={selected.id} conv={selected} />
          ) : (
            <Panel className="flex-1 flex items-center justify-center m-0 rounded-none border-0">
              <EmptyState
                icon={<MessageCircle size={32} />}
                title={conversations.length === 0
                  ? 'No conversations yet'
                  : 'Select a conversation'}
                sub={conversations.length === 0
                  ? 'Messages sent to your WhatsApp number will appear here'
                  : 'Choose a thread from the list to view messages'}
              />
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
