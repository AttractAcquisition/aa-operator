// ─── Mock Data ────────────────────────────────────────────────────────────────
// Only exports still used as fallbacks for tables that don't yet have migrations:
//   - mockSprints         → Sprints.tsx        (no 'sprints' table yet)
//   - mockSOPs            → SOPControl.tsx     (no 'sops' table yet)
//   - mockPipelineCounts  → Pipeline.tsx       (no 'prospects' table yet)
//   - mockConversionChart → Pipeline.tsx       (no 'prospects' table yet)

import type { Sprint, SOP } from '@/types'

// ─── Active Sprints ──────────────────────────────────────────────────────────
export const mockSprints: Sprint[] = [
  {
    id: 'spr_001', client_id: 'cli_001', client_name: 'Apex Plumbing',
    status: 'active', start_date: '2026-04-22', end_date: '2026-05-06',
    day_number: 8, leads_generated: 34, leads_target: 42, spend: 1680, spend_budget: 2100,
    cpl: 12.40, cpl_target: 15, roas: 4.2, roas_target: 3.5,
    last_log_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    campaign_ids: ['camp_001', 'camp_002'],
  },
  {
    id: 'spr_002', client_id: 'cli_002', client_name: 'Swift Electrical',
    status: 'active', start_date: '2026-04-27', end_date: '2026-05-11',
    day_number: 3, leads_generated: 11, leads_target: 9, spend: 680, spend_budget: 2100,
    cpl: 18.20, cpl_target: 20, roas: 3.1, roas_target: 3.0,
    last_log_at: new Date(Date.now() - 1000 * 60 * 85).toISOString(),
    campaign_ids: ['camp_003'],
  },
  {
    id: 'spr_003', client_id: 'cli_003', client_name: 'Leeds Roofing Co',
    status: 'active', start_date: '2026-04-19', end_date: '2026-05-03',
    day_number: 11, leads_generated: 28, leads_target: 38, spend: 2200, spend_budget: 2100,
    cpl: 22.10, cpl_target: 18, roas: 2.4, roas_target: 3.2,
    last_log_at: new Date(Date.now() - 1000 * 60 * 92).toISOString(),
    campaign_ids: ['camp_004', 'camp_005'],
  },
  {
    id: 'spr_004', client_id: 'cli_004', client_name: 'Midlands HVAC',
    status: 'active', start_date: '2026-04-24', end_date: '2026-05-08',
    day_number: 6, leads_generated: 14, leads_target: 18, spend: 1570, spend_budget: 2100,
    cpl: 31.40, cpl_target: 20, roas: 1.8, roas_target: 3.0,
    last_log_at: new Date(Date.now() - 1000 * 60 * 88).toISOString(),
    campaign_ids: ['camp_006'],
  },
]

// ─── SOPs Master List ─────────────────────────────────────────────────────────
export const mockSOPs: SOP[] = [
  { id: 'sop_01', num: '01', name: 'WhatsApp Outreach', domain: 'Distribution', tier: 'ASSISTED', cron_expression: '0 9 * * 1-5', schedule_label: 'Weekdays 09:00', tools: ['generate_outreach_message', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*140).toISOString(), run_count: 62, description: 'Drafts personalised WhatsApp messages for daily outreach batch. Creates approval item for your review before any message is sent.' },
  { id: 'sop_02', num: '02', name: 'Prospect Scraper & Batch Run', domain: 'Distribution', tier: 'AUTO', cron_expression: '0 8 * * 1', schedule_label: 'Monday 08:00', tools: ['normalise_prospects', 'dedup_prospects', 'insert_prospects', 'log_batch'], model: 'claude-haiku-4-5-20251001', is_active: true, last_run: new Date(Date.now() - 1000*60*60*72).toISOString(), run_count: 12, description: 'Calls the prospect scraper API (or accepts manual CSV rows) for the target source list. Normalises, deduplicates, and stages new rows with status=new, triggering SOP 03 enrichment automatically.' },
  { id: 'sop_03', num: '03', name: 'Prospect Enrichment, QA & Dedup', domain: 'Distribution', tier: 'AUTO', tools: ['web_search', 'add_enrichment_data', 'flag_duplicate'], model: 'claude-haiku-4-5-20251001', is_active: true, last_run: new Date(Date.now() - 1000*60*60*72).toISOString(), run_count: 12, description: 'Researches each prospect online, scores quality 1-10, removes duplicates, stages qualifying leads.' },
  { id: 'sop_04', num: '04', name: 'Prospect Import & CRM Staging', domain: 'Distribution', tier: 'AUTO', cron_expression: '0 8 * * 1-5', schedule_label: 'Weekdays 08:00', tools: ['stage_leads_to_batch', 'update_prospect_status'], model: 'claude-haiku-4-5-20251001', is_active: true, last_run: new Date(Date.now() - 1000*60*160).toISOString(), run_count: 62, description: 'Moves clean enriched leads into the daily outreach batch in the correct priority order.' },
  { id: 'sop_05', num: '05', name: 'Lead Sourcing & List QA', domain: 'Distribution', tier: 'AUTO', tools: ['get_distro_metrics', 'select_source_list'], model: 'claude-sonnet-4-6', is_active: true, run_count: 12, description: 'Analyses distro metrics to select the best performing vertical/location combination for scraping.' },
  { id: 'sop_06', num: '06', name: 'Reply Triage & CRM Hygiene', domain: 'Distribution', tier: 'AUTO', cron_expression: '30 8 * * *', schedule_label: 'Daily 08:30', tools: ['get_unread_replies', 'update_prospect_status', 'create_approval_item'], model: 'claude-haiku-4-5-20251001', is_active: true, last_run: new Date(Date.now() - 1000*60*150).toISOString(), run_count: 84, description: 'Classifies all incoming WhatsApp replies. Warm leads queued for your action. CRM updated automatically.' },
  { id: 'sop_07', num: '07', name: 'Discovery Call Booking & Prep', domain: 'Distribution', tier: 'ASSISTED', tools: ['generate_call_brief', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, run_count: 28, description: 'Generates detailed call brief for warm leads — company research, pain points, suggested angles.' },
  { id: 'sop_08', num: '08', name: 'MJR Build', domain: 'Distribution', tier: 'AUTO', tools: ['get_prospect_detail', 'web_search', 'generate_mjr_report', 'store_document'], model: 'claude-sonnet-4-6', is_active: true, run_count: 34, description: 'Generates the full personalised Missed Jobs Report HTML document from prospect data and web research.' },
  { id: 'sop_10', num: '10', name: 'MJR Delivery Sequence', domain: 'Distribution', tier: 'ASSISTED', tools: ['draft_delivery_sequence', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, run_count: 32, description: 'Drafts WhatsApp/email sequence for delivering the MJR and beginning engagement.' },
  { id: 'sop_12', num: '12', name: 'SPOA Build', domain: 'Distribution', tier: 'AUTO', tools: ['get_prospect_detail', 'web_search', 'generate_spoa_document', 'store_document'], model: 'claude-sonnet-4-6', is_active: true, run_count: 18, description: 'Builds the full Strategic Plan of Action document post-MJR call using prospect data and web research.' },
  { id: 'sop_15', num: '15', name: 'Offer Prep', domain: 'Sales', tier: 'ASSISTED', tools: ['web_search', 'generate_offer_document', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, run_count: 14, description: 'Researches the prospect and generates a personalised commercial offer document for principal review before sending.' },
  { id: 'sop_17', num: '17', name: 'Onboarding Brief', domain: 'Delivery', tier: 'ASSISTED', tools: ['web_search', 'get_prospect_detail', 'generate_onboarding_brief', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, run_count: 11, description: 'Builds a client onboarding briefing document with business context, agreed deliverables, and first-sprint objectives.' },
  { id: 'sop_21', num: '21', name: 'Proof Sprint Daily Ops', domain: 'Delivery', tier: 'AUTO', cron_expression: '30 7 * * *', schedule_label: 'Daily 07:30', tools: ['get_active_sprints', 'get_ad_performance', 'create_sprint_log_entry', 'create_alert'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*170).toISOString(), run_count: 84, description: 'Processes all active sprints daily — pulls ad performance, applies KPI logic, logs data, raises alerts.' },
  { id: 'sop_23', num: '23', name: 'Proof Sprint Ads Monitoring', domain: 'Delivery', tier: 'AUTO', cron_expression: '0 8 * * *', schedule_label: 'Daily 08:00', tools: ['get_ad_performance', 'apply_kill_scale_logic', 'create_alert'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*160).toISOString(), run_count: 84, description: 'Applies kill/scale logic to all active ad sets. Flags underperformers, identifies scale opportunities.' },
  { id: 'sop_26', num: '26', name: 'Sprint Closeout', domain: 'Delivery', tier: 'AUTO', cron_expression: '0 7 * * *', schedule_label: 'Daily 07:00', tools: ['get_completed_sprints', 'generate_closeout_report', 'update_sprint_status'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*175).toISOString(), run_count: 84, description: 'Detects sprints that have reached their end date, generates a performance summary, and marks them as complete.' },
  { id: 'sop_31', num: '31', name: 'Proof Brand Monthly Ops', domain: 'Delivery', tier: 'AUTO', cron_expression: '0 9 1 * *', schedule_label: '1st of month 09:00', tools: ['get_active_sprints', 'get_ad_performance', 'generate_monthly_report', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, run_count: 4, description: 'Runs end-of-month operations for all Proof Sprint clients — aggregates performance data, surfaces trends, and generates monthly reporting.' },
  { id: 'sop_33', num: '33', name: 'SOP Versioning', domain: 'Operations', tier: 'AUTO', cron_expression: '0 11 1 * *', schedule_label: '1st of month 11:00', tools: ['get_sop_versions', 'compare_sop_outputs', 'log_version_snapshot'], model: 'claude-sonnet-4-6', is_active: true, run_count: 4, description: 'Snapshots SOP run counts and performance metrics monthly — tracks version health and surfaces SOPs with declining effectiveness.' },
  { id: 'sop_35', num: '35', name: 'Upsell Detection', domain: 'Sales', tier: 'AUTO', cron_expression: '0 9 * * 1', schedule_label: 'Monday 09:00', tools: ['get_active_clients', 'analyse_upsell_signals', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*60*72).toISOString(), run_count: 12, description: 'Analyses active client sprint data for upsell signals — strong ROAS, high lead volume, or scope expansion indicators.' },
  { id: 'sop_41', num: '41', name: 'Weekly Review', domain: 'Principal', tier: 'AUTO', cron_expression: '0 16 * * 5', schedule_label: 'Friday 16:00', tools: ['get_weekly_metrics', 'generate_weekly_review', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*60*48).toISOString(), run_count: 12, description: 'Generates the end-of-week principal review — compiles KPIs, win/loss summary, outstanding actions, and priorities for next week.' },
  { id: 'sop_43', num: '43', name: 'Authority Brand Monthly Ops', domain: 'Delivery', tier: 'AUTO', cron_expression: '0 10 1 * *', schedule_label: '1st of month 10:00', tools: ['get_active_clients', 'get_ad_performance', 'generate_monthly_report', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, run_count: 4, description: 'Runs end-of-month operations for all Authority Brand clients — aggregates content performance, ad data, and generates monthly reporting.' },
  { id: 'sop_46', num: '46', name: 'Billing & Payment Chase', domain: 'Finance', tier: 'AUTO', cron_expression: '30 8 * * 1', schedule_label: 'Monday 08:30', tools: ['get_outstanding_invoices', 'generate_chase_messages', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*60*72).toISOString(), run_count: 12, description: 'Identifies overdue invoices, generates personalised payment chase messages, and queues them for approval before sending.' },
  { id: 'sop_47', num: '47', name: 'Weekly Client Reporting', domain: 'Delivery', tier: 'AUTO', cron_expression: '0 17 * * 5', schedule_label: 'Friday 17:00', tools: ['get_delivery_metrics', 'generate_weekly_client_report', 'publish_to_portal'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*60*48).toISOString(), run_count: 12, description: 'Generates weekly performance reports for all active clients. Approval required before publishing to portal.' },
  { id: 'sop_49', num: '49', name: 'Content Generation', domain: 'Marketing', tier: 'AUTO', tools: ['web_search', 'generate_content', 'store_document'], model: 'claude-sonnet-4-6', is_active: true, run_count: 8, description: 'Generates brand-aligned marketing content (case studies, LinkedIn posts, email sequences) on demand or for scheduled campaigns.' },
  { id: 'sop_51', num: '51', name: 'Admin Check', domain: 'Operations', tier: 'AUTO', cron_expression: '30 6 * * 1', schedule_label: 'Monday 06:30', tools: ['check_cron_health', 'check_approval_queue', 'check_open_alerts'], model: 'claude-haiku-4-5-20251001', is_active: true, last_run: new Date(Date.now() - 1000*60*60*72).toISOString(), run_count: 12, description: 'Weekly system health check — validates cron schedules, scans for stale approvals, and surfaces any unresolved alerts needing attention.' },
  { id: 'sop_52', num: '52', name: 'Backup & Security Check', domain: 'Operations', tier: 'AUTO', cron_expression: '0 1 * * 0', schedule_label: 'Sunday 01:00', tools: ['check_database_health', 'verify_edge_functions', 'log_backup_status'], model: 'claude-haiku-4-5-20251001', is_active: true, run_count: 4, description: 'Weekly backup and security audit — checks Supabase connectivity, Edge Function health, and logs a security status snapshot.' },
  { id: 'sop_53', num: '53', name: 'Monthly KPI Review', domain: 'Operations', tier: 'AUTO', cron_expression: '0 8 1 * *', schedule_label: '1st of month 08:00', tools: ['get_kpi_snapshots', 'generate_kpi_review', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, run_count: 4, description: 'Compiles monthly KPI report across all business metrics — distribution funnel, delivery performance, finance, and growth rate.' },
  { id: 'sop_56', num: '56', name: 'Finance Dashboard & Income Tracking', domain: 'Finance', tier: 'AUTO', cron_expression: '0 7 * * 1', schedule_label: 'Monday 07:00', tools: ['get_finance_data', 'generate_finance_summary'], model: 'claude-haiku-4-5-20251001', is_active: true, last_run: new Date(Date.now() - 1000*60*60*72).toISOString(), run_count: 12, description: 'Aggregates weekly income and expense data, flags overdue invoices, updates finance dashboard.' },
  { id: 'sop_58', num: '58', name: 'Admin Command Centre & Daily Review', domain: 'Principal', tier: 'AUTO', cron_expression: '0 6 * * *', schedule_label: 'Daily 06:00', tools: ['get_new_leads', 'get_active_sprints', 'get_open_tasks', 'get_pending_approvals', 'create_daily_briefing'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*200).toISOString(), run_count: 84, description: 'Generates your daily command centre briefing — priorities, sprint snapshot, overnight activity, alerts.' },
]

// ─── Prospects Pipeline ───────────────────────────────────────────────────────
export const mockPipelineCounts = {
  new: 43,
  enriched: 38,
  staged: 43,
  contacted: 286,
  replied: 52,
  warm: 11,
  mjr_ready: 6,
  mjr_sent: 14,
  spoa_ready: 3,
  call_booked: 4,
  closed: 28,
}

export const mockConversionChart = [
  { week: 'W14', contacted: 68, replied: 14, warm: 4, closed: 2 },
  { week: 'W15', contacted: 72, replied: 16, warm: 5, closed: 3 },
  { week: 'W16', contacted: 64, replied: 12, warm: 3, closed: 2 },
  { week: 'W17', contacted: 82, replied: 18, warm: 6, closed: 4 },
  { week: 'W18', contacted: 75, replied: 14, warm: 5, closed: 3 },
  { week: 'W19', contacted: 43, replied: 8, warm: 3, closed: 1 },
]
