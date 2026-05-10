-- ─── whatsapp_messages ───────────────────────────────────────────────────────
-- Stores every inbound and outbound WhatsApp message linked to a prospect.
-- Inbound rows are written by server.js when Meta delivers a webhook event.
-- Outbound rows are written by SOP 01 (outreach drafts) after operator approval.
--
-- direction:
--   inbound  — message received FROM a prospect via Meta Cloud API webhook
--   outbound — message sent TO a prospect by the AA Operator
--
-- status lifecycle:
--   sent → delivered → read     (outbound happy path, updated via status webhook)
--   failed                       (outbound delivery failure)
--   Inbound messages start and stay at 'sent' (we received them; 'read' is implicit).
--
-- whatsapp_message_id is Meta's globally unique wamid (e.g. wamid.xxx…).
-- It is used as a dedup key: Meta may re-deliver the same webhook event.
--
-- from_number stores the raw E.164 number as supplied by Meta (no '+').
-- This is kept even when prospect_id is null so unmatched messages can be
-- investigated and later linked.

create table if not exists public.whatsapp_messages (
  id                   uuid        primary key default gen_random_uuid(),
  prospect_id          uuid        references public.prospects(id) on delete set null,
  direction            text        not null check (direction in ('inbound', 'outbound')),
  message_body         text        not null,
  whatsapp_message_id  text        unique,                        -- nullable for manually-inserted outbound rows
  from_number          text,                                      -- raw Meta phone number, no '+'
  status               text        not null default 'sent'
    check (status in ('sent', 'delivered', 'read', 'failed')),
  sent_at              timestamptz not null,
  created_at           timestamptz not null default now()
);

-- ─── Row-level security ───────────────────────────────────────────────────────

alter table public.whatsapp_messages enable row level security;

-- Edge functions and the server.js backend use the service role for all writes.
create policy "service role full access" on public.whatsapp_messages
  for all using (auth.role() = 'service_role');

-- The frontend Supabase client (anon key) may read messages to render threads.
create policy "anon read" on public.whatsapp_messages
  for select using (true);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- Primary access patterns: by prospect (thread view) and by time (recent feed).
create index if not exists whatsapp_messages_prospect_id_idx
  on public.whatsapp_messages (prospect_id, sent_at desc);

create index if not exists whatsapp_messages_created_at_idx
  on public.whatsapp_messages (created_at desc);

-- Fast dedup checks on ingest.
create index if not exists whatsapp_messages_wa_id_idx
  on public.whatsapp_messages (whatsapp_message_id)
  where whatsapp_message_id is not null;

-- Lookup by raw from_number when prospect_id is unknown.
create index if not exists whatsapp_messages_from_number_idx
  on public.whatsapp_messages (from_number)
  where from_number is not null;
