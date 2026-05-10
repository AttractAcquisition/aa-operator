-- ─── whatsapp_conversations ───────────────────────────────────────────────────
-- One row per prospect-conversation thread.
-- Created by SOP 01 when an outreach draft is generated for a prospect who has
-- no existing conversation, or by the inbound webhook when an unknown number
-- contacts us for the first time.
--
-- source:  how the conversation started
--   outreach_campaign — SOP 01 created a draft for this prospect
--   inbound           — prospect messaged us first (via webhook)
--   referral          — manually linked
--
-- stage mirrors the prospect pipeline stage for quick filtering:
--   new → contacted → replied → warm → call_booked → closed | blocked
--
-- status:
--   open     — conversation is active
--   closed   — deal won, churned, or deliberately ended
--   archived — no activity, soft-hidden from UI

create table if not exists public.whatsapp_conversations (
  id           uuid        primary key default gen_random_uuid(),
  prospect_id  uuid        references public.prospects(id) on delete set null,
  phone        text        not null,
  source       text        not null default 'outreach_campaign'
                           check (source in ('outreach_campaign', 'inbound', 'referral')),
  stage        text        not null default 'new'
                           check (stage in ('new', 'contacted', 'replied', 'warm', 'call_booked', 'closed', 'blocked')),
  status       text        not null default 'open'
                           check (status in ('open', 'closed', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.whatsapp_conversations enable row level security;

create policy "service role full access" on public.whatsapp_conversations
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.whatsapp_conversations
  for select using (true);

-- Fast prospect → conversation lookup (primary access pattern in SOP 01 + UI)
create unique index if not exists whatsapp_conversations_prospect_id_idx
  on public.whatsapp_conversations (prospect_id)
  where prospect_id is not null;

-- Phone-based lookup for inbound webhook matching (Meta delivers no prospect_id)
create index if not exists whatsapp_conversations_phone_idx
  on public.whatsapp_conversations (phone);

create index if not exists whatsapp_conversations_stage_idx
  on public.whatsapp_conversations (stage);

create index if not exists whatsapp_conversations_status_idx
  on public.whatsapp_conversations (status)
  where status = 'open';

-- Auto-update updated_at on any write
create or replace function public.set_whatsapp_conversation_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists whatsapp_conversations_updated_at on public.whatsapp_conversations;
create trigger whatsapp_conversations_updated_at
  before update on public.whatsapp_conversations
  for each row execute function public.set_whatsapp_conversation_updated_at();


-- ─── whatsapp_ai_suggestions ─────────────────────────────────────────────────
-- AI-generated message drafts waiting for operator review.
-- Each SOP 01 run produces one row per prospect rather than one batch approval item.
-- This lets the operator approve/reject/edit at the individual message level.
--
-- status lifecycle:
--   pending_review → approved (operator clicks send) → sent
--   pending_review → rejected (operator dismisses)
--   pending_review → edited   (operator modifies then approves)
--
-- confidence is quality_score / 10 (0.00–1.00): higher = more personalisation
-- data available, Claude is more likely to produce a strong message.

create table if not exists public.whatsapp_ai_suggestions (
  id               uuid         primary key default gen_random_uuid(),
  conversation_id  uuid         not null references public.whatsapp_conversations(id) on delete cascade,
  prospect_id      uuid         references public.prospects(id) on delete set null,
  suggested_body   text         not null,
  reason           text,
  confidence       numeric(4,3) check (confidence >= 0 and confidence <= 1),
  status           text         not null default 'pending_review'
                                check (status in ('pending_review', 'approved', 'rejected', 'edited', 'sent')),
  provider         text         not null default 'anthropic',
  model            text         not null,
  created_by       text         not null,
  created_at       timestamptz  not null default now()
);

alter table public.whatsapp_ai_suggestions enable row level security;

create policy "service role full access" on public.whatsapp_ai_suggestions
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.whatsapp_ai_suggestions
  for select using (true);

create policy "anon update status" on public.whatsapp_ai_suggestions
  for update using (true) with check (true);

-- Primary query: pending suggestions for a conversation
create index if not exists whatsapp_ai_suggestions_conversation_idx
  on public.whatsapp_ai_suggestions (conversation_id, created_at desc);

-- Queue view: all pending_review across all conversations
create index if not exists whatsapp_ai_suggestions_status_idx
  on public.whatsapp_ai_suggestions (status, created_at desc)
  where status = 'pending_review';

create index if not exists whatsapp_ai_suggestions_prospect_idx
  on public.whatsapp_ai_suggestions (prospect_id);
