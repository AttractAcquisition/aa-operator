-- ─── SOP 41 — Weekly Review cron registration ────────────────────────────────
-- Runs every Friday at 16:00 UTC via pg_cron.
-- The edge function aggregates the full week, calls Claude Sonnet, and writes
-- a type='weekly_review' briefing row to daily_briefings.

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
  '41',
  'SOP 41 — Weekly Review',
  'Principal',
  '0 16 * * 5',
  'Every Friday at 16:00',
  true,
  -- Next Friday at 16:00 UTC from today (2026-05-05 Tue → 2026-05-08 Fri)
  '2026-05-08 16:00:00+00'
)
on conflict (sop_id) do update set
  sop_name        = excluded.sop_name,
  cron_expression = excluded.cron_expression,
  schedule_label  = excluded.schedule_label,
  is_active       = excluded.is_active;


-- ─── pg_cron job ─────────────────────────────────────────────────────────────
-- Requires the pg_cron extension enabled in Supabase (Dashboard → Database → Extensions).
-- The job POSTs to the edge function using the service role key from vault.

select cron.schedule(
  'sop-41-weekly-review',          -- job name (unique)
  '0 16 * * 5',                    -- every Friday at 16:00 UTC
  $$
    select net.http_post(
      url    := (select value from vault.decrypted_secrets where name = 'supabase_functions_url') || '/sop-41-weekly-review',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from vault.decrypted_secrets where name = 'supabase_service_role_key')
      ),
      body   := '{}'::jsonb
    );
  $$
);
