-- STAGED ONLY: CC reviews/applies separately. No production operation in this task.
-- Extend 0212's one private bucket row, not storage.objects policies or grants.
-- Storage has ONE size cap per bucket; PNG's existing 2 MiB cap remains in the
-- service-role uploader, while this row permits MP4/JPEG up to 12 MiB.
do $$
begin
  update storage.buckets
  set public = false,
      file_size_limit = 12582912,
      allowed_mime_types = array['image/png', 'image/jpeg', 'video/mp4']
  where id = 'training-assets';
  if not found then
    raise exception 'training-assets bucket missing: apply 0212 first';
  end if;
end $$;

-- Verify after approved apply:
-- select id, public, file_size_limit, allowed_mime_types
-- from storage.buckets where id = 'training-assets';
-- Expect private, 12582912, PNG/JPEG/MP4. No new storage.objects policy is added.
