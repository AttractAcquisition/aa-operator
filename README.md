# AA Operator — AI-First Control Panel

The operational command centre for Attract Acquisition. Built on Claude API + Supabase + React.

## What this is

A fully AI-first operating system for the agency — Claude automates 38 SOPs end-to-end, assists on 16 more, and gives you a natural language interface to all live business data.

**10 modules:**
- 🏠 Command Centre (SOP 58 — daily AI briefing)
- 💬 AI Chat (natural language → live Supabase data)
- ✅ Approval Queue (Claude drafts, you approve)
- 📊 Live Pipeline (prospect-to-client funnel)
- ⚡ Sprints (proof sprint monitoring)
- 🕐 Cron Manager (automation schedule control)
- 📋 SOP Control (all 58 SOPs, trigger on demand)
- 👥 Clients (per-client workspace)
- 💰 Finance (revenue, invoices, cash position)
- 🔔 Alerts (Claude-flagged issues)

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env.local
# Fill in your keys (or use Claude Code step below)
```

### 3. Run locally
```bash
npm run dev
```

---

## Connect to Production (via Claude Code)

After pushing to GitHub, open Claude Code in your terminal:

```bash
# 1. Connect Supabase
claude "connect this React app to my Supabase project and set up all required environment variables"

# 2. Create Edge Functions
claude "create all the Supabase Edge Functions defined in src/lib/supabase.ts"

# 3. Create new database tables
claude "create the 5 new database tables: ai_task_log, approval_queue, cron_schedule, knowledge_base, ai_alerts"

# 4. Set up Vercel cron jobs
claude "set up Vercel cron jobs for all the schedules in src/lib/mockData.ts"

# 5. Connect Anthropic API
claude "connect the Anthropic API and replace the mock streaming in src/lib/claude.ts with the real Edge Function"
```

---

## Architecture

```
Browser (React)
    ↓ fetch
Supabase Edge Functions      ← Claude API (claude-sonnet-4-6)
    ↓ SQL                         ↓ tool calls
Supabase Postgres            ← Meta Ads API / WhatsApp API
```

**Automation tiers:**
- 🟢 AUTO (38 SOPs) — Claude runs end-to-end, no input needed
- 🟡 ASSISTED (16 SOPs) — Claude drafts → approval queue → you approve → sends
- 🔴 HUMAN (4 SOPs) — Claude prepares brief, you execute live

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS (dark command centre theme) |
| State | Zustand + React Query |
| Charts | Recharts |
| Backend | Supabase (Postgres + Edge Functions) |
| AI | Anthropic Claude API |
| Cron | Vercel Cron Jobs |
| Ads | Meta Marketing API |
| Messaging | WhatsApp Business API |
| Email | Resend |

---

## Cost Estimate

| Service | Monthly |
|---------|---------|
| Anthropic API | ~£150–300 |
| Vercel Pro | £20 |
| Supabase Pro | £25 |
| WhatsApp | ~£50–100 |
| Resend | £0–20 |
| **Total** | **~£245–445/mo** |

Replacing a full-time operations hire at a fraction of the cost.
