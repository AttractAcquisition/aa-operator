-- Phase 6: finance schema consolidation
-- NOTE: financial_snapshots already exists as a native table in the live DB — H-04 is resolved.
-- This migration only creates the ledger_entries compatibility view.

-- ── ledger_entries → ledger ───────────────────────────────────────────────────
-- COS aicos.ts references 'ledger_entries'; live table is 'ledger' (COS-owned).
-- Creates ledger_entries as a view so any legacy references continue to work.
-- Note: 'ledger' (COS) and 'finance_ledger' (AICOS) are separate tables:
--   ledger        = COS transaction tracking (date, type, category, tags)
--   finance_ledger = AICOS invoice tracking (invoice_date, entry_type, invoice_number)
-- Full consolidation into a single canonical table is a deferred Phase 6.3 task.
do $$ begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ledger'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'ledger_entries'
  ) then
    execute 'create view public.ledger_entries as select * from public.ledger';
    execute 'grant select on public.ledger_entries to anon, authenticated';
  end if;
end $$;
