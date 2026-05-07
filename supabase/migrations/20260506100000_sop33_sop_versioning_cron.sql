-- ─── SOP 33 — SOP Versioning cron registration ───────────────────────────────
-- Runs on the 1st of each month at 11:00 UTC.
-- Reviews all active SOPs against 30 days of ai_task_log performance data,
-- generates improvement suggestions via Claude Sonnet, and queues them for approval.

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
  '33',
  'SOP 33 — SOP Versioning',
  'Operations',
  '0 11 1 * *',
  '1st of each month at 11:00',
  true,
  '2026-06-01 11:00:00+00'
)
on conflict (sop_id) do update set
  sop_name        = excluded.sop_name,
  cron_expression = excluded.cron_expression,
  schedule_label  = excluded.schedule_label,
  is_active       = excluded.is_active;


-- ─── pg_cron job ──────────────────────────────────────────────────────────────

select cron.schedule(
  'sop-33-sop-versioning',             -- job name (unique)
  '0 11 1 * *',                        -- 1st of each month at 11:00 UTC
  $$
    select net.http_post(
      url    := (select value from vault.decrypted_secrets where name = 'supabase_functions_url') || '/sop-33-sop-versioning',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from vault.decrypted_secrets where name = 'supabase_service_role_key')
      ),
      body   := '{}'::jsonb
    );
  $$
);
