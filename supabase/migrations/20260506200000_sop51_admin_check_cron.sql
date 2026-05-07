-- ─── SOP 51 — Admin Check cron registration ──────────────────────────────────
-- Runs every Monday at 06:30 UTC (07:30 London BST / 06:30 GMT).
-- Queries cron_schedule, approval_queue, and ai_alerts for outstanding issues,
-- generates a structured admin briefing, and queues a high-priority call_brief
-- if any critical issues are found.

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
  '51',
  'SOP 51 — Admin Check',
  'Operations',
  '30 6 * * 1',
  'Every Monday at 06:30',
  true,
  '2026-05-11 06:30:00+00'
)
on conflict (sop_id) do update set
  sop_name        = excluded.sop_name,
  cron_expression = excluded.cron_expression,
  schedule_label  = excluded.schedule_label,
  is_active       = excluded.is_active;


-- ─── pg_cron job ──────────────────────────────────────────────────────────────

select cron.schedule(
  'sop-51-admin-check',                -- job name (unique)
  '30 6 * * 1',                        -- every Monday at 06:30 UTC
  $$
    select net.http_post(
      url    := (select value from vault.decrypted_secrets where name = 'supabase_functions_url') || '/sop-51-admin-check',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from vault.decrypted_secrets where name = 'supabase_service_role_key')
      ),
      body   := '{}'::jsonb
    );
  $$
);
