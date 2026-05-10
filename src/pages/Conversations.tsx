import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MessageCircle, Wand2, ChevronRight, Search } from 'lucide-react'
import { supabase, createApprovalItem } from '@/lib/supabase'
import { Panel, Button, Spinner, EmptyState } from '@/components/ui'
import { cn, formatDate, formatRelative } from '@/lib/utils'
import { useAppStore } from '@/store'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WaMessage {
  id: string
  prospect_id: string
  direction: 'inbound' | 'outbound'
  message_body: string
  created_at: string
  status?: string
}

interface ProspectInfo {
  id: string
  name: string
  company: string
  status: string
  niche: string | null
  quality_score: number
  phone: string
}

interface Thread {
  prospect: ProspectInfo
  messages: WaMessage[]
  last_message: string
  last_at: string
  last_direction: 'inbound' | 'outbound'
  unread: number
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

function statusStyle(s: string) {
  return STATUS_STYLE[s] ?? 'text-base-500 bg-base-750 border-base-600'
}

// ─── Mock data (fallback when table is empty / offline) ───────────────────────

function daysAgo(d: number) {
  return new Date(Date.now() - d * 86_400_000).toISOString()
}
function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3_600_000).toISOString()
}

const MOCK_THREADS: Thread[] = [
  {
    prospect: {
      id: 'mp1', name: 'James Mitchell', company: 'Mitchell Roofing Ltd',
      status: 'warm', niche: 'roofing', quality_score: 8.2, phone: '+447700900001',
    },
    messages: [
      { id: 'mm1', prospect_id: 'mp1', direction: 'outbound', message_body: 'Hi James, I came across Mitchell Roofing — impressive reviews. I help local roofing companies generate 20–40 qualified leads/month through targeted Facebook and Google ads. Would a quick 15-min call be worthwhile?', created_at: daysAgo(5), status: 'read' },
      { id: 'mm2', prospect_id: 'mp1', direction: 'inbound',  message_body: "Hi, yeah we're always looking for more work. What sort of leads are we talking?", created_at: daysAgo(4) },
      { id: 'mm3', prospect_id: 'mp1', direction: 'outbound', message_body: 'Homeowners in your area actively searching for roofing quotes — not generic form fills. We run a 14-day proof sprint so you see results before committing to anything. Average CPL £18–£25 for roofing. Interested?', created_at: daysAgo(4), status: 'read' },
      { id: 'mm4', prospect_id: 'mp1', direction: 'inbound',  message_body: 'Yeah sounds good, happy to jump on a call this week', created_at: hoursAgo(2) },
    ],
    last_message: 'Yeah sounds good, happy to jump on a call this week',
    last_at: hoursAgo(2),
    last_direction: 'inbound',
    unread: 1,
  },
  {
    prospect: {
      id: 'mp2', name: 'Sarah Patel', company: 'Patel & Sons Electrical',
      status: 'replied', niche: 'electrical', quality_score: 7.4, phone: '+447700900002',
    },
    messages: [
      { id: 'mm5', prospect_id: 'mp2', direction: 'outbound', message_body: 'Hi Sarah, I help local electricians fill their job pipeline with qualified leads. Would you be open to a quick chat?', created_at: daysAgo(3), status: 'read' },
      { id: 'mm6', prospect_id: 'mp2', direction: 'inbound',  message_body: "Hi, we're pretty busy at the moment but always open to more commercial work", created_at: daysAgo(2) },
    ],
    last_message: "Hi, we're pretty busy at the moment but always open to more commercial work",
    last_at: daysAgo(2),
    last_direction: 'inbound',
    unread: 1,
  },
  {
    prospect: {
      id: 'mp3', name: 'Dan Hughes', company: 'Hughes Plumbing & Heating',
      status: 'cold', niche: 'plumbing', quality_score: 6.1, phone: '+447700900003',
    },
    messages: [
      { id: 'mm7', prospect_id: 'mp3', direction: 'outbound', message_body: 'Hi Dan, saw your Google listing — strong reviews. I help plumbing companies get consistent leads through paid ads. Worth a chat?', created_at: daysAgo(7), status: 'read' },
      { id: 'mm8', prospect_id: 'mp3', direction: 'inbound',  message_body: 'Not really looking at the moment cheers', created_at: daysAgo(6) },
      { id: 'mm9', prospect_id: 'mp3', direction: 'outbound', message_body: "No worries at all Dan. I'll check back in a couple of months — good luck with the summer busy period.", created_at: daysAgo(6), status: 'read' },
    ],
    last_message: 'No worries at all Dan. I\'ll check back in a couple of months…',
    last_at: daysAgo(6),
    last_direction: 'outbound',
    unread: 0,
  },
  {
    prospect: {
      id: 'mp4', name: 'Lisa Turner', company: 'Turner & Co Landscaping',
      status: 'not_interested', niche: 'landscaping', quality_score: 5.8, phone: '+447700900004',
    },
    messages: [
      { id: 'mm10', prospect_id: 'mp4', direction: 'outbound', message_body: 'Hi Lisa, I help local landscaping businesses get more enquiries. Would you be open to a quick chat?', created_at: daysAgo(10), status: 'read' },
      { id: 'mm11', prospect_id: 'mp4', direction: 'inbound',  message_body: 'Please don\'t message me again', created_at: daysAgo(9) },
    ],
    last_message: 'Please don\'t message me again',
    last_at: daysAgo(9),
    last_direction: 'inbound',
    unread: 0,
  },
]

// ─── Data fetch ───────────────────────────────────────────────────────────────

async function fetchThreads(): Promise<Thread[]> {
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString()

  const { data: msgs, error: msgErr } = await supabase
    .from('whatsapp_messages')
    .select('id, prospect_id, direction, message_body, created_at, status')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(2000)

  if (msgErr) throw new Error(msgErr.message)
  const messages = (msgs ?? []) as WaMessage[]
  if (messages.length === 0) return []

  const prospectIds = [...new Set(messages.map(m => m.prospect_id))]

  const { data: prospects, error: pErr } = await supabase
    .from('prospects')
    .select('id, name, company, status, niche, quality_score, phone')
    .in('id', prospectIds)

  if (pErr) throw new Error(pErr.message)
  const prospectMap = new Map((prospects ?? []).map((p) => [p.id, p as ProspectInfo]))

  // Group messages by prospect_id
  const groups: Record<string, WaMessage[]> = {}
  for (const m of messages) {
    if (!groups[m.prospect_id]) groups[m.prospect_id] = []
    groups[m.prospect_id].push(m)
  }

  return Object.entries(groups)
    .map(([pid, msgs]) => {
      const sorted  = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at))
      const last    = sorted[sorted.length - 1]
      const prospect = prospectMap.get(pid) ?? {
        id: pid, name: 'Unknown', company: '', status: 'contacted',
        niche: null, quality_score: 0, phone: '',
      }
      const inbound = sorted.filter(m => m.direction === 'inbound')
      const lastOutboundIdx = [...sorted].reverse().findIndex(m => m.direction === 'outbound')
      const unread = lastOutboundIdx < 0
        ? inbound.length
        : inbound.filter(m => m.created_at > sorted[sorted.length - 1 - lastOutboundIdx].created_at).length

      return {
        prospect,
        messages: sorted,
        last_message: last.message_body.slice(0, 80),
        last_at: last.created_at,
        last_direction: last.direction,
        unread,
      }
    })
    .sort((a, b) => b.last_at.localeCompare(a.last_at))
}

// ─── Generate reply via claude-chat ──────────────────────────────────────────

async function callGenerateReply(thread: Thread): Promise<string> {
  const history = thread.messages
    .map(m => `${m.direction === 'inbound' ? thread.prospect.name : 'AA Operator'}: ${m.message_body}`)
    .join('\n')

  const prompt = [
    `Suggest a WhatsApp follow-up reply to ${thread.prospect.name} at ${thread.prospect.company}.`,
    `Status: ${thread.prospect.status}. Niche: ${thread.prospect.niche ?? 'local trades'}. Quality score: ${thread.prospect.quality_score}/10.`,
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

function ThreadItem({ thread, active, onClick }: { thread: Thread; active: boolean; onClick: () => void }) {
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
        <Avatar name={thread.prospect.name} size="md" />
        {thread.unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-op border border-base-900 flex items-center justify-center text-[9px] font-bold text-base-950">
            {thread.unread}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className={cn('text-sm font-medium truncate', thread.unread > 0 ? 'text-white' : 'text-base-300')}>
            {thread.prospect.name}
          </span>
          <span className="text-[10px] font-mono text-base-600 flex-shrink-0">
            {formatRelative(thread.last_at)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] text-base-500 truncate">{thread.prospect.company}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className={cn(
            'text-xs truncate flex-1',
            thread.unread > 0 ? 'text-base-300' : 'text-base-600',
          )}>
            {thread.last_direction === 'outbound' && <span className="text-base-600">You: </span>}
            {thread.last_message}
          </p>
          <span className={cn('text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border flex-shrink-0', statusStyle(thread.prospect.status))}>
            {thread.prospect.status.replace('_', ' ').toUpperCase()}
          </span>
        </div>
      </div>
    </button>
  )
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MsgBubble({ msg, prospectName }: { msg: WaMessage; prospectName: string }) {
  const isOut = msg.direction === 'outbound'
  return (
    <div className={cn('flex gap-2 items-end', isOut ? 'flex-row-reverse' : 'flex-row')}>
      {!isOut && <Avatar name={prospectName} size="sm" />}
      <div className={cn('max-w-[72%] space-y-1', isOut ? 'items-end' : 'items-start', 'flex flex-col')}>
        <div className={cn(
          'px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed',
          isOut
            ? 'bg-electric/15 border border-electric/25 text-white rounded-br-sm'
            : 'bg-base-750 border border-base-600 text-base-200 rounded-bl-sm',
        )}>
          {msg.message_body}
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

function ConversationPanel({ thread }: { thread: Thread }) {
  const { addNotification } = useAppStore()
  const [generating, setGenerating] = useState(false)
  const [draftReply, setDraftReply] = useState<string | null>(null)
  const [queueing, setQueueing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isWarm = ['warm', 'replied', 'call_booked'].includes(thread.prospect.status)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread.prospect.id, thread.messages.length])

  const handleGenerate = async () => {
    setGenerating(true)
    setDraftReply(null)
    try {
      const reply = await callGenerateReply(thread)
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
        priority: thread.prospect.status === 'warm' ? 'high' : 'medium',
        content: {
          title: `WhatsApp reply — ${thread.prospect.name} (${thread.prospect.company})`,
          body: draftReply,
          recipient: thread.prospect.phone || thread.prospect.name,
          metadata: {
            prospect_id: thread.prospect.id,
            prospect_status: thread.prospect.status,
            niche: thread.prospect.niche ?? 'unknown',
            quality_score: String(thread.prospect.quality_score),
            model: 'claude-sonnet-4-6',
          },
        },
      })
      addNotification(`Reply queued for approval — ${thread.prospect.name}`, 'success')
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
        <Avatar name={thread.prospect.name} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white">{thread.prospect.name}</span>
            <span className={cn('text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border', statusStyle(thread.prospect.status))}>
              {thread.prospect.status.replace('_', ' ').toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-base-500 font-mono">
            {thread.prospect.company}
            {thread.prospect.niche && ` · ${thread.prospect.niche}`}
            {` · Q${thread.prospect.quality_score}`}
          </p>
        </div>
        <span className="text-[10px] font-mono text-base-600">{thread.messages.length} messages</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {thread.messages.map(msg => (
          <MsgBubble key={msg.id} msg={msg} prospectName={thread.prospect.name} />
        ))}
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

  const { data: liveThreads, isLoading, error } = useQuery({
    queryKey: ['whatsapp_threads'],
    queryFn: fetchThreads,
    refetchInterval: 1000 * 60 * 2,
  })

  const useMock  = !isLoading && (!liveThreads || liveThreads.length === 0)
  const threads  = useMock ? MOCK_THREADS : (liveThreads ?? [])

  const filtered = threads.filter(t =>
    !search || [t.prospect.name, t.prospect.company, t.last_message]
      .some(s => s.toLowerCase().includes(search.toLowerCase()))
  )

  const selected = filtered.find(t => t.prospect.id === selectedId) ?? filtered[0] ?? null

  const totalUnread = threads.reduce((n, t) => n + t.unread, 0)

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
            {isLoading ? 'Loading…' : `${threads.length} threads${useMock ? ' · mock data' : ''}${error ? ' · offline' : ''}`}
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
            ) : filtered.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <MessageCircle size={24} className="text-base-700 mx-auto mb-2" />
                <p className="text-xs text-base-500">No conversations found</p>
              </div>
            ) : (
              filtered.map(thread => (
                <ThreadItem
                  key={thread.prospect.id}
                  thread={thread}
                  active={thread.prospect.id === (selected?.prospect.id ?? null)}
                  onClick={() => setSelectedId(thread.prospect.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: conversation */}
        <div className="flex-1 flex flex-col min-w-0">
          {selected ? (
            <ConversationPanel key={selected.prospect.id} thread={selected} />
          ) : (
            <Panel className="flex-1 flex items-center justify-center m-0 rounded-none border-0">
              <EmptyState
                icon={<MessageCircle size={32} />}
                title="Select a conversation"
                sub="Choose a thread from the list to view messages"
              />
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
