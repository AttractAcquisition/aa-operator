-- ─── clients upsell tracking ─────────────────────────────────────────────────
-- Persists the most recent upsell readiness score and check timestamp so the
-- dashboard can surface high-scoring clients without re-running SOP 35.
alter table public.clients
  add column if not exists last_upsell_score    integer
    check (last_upsell_score between 0 and 10),
  add column if not exists last_upsell_check_at timestamptz;

create index if not exists clients_upsell_score_idx
  on public.clients (last_upsell_score desc nulls last);
