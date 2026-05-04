-- ─── documents storage bucket ────────────────────────────────────────────────
-- Private bucket for SOP-generated files (MJRs, SPOAs, client reports).
-- Access is via signed URLs created by service-role functions only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  10485760,           -- 10 MB per file
  array['text/html', 'application/pdf', 'text/plain']
)
on conflict (id) do nothing;

-- Service role can do everything
create policy "service role full access on documents"
  on storage.objects for all
  using (bucket_id = 'documents' and auth.role() = 'service_role');

-- Authenticated users can read (for signed URL resolution)
create policy "authenticated read documents"
  on storage.objects for select
  using (bucket_id = 'documents' and auth.role() = 'authenticated');
