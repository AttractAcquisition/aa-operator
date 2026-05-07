-- ─── clients.contact_phone ───────────────────────────────────────────────────
-- Phone number used for WhatsApp billing chase messages (SOP 46).
alter table public.clients
  add column if not exists contact_phone text;


-- ─── finance_ledger ───────────────────────────────────────────────────────────
-- Tracks invoices issued to managed clients.
-- SOP 46 queries for overdue rows and generates WhatsApp chase messages.
create table if not exists public.finance_ledger (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  client_name     text not null,
  invoice_number  text not null unique,
  invoice_date    date not null,
  due_date        date not null,
  amount          numeric(10, 2) not null check (amount > 0),
  currency        text not null default 'GBP',
  status          text not null default 'pending'
    check (status in ('pending', 'paid', 'overdue', 'partial', 'cancelled')),
  description     text not null default '',
  notes           text,
  paid_at         timestamptz
);

alter table public.finance_ledger enable row level security;

create policy "service role full access" on public.finance_ledger
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.finance_ledger
  for select using (true);

create index if not exists finance_ledger_client_id_idx  on public.finance_ledger (client_id);
create index if not exists finance_ledger_due_date_idx   on public.finance_ledger (due_date);
create index if not exists finance_ledger_status_idx     on public.finance_ledger (status);

drop trigger if exists finance_ledger_updated_at on public.finance_ledger;
create trigger finance_ledger_updated_at
  before update on public.finance_ledger
  for each row execute function public.set_updated_at();
