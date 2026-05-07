-- ─── SOP 46 — Billing & Payment Chase cron registration ──────────────────────
-- Runs every Monday at 08:30 UTC (09:30 London BST / 08:30 GMT).
-- Checks all active clients for invoices overdue 7+ days, generates WhatsApp
-- chase messages, and raises warning alerts for invoices overdue 14+ days.

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
  '46',
  'SOP 46 — Billing & Payment Chase',
  'Finance',
  '30 8 * * 1',
  'Every Monday at 08:30',
  true,
  -- Next Monday at 08:30 UTC from today (2026-05-05 Tue → 2026-05-11 Mon)
  '2026-05-11 08:30:00+00'
)
on conflict (sop_id) do update set
  sop_name        = excluded.sop_name,
  cron_expression = excluded.cron_expression,
  schedule_label  = excluded.schedule_label,
  is_active       = excluded.is_active;


-- ─── pg_cron job ─────────────────────────────────────────────────────────────

select cron.schedule(
  'sop-46-billing',                 -- job name (unique)
  '30 8 * * 1',                     -- every Monday at 08:30 UTC
  $$
    select net.http_post(
      url    := (select value from vault.decrypted_secrets where name = 'supabase_functions_url') || '/sop-46-billing',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (select value from vault.decrypted_secrets where name = 'supabase_service_role_key')
      ),
      body   := '{}'::jsonb
    );
  $$
);
