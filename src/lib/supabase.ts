import { createClient } from '@supabase/supabase-js'
import type {
  Prospect, ProspectStatus,
  ApprovalItem, ApprovalType, ApprovalStatus,
  AIAlert, AlertSeverity,
  AITaskLog,
  CronJob,
} from '@/types'

// ─── TODO: Add your Supabase credentials ────────────────────────────────────
// Either set these in a .env file:
//   VITE_SUPABASE_URL=https://your-project.supabase.co
//   VITE_SUPABASE_ANON_KEY=your-anon-key
//
// Or connect via Claude Code:
//   claude "connect this app to supabase project [your-project-ref]"
// ─────────────────────────────────────────────────────────────────────────────

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ─── Type helpers ─────────────────────────────────────────────────────────────
export type SupabaseClient = typeof supabase

// ─── Edge Function caller ─────────────────────────────────────────────────────
export async function callEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw error
  return data as T
}

// ─── Write layer ──────────────────────────────────────────────────────────────

/** Update a prospect's pipeline status and optionally record a reply classification. */
export async function updateProspectStatus(
  id: string,
  status: ProspectStatus,
  replyClassification?: string,
): Promise<Prospect> {
  const patch: Record<string, unknown> = { status }
  if (replyClassification !== undefined) patch.reply_classification = replyClassification

  const { data, error } = await supabase
    .from('prospects')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`updateProspectStatus: ${error.message}`)
  return data as Prospect
}

export interface CreateApprovalItemInput {
  sop_id: string
  sop_name: string
  type: ApprovalType
  priority: 'high' | 'medium' | 'low'
  content: {
    title: string
    body: string
    recipient?: string
    document_url?: string
    metadata?: Record<string, string>
  }
}

/** Insert a new item into the approval queue and return the created record. */
export async function createApprovalItem(
  input: CreateApprovalItemInput,
): Promise<ApprovalItem> {
  const { data, error } = await supabase
    .from('approval_queue')
    .insert({
      sop_id: input.sop_id,
      sop_name: input.sop_name,
      status: 'pending',
      priority: input.priority,
      content: input.content,
      content_type: input.type,
      content_id: crypto.randomUUID(),
    })
    .select()
    .single()

  if (error) throw new Error(`createApprovalItem: ${error.message}`)
  return {
    ...(data as Omit<ApprovalItem, 'type'>),
    type: data.content_type as ApprovalType,
  }
}

export interface LogAiTaskInput {
  sop_id: string
  sop_name: string
  tool_called: string
  status: 'success' | 'failure' | 'running'
  duration_ms?: number
  input_summary: string
  output_summary: string
}

/** Append a row to the AI task log and return the created record. */
export async function logAiTask(input: LogAiTaskInput): Promise<AITaskLog> {
  const { data, error } = await supabase
    .from('ai_task_log')
    .insert(input)
    .select()
    .single()

  if (error) throw new Error(`logAiTask: ${error.message}`)
  return data as AITaskLog
}

export interface CreateAlertInput {
  severity: AlertSeverity
  category: string
  message: string
  suggested_action: string
  sop_id?: string
  client_name?: string
}

/** Update an approval queue item's status and return the updated record. */
export async function updateApprovalStatus(
  id: string,
  status: ApprovalStatus,
  reviewerNotes?: string,
): Promise<ApprovalItem> {
  const patch: Record<string, unknown> = { status, reviewed_at: new Date().toISOString() }
  if (reviewerNotes !== undefined) patch.reviewer_notes = reviewerNotes

  const { data, error } = await supabase
    .from('approval_queue')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`updateApprovalStatus: ${error.message}`)
  return {
    ...(data as Omit<ApprovalItem, 'type'>),
    type: data.content_type as ApprovalType,
  }
}

/** Create a new AI alert (resolved: false by default) and return the created record. */
export async function createAlert(input: CreateAlertInput): Promise<AIAlert> {
  const { data, error } = await supabase
    .from('ai_alerts')
    .insert({ ...input, resolved: false })
    .select()
    .single()

  if (error) throw new Error(`createAlert: ${error.message}`)
  return data as AIAlert
}

/** Flip the is_active flag on a cron_schedule row and return the updated record. */
export async function updateCronStatus(id: string, isActive: boolean): Promise<CronJob> {
  const { data, error } = await supabase
    .from('cron_schedule')
    .update({ is_active: isActive })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`updateCronStatus: ${error.message}`)
  return data as CronJob
}

/** Mark an alert as resolved and stamp resolved_at. */
export async function updateAlertResolved(id: string): Promise<AIAlert> {
  const { data, error } = await supabase
    .from('ai_alerts')
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`updateAlertResolved: ${error.message}`)
  return data as AIAlert
}
