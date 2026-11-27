do $$
declare
  bucket record;
  policy_count integer;
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return;
  end if;

  select * into bucket from storage.buckets where id = 'xelra-profile-images';
  if bucket.id is null or bucket.public or bucket.file_size_limit <> 262144
    or bucket.allowed_mime_types <> array['image/jpeg'] then
    raise exception 'Profile image bucket is missing its private size and type restrictions.';
  end if;

  select count(*) into policy_count
  from pg_policy policy
  join pg_class relation on relation.oid = policy.polrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'storage'
    and relation.relname = 'objects'
    and policy.polname in (
      'xelra_profile_images_select_own',
      'xelra_profile_images_insert_own',
      'xelra_profile_images_update_own',
      'xelra_profile_images_delete_own'
    )
    and coalesce(policy.polqual::text, '') || coalesce(policy.polwithcheck::text, '') like '%xelra-profile-images%'
    and coalesce(policy.polqual::text, '') || coalesce(policy.polwithcheck::text, '') like '%auth.uid%';
  if policy_count <> 4 then
    raise exception 'Profile image policies do not enforce a signed-in owner scope.';
  end if;
end
$$;
