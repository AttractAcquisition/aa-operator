import { useState, useRef, useEffect } from 'react'
import { Send, Bot, User, Wrench, Trash2, Zap } from 'lucide-react'
import { useAppStore } from '@/store'
import { streamChatResponse } from '@/lib/claude'
import { Panel, Button, Spinner } from '@/components/ui'
import { cn, formatDate } from '@/lib/utils'
import type { ChatMessage } from '@/types'

const SUGGESTED = [
  "What needs my attention today?",
  "How many leads came in this week?",
  "Which sprints are off target?",
  "What's our revenue this month?",
  "Show me pending approvals",
  "What's the status of Leeds Roofing?",
]

function MarkdownText({ text }: { text: string }) {
  // Simple markdown rendering
  const lines = text.split('\n')
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('**') && line.endsWith('**')) {
          return <p key={i} className="font-bold text-white">{line.slice(2, -2)}</p>
        }
        // Bold inline
        const parts = line.split(/(\*\*[^*]+\*\*)/g)
        return (
          <p key={i} className={cn(line.startsWith('•') || line.startsWith('-') ? 'pl-2' : '')}>
            {parts.map((part, j) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={j} className="text-white font-semibold">{part.slice(2, -2)}</strong>
              }
              return <span key={j}>{part}</span>
            })}
          </p>
        )
      })}
    </div>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={cn('flex gap-3 chat-message', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={cn(
        'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
        isUser ? 'bg-electric/20 border border-electric/30' : 'bg-base-700 border border-base-600'
      )}>
        {isUser
          ? <User size={14} className="text-electric" />
          : <Bot size={14} className="text-base-400" />
        }
      </div>

      <div className={cn('flex flex-col max-w-[80%]', isUser && 'items-end')}>
        {/* Tool calls */}
        {msg.tool_calls && msg.tool_calls.length > 0 && (
          <div className="mb-2 space-y-1">
            {msg.tool_calls.map((tc, i) => (
              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-base-800 border border-electric/20">
                <Wrench size={10} className="text-electric flex-shrink-0" />
                <span className="text-[10px] font-mono text-electric">{tc.tool}()</span>
                <span className="text-[10px] text-base-500">→ {tc.result_summary}</span>
              </div>
            ))}
          </div>
        )}

        {/* Message bubble */}
        <div className={cn(
          'px-4 py-3 rounded-xl text-sm leading-relaxed',
          isUser
            ? 'bg-electric/15 border border-electric/25 text-white'
            : 'bg-base-800 border border-base-600 text-base-300'
        )}>
          {msg.is_streaming
            ? <span className="cursor-blink">{msg.content}</span>
            : <MarkdownText text={msg.content} />
          }
        </div>

        <span className="text-[10px] text-base-600 font-mono mt-1">
          {formatDate(msg.timestamp)}
        </span>
      </div>
    </div>
  )
}

export function Chat() {
  const [input, setInput] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const { chatMessages, addChatMessage, updateChatMessage, clearChat } = useAppStore()
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const send = async (text: string) => {
    if (!text.trim() || isThinking) return

    const userText = text.trim()
    setInput('')

    // Add user message
    addChatMessage({ role: 'user', content: userText })

    // Create streaming assistant message
    setIsThinking(true)
    const assistantId = addChatMessage({
      role: 'assistant',
      content: '',
      is_streaming: true,
      tool_calls: [],
    })

    const toolCalls: ChatMessage['tool_calls'] = []
    let fullText = ''

    await streamChatResponse(
      [...chatMessages, { id: 'tmp', role: 'user' as const, content: userText, timestamp: new Date().toISOString() }],
      {
        onToken: (token) => {
          fullText += token
          updateChatMessage(assistantId, { content: fullText, is_streaming: true })
        },
        onToolCall: (tool, summary) => {
          toolCalls.push({ tool, result_summary: summary })
          updateChatMessage(assistantId, { tool_calls: [...toolCalls] })
        },
        onComplete: (final) => {
          updateChatMessage(assistantId, { content: final, is_streaming: false, tool_calls: toolCalls })
          setIsThinking(false)
        },
        onError: (err) => {
          updateChatMessage(assistantId, {
            content: `Error: ${err.message}`,
            is_streaming: false,
          })
          setIsThinking(false)
        },
      }
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-104px)] animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-op">
              <div className="absolute w-2 h-2 rounded-full bg-green-op animate-ping opacity-40" />
            </div>
            <h2 className="font-display font-bold text-white uppercase tracking-wide">AI Chat Interface</h2>
          </div>
          <p className="text-xs text-base-500 font-mono mt-0.5">
            Claude has live access to your Supabase database · All 58 SOPs available
          </p>
        </div>
        {chatMessages.length > 0 && (
          <Button onClick={clearChat} variant="ghost" size="sm">
            <Trash2 size={12} /> Clear
          </Button>
        )}
      </div>

      {/* Messages */}
      <Panel className="flex-1 overflow-y-auto p-5">
        {chatMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-xl bg-electric/10 border border-electric/20 flex items-center justify-center mb-4">
              <Bot size={24} className="text-electric" />
            </div>
            <h3 className="font-display font-bold text-white text-lg uppercase mb-1">AI Operator Ready</h3>
            <p className="text-base-500 text-sm text-center max-w-sm mb-6">
              Ask anything about your business. I have live access to your leads, sprints, clients, finance, and all 58 SOPs.
            </p>
            <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left px-3 py-2.5 rounded-lg bg-base-750 border border-base-600 hover:border-electric/40 hover:bg-base-700 transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <Zap size={10} className="text-electric flex-shrink-0" />
                    <span className="text-xs text-base-400 group-hover:text-white transition-colors">{s}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {chatMessages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
            {isThinking && chatMessages[chatMessages.length - 1]?.role === 'user' && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-lg bg-base-700 border border-base-600 flex items-center justify-center">
                  <Bot size={14} className="text-base-400" />
                </div>
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-base-800 border border-base-600">
                  <Spinner size={12} />
                  <span className="text-xs text-base-500 font-mono">Thinking...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </Panel>

      {/* Input */}
      <div className="mt-3">
        <Panel className="p-3">
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about your business... (Enter to send)"
              rows={2}
              disabled={isThinking}
              className={cn(
                'flex-1 bg-transparent resize-none text-sm text-white placeholder-base-600',
                'focus:outline-none font-body leading-relaxed',
                'disabled:opacity-50'
              )}
            />
            <Button
              onClick={() => send(input)}
              variant="primary"
              disabled={!input.trim() || isThinking}
            >
              {isThinking ? <Spinner size={14} /> : <Send size={14} />}
            </Button>
          </div>
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-base-700">
            <span className="text-[10px] font-mono text-base-600">
              MODEL: claude-sonnet-4-6 · TOOLS: 28 active · CONTEXT: live DB
            </span>
            <span className="ml-auto text-[10px] font-mono text-base-600">
              Shift+Enter for new line
            </span>
          </div>
        </Panel>
      </div>
    </div>
  )
}
