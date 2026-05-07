-- ─── finance_ledger.entry_type ───────────────────────────────────────────────
-- Distinguishes income (client invoices) from expenses (agency costs).
-- Required by SOP 56 to separate income vs expense aggregations.
alter table public.finance_ledger
  add column if not exists entry_type text not null default 'income'
    check (entry_type in ('income', 'expense'));

create index if not exists finance_ledger_entry_type_idx
  on public.finance_ledger (entry_type);


-- ─── finance_snapshots ───────────────────────────────────────────────────────
-- Stores structured monthly finance summaries written by SOP 56.
-- Each row is one snapshot run; finance_summary JSONB holds the full report.
create table if not exists public.finance_snapshots (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  snapshot_date   date not null,
  period_start    date not null,
  period_end      date not null,
  finance_summary jsonb not null default '{}'
);

alter table public.finance_snapshots enable row level security;

create policy "service role full access" on public.finance_snapshots
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.finance_snapshots
  for select using (true);

create index if not exists finance_snapshots_snapshot_date_idx
  on public.finance_snapshots (snapshot_date desc);

create index if not exists finance_snapshots_period_start_idx
  on public.finance_snapshots (period_start desc);
