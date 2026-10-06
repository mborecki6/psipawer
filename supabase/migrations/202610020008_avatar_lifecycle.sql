-- Application-owned retirement records. Physical objects are removed through
-- Storage API, never by SQL or a trigger on the provider's storage schema.
-- Retired keys cannot be reused, including while cleanup is being retried.
create table public.avatar_cleanup (
  bucket_id text not null check(bucket_id in ('dog-avatars','community-avatars')),
  object_path text not null check(length(object_path) between 1 and 500),
  guardian_id uuid references public.profiles on delete set null,
  retired_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key(bucket_id,object_path)
);
create index avatar_cleanup_pending_idx on public.avatar_cleanup(next_attempt_at,retired_at)
  where completed_at is null;
alter table public.avatar_cleanup enable row level security;
create policy avatar_cleanup_read on public.avatar_cleanup for select to authenticated
  using((select public.is_admin()) or guardian_id=(select auth.uid()));
revoke all on public.avatar_cleanup from anon,authenticated;
grant select on public.avatar_cleanup to authenticated;

create function public.avatar_key_available(p_bucket text,p_path text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_bucket is null or p_bucket not in ('dog-avatars','community-avatars') or p_path is null then return false; end if;
  -- Volatile SPI reads after the lock see a retirement that committed while
  -- this INSERT waited. The same lock serializes attachment and retirement.
  perform pg_advisory_xact_lock(hashtextextended(p_bucket||'/'||p_path,0));
  return not exists(select 1 from public.avatar_cleanup where bucket_id=p_bucket and object_path=p_path);
end $$;

create function public.avatar_key_deletable(p_bucket text,p_path text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or p_bucket is null or p_bucket not in ('dog-avatars','community-avatars') or p_path is null or
     not(public.is_admin() or split_part(p_path,'/',1)=auth.uid()::text) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_bucket||'/'||p_path,0));
  if p_bucket='dog-avatars' then
    return not exists(select 1 from public.dogs where avatar_path=p_path);
  end if;
  return not exists(select 1 from public.psiutki_profiles where avatar_path=p_path);
end $$;

create function public.check_avatar_reference()
returns trigger language plpgsql security definer set search_path='' as $$
declare b text; dog_id uuid; guardian uuid;
begin
  if new.avatar_path is null then return new; end if;
  if tg_table_name='dogs' then
    b='dog-avatars'; dog_id=new.id; guardian=new.guardian_id;
  else
    b='community-avatars'; dog_id=new.dog_id;
    select guardian_id into guardian from public.dogs where id=dog_id;
  end if;
  if guardian is null or length(new.avatar_path)>500 or split_part(new.avatar_path,'/',1)<>guardian::text or
     split_part(new.avatar_path,'/',2)<>dog_id::text or
     array_length(string_to_array(new.avatar_path,'/'),1)<>3 or
     split_part(new.avatar_path,'/',3)!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$' then
    raise exception 'Wybierz zdjęcie przesłane do profilu tego psa.';
  end if;
  if not public.avatar_key_available(b,new.avatar_path) or
     not exists(select 1 from storage.objects where bucket_id=b and name=new.avatar_path) then
    raise exception 'Zdjęcie nie jest już dostępne. Prześlij nowy plik.';
  end if;
  return new;
end $$;
create trigger dogs_avatar_reference before insert or update of avatar_path on public.dogs
  for each row execute function public.check_avatar_reference();
create trigger community_avatar_reference before insert or update of avatar_path on public.psiutki_profiles
  for each row execute function public.check_avatar_reference();

create function public.retire_changed_avatar()
returns trigger language plpgsql security definer set search_path='' as $$
declare b text; guardian uuid;
begin
  if old.avatar_path is null then return null; end if;
  if tg_op='UPDATE' and old.avatar_path is not distinct from new.avatar_path then return null; end if;
  b=case when tg_table_name='dogs' then 'dog-avatars' else 'community-avatars' end;
  perform pg_advisory_xact_lock(hashtextextended(b||'/'||old.avatar_path,0));
  select id into guardian from public.profiles where id::text=split_part(old.avatar_path,'/',1);
  insert into public.avatar_cleanup(bucket_id,object_path,guardian_id)
    values(b,old.avatar_path,guardian) on conflict do nothing;
  return null;
end $$;
create trigger dogs_avatar_retirement after update of avatar_path or delete on public.dogs
  for each row execute function public.retire_changed_avatar();
create trigger community_avatar_retirement after update of avatar_path or delete on public.psiutki_profiles
  for each row execute function public.retire_changed_avatar();

create function public.set_dog_avatar(p_dog uuid,p_expected_path text,p_path text)
returns void language plpgsql security definer set search_path='' as $$
declare d public.dogs;
begin
  select * into d from public.dogs where id=p_dog for update;
  if auth.uid() is null or d.id is null or not(public.is_admin() or d.guardian_id=auth.uid()) then
    raise exception 'Brak dostępu do psa.';
  end if;
  if d.avatar_path is not distinct from p_path then return; end if;
  if d.avatar_path is distinct from p_expected_path then
    raise exception 'Zdjęcie psa zmieniło się. Odśwież kartę przed kolejną zmianą.';
  end if;
  update public.dogs set avatar_path=p_path where id=p_dog;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'dog_avatar_changed',p_dog,jsonb_build_object('has_photo',p_path is not null));
end $$;

-- Preserve the current public description in the same transaction as the photo.
-- Return this operation's exact version, never a later, separate API read.
create function public.set_community_avatar(p_dog uuid,p_expected_updated_at timestamptz,p_path text)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare p public.psiutki_profiles; result timestamptz;
begin
  perform 1 from public.dogs where id=p_dog and guardian_id=auth.uid() for update;
  if not found then raise exception 'Możesz zgłosić wyłącznie własnego psa.'; end if;
  select * into p from public.psiutki_profiles where dog_id=p_dog for update;
  if p.dog_id is null then raise exception 'Najpierw zapisz wizytówkę psa.'; end if;
  perform public.save_community_profile(p_dog,p_expected_updated_at,
    jsonb_build_object('display_name',p.display_name,'area',p.area,'headline',p.headline,
      'seeking',p.seeking,'traits',p.traits,'likes',p.likes,'dislikes',p.dislikes,'avatar_path',p_path),true);
  select updated_at into result from public.psiutki_profiles where dog_id=p_dog;
  return result;
end $$;

-- A failed/uncertain upload can be retired only if no profile references it.
-- In particular, a lost successful attachment response must not erase the photo.
create function public.retire_avatar_upload(p_bucket text,p_path text)
returns boolean language plpgsql security definer set search_path='' as $$
declare guardian uuid;
begin
  if auth.uid() is null or p_bucket is null or p_bucket not in ('dog-avatars','community-avatars') or p_path is null or length(p_path)>500 or
     array_length(string_to_array(p_path,'/'),1)<>3 or
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

create function public.record_avatar_cleanup(p_bucket text,p_path text,p_failed boolean)
returns void language plpgsql security definer set search_path='' as $$
declare job public.avatar_cleanup;
begin
  select * into job from public.avatar_cleanup where bucket_id=p_bucket and object_path=p_path for update;
  if job.bucket_id is null or job.completed_at is not null then return; end if;
  if p_failed is true then
    update public.avatar_cleanup set attempts=attempts+1,
      next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer)
      where bucket_id=p_bucket and object_path=p_path;
  else
    if exists(select 1 from storage.objects where bucket_id=p_bucket and name=p_path) then
      raise exception 'Usunięcie zdjęcia nie zostało potwierdzone.';
    end if;
    update public.avatar_cleanup set attempts=attempts+1,completed_at=clock_timestamp()
      where bucket_id=p_bucket and object_path=p_path;
  end if;
end $$;
create function public.finish_avatar_cleanup(p_bucket text,p_path text,p_failed boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not(public.is_admin() or exists(select 1 from public.avatar_cleanup
    where bucket_id=p_bucket and object_path=p_path and guardian_id=auth.uid())) then
    raise exception 'Brak dostępu do zdjęcia.';
  end if;
  perform public.record_avatar_cleanup(p_bucket,p_path,p_failed);
end $$;
create function public.worker_avatar_cleanup(p_limit integer default 20)
returns table(bucket_id text,object_path text) language sql security definer set search_path='' as $$
  select c.bucket_id,c.object_path from public.avatar_cleanup c
    where c.completed_at is null and c.next_attempt_at<=clock_timestamp()
    and not exists(select 1 from public.dogs d where c.bucket_id='dog-avatars' and d.avatar_path=c.object_path)
    and not exists(select 1 from public.psiutki_profiles p where c.bucket_id='community-avatars' and p.avatar_path=c.object_path)
    order by c.retired_at,c.bucket_id,c.object_path limit least(greatest(coalesce(p_limit,20),1),50)
$$;
create function public.worker_finish_avatar_cleanup(p_bucket text,p_path text,p_failed boolean default false)
returns void language sql security definer set search_path='' as $$
  select public.record_avatar_cleanup(p_bucket,p_path,p_failed)
$$;

drop policy dog_avatars_create on storage.objects;
create policy dog_avatars_create on storage.objects for insert to authenticated with check(
  bucket_id='dog-avatars' and (public.is_admin() or
    ((storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.dogs d
      where d.id::text=(storage.foldername(storage.objects.name))[2] and d.guardian_id=auth.uid()))) and
  public.avatar_key_available(bucket_id,name));
drop policy community_avatars_create on storage.objects;
create policy community_avatars_create on storage.objects for insert to authenticated with check(
  bucket_id='community-avatars' and (storage.foldername(name))[1]=auth.uid()::text and
  exists(select 1 from public.dogs d where d.id::text=(storage.foldername(storage.objects.name))[2] and d.guardian_id=auth.uid()) and
  not exists(select 1 from public.psiutki_profiles p where p.avatar_path=storage.objects.name) and
  public.avatar_key_available(bucket_id,name));
drop policy dog_avatars_delete on storage.objects;
create policy dog_avatars_delete on storage.objects for delete to authenticated
  using(bucket_id='dog-avatars' and public.avatar_key_deletable(bucket_id,name));
drop policy community_avatars_delete on storage.objects;
create policy community_avatars_delete on storage.objects for delete to authenticated
  using(bucket_id='community-avatars' and public.avatar_key_deletable(bucket_id,name));

revoke all on function public.avatar_key_available(text,text),public.avatar_key_deletable(text,text),
  public.check_avatar_reference(),public.retire_changed_avatar(),public.set_dog_avatar(uuid,text,text),
  public.set_community_avatar(uuid,timestamptz,text),public.retire_avatar_upload(text,text),
  public.record_avatar_cleanup(text,text,boolean),public.finish_avatar_cleanup(text,text,boolean),
  public.worker_avatar_cleanup(integer),public.worker_finish_avatar_cleanup(text,text,boolean) from public,anon,authenticated;
grant execute on function public.avatar_key_available(text,text),public.avatar_key_deletable(text,text),
  public.set_dog_avatar(uuid,text,text),public.set_community_avatar(uuid,timestamptz,text),
  public.retire_avatar_upload(text,text),public.finish_avatar_cleanup(text,text,boolean) to authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.worker_avatar_cleanup(integer),public.worker_finish_avatar_cleanup(text,text,boolean) to service_role;
  end if;
end $$;
