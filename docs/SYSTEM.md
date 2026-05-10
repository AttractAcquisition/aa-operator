# AA Operator — System Architecture & Runbook

**Stack:** React + Vite · Supabase (Postgres + Edge Functions) · Railway (Express + Cron) · Vercel (optional fallback crons) · Meta Cloud API  
**Last updated:** 2026-05-10

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Infrastructure Components](#2-infrastructure-components)
3. [Database Tables](#3-database-tables)
4. [Edge Functions](#4-edge-functions)
5. [Cron Schedule](#5-cron-schedule)
6. [Two-Tier Model Routing](#6-two-tier-model-routing)
7. [Environment Variables](#7-environment-variables)
8. [Runbook — Common Operations](#8-runbook)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         OPERATOR BROWSER                            │
│                    React + Vite (Tailwind, RQ)                      │
│   Dashboard · ApprovalQueue · Pipeline · Sprints · Finance · Chat   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS  (VITE_SUPABASE_URL + ANON_KEY)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          SUPABASE                                   │
│                                                                     │
│  ┌──────────────────────┐    ┌───────────────────────────────────┐  │
│  │   PostgreSQL DB      │    │      Edge Functions (Deno)        │  │
│  │                      │    │                                   │  │
│  │  ai_task_log         │◄───│  run-sop          (dispatcher)    │  │
│  │  approval_queue      │    │  sop-01 → sop-58  (27 functions)  │  │
│  │  ai_alerts           │    │  claude-chat      (agentic loop)  │  │
│  │  cron_schedule       │    │  meta-ads-sync    (Meta API)      │  │
│  │  daily_briefings     │    │                                   │  │
│  │  clients             │◄───│  ← reads/writes all tables        │  │
│  │  prospects           │    │  ← calls Anthropic API            │  │
│  │  sprints             │    │  ← calls Meta Marketing API       │  │
│  │  finance_ledger      │    └───────────────────────────────────┘  │
│  │  finance_snapshots   │                    ▲                      │
│  │  knowledge_base      │                    │  invoke()            │
│  │  kpi_snapshots       │                    │                      │
│  │  whatsapp_messages   │    ┌───────────────┴───────────────────┐  │
│  │  prospect_batches    │    │        Storage Bucket             │  │
│  │  documents bucket    │    │   documents/  (MJR, SPOA, Offer)  │  │
│  └──────────────────────┘    └───────────────────────────────────┘  │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │ service_role key
              ┌────────────────────────┴──────────────────────┐
              │                   RAILWAY                      │
              │                                               │
              │  ┌─────────────────────┐  ┌────────────────┐  │
              │  │   server.js         │  │ cron-runner.js │  │
              │  │   Express :8080     │  │ 18 cron jobs   │  │
              │  │                     │  │ node-cron      │  │
              │  │  GET  /webhook/wa   │  │ Europe/London  │  │
              │  │  POST /webhook/wa   │  └────────┬───────┘  │
              │  │  GET  /* → SPA      │           │          │
              │  └──────────┬──────────┘           │          │
              └─────────────┼───────────────────────┼──────────┘
                            │                       │
              ┌─────────────┴──────┐    ┌───────────┴──────────┐
              │   META CLOUD API   │    │   SUPABASE EDGE FNs   │
              │  WhatsApp inbound  │    │  supabase.functions   │
              │  messages webhook  │    │  .invoke(sop_name)    │
              └────────────────────┘    └──────────────────────┘
                                                   │
                                        ┌──────────┴──────────┐
                                        │  ANTHROPIC API       │
                                        │  claude-sonnet-4-6   │
                                        │  claude-haiku-4-5    │
                                        └─────────────────────┘

Optional: VERCEL (cron fallback for 9 core SOPs if Railway is down)
```

### Data flow — WhatsApp inbound message

```
Meta Cloud API
    │  POST /webhook/whatsapp
    ▼
server.js (Railway)
    │  1. ACK 200 immediately
    │  2. Normalise phone number (+E.164 / UK local)
    │  3. Look up prospect by phone variants
    │  4. Upsert → whatsapp_messages (onConflict: wamid)
    │  5. Fire sop-06-reply-triage (async, no await)
    ▼
sop-06-reply-triage (Edge Function)
    │  Classify reply → warm / cold / not_interested
    │  Update prospects.status
    │  Create approval_queue item if warm
    ▼
Operator browser — Approval Queue page
```

### Data flow — scheduled SOP run

```
cron-runner.js (Railway, node-cron, Europe/London)
    │  At scheduled time:
    │  1. Update cron_schedule → last_status: 'running'
    │  2. supabase.functions.invoke(fn_name or 'run-sop')
    │  3. On success: write ai_task_log, update cron_schedule
    │  4. On failure: write ai_task_log + ai_alerts (severity: critical)
    ▼
Edge Function (Deno, Supabase)
    │  Reads Supabase tables
    │  Calls Anthropic API (Claude)
    │  Writes results, creates approval items, raises alerts
    ▼
Operator browser — Dashboard / ApprovalQueue / Alerts pages
```

---

## 2. Infrastructure Components

### Railway — two services

| Service | File | Purpose |
|---------|------|---------|
| **Web server** | `server.js` | Serves the compiled React SPA, handles WhatsApp webhook (`/webhook/whatsapp`), proxies nothing — static host + webhook receiver |
| **Cron runner** | `cron-runner.js` | Schedules all 18 automated SOPs using `node-cron`. Timezone: `Europe/London`. Writes directly to Supabase on success/failure. |

### Supabase

| Component | Purpose |
|-----------|---------|
| **PostgreSQL** | Single source of truth for all operational data |
| **Edge Functions** | 31 Deno functions — SOP logic, agentic loops, API integrations |
| **Storage** | `documents` bucket — generated MJR, SPOA, Offer, and Onboarding HTML files |
| **Row Level Security** | Enabled on all tables. Anon role gets read on most; service role gets full access. `approval_queue` anon gets insert + update. |

### Vercel (optional fallback)

9 cron jobs in `vercel.json` call `/api/cron?sop=N` on the deployed preview. Used as a fallback if Railway cron runner is down. Covers SOPs: **01, 02, 06, 21, 23, 47, 52, 56, 58** only.

---

## 3. Database Tables

All tables are in the `public` schema with RLS enabled.

### `ai_task_log`
Every tool invocation made by Claude across all SOP runs.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `created_at` | timestamptz | |
| `sop_id` | text | e.g. `'21'` |
| `sop_name` | text | Human-readable name |
| `tool_called` | text | Tool or function name |
| `status` | text | `success` · `failure` · `running` |
| `duration_ms` | integer | Wall-clock time |
| `input_summary` | text | Brief description of inputs |
| `output_summary` | text | Brief description of outputs |

**Access:** Anon read, service role full. Indexed on `created_at DESC`, `sop_id`, `status`.

---

### `approval_queue`
Pre-existing table extended with SOP-specific columns. Holds all AI-generated content awaiting human review before action.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `created_at` | timestamptz | |
| `content_type` | text | Maps to `ApprovalType` in UI |
| `status` | text | `pending` · `approved` · `rejected` · `edited` |
| `sop_id` | text | Which SOP created this item |
| `sop_name` | text | |
| `priority` | text | `high` · `medium` · `low` |
| `content` | jsonb | `{ title, body, recipient, metadata, html_report? }` |
| `reviewed_at` | timestamptz | |
| `reviewer_notes` | text | |

**Access:** Anon read + insert + update, service role full.

---

### `ai_alerts`
Critical/warning/info alerts raised by Claude during SOP runs and by the cron runner on job failure.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `created_at` | timestamptz | |
| `severity` | text | `critical` · `warning` · `info` |
| `sop_id` | text | Originating SOP (nullable) |
| `category` | text | e.g. `Sprint Performance`, `Cron Failure`, `Finance` |
| `message` | text | Full alert description |
| `suggested_action` | text | What the operator should do |
| `resolved` | boolean | Default false |
| `resolved_at` | timestamptz | |
| `client_name` | text | Nullable — for client-specific alerts |

**Access:** Anon read + update (for resolve), service role full.

---

### `cron_schedule`
One row per scheduled SOP. Tracks run history and controls active/paused state from the Cron Manager UI.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `sop_id` | text | Unique — `'01'` through `'58'` |
| `sop_name` | text | |
| `domain` | text | `Distribution` · `Delivery` · `Finance` · `Operations` · `Principal` |
| `cron_expression` | text | UTC cron syntax |
| `schedule_label` | text | Human display (BST local time) |
| `is_active` | boolean | Toggle from Cron Manager UI |
| `last_run` | timestamptz | |
| `next_run` | timestamptz | |
| `last_status` | text | `success` · `failure` · `running` |
| `run_count` | integer | Lifetime total |
| `avg_duration_ms` | integer | Rolling average |
| `last_error` | text | Most recent failure message |

**Access:** Anon read + update (for pause/resume), service role full.

---

### `knowledge_base`
SOP definitions, prompt templates, message scripts, and reference documents consumed as context by Claude during SOP runs.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `created_at` / `updated_at` | timestamptz | Auto-updated trigger |
| `type` | text | `sop` · `template` · `script` · `reference` · `client_context` |
| `title` | text | |
| `content` | text | Full text — injected into Claude system prompt |
| `metadata` | jsonb | Arbitrary key/value |
| `tags` | text[] | GIN indexed for fast tag filtering |
| `is_active` | boolean | Inactive docs excluded from context |

---

### `daily_briefings`
One row per briefing run (SOP 58). Stores the structured briefing JSON used by the Dashboard Command Centre.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `generated_at` | timestamptz | |
| `briefing` | jsonb | `DailyBriefing` shape: priorities, sprint_snapshot, KPIs, MRR |

**UI reads:** Latest row only (`ORDER BY generated_at DESC LIMIT 1`).

---

### `prospect_batches`
Staging area for raw scraped prospects before enrichment (SOP 02 → 03 pipeline).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `created_at` | timestamptz | |
| `source` | text | `checkatrade` · `yell` · `google_maps` etc. |
| `status` | text | `raw` · `enriched` · `staged` · `failed` |
| `data` | jsonb | Raw scraped record |
| `batch_id` | text | Groups records from one scrape run |

---

### `clients`
Master client record. Extended across multiple migrations with tier tracking, upsell fields, and finance linkage.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `name` | text | Contact name |
| `company` | text | Business name |
| `tier` | text | `proof_sprint` · `proof_brand` · `authority_brand` |
| `status` | text | `active` · `paused` · `churned` · `onboarding` |
| `mrr` | integer | Monthly recurring revenue (£) |
| `start_date` | date | |
| `niche` | text | Trade category |
| `active_sprint_id` | uuid | FK → `sprints` (nullable) |
| `next_review_date` | date | |
| `account_manager` | text | |
| `upsell_score` | integer | Computed by SOP 35 |
| `upsell_eligible` | boolean | Set by SOP 35 |

---

### `finance_ledger`
Double-entry style log of all income and expense transactions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `invoice_date` | date | |
| `entry_type` | text | `income` · `expense` |
| `client_id` | uuid | Nullable FK → `clients` |
| `client_name` | text | Denormalised for display |
| `invoice_number` | text | |
| `amount` | numeric | GBP |
| `status` | text | `paid` · `pending` · `overdue` · `partial` · `cancelled` |
| `description` | text | |
| `notes` | text | |

**UI reads:** Current month entries by `invoice_date`. Indexed on `invoice_date`.

---

### `finance_snapshots`
Weekly aggregated finance summary generated by SOP 56 every Monday.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `snapshot_date` | date | |
| `finance_summary` | jsonb | MRR, income, expenses, net profit, outstanding, overdue, 90-day forecast, health score |

**UI reads:** Latest row only.

---

### `kpi_snapshots`
Monthly KPI snapshots generated by SOP 53 on the 1st of each month.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `snapshot_date` | date | |
| `metrics` | jsonb | reply_rate, warm_rate, close_rate, avg_cpl, avg_roas, mrr_growth_rate, client_retention, revenue_per_client |

---

### `whatsapp_messages`
Inbound and outbound WhatsApp messages, linked to prospects.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `prospect_id` | uuid | FK → `prospects` (nullable — unmatched numbers) |
| `direction` | text | `inbound` · `outbound` |
| `message_body` | text | Raw text content |
| `whatsapp_message_id` | text | Meta `wamid` — unique, used for upsert dedup |
| `from_number` | text | E.164 digits (no `+`) |
| `status` | text | `sent` · `delivered` · `read` · `failed` |
| `sent_at` | timestamptz | From Meta timestamp |
| `created_at` | timestamptz | |

**Note:** `prospects` and `sprints` tables are also used throughout the system but have no migrations in this repo (assumed pre-existing or created manually).

### Supabase Storage

| Bucket | Path pattern | Contents |
|--------|-------------|---------|
| `documents` | `mjr/{prospect_id}/...` | MJR HTML reports (SOP 08) |
| `documents` | `spoa/{prospect_id}/...` | SPOA HTML documents (SOP 12) |
| `documents` | `offer/{prospect_id}/...` | Offer documents (SOP 15) |
| `documents` | `onboarding/{client_id}/...` | Onboarding briefs (SOP 17) |

---

## 4. Edge Functions

All functions are in `supabase/functions/`. They run on Deno and are invoked via `supabase.functions.invoke()`.

### Infrastructure functions

| Function | Trigger | Description |
|----------|---------|-------------|
| `run-sop` | cron-runner / Vercel cron | Generic dispatcher. Routes `sop_id` to embedded logic for SOPs without dedicated functions (currently SOP 02, 31, 35, 43 inline logic). Haiku for `02 03 04 06 52 56`, Sonnet for all others. |
| `claude-chat` | User (Chat page) | Agentic chat loop (max 10 iterations). 6 read-only tools: `get_new_leads`, `get_active_sprints`, `get_open_tasks`, `get_pending_approvals`, `get_distro_metrics`, `get_ad_performance`. claude-sonnet-4-6. |
| `meta-ads-sync` | SOP 21 (internal invoke) | Pulls live campaign/adset performance from Meta Marketing API. Writes impressions, clicks, CPL, ROAS back to `sprints`. No Claude model. |

### SOP functions

| Function | SOP | Trigger | Model | Description |
|----------|-----|---------|-------|-------------|
| `sop-01-outreach-drafts` | 01 | Weekdays 08:00 | Sonnet | Generates personalised WhatsApp outreach messages for up to 25 staged prospects. Creates a single batch approval item. |
| _(run-sop dispatch)_ | 02 | Monday 08:00 | Haiku | **⚠️ No dedicated function.** Prospect scraper — should fetch raw leads from external sources and insert to `prospect_batches`. Currently a stub in `run-sop`. |
| `sop-03-enrichment` | 03 | On demand | Haiku | Enriches staged prospects via `web_search` (max 3 uses/prospect). Quality-scores 1–10, deduplicates. |
| `sop-04-crm-staging` | 04 | On demand | Haiku | Moves prospects with `quality_score >= 6` from `prospect_batches` into the active outreach batch. |
| `sop-05-lead-sourcing` | 05 | On demand | Sonnet | Analyses 90-day prospect data to recommend the best vertical/location for the next scrape run. |
| `sop-06-reply-triage` | 06 | Daily 07:30 + WhatsApp webhook | Haiku | Classifies up to 50 unclassified WhatsApp replies as `warm / cold / not_interested`. Creates approval items for warm leads. |
| `sop-07-call-brief` | 07 | Event (warm lead) | Sonnet | Generates call brief for up to 5 `call_booked` prospects. Web research (5 searches), pain-point analysis, objection angles. Creates approval item. |
| `sop-08-mjr-build` | 08 | Event (MJR ready) | Sonnet | Two-phase MJR build: market research then template fill (4 web searches). Stores HTML to `documents` bucket. Max 3 prospects/run. |
| `sop-10-delivery-sequence` | 10 | Event (MJR sent) | Sonnet | Drafts 3-message WhatsApp delivery sequence for up to 5 `mjr_sent` prospects. Creates approval items. |
| `sop-12-spoa-build` | 12 | Event (call complete) | Sonnet | Three-phase SPOA build: prospect research → competitor analysis → plan generation (5 web searches). Stores HTML doc. Max 3/run. |
| `sop-15-offer-prep` | 15 | On demand | Sonnet | Tier-aware offer document generator (Proof Sprint / Proof Brand / Authority Brand pricing). Web research (5 searches). |
| `sop-17-onboarding-brief` | 17 | Event (client signed) | Sonnet | Generates full onboarding brief with campaign strategy, ad budgets, and targeting plan. Budget tiers: PS £800, PB £1500, AB £3000. |
| `sop-21-sprint-daily-ops` | 21 | Daily 06:30 | _(direct SQL)_ | Aggregates daily sprint metrics, invokes `meta-ads-sync`, computes health status (`on_track` if CPL ≤ 110% target). Creates sprint log entries and alerts. |
| `sop-23-ads-monitoring` | 23 | Daily 07:00 | _(Meta API)_ | Kill/scale logic on all active ad sets. Kill if CPL > 140% target for 3+ days. Scale if CPL < 80% target. Creates alerts for flagged sets. |
| `sop-26-sprint-closeout` | 26 | Daily 07:00 | Sonnet | Detects sprints past end date, generates closeout reports, moves `status → complete`, archives campaign data. |
| `sop-31-proof-brand-ops` | 31 | 1st of month 09:00 | Sonnet | Monthly Proof Brand client review. Computes upsell readiness score (threshold 8/10). Flags eligible clients for Authority Brand conversation. |
| `sop-33-sop-versioning` | 33 | 1st of month 11:00 | Sonnet | Reviews all active SOPs against 30-day performance data. Flags underperforming automations and suggests prompt/logic improvements to `knowledge_base`. |
| `sop-35-upsell-detection` | 35 | Monday 09:00 | Sonnet | Deterministic scoring across 5 dimensions (sprint completion, CPL performance, satisfaction, tenure, tier headroom). Updates `clients.upsell_score`. |
| `sop-41-weekly-review` | 41 | Friday 16:00 | Sonnet | 7-day operational snapshot — approval throughput, alert resolution rate, SOP success rates. Writes to `ai_task_log` as summary entry. |
| `sop-43-authority-brand-ops` | 43 | 1st of month 10:00 | Sonnet | Monthly Authority Brand client review. Retention risk assessment for £3 000/mo clients. Flags churn signals. |
| `sop-46-billing` | 46 | Monday 08:30 | Sonnet | Generates WhatsApp payment chase messages for invoices 7+ days overdue. Creates approval items for review before sending. |
| `sop-47-weekly-reports` | 47 | Friday 17:00 | Sonnet | Generates professional HTML performance reports for all active clients. Supports single-client mode (`{ client_id }`). Creates approval items. |
| `sop-49-content` | 49 | On demand | Sonnet | Produces 5 platform-specific content pieces (LinkedIn, Instagram, Facebook, Email, Blog) based on sprint data and case studies. |
| `sop-51-admin-check` | 51 | Monday 06:30 | Haiku | Health check: counts failed jobs (7d), stale approvals (48h+), unresolved critical alerts (24h+). Raises `ai_alerts` for anything out of threshold. |
| `sop-52-backup-check` | 52 | Sunday 01:00 | Haiku | Verifies env vars, cron schedule health, and that daily SOPs (58, 21, 23, 06, 26) ran within the last 24 h. Supports `dry_run` mode. |
| `sop-53-kpi-review` | 53 | 1st of month 08:00 | Sonnet | Computes 8 business KPIs, compares to prior month, writes `kpi_snapshots` row. Raises alerts for metrics outside target bands. |
| `sop-56-finance-dashboard` | 56 | Monday 06:00 | Haiku | Aggregates `finance_ledger`, computes MRR by tier (PS £800, PB £1500, AB £3000), calculates net profit, flags overdue invoices, writes `finance_snapshots`. |
| `sop-58-daily-briefing` | 58 | Daily 05:00 | Sonnet | Master daily briefing: pulls KPIs, sprint snapshots, open alerts, pending approvals. Ranks priorities by urgency. Writes `daily_briefings` row. Supports `dry_run`. |

---

## 5. Cron Schedule

All times are **UTC**. The cron runner runs in `Europe/London` timezone so the displayed local times shift by +1 h during BST (late March → late October).

### Daily jobs

| UTC Time | Local (BST) | SOP | Function | Description |
|----------|-------------|-----|----------|-------------|
| 01:00 Sun | 02:00 Sun | 52 | `sop-52-backup-check` | Weekly security & health check |
| 05:00 daily | 06:00 | 58 | `sop-58-daily-briefing` | Command centre briefing |
| 06:00 Mon | 07:00 Mon | 56 | `sop-56-finance-dashboard` | Weekly finance snapshot |
| 06:30 daily | 07:30 | 21 | `sop-21-sprint-daily-ops` | Sprint daily ops + Meta sync |
| 06:30 Mon | 07:30 Mon | 51 | `sop-51-admin-check` | Weekly admin health check |
| 07:00 daily | 08:00 | 23 | `sop-23-ads-monitoring` | Kill/scale ad sets |
| 07:00 daily | 08:00 | 26 | `sop-26-sprint-closeout` | Detect + close completed sprints |
| 07:30 daily | 08:30 | 06 | `sop-06-reply-triage` | Classify overnight WhatsApp replies |
| 08:00 weekdays | 09:00 | 01 | `sop-01-outreach-drafts` | Generate outreach batch |
| 08:00 Mon | 09:00 Mon | 02 | `run-sop` | Prospect scraper ⚠️ stub |
| 08:00 Mon | 09:00 Mon | 35 | `sop-35-upsell-detection` | Score all clients for upsell |
| 08:30 Mon | 09:30 Mon | 46 | `sop-46-billing` | Chase overdue invoices |

### Weekly jobs

| UTC Time | Local (BST) | SOP | Function | Description |
|----------|-------------|-----|----------|-------------|
| 16:00 Fri | 17:00 Fri | 41 | `sop-41-weekly-review` | 7-day operational snapshot |
| 17:00 Fri | 18:00 Fri | 47 | `sop-47-weekly-reports` | Generate client performance reports |

### Monthly jobs (1st of month)

| UTC Time | Local (BST) | SOP | Function | Description |
|----------|-------------|-----|----------|-------------|
| 08:00 | 09:00 | 53 | `sop-53-kpi-review` | Business KPI computation |
| 09:00 | 10:00 | 31 | `sop-31-proof-brand-ops` | Proof Brand monthly review |
| 10:00 | 11:00 | 43 | `sop-43-authority-brand-ops` | Authority Brand monthly review |
| 11:00 | 12:00 | 33 | `sop-33-sop-versioning` | SOP performance review |

### On-demand / event-triggered (no cron)

| SOP | Trigger event | Description |
|-----|--------------|-------------|
| 03 | After SOP 02 / manual | Prospect enrichment |
| 04 | After SOP 03 | CRM staging |
| 05 | Manual / weekly | Lead source selection |
| 07 | Prospect hits `call_booked` | Call brief generation |
| 08 | Prospect hits `mjr_ready` | MJR document build |
| 10 | After SOP 08 | MJR delivery sequence |
| 12 | After discovery call | SPOA build |
| 15 | Pre-close / manual | Offer document |
| 17 | Client signs / manual | Onboarding brief |
| 49 | Manual | Content generation |

---

## 6. Two-Tier Model Routing

Claude model is selected based on task type. The `run-sop` dispatcher and each dedicated function hard-code their model.

### Haiku 4.5 (`claude-haiku-4-5-20251001`) — mechanical tasks

Used for structured data processing where reasoning depth is not required. Cheaper and faster.

| SOP | Task type |
|-----|-----------|
| 02 | Prospect scraping/staging |
| 03 | Prospect enrichment & quality scoring |
| 04 | CRM batch staging |
| 06 | Reply classification |
| 51 | Admin health check thresholds |
| 52 | Backup/env-var verification |
| 56 | Finance ledger aggregation |

### Sonnet 4.6 (`claude-sonnet-4-6`) — reasoning & generation

Used for all tasks requiring writing, analysis, research synthesis, or multi-step reasoning.

| SOPs | Task type |
|------|-----------|
| 01, 10, 46 | Personalised message drafting |
| 05, 31, 35, 43 | Strategic analysis & scoring |
| 07, 08, 12, 15, 17 | Document generation with web research |
| 26, 41, 47 | Report generation & synthesis |
| 33, 53 | Performance review & recommendations |
| 49 | Multi-platform content creation |
| 58 | Daily briefing synthesis |
| `claude-chat` | Agentic operator chat |

### No model (direct API/SQL)

| Function | Approach |
|----------|---------|
| `sop-21-sprint-daily-ops` | Direct Postgres queries + invokes `meta-ads-sync` |
| `sop-23-ads-monitoring` | Direct Meta Marketing API calls, deterministic kill/scale logic |
| `meta-ads-sync` | Meta Marketing API — no Claude involvement |

---

## 7. Environment Variables

### Frontend — `.env.local` (Vite, browser-safe)

| Variable | Where to get it | Required |
|----------|----------------|---------|
| `VITE_SUPABASE_URL` | Supabase → Project → Settings → API | ✅ |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project → Settings → API → anon/public key | ✅ |

### Railway server — `server.js`

| Variable | Purpose | Required |
|----------|---------|---------|
| `SUPABASE_URL` | Service-role Supabase client | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Full DB access for webhook writes | ✅ |
| `WEBHOOK_VERIFY_TOKEN` | Meta webhook verification challenge | ✅ |
| `PORT` | Express port (default: 8080) | optional |

### Railway cron runner — `cron-runner.js`

| Variable | Purpose | Required |
|----------|---------|---------|
| `SUPABASE_URL` | Supabase client | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Full DB access for cron writes | ✅ |

### Supabase Edge Functions — set via `supabase secrets set`

| Variable | Purpose | Required |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | All Claude API calls | ✅ |
| `SUPABASE_URL` | Auto-provided by Supabase runtime | auto |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-provided by Supabase runtime | auto |
| `META_ACCESS_TOKEN` | Meta Marketing API (SOPs 21, 23) | ✅ for ads |
| `META_AD_ACCOUNT_ID` | Ad account ID (e.g. `act_123456`) | ✅ for ads |
| `META_GRAPH_API_VERSION` | e.g. `v19.0` (default if unset) | optional |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp send messages | ✅ for WA sends |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp Cloud API token | ✅ for WA sends |
| `RESEND_API_KEY` | Email notifications | optional |
| `RESEND_FROM_EMAIL` | Sender address | optional |

---

## 8. Runbook

### How to manually trigger any SOP

**Option A — Cron Manager UI (recommended)**

1. Open the app → **Cron Manager** page
2. Find the SOP row by number or name
3. Click the ▶ **Run Now** button on the right
4. Status dot turns blue/pulsing while running; check **AI Task Log** on the Dashboard for output

**Option B — Supabase Dashboard**

1. Open [Supabase Dashboard](https://app.supabase.com) → your project → Edge Functions
2. Find the function (e.g. `sop-47-weekly-reports`)
3. Click **Invoke** → set body if needed → **Send**

**Option C — curl (service role)**

```bash
# Invoke a dedicated function directly
curl -X POST \
  "$SUPABASE_URL/functions/v1/sop-47-weekly-reports" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'

# Invoke via the run-sop dispatcher
curl -X POST \
  "$SUPABASE_URL/functions/v1/run-sop" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sop_id": "06"}'

# Invoke for a specific client (where supported)
curl -X POST \
  "$SUPABASE_URL/functions/v1/sop-47-weekly-reports" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "cli_001"}'
```

**Option D — Claude Code (from this repo)**

```bash
# Trigger via the Supabase CLI
supabase functions invoke sop-58-daily-briefing --data '{}'
supabase functions invoke run-sop --data '{"sop_id":"06"}'
```

---

### How to add a new prospect

**Manual (direct DB insert)**

```sql
INSERT INTO public.prospects (
  name, company, phone, status, quality_score, source_list, niche
) VALUES (
  'John Smith', 'Smith Plumbing Ltd', '+447700900123',
  'new', 7, 'manual', 'Plumbing'
);
```

**Via the pipeline (recommended)**

1. Ensure source data is in `prospect_batches` with `status = 'raw'`
2. Trigger **SOP 03** (Enrichment) — it will score and dedup
3. Trigger **SOP 04** (CRM Staging) — it will move `quality_score >= 6` to `staged`
4. SOP 01 will pick up `staged` prospects in the next weekday outreach run

**Via AI Chat**

Open the **Chat** page and say:  
> "Add a new prospect: [Name], [Company], [Phone], [Trade], [Location]"

The agentic loop will call `get_new_leads` and guide you through the intake.

---

### How to resolve a failed cron job

1. **Check the alert** — failed jobs automatically create a `critical` alert in `ai_alerts`. Open the **Alerts** page and read the message and suggested action.

2. **Check the AI Task Log** — Dashboard → Overnight AI Activity panel shows the last 10 runs with status dots and output summaries. The failed entry will show the error string.

3. **Check Railway logs** — In Railway dashboard → your cron runner service → **Logs**. Look for `[timestamp] SOP N FAILED: <message>`.

4. **Diagnose common causes:**

   | Symptom | Likely cause | Fix |
   |---------|-------------|-----|
   | `FunctionsHttpError: 401` | Expired or wrong service role key | Rotate `SUPABASE_SERVICE_ROLE_KEY` in Railway env |
   | `FunctionsHttpError: 500` | Edge Function runtime error | Check Supabase Edge Function logs |
   | `Anthropic API error: 429` | Rate limit hit | Retry after backoff; upgrade Anthropic tier if recurring |
   | `Meta API: OAuthException` | Expired Meta access token | Rotate `META_ACCESS_TOKEN` (see key rotation runbook) |
   | `connection timeout` | Supabase briefly unavailable | Re-run manually; usually self-heals |
   | `cron_schedule not updated` | DB write failure post-run | Run `UPDATE cron_schedule SET last_status='success' WHERE sop_id='N'` manually |

5. **Re-run the job** — once the root cause is fixed, use the Cron Manager UI Run Now button or curl (see above). The `run_count` and `avg_duration_ms` will update correctly.

6. **Resolve the alert** — open the **Alerts** page, find the critical alert, click ✕ to mark resolved.

---

### How to add a new SOP

1. **Create the Edge Function directory:**

   ```bash
   mkdir supabase/functions/sop-XX-my-new-sop
   touch supabase/functions/sop-XX-my-new-sop/index.ts
   ```

2. **Write the function** — follow the pattern in an existing function. Key requirements:
   - Import shared `cors` headers from `../_shared/`
   - Accept `Authorization: Bearer` header
   - Write a row to `ai_task_log` on both success and failure
   - On failure, write a row to `ai_alerts` (severity `'critical'`)

3. **Deploy the function:**

   ```bash
   supabase functions deploy sop-XX-my-new-sop
   ```

4. **Add to the cron runner** (if scheduled) — edit `cron-runner.js`:

   ```js
   { sop_id: 'XX', name: 'My New SOP', schedule: '0 9 * * 1', fn: 'sop-XX-my-new-sop' },
   ```

5. **Add to `cron_schedule` table** — insert a row so the Cron Manager UI shows it:

   ```sql
   INSERT INTO public.cron_schedule (sop_id, sop_name, domain, cron_expression, schedule_label, next_run)
   VALUES ('XX', 'My New SOP', 'Distribution', '0 9 * * 1', 'Monday 09:00',
           (NOW() + INTERVAL '7 days'));
   ```

6. **Add to `mockSOPs`** in `src/lib/mockData.ts` so it appears on the SOP Control page (until the `sops` table is built).

7. **Update `docs/sop-audit.md`** to reflect the new SOP.

---

### How to rotate API keys

#### Anthropic API key

```bash
# 1. Generate new key at console.anthropic.com → API Keys
# 2. Set in Supabase Edge Functions:
supabase secrets set ANTHROPIC_API_KEY=sk-ant-new-key-here

# 3. Verify by triggering a lightweight SOP:
supabase functions invoke sop-52-backup-check --data '{"dry_run":true}'
```

#### Supabase service role key

```bash
# 1. Rotate at Supabase → Project → Settings → API → service_role
# 2. Update Railway server env:
#    Railway Dashboard → server.js service → Variables → SUPABASE_SERVICE_ROLE_KEY
# 3. Update Railway cron-runner env:
#    Railway Dashboard → cron-runner service → Variables → SUPABASE_SERVICE_ROLE_KEY
# 4. Update local .env.local (VITE_SUPABASE_ANON_KEY is separate and doesn't need rotation)

# 5. Verify cron runner reconnects:
#    Railway → cron-runner → Logs — should see "Cron runner started" after redeploy
```

#### Meta access token

```bash
# 1. Generate new long-lived token at:
#    developers.facebook.com → Your App → Marketing API → Tools → Access Token
# 2. Set in Supabase secrets:
supabase secrets set META_ACCESS_TOKEN=new-token-here

# 3. Verify by triggering ads sync:
supabase functions invoke sop-23-ads-monitoring --data '{}'
```

#### WhatsApp webhook verify token

```bash
# 1. Choose a new random string (e.g. openssl rand -hex 16)
NEW_TOKEN=$(openssl rand -hex 16)

# 2. Update Railway server env variable:
#    Railway → web server → Variables → WEBHOOK_VERIFY_TOKEN = $NEW_TOKEN

# 3. Update Meta webhook verification token:
#    Facebook Developer Console → Your App → WhatsApp → Configuration → Webhook
#    → Edit → Verify Token → paste $NEW_TOKEN → Verify and Save

# 4. No Supabase secret change needed — only server.js uses this token
```

---

*For the full SOP-by-SOP coverage audit (deployment status, gaps, schedule discrepancies) see [`docs/sop-audit.md`](./sop-audit.md).*
