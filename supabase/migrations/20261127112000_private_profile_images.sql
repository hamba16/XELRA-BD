begin;

-- Supabase Storage is part of production; lightweight SQL test databases omit it.
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Supabase Storage is unavailable; profile-image storage setup was skipped.';
    return;
  end if;

  execute $sql$
    insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values ('xelra-profile-images', 'xelra-profile-images', false, 262144, array['image/jpeg'])
    on conflict (id) do update set
      name = excluded.name,
      public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types
  $sql$;

  execute $sql$
    create policy xelra_profile_images_select_own on storage.objects
    for select to authenticated
    using (
      bucket_id = 'xelra-profile-images'
      and name = (select auth.uid())::text || '/avatar.jpg'
    )
  $sql$;

  execute $sql$
    create policy xelra_profile_images_insert_own on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'xelra-profile-images'
      and name = (select auth.uid())::text || '/avatar.jpg'
    )
  $sql$;

  execute $sql$
    create policy xelra_profile_images_update_own on storage.objects
    for update to authenticated
    using (
      bucket_id = 'xelra-profile-images'
      and name = (select auth.uid())::text || '/avatar.jpg'
    )
    with check (
      bucket_id = 'xelra-profile-images'
      and name = (select auth.uid())::text || '/avatar.jpg'
    )
  $sql$;

  execute $sql$
    create policy xelra_profile_images_delete_own on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'xelra-profile-images'
      and name = (select auth.uid())::text || '/avatar.jpg'
    )
  $sql$;
end
$$;

commit;
