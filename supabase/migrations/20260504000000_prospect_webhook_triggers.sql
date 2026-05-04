-- ─── prospect_webhook_triggers ────────────────────────────────────────────────
-- Fires edge functions automatically when prospects change state:
--   INSERT with status = 'new'          → sop-03-enrichment
--   UPDATE status → 'call_booked'       → sop-07-call-brief
--
-- Both functions support a single-prospect mode: when called from a webhook they
-- receive { prospect_id } in the body and process only that row; when invoked by
-- the cron scheduler (no body) they fall back to their normal batch behaviour.
--
-- REQUIRED ONE-TIME SETUP — run in Supabase dashboard → SQL editor:
--   alter database postgres set app.supabase_url    = 'https://YOUR_REF.supabase.co';
--   alter database postgres set app.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
-- These GUCs keep secrets out of version-controlled migration files.

-- ── pg_net (HTTP from within Postgres) ───────────────────────────────────────
create extension if not exists pg_net;

-- ── Private schema for trigger helpers (not exposed via PostgREST) ────────────
create schema if not exists private;

-- ── Helper: POST to any named edge function ───────────────────────────────────
create or replace function private.invoke_edge_function(
  fn_name text,
  payload jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _url text := current_setting('app.supabase_url', true) || '/functions/v1/' || fn_name;
  _key text := current_setting('app.service_role_key', true);
begin
  if _url is null or _key is null then
    raise warning
      'invoke_edge_function: app.supabase_url or app.service_role_key not configured — skipping %',
      fn_name;
    return;
  end if;

  perform net.http_post(
    url     := _url,
    body    := payload,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || _key
    ),
    timeout_milliseconds := 5000
  );
end;
$$;

-- ── INSERT trigger: new prospect with status = 'new' → sop-03-enrichment ──────

create or replace function private.on_prospect_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'new' then
    perform private.invoke_edge_function(
      'sop-03-enrichment',
      jsonb_build_object(
        'type',        'INSERT',
        'table',       'prospects',
        'record',      row_to_json(new),
        'prospect_id', new.id
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists prospect_new_insert_webhook on public.prospects;
create trigger prospect_new_insert_webhook
  after insert on public.prospects
  for each row
  execute function private.on_prospect_inserted();

-- ── UPDATE trigger: status transition → 'call_booked' → sop-07-call-brief ─────

create or replace function private.on_prospect_status_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only fire on a genuine transition into call_booked (not a no-op update)
  if new.status = 'call_booked' and old.status is distinct from 'call_booked' then
    perform private.invoke_edge_function(
      'sop-07-call-brief',
      jsonb_build_object(
        'type',        'UPDATE',
        'table',       'prospects',
        'record',      row_to_json(new),
        'old_record',  row_to_json(old),
        'prospect_id', new.id
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists prospect_call_booked_webhook on public.prospects;
create trigger prospect_call_booked_webhook
  after update of status on public.prospects
  for each row
  execute function private.on_prospect_status_updated();
