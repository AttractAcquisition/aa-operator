# SOP Coverage Audit

**Generated:** 2026-05-10  
**Sources cross-referenced:**
- `supabase/functions/` — 31 directories (27 SOP functions + `run-sop` dispatcher + `claude-chat` + `meta-ads-sync`)
- `src/lib/mockData.ts` — `mockSOPs` array (15 entries, UI display list)
- `cron-runner.js` — Railway cron scheduler (18 jobs)
- `vercel.json` — Vercel cron fallback (9 jobs)

---

## Coverage Summary

| Metric | Count |
|--------|-------|
| Total SOPs in system | **28** |
| Deployed (dedicated Edge Function) | **27** |
| Partial (scheduled but no dedicated function) | **1** (SOP 02) |
| Missing (no implementation) | **0** |
| Scheduled via Railway cron | **18** |
| Scheduled via Vercel cron | **9** |
| On-demand / event-triggered | **7** |
| In `mockSOPs` UI list | **15** |
| Built but missing from `mockSOPs` | **13** |

---

## Full SOP Registry

> **Status key:**  
> `DEPLOYED` — dedicated Edge Function exists and is reachable  
> `PARTIAL` — scheduled and visible in UI but lacks a dedicated Edge Function (runs via generic dispatcher only)  
> `MISSING` — no Edge Function found

| SOP # | Name | Edge Function | Schedule | Model | Domain | Tier | Status |
|------:|------|---------------|----------|-------|--------|------|--------|
| **01** | WhatsApp Outreach Draft Queue | `sop-01-outreach-drafts` | Weekdays 08:00 (Railway) | Sonnet 4.6 | Distribution | ASSISTED | ✅ DEPLOYED |
| **02** | Prospect Scraper & Batch Run | ~~no dedicated fn~~ `run-sop` | Monday 08:00 (Railway + Vercel) | Haiku 4.5 | Distribution | AUTO | ⚠️ PARTIAL |
| **03** | Prospect Enrichment, QA & Dedup | `sop-03-enrichment` | ON DEMAND | Haiku 4.5 | Distribution | AUTO | ✅ DEPLOYED |
| **04** | Prospect Import & CRM Staging | `sop-04-crm-staging` | ON DEMAND | Haiku 4.5 | Distribution | AUTO | ✅ DEPLOYED |
| **05** | Lead Sourcing & List QA | `sop-05-lead-sourcing` | ON DEMAND | Sonnet 4.6 | Distribution | AUTO | ✅ DEPLOYED |
| **06** | Reply Triage & CRM Hygiene | `sop-06-reply-triage` | Daily 07:30 (Railway + Vercel) | Haiku 4.5 | Distribution | AUTO | ✅ DEPLOYED |
| **07** | Discovery Call Booking & Prep | `sop-07-call-brief` | EVENT TRIGGERED | Sonnet 4.6 | Distribution | ASSISTED | ✅ DEPLOYED |
| **08** | MJR Build | `sop-08-mjr-build` | EVENT TRIGGERED | Sonnet 4.6 | Distribution | AUTO | ✅ DEPLOYED |
| **10** | MJR Delivery Sequence | `sop-10-delivery-sequence` | EVENT TRIGGERED | Sonnet 4.6 | Distribution | ASSISTED | ✅ DEPLOYED |
| **12** | SPOA Build | `sop-12-spoa-build` | EVENT TRIGGERED | Sonnet 4.6 | Distribution | AUTO | ✅ DEPLOYED |
| **15** | Offer Prep | `sop-15-offer-prep` | ON DEMAND | Sonnet 4.6 | Sales | ASSISTED | ✅ DEPLOYED |
| **17** | Onboarding Brief | `sop-17-onboarding-brief` | ON DEMAND | Sonnet 4.6 | Delivery | ASSISTED | ✅ DEPLOYED |
| **21** | Proof Sprint Daily Ops | `sop-21-sprint-daily-ops` | Daily 06:30 (Railway + Vercel) | _(direct SQL)_ | Delivery | AUTO | ✅ DEPLOYED |
| **23** | Proof Sprint Ads Monitoring | `sop-23-ads-monitoring` | Daily 07:00 (Railway + Vercel) | _(Meta API)_ | Delivery | AUTO | ✅ DEPLOYED |
| **26** | Sprint Closeout | `sop-26-sprint-closeout` | Daily 07:00 (Railway) | Sonnet 4.6 | Delivery | AUTO | ✅ DEPLOYED |
| **31** | Proof Brand Monthly Ops | `sop-31-proof-brand-monthly-ops` | 1st of month 09:00 (Railway) | Sonnet 4.6 | Delivery | AUTO | ✅ DEPLOYED |
| **33** | SOP Versioning | `sop-33-sop-versioning` | 1st of month 11:00 (Railway) | Sonnet 4.6 | Operations | AUTO | ✅ DEPLOYED |
| **35** | Upsell Detection | `sop-35-upsell-detection` | Monday 09:00 (Railway) | Sonnet 4.6 | Sales | AUTO | ✅ DEPLOYED |
| **41** | Weekly Review | `sop-41-weekly-review` | Friday 16:00 (Railway) | Sonnet 4.6 | Principal | AUTO | ✅ DEPLOYED |
| **43** | Authority Brand Monthly Ops | `sop-43-authority-brand-monthly-ops` | 1st of month 10:00 (Railway) | Sonnet 4.6 | Delivery | AUTO | ✅ DEPLOYED |
| **46** | Billing & Payment Chase | `sop-46-billing` | Monday 08:30 (Railway) | Sonnet 4.6 | Finance | AUTO | ✅ DEPLOYED |
| **47** | Weekly Client Reporting | `sop-47-weekly-reports` | Friday 17:00 (Railway + Vercel) | Sonnet 4.6 | Delivery | AUTO | ✅ DEPLOYED |
| **49** | Content Generation | `sop-49-content` | ON DEMAND | Sonnet 4.6 | Marketing | AUTO | ✅ DEPLOYED |
| **51** | Admin Check | `sop-51-admin-check` | Monday 06:30 (Railway) | Haiku 4.5 | Operations | AUTO | ✅ DEPLOYED |
| **52** | Backup & Security Check | `sop-52-backup-check` | Sunday 01:00 (Railway + Vercel) | Haiku 4.5 | Operations | AUTO | ✅ DEPLOYED |
| **53** | Monthly KPI Review | `sop-53-kpi-review` | 1st of month 08:00 (Railway) | Sonnet 4.6 | Operations | AUTO | ✅ DEPLOYED |
| **56** | Finance Dashboard & Income Tracking | `sop-56-finance-dashboard` | Monday 06:00 (Railway + Vercel) | Haiku 4.5 | Finance | AUTO | ✅ DEPLOYED |
| **58** | Admin Command Centre & Daily Briefing | `sop-58-daily-briefing` | Daily 05:00 (Railway + Vercel) | Sonnet 4.6 | Principal | AUTO | ✅ DEPLOYED |

---

## Gaps & Issues

### ⚠️ GAP 1 — SOP 02 has no dedicated Edge Function

**SOP 02 — Prospect Scraper & Batch Run** is scheduled in both `cron-runner.js` (Monday 08:00) and `vercel.json`, and it appears in the `mockSOPs` UI list, but no `sop-02-*` Edge Function directory exists. It currently falls through to the generic `run-sop` dispatcher, which has no scraper implementation.

```
Expected:  supabase/functions/sop-02-prospect-scraper/index.ts
Found:     (nothing)
Scheduled: cron-runner.js — sop_id '02', Monday 08:00
mockSOPs:  tier: AUTO, model: claude-haiku-4-5-20251001
           tools: trigger_scraper_run, stage_batch_results
```

**Recommended action:** Build `sop-02-prospect-scraper` — fetch from an external source (Checkatrade/Yell scraper or a third-party API), insert raw rows into `prospect_batches`, invoke `sop-03-enrichment` to continue the pipeline.

---

### ⚠️ GAP 2 — 13 deployed SOPs missing from the `mockSOPs` UI list

`src/lib/mockData.ts` (`mockSOPs`) is the data source for the SOP Control page. It only contains 15 entries and is missing the following 13 SOPs that have fully built Edge Functions:

| SOP # | Name | Schedule |
|------:|------|----------|
| 15 | Offer Prep | On demand |
| 17 | Onboarding Brief | On demand |
| 26 | Sprint Closeout | Daily 07:00 |
| 31 | Proof Brand Monthly Ops | 1st of month 09:00 |
| 33 | SOP Versioning | 1st of month 11:00 |
| 35 | Upsell Detection | Monday 09:00 |
| 41 | Weekly Review | Friday 16:00 |
| 43 | Authority Brand Monthly Ops | 1st of month 10:00 |
| 46 | Billing & Payment Chase | Monday 08:30 |
| 49 | Content Generation | On demand |
| 51 | Admin Check | Monday 06:30 |
| 52 | Backup & Security Check | Sunday 01:00 |
| 53 | Monthly KPI Review | 1st of month 08:00 |

**Recommended action:** Once `src/pages/SOPControl.tsx` is migrated to a live `sops` table (see TODO comment in that file), these will be populated from the database. Until then, add all 13 to `mockSOPs` in `src/lib/mockData.ts` so they appear in the UI.

---

### ⚠️ GAP 3 — 7 SOPs scheduled only via Railway, not in `vercel.json`

The following SOPs are in `cron-runner.js` (Railway) but absent from `vercel.json`:

| SOP # | Name | Railway Schedule |
|------:|------|-----------------|
| 26 | Sprint Closeout | Daily 07:00 |
| 31 | Proof Brand Monthly Ops | 1st of month 09:00 |
| 33 | SOP Versioning | 1st of month 11:00 |
| 35 | Upsell Detection | Monday 09:00 |
| 41 | Weekly Review | Friday 16:00 |
| 43 | Authority Brand Monthly Ops | 1st of month 10:00 |
| 46 | Billing & Payment Chase | Monday 08:30 |
| 53 | Monthly KPI Review | 1st of month 08:00 |

**Note:** This is intentional if Railway is the primary scheduler and Vercel is a fallback for core daily ops only. Document this decision explicitly if so.

---

### ℹ️ INFO — SOP number gaps (reserved / unbuilt)

The following SOP numbers are absent from all sources (no function, no cron entry, not in mockSOPs). These are likely reserved in the SOP roadmap:

```
09, 11, 13, 14, 16, 18, 19, 20, 22, 24, 25, 27, 28, 29, 30,
32, 34, 36, 37, 38, 39, 40, 42, 44, 45, 48, 50, 54, 55, 57
```

---

### ℹ️ INFO — Schedule discrepancy: cron-runner vs mockSOPs

The Railway `cron-runner.js` runs SOPs at UTC times adjusted for a **Europe/London** timezone. The `mockSOPs` `schedule_label` fields reflect the displayed local time. These diverge around BST/GMT changeovers — the cron expressions in `cron-runner.js` are the authoritative source.

| SOP | cron-runner.js | mockSOPs schedule_label |
|-----|---------------|------------------------|
| 58 | `0 5 * * *` (05:00 UTC) | Daily 06:00 |
| 21 | `30 6 * * *` (06:30 UTC) | Daily 07:30 |
| 23 | `0 7 * * *` (07:00 UTC) | Daily 08:00 |
| 06 | `30 7 * * *` (07:30 UTC) | Daily 08:30 |
| 01 | `0 8 * * 1-5` (08:00 UTC) | Weekdays 09:00 |
| 47 | `0 17 * * 5` (17:00 UTC) | Friday 17:00 |
| 56 | `0 6 * * 1` (06:00 UTC) | Monday 07:00 |

These are consistent — cron-runner.js runs at UTC, which displays as BST (+1) in the UI during British Summer Time.

---

## Model Distribution

| Model | SOPs |
|-------|------|
| `claude-sonnet-4-6` | 01, 05, 07, 08, 10, 12, 15, 17, 26, 31, 33, 35, 41, 43, 46, 47, 49, 53, 58 **(19)** |
| `claude-haiku-4-5-20251001` | 02, 03, 04, 06, 51, 52, 56 **(7)** |
| No Claude model _(direct API/SQL)_ | 21 _(Meta Ads sync)_, 23 _(Meta Marketing API)_ **(2)** |

**Routing logic in `run-sop` dispatcher:** Haiku for SOPs `02, 03, 04, 06, 52, 56` — all mechanical/structured data tasks. Sonnet for all others requiring reasoning or generation.

---

## Non-SOP Infrastructure Functions

| Function | Purpose |
|----------|---------|
| `run-sop` | Generic dispatcher — routes `sop_id` to appropriate logic when no dedicated function exists. Handles SOPs 02, 31, 35, 43 via embedded logic. |
| `claude-chat` | Agentic chat interface for the Chat page — not a SOP runner. Uses a 10-iteration tool loop with 6 read-only tools. |
| `meta-ads-sync` | Direct Meta Marketing API integration — called by SOP 21 to pull live ad performance data into `sprints` table. |
