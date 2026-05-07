-- ─── SOP 56 — Finance Dashboard cron registration ────────────────────────────
-- Runs every Monday at 06:00 UTC (07:00 London BST / 06:00 GMT).
-- Aggregates finance_ledger for the current month, writes a structured
-- finance_summary snapshot to finance_snapshots, and logs to ai_task_log.

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
  '56',
  'SOP 56 — Finance Dashboard & Income Tracking',
  'Finance',
  '0 6 * * 1',
  'Every Monday at 06:00',
  true,
  -- Next Monday at 06:00 UTC from today (2026-05-07 Thu → 2026-05-11 Mon)
  '2026-05-11 06:00:00+00'
)
on conflict (sop_id) do update set
  sop_name        = excluded.sop_name,
  cron_expression = excluded.cron_expression,
  schedule_label  = excluded.schedule_label,
  is_active       = excluded.is_active;


-- ─── pg_cron job ─────────────────────────────────────────────────────────────

select cron.schedule(
  'sop-56-finance-dashboard',         -- job name (unique)
  '0 6 * * 1',                        -- every Monday at 06:00 UTC
  $$
    select net.http_post(
      url    := (select value from vault.decrypted_secrets where name = 'supabase_functions_url') || '/sop-56-finance-dashboard',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from vault.decrypted_secrets where name = 'supabase_service_role_key')
      ),
      body   := '{}'::jsonb
    );
  $$
);
