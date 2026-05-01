-- ─── daily_briefings ─────────────────────────────────────────────────────────
-- Stores the output of SOP 58 — one row per briefing run.
-- The full DailyBriefing JSON is stored in the briefing column; generated_at
-- is denormalised as a top-level column for efficient ORDER BY / index scans.
create table if not exists public.daily_briefings (
  id           uuid primary key default gen_random_uuid(),
  generated_at timestamptz not null default now(),
  briefing     jsonb not null
);

alter table public.daily_briefings enable row level security;

create policy "service role full access" on public.daily_briefings
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.daily_briefings
  for select using (true);

create index if not exists daily_briefings_generated_at_idx
  on public.daily_briefings (generated_at desc);
