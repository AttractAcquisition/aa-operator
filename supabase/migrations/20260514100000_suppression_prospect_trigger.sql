-- Suppression list → prospect status trigger — 2026-05-14
-- When a row is inserted into whatsapp_suppression_list, automatically set
-- the matching prospect(s) status to 'do_not_contact'.
-- This replaces direct browser writes to prospects from Outreach-System.

create or replace function public.handle_suppression_insert()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.prospects
  set status = 'do_not_contact'
  where (new.prospect_id is not null and id = new.prospect_id)
     or (new.prospect_id is null and (phone = new.phone_number or whatsapp = new.phone_number));
  return new;
end;
$$;

drop trigger if exists on_suppression_insert on public.whatsapp_suppression_list;
create trigger on_suppression_insert
  after insert on public.whatsapp_suppression_list
  for each row execute function public.handle_suppression_insert();
