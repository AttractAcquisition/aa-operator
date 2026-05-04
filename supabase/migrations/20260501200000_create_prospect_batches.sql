-- ─── prospect_batches ────────────────────────────────────────────────────────
-- Records each daily CRM staging run produced by SOP 04.
-- prospect_ids stores the ordered list of staged prospect UUIDs for traceability.
create table if not exists public.prospect_batches (
  id                uuid    primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  batch_date        date    not null default current_date,
  count             integer not null,
  avg_quality_score numeric(4, 2) not null,
  min_quality_score integer not null default 6,
  batch_notes       text,
  prospect_ids      uuid[]  not null default '{}'
);

alter table public.prospect_batches enable row level security;

create policy "service role full access" on public.prospect_batches
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.prospect_batches
  for select using (true);

create index if not exists prospect_batches_batch_date_idx
  on public.prospect_batches (batch_date desc);
