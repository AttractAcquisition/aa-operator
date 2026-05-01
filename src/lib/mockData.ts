// ─── Mock Data ────────────────────────────────────────────────────────────────
// This file provides realistic mock data for all UI components.
// When you connect Supabase, replace these with real queries.
// Each function is named to match the Supabase table / Edge Function it will use.

import type {
  Sprint, Client, ApprovalItem, CronJob,
  AIAlert, AITaskLog, FinanceEntry, SOP, DailyBriefing
} from '@/types'

// ─── Daily Briefing ──────────────────────────────────────────────────────────
export const mockDailyBriefing: DailyBriefing = {
  generated_at: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
  new_leads: 43,
  warm_replies: 3,
  active_sprints: 4,
  pending_approvals: 7,
  open_alerts: 2,
  mrr: 18400,
  overdue_invoices: 1,
  priorities: [
    { rank: 1, category: 'Sprint Performance', message: 'Midlands HVAC CPL at £31.40 vs £20 target', action: 'Review ad sets in Alerts', urgency: 'high' },
    { rank: 2, category: 'Approval Queue', message: '7 items pending — outreach batch queued since 09:00', action: 'Open Approval Queue', urgency: 'high' },
    { rank: 3, category: 'Finance', message: 'Leeds Roofing invoice overdue 9 days (£1,800)', action: 'Approve payment chase', urgency: 'medium' },
    { rank: 4, category: 'Pipeline', message: '3 warm replies ready for follow-up', action: 'Review in Pipeline', urgency: 'medium' },
    { rank: 5, category: 'Upcoming', message: 'Discovery call at 14:00 — Northgate Builders brief ready', action: 'View call brief', urgency: 'low' },
  ],
  sprint_snapshot: [
    { client: 'Apex Plumbing', day: 8, status: 'on_track', leads_today: 5 },
    { client: 'Swift Electrical', day: 3, status: 'on_track', leads_today: 4 },
    { client: 'Leeds Roofing Co', day: 11, status: 'at_risk', leads_today: 2 },
    { client: 'Midlands HVAC', day: 6, status: 'off_track', leads_today: 2 },
  ],
}

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

// ─── Clients ─────────────────────────────────────────────────────────────────
export const mockClients: Client[] = [
  { id: 'cli_001', name: 'Dave Morrison', company: 'Apex Plumbing', tier: 'proof_sprint', status: 'active', mrr: 2100, start_date: '2026-04-22', niche: 'Plumbing', active_sprint_id: 'spr_001' },
  { id: 'cli_002', name: 'Sarah Chen', company: 'Swift Electrical', tier: 'proof_sprint', status: 'active', mrr: 2100, start_date: '2026-04-27', niche: 'Electrical', active_sprint_id: 'spr_002' },
  { id: 'cli_003', name: 'Mike Lawson', company: 'Leeds Roofing Co', tier: 'proof_sprint', status: 'active', mrr: 2100, start_date: '2026-04-19', niche: 'Roofing', active_sprint_id: 'spr_003' },
  { id: 'cli_004', name: 'Raj Patel', company: 'Midlands HVAC', tier: 'proof_sprint', status: 'active', mrr: 2100, start_date: '2026-04-24', niche: 'HVAC', active_sprint_id: 'spr_004' },
  { id: 'cli_005', name: 'Tom Walsh', company: 'Precision Drainage', tier: 'proof_brand', status: 'active', mrr: 3800, start_date: '2026-03-01', niche: 'Drainage', next_review_date: '2026-06-01' },
  { id: 'cli_006', name: 'Lisa Grant', company: 'Northern Boiler Services', tier: 'authority_brand', status: 'active', mrr: 6200, start_date: '2025-11-15', niche: 'Boiler/Heating', next_review_date: '2026-05-15' },
]

// ─── Approval Queue ──────────────────────────────────────────────────────────
export const mockApprovals: ApprovalItem[] = [
  {
    id: 'appr_001', created_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    sop_id: '01', sop_name: 'WhatsApp Outreach', type: 'whatsapp_message', status: 'pending',
    content: {
      title: 'Daily Outreach Batch — 43 Messages',
      body: `Hi [Name], I was looking at [Company]'s online presence and noticed you might be missing out on leads from homeowners searching for [service] in your area. I help tradesmen like yourself get consistent, quality leads through targeted campaigns. Would it be worth a 10-minute chat? — Attract Acquisition`,
      recipient: '43 prospects staged',
      metadata: { batch_size: '43', source: 'Checkatrade + Yell', quality_avg: '6.8/10' },
    },
    priority: 'high',
  },
  {
    id: 'appr_002', created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    sop_id: '47', sop_name: 'Weekly Client Reporting', type: 'client_report', status: 'pending',
    content: {
      title: 'Weekly Report — Apex Plumbing',
      body: 'Week 2 performance summary: 34 leads generated, £12.40 CPL (target £15 ✅), 4.2x ROAS. Campaign optimised Thursday — CPL dropped 18% post-edit. Recommend increasing budget 15% on winning ad set.',
      recipient: 'Dave Morrison — Apex Plumbing',
    },
    priority: 'medium',
  },
  {
    id: 'appr_003', created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    sop_id: '47', sop_name: 'Weekly Client Reporting', type: 'client_report', status: 'pending',
    content: {
      title: 'Weekly Report — Precision Drainage',
      body: 'Month 2 report: 89 leads, £14.20 CPL, 3.8x ROAS. Retainer performing above target. 3 converted to booked jobs this week. Upsell opportunity: Authority Brand criteria met.',
      recipient: 'Tom Walsh — Precision Drainage',
    },
    priority: 'medium',
  },
  {
    id: 'appr_004', created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    sop_id: '07', sop_name: 'Discovery Call Booking & Prep', type: 'call_brief', status: 'pending',
    content: {
      title: 'Call Brief — Northgate Builders (14:00 today)',
      body: 'Prospect: James Northgate, Northgate Builders Ltd. Established 2018. 12 reviews on Checkatrade (4.6★). Currently no paid advertising. Website: basic, no lead capture. Pain point from reply: "struggling to get consistent enquiries". Angle: Proof Sprint ROI case study from similar builder.',
      recipient: 'James Northgate',
      metadata: { call_time: '14:00 today', quality_score: '8.5/10', stage: 'Discovery' },
    },
    priority: 'high',
  },
  {
    id: 'appr_005', created_at: new Date(Date.now() - 1000 * 60 * 20).toISOString(),
    sop_id: '46', sop_name: 'Billing & Collections', type: 'whatsapp_message', status: 'pending',
    content: {
      title: 'Payment Chase — Leeds Roofing Co (£1,800 overdue)',
      body: 'Hi Mike, hope the sprint is going well — strong progress this week. Just a quick note that invoice #AA-2026-031 for £1,800 (April retainer) is now 9 days overdue. Could you give that a quick look when you get a moment? Happy to help if there\'s any issue. Cheers',
      recipient: 'Mike Lawson — Leeds Roofing',
      metadata: { invoice: '#AA-2026-031', amount: '£1,800', days_overdue: '9' },
    },
    priority: 'medium',
  },
]

// ─── Cron Jobs ────────────────────────────────────────────────────────────────
export const mockCronJobs: CronJob[] = [
  { id: 'cron_001', sop_id: '58', sop_name: 'Admin Command Centre & Daily Review', domain: 'Principal', cron_expression: '0 6 * * *', schedule_label: 'Daily 06:00', is_active: true, last_run: new Date(Date.now() - 1000 * 60 * 200).toISOString(), next_run: new Date(Date.now() + 1000 * 60 * 60 * 14).toISOString(), last_status: 'success', run_count: 84, avg_duration_ms: 8200 },
  { id: 'cron_002', sop_id: '21', sop_name: 'Proof Sprint Daily Ops', domain: 'Delivery', cron_expression: '30 7 * * *', schedule_label: 'Daily 07:30', is_active: true, last_run: new Date(Date.now() - 1000 * 60 * 170).toISOString(), next_run: new Date(Date.now() + 1000 * 60 * 60 * 16).toISOString(), last_status: 'success', run_count: 84, avg_duration_ms: 14600 },
  { id: 'cron_003', sop_id: '23', sop_name: 'Proof Sprint Ads Monitoring', domain: 'Delivery', cron_expression: '0 8 * * *', schedule_label: 'Daily 08:00', is_active: true, last_run: new Date(Date.now() - 1000 * 60 * 160).toISOString(), next_run: new Date(Date.now() + 1000 * 60 * 60 * 17).toISOString(), last_status: 'success', run_count: 84, avg_duration_ms: 9800 },
  { id: 'cron_004', sop_id: '06', sop_name: 'Reply Triage & CRM Hygiene', domain: 'Distribution', cron_expression: '30 8 * * *', schedule_label: 'Daily 08:30', is_active: true, last_run: new Date(Date.now() - 1000 * 60 * 150).toISOString(), next_run: new Date(Date.now() + 1000 * 60 * 60 * 18).toISOString(), last_status: 'success', run_count: 84, avg_duration_ms: 11200 },
  { id: 'cron_005', sop_id: '01', sop_name: 'WhatsApp Outreach Draft Queue', domain: 'Distribution', cron_expression: '0 9 * * 1-5', schedule_label: 'Weekdays 09:00', is_active: true, last_run: new Date(Date.now() - 1000 * 60 * 140).toISOString(), next_run: new Date(Date.now() + 1000 * 60 * 60 * 19).toISOString(), last_status: 'success', run_count: 62, avg_duration_ms: 22400 },
  { id: 'cron_006', sop_id: '47', sop_name: 'Weekly Client Reporting', domain: 'Delivery', cron_expression: '0 17 * * 5', schedule_label: 'Friday 17:00', is_active: true, last_run: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), next_run: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), last_status: 'success', run_count: 12, avg_duration_ms: 44000 },
  { id: 'cron_007', sop_id: '56', sop_name: 'Finance Dashboard & Income Tracking', domain: 'Finance', cron_expression: '0 7 * * 1', schedule_label: 'Monday 07:00', is_active: true, last_run: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), next_run: new Date(Date.now() + 1000 * 60 * 60 * 60).toISOString(), last_status: 'success', run_count: 12, avg_duration_ms: 6400 },
  { id: 'cron_008', sop_id: '52', sop_name: 'Backup & Security Check', domain: 'Operations', cron_expression: '0 2 * * 0', schedule_label: 'Sunday 02:00', is_active: true, last_run: new Date(Date.now() - 1000 * 60 * 60 * 120).toISOString(), next_run: new Date(Date.now() + 1000 * 60 * 60 * 132).toISOString(), last_status: 'success', run_count: 8, avg_duration_ms: 4200 },
  { id: 'cron_009', sop_id: '02', sop_name: 'Prospect Scraper & Batch Run', domain: 'Distribution', cron_expression: '0 9 * * 1', schedule_label: 'Monday 09:00', is_active: true, last_run: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), next_run: new Date(Date.now() + 1000 * 60 * 60 * 60).toISOString(), last_status: 'success', run_count: 12, avg_duration_ms: 31000 },
  { id: 'cron_010', sop_id: '53', sop_name: 'Performance Review & KPI Cadence', domain: 'Operations', cron_expression: '0 18 * * 5', schedule_label: 'Friday 18:00', is_active: false, last_run: new Date(Date.now() - 1000 * 60 * 60 * 168).toISOString(), next_run: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), last_status: 'failure', run_count: 11, avg_duration_ms: 18600, last_error: 'Supabase connection timeout — retry queued' },
]

// ─── Alerts ───────────────────────────────────────────────────────────────────
export const mockAlerts: AIAlert[] = [
  { id: 'alert_001', created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(), severity: 'critical', sop_id: '23', category: 'Sprint Performance', message: 'Midlands HVAC — 2 ad sets with CPL >£40 (vs £20 target). Ad Set "Broad 35-55" at £48.20 CPL. Ad Set "Interest: Home Improvement" at £44.10 CPL.', suggested_action: 'Pause both flagged ad sets and reallocate budget to performing "Lookalike 1%" set at £18.40 CPL', resolved: false, client_name: 'Midlands HVAC' },
  { id: 'alert_002', created_at: new Date(Date.now() - 1000 * 60 * 150).toISOString(), severity: 'warning', sop_id: '46', category: 'Finance', message: 'Leeds Roofing Co — Invoice #AA-2026-031 (£1,800) now 9 days overdue. No response to automated reminder sent Day 3.', suggested_action: 'Approve WhatsApp payment chase in approval queue (item appr_005)', resolved: false, client_name: 'Leeds Roofing Co' },
  { id: 'alert_003', created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(), severity: 'warning', sop_id: '21', category: 'Sprint Pacing', message: 'Leeds Roofing Co — On Day 11 with 28 leads vs 38 target. Current pace projects 33 leads by Day 14, below 42-lead target.', suggested_action: 'Consider increasing daily budget £50 for final 3 days to hit minimum target', resolved: false, client_name: 'Leeds Roofing Co' },
  { id: 'alert_004', created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(), severity: 'info', sop_id: '35', category: 'Upsell Opportunity', message: 'Precision Drainage (Proof Brand Month 2) has hit Authority Brand criteria: 89 leads, consistent 3.8x ROAS, client satisfaction high.', suggested_action: 'Schedule Authority Brand upsell call — prepare offer using SOP 36', resolved: false, client_name: 'Precision Drainage' },
]

// ─── AI Task Log ──────────────────────────────────────────────────────────────
export const mockTaskLog: AITaskLog[] = [
  { id: 'log_001', created_at: new Date(Date.now() - 1000 * 60 * 200).toISOString(), sop_id: '58', sop_name: 'Daily Command Centre', tool_called: 'run_daily_briefing', status: 'success', duration_ms: 8242, input_summary: 'Triggered by cron 06:00', output_summary: '5 priorities identified, 4 sprint snapshots, 2 alerts flagged' },
  { id: 'log_002', created_at: new Date(Date.now() - 1000 * 60 * 170).toISOString(), sop_id: '21', sop_name: 'Sprint Daily Ops', tool_called: 'create_sprint_log_entry', status: 'success', duration_ms: 14623, input_summary: '4 active sprints processed', output_summary: 'Logs created for all 4 sprints, 1 alert created (Midlands HVAC)' },
  { id: 'log_003', created_at: new Date(Date.now() - 1000 * 60 * 160).toISOString(), sop_id: '23', sop_name: 'Ads Monitoring', tool_called: 'apply_kill_scale_logic', status: 'success', duration_ms: 9812, input_summary: 'Checked ad performance for 4 sprints', output_summary: '2 underperforming ad sets flagged in Midlands HVAC, 1 scale recommendation for Apex' },
  { id: 'log_004', created_at: new Date(Date.now() - 1000 * 60 * 150).toISOString(), sop_id: '06', sop_name: 'Reply Triage', tool_called: 'update_prospect_status', status: 'success', duration_ms: 11244, input_summary: '12 unread replies processed', output_summary: '3 warm, 6 cold, 3 not interested — 3 approval items created' },
  { id: 'log_005', created_at: new Date(Date.now() - 1000 * 60 * 140).toISOString(), sop_id: '01', sop_name: 'WhatsApp Outreach', tool_called: 'generate_outreach_message', status: 'success', duration_ms: 22401, input_summary: '43 staged prospects', output_summary: '43 personalised messages drafted, batch approval item created' },
  { id: 'log_006', created_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(), sop_id: '47', sop_name: 'Weekly Client Reporting', tool_called: 'generate_weekly_client_report', status: 'success', duration_ms: 44012, input_summary: '6 active clients', output_summary: '6 reports generated — 2 queued for approval (Apex, Precision)' },
]

// ─── Finance ──────────────────────────────────────────────────────────────────
export const mockFinance: FinanceEntry[] = [
  { id: 'fin_001', date: '2026-04-01', type: 'income', category: 'Proof Sprint', amount: 2100, client_id: 'cli_003', client_name: 'Leeds Roofing Co', notes: 'April sprint fee', invoice_status: 'overdue' },
  { id: 'fin_002', date: '2026-04-01', type: 'income', category: 'Proof Brand', amount: 3800, client_id: 'cli_005', client_name: 'Precision Drainage', notes: 'April retainer', invoice_status: 'paid' },
  { id: 'fin_003', date: '2026-04-01', type: 'income', category: 'Authority Brand', amount: 6200, client_id: 'cli_006', client_name: 'Northern Boiler Services', notes: 'April retainer', invoice_status: 'paid' },
  { id: 'fin_004', date: '2026-04-22', type: 'income', category: 'Proof Sprint', amount: 2100, client_id: 'cli_001', client_name: 'Apex Plumbing', notes: 'Sprint start', invoice_status: 'paid' },
  { id: 'fin_005', date: '2026-04-24', type: 'income', category: 'Proof Sprint', amount: 2100, client_id: 'cli_004', client_name: 'Midlands HVAC', notes: 'Sprint start', invoice_status: 'paid' },
  { id: 'fin_006', date: '2026-04-27', type: 'income', category: 'Proof Sprint', amount: 2100, client_id: 'cli_002', client_name: 'Swift Electrical', notes: 'Sprint start', invoice_status: 'paid' },
  { id: 'fin_007', date: '2026-04-10', type: 'expense', category: 'Tools & Software', amount: 280, notes: 'Anthropic API + Vercel + Supabase Pro' },
  { id: 'fin_008', date: '2026-04-01', type: 'expense', category: 'Contractor', amount: 1200, notes: 'Part-time media buyer' },
]

export const mockRevenueChart = [
  { month: 'Nov', revenue: 8400, target: 10000 },
  { month: 'Dec', revenue: 11200, target: 10000 },
  { month: 'Jan', revenue: 13600, target: 12000 },
  { month: 'Feb', revenue: 14800, target: 14000 },
  { month: 'Mar', revenue: 16400, target: 15000 },
  { month: 'Apr', revenue: 18400, target: 17000 },
]

// ─── SOPs Master List ─────────────────────────────────────────────────────────
export const mockSOPs: SOP[] = [
  { id: 'sop_01', num: '01', name: 'WhatsApp Outreach', domain: 'Distribution', tier: 'ASSISTED', cron_expression: '0 9 * * 1-5', schedule_label: 'Weekdays 09:00', tools: ['generate_outreach_message', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*140).toISOString(), run_count: 62, description: 'Drafts personalised WhatsApp messages for daily outreach batch. Creates approval item for your review before any message is sent.' },
  { id: 'sop_02', num: '02', name: 'Prospect Scraper & Batch Run', domain: 'Distribution', tier: 'AUTO', cron_expression: '0 9 * * 1', schedule_label: 'Mon/Wed 09:00', tools: ['trigger_scraper_run', 'stage_batch_results'], model: 'claude-haiku-4-5-20251001', is_active: true, last_run: new Date(Date.now() - 1000*60*60*72).toISOString(), run_count: 12, description: 'Triggers the prospect scraper for the selected source list and stages results for enrichment.' },
  { id: 'sop_03', num: '03', name: 'Prospect Enrichment, QA & Dedup', domain: 'Distribution', tier: 'AUTO', tools: ['web_search', 'add_enrichment_data', 'flag_duplicate'], model: 'claude-haiku-4-5-20251001', is_active: true, last_run: new Date(Date.now() - 1000*60*60*72).toISOString(), run_count: 12, description: 'Researches each prospect online, scores quality 1-10, removes duplicates, stages qualifying leads.' },
  { id: 'sop_04', num: '04', name: 'Prospect Import & CRM Staging', domain: 'Distribution', tier: 'AUTO', cron_expression: '0 8 * * 1-5', schedule_label: 'Weekdays 08:00', tools: ['stage_leads_to_batch', 'update_prospect_status'], model: 'claude-haiku-4-5-20251001', is_active: true, last_run: new Date(Date.now() - 1000*60*160).toISOString(), run_count: 62, description: 'Moves clean enriched leads into the daily outreach batch in the correct priority order.' },
  { id: 'sop_05', num: '05', name: 'Lead Sourcing & List QA', domain: 'Distribution', tier: 'AUTO', tools: ['get_distro_metrics', 'select_source_list'], model: 'claude-sonnet-4-6', is_active: true, run_count: 12, description: 'Analyses distro metrics to select the best performing vertical/location combination for scraping.' },
  { id: 'sop_06', num: '06', name: 'Reply Triage & CRM Hygiene', domain: 'Distribution', tier: 'AUTO', cron_expression: '30 8 * * *', schedule_label: 'Daily 08:30', tools: ['get_unread_replies', 'update_prospect_status', 'create_approval_item'], model: 'claude-haiku-4-5-20251001', is_active: true, last_run: new Date(Date.now() - 1000*60*150).toISOString(), run_count: 84, description: 'Classifies all incoming WhatsApp replies. Warm leads queued for your action. CRM updated automatically.' },
  { id: 'sop_07', num: '07', name: 'Discovery Call Booking & Prep', domain: 'Distribution', tier: 'ASSISTED', tools: ['generate_call_brief', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, run_count: 28, description: 'Generates detailed call brief for warm leads — company research, pain points, suggested angles.' },
  { id: 'sop_08', num: '08', name: 'MJR Build', domain: 'Distribution', tier: 'AUTO', tools: ['get_prospect_detail', 'web_search', 'generate_mjr_report', 'store_document'], model: 'claude-sonnet-4-6', is_active: true, run_count: 34, description: 'Generates the full personalised Missed Jobs Report HTML document from prospect data and web research.' },
  { id: 'sop_10', num: '10', name: 'MJR Delivery Sequence', domain: 'Distribution', tier: 'ASSISTED', tools: ['draft_delivery_sequence', 'create_approval_item'], model: 'claude-sonnet-4-6', is_active: true, run_count: 32, description: 'Drafts WhatsApp/email sequence for delivering the MJR and beginning engagement.' },
  { id: 'sop_12', num: '12', name: 'SPOA Build', domain: 'Distribution', tier: 'AUTO', tools: ['get_prospect_detail', 'web_search', 'generate_spoa_document', 'store_document'], model: 'claude-sonnet-4-6', is_active: true, run_count: 18, description: 'Builds the full Strategic Plan of Action document post-MJR call using prospect data and web research.' },
  { id: 'sop_21', num: '21', name: 'Proof Sprint Daily Ops', domain: 'Delivery', tier: 'AUTO', cron_expression: '30 7 * * *', schedule_label: 'Daily 07:30', tools: ['get_active_sprints', 'get_ad_performance', 'create_sprint_log_entry', 'create_alert'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*170).toISOString(), run_count: 84, description: 'Processes all active sprints daily — pulls ad performance, applies KPI logic, logs data, raises alerts.' },
  { id: 'sop_23', num: '23', name: 'Proof Sprint Ads Monitoring', domain: 'Delivery', tier: 'AUTO', cron_expression: '0 8 * * *', schedule_label: 'Daily 08:00', tools: ['get_ad_performance', 'apply_kill_scale_logic', 'create_alert'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*160).toISOString(), run_count: 84, description: 'Applies kill/scale logic to all active ad sets. Flags underperformers, identifies scale opportunities.' },
  { id: 'sop_47', num: '47', name: 'Weekly Client Reporting', domain: 'Delivery', tier: 'AUTO', cron_expression: '0 17 * * 5', schedule_label: 'Friday 17:00', tools: ['get_delivery_metrics', 'generate_weekly_client_report', 'publish_to_portal'], model: 'claude-sonnet-4-6', is_active: true, last_run: new Date(Date.now() - 1000*60*60*48).toISOString(), run_count: 12, description: 'Generates weekly performance reports for all active clients. Approval required before publishing to portal.' },
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
