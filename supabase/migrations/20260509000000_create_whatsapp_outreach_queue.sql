-- ─── whatsapp_outreach_queue ──────────────────────────────────────────────────
-- Holds cold outreach message drafts produced by SOP 01 each weekday morning.
-- One row per prospect per batch — the operator reviews, edits, approves, and
-- sends from this queue.
--
-- Distinct from whatsapp_ai_suggestions, which stores AI reply drafts for warm
-- in-progress conversations. This table is exclusively for first-touch cold
-- outreach batches targeting staged prospects.
--
-- Status lifecycle:
--   pending_review → approved → sent       (happy path)
--   pending_review → rejected              (operator dismisses)
--   approved       → failed                (send attempt failed; error_message set)
--
-- ⚠ MIGRATION ORDER DEPENDENCY:
--   The conversation_id FK references whatsapp_conversations, which is created in
--   20260510000000_create_whatsapp_conversations.sql. If applying migrations in
--   filename-timestamp order, rename this file to 20260510200000_… or later to
--   ensure whatsapp_conversations exists before this table is created.

create table if not exists public.whatsapp_outreach_queue (
  id               uuid         primary key default gen_random_uuid(),
  batch_date       date         not null default current_date,
  batch_label      text,
  prospect_id      uuid         references public.prospects(id) on delete set null,
  conversation_id  uuid         references public.whatsapp_conversations(id) on delete set null,
  phone_number     text         not null,
  contact_name     text         not null,
  company_name     text         not null,
  drafted_message  text         not null,
  quality_score    integer,
  status           text         not null default 'pending_review'
                                check (status in ('pending_review', 'approved', 'rejected', 'sent', 'failed')),
  approved_by      text,
  approved_at      timestamptz,
  sent_at          timestamptz,
  error_message    text,
  created_at       timestamptz  not null default now()
);

-- ─── Row-level security ───────────────────────────────────────────────────────

alter table public.whatsapp_outreach_queue enable row level security;

-- Edge functions and cron runner write via the service role.
create policy "service role full access" on public.whatsapp_outreach_queue
  for all using (auth.role() = 'service_role');

-- Frontend Supabase client (anon key) may read the queue to render the UI.
create policy "anon read" on public.whatsapp_outreach_queue
  for select using (true);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Primary UI access pattern: today's pending batch in quality order.
create index if not exists whatsapp_outreach_queue_batch_date_idx
  on public.whatsapp_outreach_queue (batch_date desc, quality_score desc);

-- Filter by status (e.g. all pending_review for the review screen).
create index if not exists whatsapp_outreach_queue_status_idx
  on public.whatsapp_outreach_queue (status, batch_date desc);

-- Link back to prospect and conversation for detail lookups.
create index if not exists whatsapp_outreach_queue_prospect_id_idx
  on public.whatsapp_outreach_queue (prospect_id);

create index if not exists whatsapp_outreach_queue_conversation_id_idx
  on public.whatsapp_outreach_queue (conversation_id);
