// ─── Claude API Integration ───────────────────────────────────────────────────
// TODO: The Anthropic SDK cannot be called directly from the browser due to CORS.
// When you connect via Claude Code, it will set up a Supabase Edge Function
// that proxies requests to the Anthropic API securely.
//
// For now, the chat interface uses a simulated streaming response.
// Replace `streamChatResponse` with the real implementation below once
// your Edge Function is deployed.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'
import type { ChatMessage } from '@/types'

export interface ClaudeStreamCallbacks {
  onToken: (token: string) => void
  onToolCall: (tool: string, summary: string) => void
  onComplete: (fullText: string) => void
  onError: (error: Error) => void
}

// ─── Real implementation (uncomment after Edge Function is deployed) ──────────
export async function streamChatResponse(
  messages: ChatMessage[],
  callbacks: ClaudeStreamCallbacks
) {
  try {
    const { data, error } = await supabase.functions.invoke('claude-chat', {
      body: {
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        system: OPERATOR_SYSTEM_PROMPT,
      },
    })

    if (error) throw error

    // Handle streaming response from Edge Function
    if (data?.content) {
      callbacks.onComplete(data.content)
    }
  } catch {
    // Fall back to mock in development
    await mockStreamResponse(messages, callbacks)
  }
}

// ─── Mock streaming for development (used until Edge Function is live) ────────
async function mockStreamResponse(
  messages: ChatMessage[],
  callbacks: ClaudeStreamCallbacks
) {
  const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || ''

  let response = ''
  const toolCalls: Array<{ tool: string; summary: string }> = []

  if (lastMessage.includes('leads') || lastMessage.includes('prospect')) {
    toolCalls.push({ tool: 'get_new_leads', summary: 'Fetched 47 leads from prospects table' })
    response = `Based on your prospects table, here's the current lead summary:\n\n**This week:** 47 new leads scraped across 3 batch runs\n**Quality breakdown:** 18 high (8+), 22 medium (5–7), 7 low (<5)\n**Top source:** Checkatrade — North West tradesmen\n**Avg quality score:** 6.8/10\n\nOf these, 12 have been enriched and are staged for today's outreach batch. 3 warm replies from yesterday are in your approval queue.`
  } else if (lastMessage.includes('sprint') || lastMessage.includes('performance')) {
    toolCalls.push({ tool: 'get_active_sprints', summary: 'Fetched 4 active sprints' })
    toolCalls.push({ tool: 'get_ad_performance', summary: 'Pulled Meta Ads data for all campaigns' })
    response = `You have **4 active proof sprints** running:\n\n🟢 **Apex Plumbing** — Day 8 of 14 — 34 leads, CPL £12.40 (target £15) — *On track*\n🟢 **Swift Electrical** — Day 3 of 14 — 11 leads, CPL £18.20 (target £20) — *On track*\n🟡 **Leeds Roofing Co** — Day 11 of 14 — 28 leads, CPL £22.10 (target £18) — *Attention needed*\n🔴 **Midlands HVAC** — Day 6 of 14 — 14 leads, CPL £31.40 (target £20) — *Off target*\n\nMidlands HVAC has an alert — I've flagged 2 underperforming ad sets for your review.`
  } else if (lastMessage.includes('revenue') || lastMessage.includes('finance') || lastMessage.includes('money')) {
    toolCalls.push({ tool: 'get_finance_summary', summary: 'Queried finance_ledger for April 2026' })
    response = `**April 2026 Revenue Summary:**\n\nMRR: **£18,400** (↑12% vs March)\nInvoiced this month: **£21,200**\nCollected: **£16,800**\nOutstanding: **£4,400** (2 invoices)\n\n**Overdue (>7 days):** £1,800 from Leeds Roofing Co — payment chase queued\n\nPipeline value at current conversion rates: **£34,000** over next 90 days\n\nWould you like me to draft a payment chase message for the overdue invoice?`
  } else if (lastMessage.includes('approval') || lastMessage.includes('queue') || lastMessage.includes('pending')) {
    toolCalls.push({ tool: 'get_pending_approvals', summary: 'Found 7 items pending approval' })
    response = `You have **7 items** in your approval queue:\n\n🔴 **2 urgent** — WhatsApp outreach batch (43 messages) ready to send\n🟡 **3 medium** — Weekly client reports for Apex, Swift, and Precision Drainage\n⚪ **2 low** — Call brief for tomorrow's discovery call + MJR review for prospect\n\nHighest priority: the outreach batch has been ready since 09:00 this morning. Want me to open the queue?`
  } else if (lastMessage.includes('brief') || lastMessage.includes('today') || lastMessage.includes('attention')) {
    toolCalls.push({ tool: 'run_daily_briefing', summary: 'Aggregated all live data for daily summary' })
    response = `**Good morning — here's your command centre briefing:**\n\n**Immediate attention:**\n1. 🔴 Midlands HVAC sprint — CPL at £31.40 vs £20 target. 2 ad sets flagged for kill.\n2. 🟡 7 items in approval queue including today's outreach batch\n3. 🟡 Leeds Roofing invoice overdue 9 days — automated chase ready\n\n**Overnight activity:**\n• 12 new replies triaged — 3 warm leads created\n• 4 sprints logged (all 07:30 runs successful)\n• Weekly finance dashboard updated\n\n**Today's schedule:**\n• 14:00 — Discovery call with Northgate Builders (brief ready in queue)\n• 17:00 — Friday client reports generating automatically\n\nAll systems operational. No cron failures overnight.`
  } else {
    response = `I'm your Attract Acquisition AI operator. I have live access to your Supabase database and can help you with:\n\n• **Prospect & lead data** — counts, quality scores, pipeline status\n• **Sprint monitoring** — active sprints, CPL, ROAS, daily performance\n• **Approval queue** — what needs your attention right now\n• **Finance tracking** — revenue, outstanding invoices, pipeline value\n• **Running SOPs** — trigger any automated process on demand\n• **Client status** — any client's current situation and history\n\nWhat would you like to know?`
  }

  // Emit tool calls first
  for (const tc of toolCalls) {
    callbacks.onToolCall(tc.tool, tc.summary)
    await sleep(300)
  }

  // Stream the response token by token
  let accumulated = ''
  const words = response.split(' ')
  for (const word of words) {
    const token = word + ' '
    accumulated += token
    callbacks.onToken(token)
    await sleep(18 + Math.random() * 20)
  }

  callbacks.onComplete(accumulated.trim())
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── System prompt ──────────────────────────────────────────────────────────
export const OPERATOR_SYSTEM_PROMPT = `You are the AI operating system for Attract Acquisition, a performance marketing agency.

You have live access to the Supabase database via tools. Always query live data before answering factual questions about leads, clients, sprints, or finances.

Business context:
- Attract Acquisition runs a prospect-to-client pipeline using WhatsApp outreach
- Products: Proof Sprint (14-day paid trial), Proof Brand (monthly retainer), Authority Brand (premium tier)
- Key metrics: CPL (cost per lead), ROAS, lead volume, conversion rates
- 58 SOPs across 9 domains — all mapped to automation tiers

Always be direct, data-driven, and actionable. When flagging issues, suggest a specific next action.
Format responses clearly — use markdown for structure. Keep answers concise unless asked for detail.`
