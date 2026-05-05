-- ─── clients.tier ─────────────────────────────────────────────────────────────
-- Adds service tier to clients. Mirrors the tier system in sop-15/sop-17.
-- Used by SOP 31 (proof_brand monthly ops) and future tier-specific automations.
--   proof_sprint   — £800/mo, Google Ads only
--   proof_brand    — £1500/mo, Google Ads + Meta Ads
--   authority_brand — £3000/mo, Google + Meta + Remarketing
alter table public.clients
  add column if not exists tier text
    check (tier in ('proof_sprint', 'proof_brand', 'authority_brand'));

create index if not exists clients_tier_idx on public.clients (tier);
