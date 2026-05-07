-- ─── SOP 53 — KPI Review cron registration ────────────────────────────────────
-- Runs on the 1st of each month at 08:00 UTC.
-- Calculates 8 core KPIs vs. the previous 30-day period, writes to kpi_snapshots.

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
  '53',
  'SOP 53 — Monthly KPI Review',
  'Analytics',
  '0 8 1 * *',
  '1st of each month at 08:00',
  true,
  '2026-06-01 08:00:00+00'
)
on conflict (sop_id) do update set
  sop_name        = excluded.sop_name,
  cron_expression = excluded.cron_expression,
  schedule_label  = excluded.schedule_label,
  is_active       = excluded.is_active;


-- ─── pg_cron job ──────────────────────────────────────────────────────────────

select cron.schedule(
  'sop-53-kpi-review',                 -- job name (unique)
  '0 8 1 * *',                         -- 1st of each month at 08:00 UTC
  $$
    select net.http_post(
      url    := (select value from vault.decrypted_secrets where name = 'supabase_functions_url') || '/sop-53-kpi-review',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from vault.decrypted_secrets where name = 'supabase_service_role_key')
      ),
      body   := '{}'::jsonb
    );
  $$
);
