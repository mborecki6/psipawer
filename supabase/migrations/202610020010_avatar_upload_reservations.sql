-- Register application uploads before sending bytes to Storage. A crashed
-- application leaves an expiring reservation that the existing worker retires.
create table public.avatar_uploads (
  bucket_id text not null check(bucket_id in ('dog-avatars','community-avatars')),
  object_path text not null check(length(object_path) between 1 and 500),
  dog_id uuid references public.dogs on delete set null,
  guardian_id uuid references public.profiles on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
  check(expires_at>created_at),
  primary key(bucket_id,object_path)
);
create index avatar_uploads_expiry_idx on public.avatar_uploads(expires_at);
alter table public.avatar_uploads enable row level security;
create policy avatar_uploads_read on public.avatar_uploads for select to authenticated
  using((select public.is_admin()) or guardian_id=(select auth.uid()));
revoke all on public.avatar_uploads from anon,authenticated;
grant select on public.avatar_uploads to authenticated;

create or replace function public.avatar_key_available(p_bucket text,p_path text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_bucket is null or p_bucket not in ('dog-avatars','community-avatars') or p_path is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_bucket||'/'||p_path,0));
  return not exists(select 1 from public.avatar_cleanup where bucket_id=p_bucket and object_path=p_path)
    and not exists(select 1 from public.avatar_uploads where bucket_id=p_bucket and object_path=p_path and expires_at<=clock_timestamp());
end $$;

create function public.reserve_avatar_upload(p_dog uuid,p_bucket text,p_path text)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare d public.dogs; deadline timestamptz;
begin
  if auth.uid() is null or p_bucket is null or p_bucket not in ('dog-avatars','community-avatars') or p_path is null then
    raise exception 'Brak dostępu do zdjęcia.';
  end if;
  select * into d from public.dogs where id=p_dog for key share;
  if d.id is null or not(d.guardian_id=auth.uid() or (p_bucket='dog-avatars' and public.is_admin())) or
    split_part(p_path,'/',1)<>d.guardian_id::text or split_part(p_path,'/',2)<>d.id::text or
    array_length(string_to_array(p_path,'/'),1)<>3 or
    split_part(p_path,'/',3)!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$' then
    raise exception 'Brak dostępu do zdjęcia.';
  end if;
  if not public.avatar_key_available(p_bucket,p_path) then raise exception 'Zdjęcie nie jest już dostępne. Prześlij nowy plik.'; end if;
  select expires_at into deadline from public.avatar_uploads where bucket_id=p_bucket and object_path=p_path;
  if deadline is not null then return deadline; end if;
  if exists(select 1 from storage.objects where bucket_id=p_bucket and name=p_path) then
    raise exception 'Wybierz nowy plik do przesłania.';
  end if;
  insert into public.avatar_uploads(bucket_id,object_path,dog_id,guardian_id)
    values(p_bucket,p_path,d.id,d.guardian_id) returning expires_at into deadline;
  return deadline;
end $$;

create function public.complete_avatar_upload()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.avatar_path is not null then
    delete from public.avatar_uploads where object_path=new.avatar_path
      and bucket_id=case when tg_table_name='dogs' then 'dog-avatars' else 'community-avatars' end;
  end if;
  return null;
end $$;
create trigger dogs_avatar_upload_completed after insert or update of avatar_path on public.dogs
  for each row execute function public.complete_avatar_upload();
create trigger community_avatar_upload_completed after insert or update of avatar_path on public.psiutki_profiles
  for each row execute function public.complete_avatar_upload();

create function public.worker_retire_avatar_uploads(p_limit integer default 20)
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; lease public.avatar_uploads; retired integer:=0;
begin
  for candidate in select u.bucket_id,u.object_path from public.avatar_uploads u
    where u.expires_at<=clock_timestamp() order by u.expires_at,u.bucket_id,u.object_path
    limit least(greatest(coalesce(p_limit,20),1),50)
  loop
    -- Same lock order as attachment: key, then reservation row. Do not select
    -- reservation rows FOR UPDATE before this lock (that could deadlock).
    perform pg_advisory_xact_lock(hashtextextended(candidate.bucket_id||'/'||candidate.object_path,0));
    select * into lease from public.avatar_uploads where bucket_id=candidate.bucket_id and object_path=candidate.object_path for update;
    if lease.bucket_id is null or lease.expires_at>clock_timestamp() then continue; end if;
    if not exists(select 1 from public.dogs where lease.bucket_id='dog-avatars' and avatar_path=lease.object_path)
      and not exists(select 1 from public.psiutki_profiles where lease.bucket_id='community-avatars' and avatar_path=lease.object_path) then
      insert into public.avatar_cleanup(bucket_id,object_path,guardian_id)
        values(lease.bucket_id,lease.object_path,lease.guardian_id) on conflict do nothing;
      retired:=retired+1;
    end if;
    delete from public.avatar_uploads where bucket_id=lease.bucket_id and object_path=lease.object_path;
  end loop;
  return retired;
end $$;

create or replace function public.worker_avatar_cleanup(p_limit integer default 20)
returns table(bucket_id text,object_path text) language plpgsql security definer set search_path='' as $$
begin
  perform public.worker_retire_avatar_uploads(p_limit);
  return query select c.bucket_id,c.object_path from public.avatar_cleanup c
    where c.completed_at is null and c.next_attempt_at<=clock_timestamp()
    and c.object_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,180}$'
    and not exists(select 1 from public.dogs d where c.bucket_id='dog-avatars' and d.avatar_path=c.object_path)
    and not exists(select 1 from public.psiutki_profiles p where c.bucket_id='community-avatars' and p.avatar_path=c.object_path)
    order by c.retired_at,c.bucket_id,c.object_path limit least(greatest(coalesce(p_limit,20),1),50);
end $$;

-- Explicitly abandoning an upload also closes its outstanding reservation.
create function public.close_retired_avatar_upload()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.avatar_uploads where bucket_id=new.bucket_id and object_path=new.object_path;
  return null;
end $$;
create trigger retired_avatar_upload_closed after insert on public.avatar_cleanup
  for each row execute function public.close_retired_avatar_upload();

revoke all on function public.reserve_avatar_upload(uuid,text,text),public.complete_avatar_upload(),
  public.worker_retire_avatar_uploads(integer),public.close_retired_avatar_upload() from public,anon,authenticated;
grant execute on function public.reserve_avatar_upload(uuid,text,text) to authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.worker_retire_avatar_uploads(integer) to service_role;
  end if;
end $$;
