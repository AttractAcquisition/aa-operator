-- ─── SOP 49 — Weekly Content Generation cron registration ────────────────────
-- Runs every Monday at 08:00 UTC (09:00 London BST / 08:00 GMT).
-- Pulls sprint wins, client results, and industry insights from knowledge_base,
-- generates 5 social media content pieces via claude-sonnet-4-6, and queues
-- one medium-priority approval item for review before scheduling.

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
  '49',
  'SOP 49 — Weekly Content Generation',
  'Marketing',
  '0 8 * * 1',
  'Every Monday at 08:00 UTC',
  true,
  '2026-05-11 08:00:00+00'
)
on conflict (sop_id) do update set
  sop_name        = excluded.sop_name,
  cron_expression = excluded.cron_expression,
  schedule_label  = excluded.schedule_label,
  is_active       = excluded.is_active;


-- ─── pg_cron job ──────────────────────────────────────────────────────────────

select cron.schedule(
  'sop-49-content',                     -- job name (unique)
  '0 8 * * 1',                          -- every Monday at 08:00 UTC
  $$
    select net.http_post(
      url    := (select value from vault.decrypted_secrets where name = 'supabase_functions_url') || '/sop-49-content',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from vault.decrypted_secrets where name = 'supabase_service_role_key')
      ),
      body   := '{}'::jsonb
    );
  $$
);
