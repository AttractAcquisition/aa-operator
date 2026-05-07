-- ─── SOP 52 — Backup & Security Check cron registration ─────────────────────
-- Runs every Sunday at 01:00 UTC.
-- Verifies all daily SOP logs, pings an edge function, checks env vars,
-- and raises critical ai_alerts for any failures.

insert into public.cron_schedule (
  sop_id,
  sop_name,
  domain,
  cron_expression,
  schedule_label,
  is_active,
  next_run
)
values (
  '52',
  'SOP 52 — Backup & Security Check',
  'Operations',
  '0 1 * * 0',
  'Every Sunday at 01:00',
  true,
  '2026-05-10 01:00:00+00'
)
on conflict (sop_id) do update set
  sop_name        = excluded.sop_name,
  cron_expression = excluded.cron_expression,
  schedule_label  = excluded.schedule_label,
  is_active       = excluded.is_active;


-- ─── pg_cron job ──────────────────────────────────────────────────────────────

select cron.schedule(
  'sop-52-backup-check',               -- job name (unique)
  '0 1 * * 0',                         -- every Sunday at 01:00 UTC
  $$
    select net.http_post(
      url    := (select value from vault.decrypted_secrets where name = 'supabase_functions_url') || '/sop-52-backup-check',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from vault.decrypted_secrets where name = 'supabase_service_role_key')
      ),
      body   := '{}'::jsonb
    );
  $$
);
