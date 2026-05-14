-- Phase 1 schema fixes — 2026-05-14
-- Adds missing columns, new tables, canonical constraints, indexes and RPC.

-- ── 1. Add missing columns to prospects ──────────────────────────────────────
alter table public.prospects
  add column if not exists reply_classification text,
  add column if not exists last_reply_at timestamptz;

-- ── 2. Add active_sprint_id to clients ───────────────────────────────────────
alter table public.clients
  add column if not exists active_sprint_id uuid references public.proof_sprints(id) on delete set null;

-- ── 3. Fix clients status constraint ─────────────────────────────────────────
alter table public.clients drop constraint if exists clients_status_check;
alter table public.clients
  add constraint clients_status_check
  check (status in ('active', 'inactive', 'churned', 'paused', 'onboarding'));

-- ── 4. Fix prospects status constraint with canonical vocabulary ──────────────
alter table public.prospects drop constraint if exists prospects_status_check;
alter table public.prospects
  add constraint prospects_status_check
  check (status in (
    'new', 'enriched', 'staged', 'contacted', 'replied', 'warm', 'cold',
    'not_interested', 'unsubscribed', 'mjr_ready', 'mjr_sent', 'spoa_ready',
    'spoa_sent', 'call_booked', 'qualified', 'booked', 'won', 'lost',
    'do_not_contact', 'closed', 'closed_won'
  ));

-- ── 5. Create proof_submissions table ────────────────────────────────────────
create table if not exists public.proof_submissions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  proof_type   text not null check (proof_type in ('before', 'during', 'after')),
  public_url   text not null,
  storage_path text not null,
  notes        text,
  created_at   timestamptz not null default now()
);
alter table public.proof_submissions enable row level security;
create policy "users can read own submissions" on public.proof_submissions
  for select using (auth.uid() = user_id);
create policy "users can insert own submissions" on public.proof_submissions
  for insert with check (auth.uid() = user_id);
create index if not exists proof_submissions_user_id_idx
  on public.proof_submissions (user_id, created_at desc);

-- ── 6. Create client_deliverables table (only if it doesn't already exist) ───
-- If the relation already exists as a view this block is a no-op.
do $cd$ begin
  if not exists (select 1 from pg_class where relname = 'client_deliverables' and relnamespace = 'public'::regnamespace) then
    create table public.client_deliverables (
      id         uuid primary key default gen_random_uuid(),
      client_id  uuid not null references public.clients(id) on delete cascade,
      title      text not null,
      type       text not null,
      status     text not null default 'pending'
                 check (status in ('pending', 'in_progress', 'complete', 'cancelled')),
      due_date   date,
      notes      text,
      tier       text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    alter table public.client_deliverables enable row level security;
    create policy "authenticated read client_deliverables" on public.client_deliverables
      for select to authenticated using (true);
    create policy "authenticated write client_deliverables" on public.client_deliverables
      for all to authenticated using (true) with check (true);
    create index client_deliverables_client_id_idx on public.client_deliverables (client_id);
  end if;
end $cd$;

-- ── 7. Create proof_sprint_client_data table (only if not already a view) ────
do $pscd$ begin
  if not exists (select 1 from pg_class where relname = 'proof_sprint_client_data' and relnamespace = 'public'::regnamespace) then
    create table public.proof_sprint_client_data (
      id        uuid primary key default gen_random_uuid(),
      client_id uuid not null references public.clients(id) on delete cascade,
      sprint_id uuid references public.proof_sprints(id) on delete set null,
      data      jsonb not null default '{}',
      updated_at timestamptz not null default now(),
      unique (client_id)
    );
    alter table public.proof_sprint_client_data enable row level security;
    create policy "authenticated read proof_sprint_client_data" on public.proof_sprint_client_data
      for select to authenticated using (true);
    create policy "authenticated write proof_sprint_client_data" on public.proof_sprint_client_data
      for all to authenticated using (true) with check (true);
  elsif (select relkind from pg_class where relname = 'proof_sprint_client_data' and relnamespace = 'public'::regnamespace) = 'r' then
    -- table already exists — enable RLS idempotently
    alter table public.proof_sprint_client_data enable row level security;
  end if;
end $pscd$;

-- ── 8. Create monthly_revenue view (only if finance_ledger has entry_type) ───
do $mr$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_ledger' and column_name = 'entry_type'
  ) then
    execute $v$
      create or replace view public.monthly_revenue as
      select
        date_trunc('month', invoice_date)::date as month,
        sum(case when entry_type = 'income'  then amount else 0 end) as income,
        sum(case when entry_type = 'expense' then amount else 0 end) as expense,
        sum(case when entry_type = 'income'  then amount else 0 end)
          - sum(case when entry_type = 'expense' then amount else 0 end) as net
      from public.finance_ledger
      where status != 'cancelled'
      group by 1
      order by 1 desc
    $v$;
  end if;
end $mr$;

-- ── 9. Create get_pipeline_counts RPC ────────────────────────────────────────
create or replace function public.get_pipeline_counts()
returns table (status text, count bigint)
language sql security definer as $$
  select status::text, count(*)::bigint
  from public.prospects
  where is_archived = false or is_archived is null
  group by status;
$$;

-- ── 10. Add missing indexes ───────────────────────────────────────────────────
create index if not exists prospects_status_idx          on public.prospects (status);
create index if not exists prospects_pipeline_stage_idx  on public.prospects (pipeline_stage);
create index if not exists prospects_icp_total_score_idx on public.prospects (icp_total_score desc);
create index if not exists clients_tier_idx              on public.clients (tier);
create index if not exists clients_status_idx            on public.clients (status);
