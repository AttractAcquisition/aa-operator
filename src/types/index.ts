// ─── Core Types ────────────────────────────────────────────────────────────

export type AutomationTier = 'AUTO' | 'ASSISTED' | 'HUMAN'
export type AlertSeverity = 'critical' | 'warning' | 'info'
export type SprintStatus = 'active' | 'complete' | 'setup' | 'paused'
export type ProspectStatus =
  | 'new'
  | 'enriched'
  | 'staged'
  | 'contacted'
  | 'replied'
  | 'warm'
  | 'cold'
  | 'not_interested'
  | 'unsubscribed'
  | 'mjr_ready'
  | 'mjr_sent'
  | 'spoa_ready'
  | 'spoa_sent'
  | 'call_booked'
  | 'closed'

export type ApprovalType =
  | 'whatsapp_message'
  | 'mjr_document'
  | 'spoa_document'
  | 'client_report'
  | 'delivery_sequence'
  | 'offer_document'
  | 'call_brief'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'edited'

export interface Prospect {
  id: string
  name: string
  company: string
  phone: string
  status: ProspectStatus
  quality_score: number
  created_at: string
  enrichment_data?: {
    company_size?: string
    trading_since?: string
    review_count?: number
    niche?: string
    website_quality?: number
    notes?: string
  }
  source_list?: string
  last_reply_at?: string
  reply_classification?: string
}

export interface Sprint {
  id: string
  client_id: string
  client_name: string
  status: SprintStatus
  start_date: string
  end_date: string
  day_number: number
  leads_generated: number
  leads_target: number
  spend: number
  spend_budget: number
  cpl: number
  cpl_target: number
  roas: number
  roas_target: number
  last_log_at: string
  campaign_ids: string[]
}

export interface Client {
  id: string
  name: string
  company: string
  tier: 'proof_sprint' | 'proof_brand' | 'authority_brand'
  status: 'active' | 'paused' | 'churned' | 'onboarding'
  mrr: number
  start_date: string
  next_review_date?: string
  account_manager?: string
  niche: string
  active_sprint_id?: string
}

export interface ApprovalItem {
  id: string
  created_at: string
  sop_id: string
  sop_name: string
  type: ApprovalType
  status: ApprovalStatus
  content: {
    title: string
    body: string
    recipient?: string
    document_url?: string
    metadata?: Record<string, string>
  }
  reviewed_at?: string
  reviewer_notes?: string
  priority: 'high' | 'medium' | 'low'
}

export interface CronJob {
  id: string
  sop_id: string
  sop_name: string
  domain: string
  cron_expression: string
  schedule_label: string
  is_active: boolean
  last_run?: string
  next_run: string
  last_status?: 'success' | 'failure' | 'running'
  run_count: number
  avg_duration_ms?: number
  last_error?: string
}

export interface AIAlert {
  id: string
  created_at: string
  severity: AlertSeverity
  sop_id?: string
  category: string
  message: string
  suggested_action: string
  resolved: boolean
  resolved_at?: string
  client_name?: string
}

export interface AITaskLog {
  id: string
  created_at: string
  sop_id: string
  sop_name: string
  tool_called: string
  status: 'success' | 'failure' | 'running'
  duration_ms?: number
  input_summary: string
  output_summary: string
}

export interface FinanceEntry {
  id: string
  date: string
  type: 'income' | 'expense'
  category: string
  amount: number
  client_id?: string
  client_name?: string
  notes?: string
  invoice_status?: 'paid' | 'pending' | 'overdue'
}

export interface SOP {
  id: string
  num: string
  name: string
  domain: string
  tier: AutomationTier
  cron_expression?: string
  schedule_label?: string
  tools: string[]
  model: string
  is_active: boolean
  last_run?: string
  run_count: number
  description: string
}

export interface DailyBriefing {
  generated_at: string
  new_leads: number
  warm_replies: number
  active_sprints: number
  pending_approvals: number
  open_alerts: number
  mrr: number
  overdue_invoices: number
  priorities: Array<{
    rank: number
    category: string
    message: string
    action: string
    urgency: 'high' | 'medium' | 'low'
  }>
  sprint_snapshot: Array<{
    client: string
    day: number
    status: 'on_track' | 'at_risk' | 'off_track'
    leads_today: number
  }>
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  tool_calls?: Array<{
    tool: string
    result_summary: string
  }>
  is_streaming?: boolean
}
