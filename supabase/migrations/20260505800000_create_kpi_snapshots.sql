-- ─── kpi_snapshots ────────────────────────────────────────────────────────────
-- Stores structured monthly KPI reports written by SOP 53.
-- Each row is one snapshot run; kpi_report JSONB holds the full report.
create table if not exists public.kpi_snapshots (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  snapshot_date date not null,
  period_start  date not null,
  period_end    date not null,
  kpi_report    jsonb not null default '{}'
);

alter table public.kpi_snapshots enable row level security;

create policy "service role full access" on public.kpi_snapshots
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.kpi_snapshots
  for select using (true);

create index if not exists kpi_snapshots_snapshot_date_idx
  on public.kpi_snapshots (snapshot_date desc);

create index if not exists kpi_snapshots_period_start_idx
  on public.kpi_snapshots (period_start desc);
