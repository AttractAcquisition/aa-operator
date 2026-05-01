-- ─── ai_task_log ─────────────────────────────────────────────────────────────
-- Records every tool call made by Claude across all SOPs.
create table if not exists public.ai_task_log (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  sop_id          text not null,
  sop_name        text not null,
  tool_called     text not null,
  status          text not null check (status in ('success', 'failure', 'running')),
  duration_ms     integer,
  input_summary   text not null default '',
  output_summary  text not null default ''
);

alter table public.ai_task_log enable row level security;

create policy "service role full access" on public.ai_task_log
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.ai_task_log
  for select using (true);

create index if not exists ai_task_log_created_at_idx on public.ai_task_log (created_at desc);
create index if not exists ai_task_log_sop_id_idx      on public.ai_task_log (sop_id);
create index if not exists ai_task_log_status_idx      on public.ai_task_log (status);


-- ─── approval_queue (operator columns) ───────────────────────────────────────
-- The approval_queue table already exists for content approval.
-- We extend it with operator-specific columns for SOP-generated items.
alter table public.approval_queue
  add column if not exists sop_id       text,
  add column if not exists sop_name     text,
  add column if not exists priority     text default 'medium'
    check (priority in ('high', 'medium', 'low')),
  add column if not exists content      jsonb not null default '{}',
  add column if not exists reviewed_at  timestamptz,
  add column if not exists reviewer_notes text;

create index if not exists approval_queue_sop_id_idx   on public.approval_queue (sop_id);
create index if not exists approval_queue_priority_idx on public.approval_queue (priority);


-- ─── cron_schedule ───────────────────────────────────────────────────────────
-- Tracks all scheduled SOP automations and their run history.
create table if not exists public.cron_schedule (
  id               uuid primary key default gen_random_uuid(),
  sop_id           text not null unique,
  sop_name         text not null,
  domain           text not null,
  cron_expression  text not null,
  schedule_label   text not null,
  is_active        boolean not null default true,
  last_run         timestamptz,
  next_run         timestamptz not null,
  last_status      text check (last_status in ('success', 'failure', 'running')),
  run_count        integer not null default 0,
  avg_duration_ms  integer,
  last_error       text
);

alter table public.cron_schedule enable row level security;

create policy "service role full access" on public.cron_schedule
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.cron_schedule
  for select using (true);

create index if not exists cron_schedule_is_active_idx on public.cron_schedule (is_active);
create index if not exists cron_schedule_next_run_idx  on public.cron_schedule (next_run);


-- ─── knowledge_base ──────────────────────────────────────────────────────────
-- Stores SOP definitions, prompt templates, and reference documents used as
-- context by Claude when running automations.
create table if not exists public.knowledge_base (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  type        text not null check (type in ('sop', 'template', 'script', 'reference', 'client_context')),
  title       text not null,
  content     text not null,
  metadata    jsonb not null default '{}',
  tags        text[] not null default '{}',
  is_active   boolean not null default true
);

alter table public.knowledge_base enable row level security;

create policy "service role full access" on public.knowledge_base
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.knowledge_base
  for select using (true);

create index if not exists knowledge_base_type_idx      on public.knowledge_base (type);
create index if not exists knowledge_base_is_active_idx on public.knowledge_base (is_active);
create index if not exists knowledge_base_tags_idx      on public.knowledge_base using gin (tags);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists knowledge_base_updated_at on public.knowledge_base;
create trigger knowledge_base_updated_at
  before update on public.knowledge_base
  for each row execute function public.set_updated_at();


-- ─── ai_alerts ───────────────────────────────────────────────────────────────
-- Alerts raised by Claude during automated runs (sprint issues, finance flags, etc).
create table if not exists public.ai_alerts (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  severity         text not null check (severity in ('critical', 'warning', 'info')),
  sop_id           text,
  category         text not null,
  message          text not null,
  suggested_action text not null default '',
  resolved         boolean not null default false,
  resolved_at      timestamptz,
  client_name      text
);

alter table public.ai_alerts enable row level security;

create policy "service role full access" on public.ai_alerts
  for all using (auth.role() = 'service_role');

create policy "anon read" on public.ai_alerts
  for select using (true);

create policy "anon update resolved" on public.ai_alerts
  for update using (true) with check (true);

create index if not exists ai_alerts_resolved_idx   on public.ai_alerts (resolved);
create index if not exists ai_alerts_severity_idx   on public.ai_alerts (severity);
create index if not exists ai_alerts_created_at_idx on public.ai_alerts (created_at desc);
create index if not exists ai_alerts_client_idx     on public.ai_alerts (client_name);
