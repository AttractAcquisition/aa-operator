-- ─── whatsapp_conversations: ai_intent + needs_human + expanded stage ─────────
-- Added by SOP 06 refactor — reply triage now writes structured intent signals
-- directly to the conversation row so the UI can filter/sort by AI classification
-- without joining back to prospects.
--
-- ai_intent   — the Haiku classification label (warm/cold/not_interested/unsubscribed)
-- needs_human — true when a human should review/respond; false when SOP has fully
--               handled the outcome (closed, unsubscribed, not_interested)
--
-- Stage constraint is also expanded:
--   'qualified' — warm reply received, prospect is sales-ready
--   'lost'      — prospect declined (not_interested); conversation closed
--   'blocked'   — prospect requested no further contact (unsubscribed)

alter table public.whatsapp_conversations
  add column if not exists ai_intent    text
    check (ai_intent in ('warm', 'cold', 'not_interested', 'unsubscribed')),
  add column if not exists needs_human  boolean;

-- Expand the stage check constraint to include 'qualified', 'lost', 'blocked'.
-- PostgreSQL requires drop + re-add to change a check constraint.
-- The default auto-generated name is <table>_stage_check; we drop it if it exists
-- under either the auto-generated or a legacy explicit name before recreating.
alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_stage_check;

alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_stage_check
  check (stage in (
    'new', 'contacted', 'replied', 'warm',
    'qualified', 'lost', 'blocked',
    'call_booked', 'closed'
  ));

-- Index for the UI's "needs human attention" queue
create index if not exists whatsapp_conversations_needs_human_idx
  on public.whatsapp_conversations (needs_human, updated_at desc)
  where needs_human = true;

-- Index for filtering by AI intent (e.g. all warm conversations)
create index if not exists whatsapp_conversations_ai_intent_idx
  on public.whatsapp_conversations (ai_intent)
  where ai_intent is not null;
