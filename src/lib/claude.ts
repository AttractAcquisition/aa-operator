import { supabase } from './supabase'
import type { ChatMessage } from '@/types'

// Two-tier model routing:
// HAIKU — mechanical tasks: scraping, dedup, CRM staging, reply classification, finance rollup, backup checks
// SONNET — generation/reasoning tasks: message drafting, document builds, analysis, briefings, chat
export const SONNET_MODEL = 'claude-sonnet-4-6'
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001'

export interface ClaudeStreamCallbacks {
  onToken: (token: string) => void
  onToolCall: (tool: string, summary: string) => void
  onComplete: (fullText: string) => void
  onError: (error: Error) => void
}

export async function streamChatResponse(
  messages: ChatMessage[],
  callbacks: ClaudeStreamCallbacks
) {
  const { data, error } = await supabase.functions.invoke('claude-chat', {
    body: {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      system: OPERATOR_SYSTEM_PROMPT,
    },
  })

  if (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)))
    return
  }

  // Emit tool calls first, in order
  for (const tc of (data?.tool_calls ?? []) as Array<{ tool: string; result_summary: string }>) {
    callbacks.onToolCall(tc.tool, tc.result_summary)
    await sleep(240)
  }

  // Simulate token streaming so the UI feels live
  const content: string = data?.content ?? ''
  let accumulated = ''
  for (const word of content.split(' ')) {
    const token = word + ' '
    accumulated += token
    callbacks.onToken(token)
    await sleep(12 + Math.random() * 14)
  }

  callbacks.onComplete(accumulated.trim())
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── System prompt ────────────────────────────────────────────────────────────
export const OPERATOR_SYSTEM_PROMPT = `You are the AI operating system for Attract Acquisition, a performance marketing agency.

You have live access to the Supabase database via tools. Always query live data before answering factual questions about leads, clients, sprints, or finances.

Business context:
- Attract Acquisition runs a prospect-to-client pipeline using WhatsApp outreach
- Products: Proof Sprint (14-day paid trial), Proof Brand (monthly retainer), Authority Brand (premium tier)
- Key metrics: CPL (cost per lead), ROAS, lead volume, conversion rates
- 58 SOPs across 9 domains — all mapped to automation tiers

Model routing (two-tier):
- claude-haiku-4-5-20251001 handles mechanical tasks: prospect scraping (SOP 02), dedup/enrichment classification (SOP 03), CRM staging (SOP 04), reply classification (SOP 06), backup checks (SOP 52), finance rollup (SOP 56), and any tool call that only writes structured data to Supabase.
- claude-sonnet-4-6 handles generation and reasoning: outreach drafting (SOP 01), call briefs (SOP 07), MJR builds (SOP 08), delivery sequences (SOP 10), SPOA builds (SOP 12), sprint analysis (SOP 21), ads monitoring (SOP 23), client reports (SOP 47), daily briefings (SOP 58), and all chat interface completions.

Always be direct, data-driven, and actionable. When flagging issues, suggest a specific next action.
Format responses clearly — use markdown for structure. Keep answers concise unless asked for detail.`
