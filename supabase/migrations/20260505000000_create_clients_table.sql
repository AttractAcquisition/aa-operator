-- ─── clients ──────────────────────────────────────────────────────────────────
-- Tracks active managed clients. Used by SOP 47 (weekly reports) and future
-- billing/renewal automations. client.name is the join key to sprints.client_name.
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  name            text not null unique,
  status          text not null default 'active'
    check (status in ('active', 'inactive', 'churned')),
  niche           text,
  contact_name    text,
  contact_email   text,
  notes           text
);

alter table public.clients enable row level security;

create policy "service role full access" on public.clients
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.clients
  for select using (true);

create index if not exists clients_status_idx on public.clients (status);
create index if not exists clients_name_idx   on public.clients (name);

drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();
