-- An authenticated caller must not poison the cleanup batch with a malformed
-- abandoned-upload path. Existing retired legacy keys remain readable for
-- investigation, but are never handed to the physical deletion worker.
create or replace function public.retire_avatar_upload(p_bucket text,p_path text)
returns boolean language plpgsql security definer set search_path='' as $$
declare guardian uuid;
begin
  if auth.uid() is null or p_bucket is null or p_bucket not in ('dog-avatars','community-avatars') or p_path is null or length(p_path)>500 or
     p_path !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,180}$' or
     split_part(p_path,'/',3)!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$' or
     not(public.is_admin() or split_part(p_path,'/',1)=auth.uid()::text) then
    raise exception 'Brak dostępu do zdjęcia.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_bucket||'/'||p_path,0));
  if (p_bucket='dog-avatars' and exists(select 1 from public.dogs where avatar_path=p_path)) or
     (p_bucket='community-avatars' and exists(select 1 from public.psiutki_profiles where avatar_path=p_path)) then
    return false;
  end if;
  select id into guardian from public.profiles where id::text=split_part(p_path,'/',1);
  insert into public.avatar_cleanup(bucket_id,object_path,guardian_id)
    values(p_bucket,p_path,guardian) on conflict do nothing;
  return true;
end $$;

create or replace function public.worker_avatar_cleanup(p_limit integer default 20)
returns table(bucket_id text,object_path text) language sql security definer set search_path='' as $$
  select c.bucket_id,c.object_path from public.avatar_cleanup c
    where c.completed_at is null and c.next_attempt_at<=clock_timestamp()
    and c.object_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,180}$'
    and not exists(select 1 from public.dogs d where c.bucket_id='dog-avatars' and d.avatar_path=c.object_path)
    and not exists(select 1 from public.psiutki_profiles p where c.bucket_id='community-avatars' and p.avatar_path=c.object_path)
    order by c.retired_at,c.bucket_id,c.object_path limit least(greatest(coalesce(p_limit,20),1),50)
$$;
