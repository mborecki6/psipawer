-- One behaviourist's calendar for the single-practice pilot. A PostgreSQL
-- exclusion constraint protects every write path, including concurrent writes.
create table public.calendar_blocks (
  id uuid primary key,
  title text not null check(length(trim(title)) between 3 and 160),
  starts_at timestamptz not null check(isfinite(starts_at)),
  ends_at timestamptz not null check(isfinite(ends_at)),
  version integer not null default 1 check(version>0),
  cancelled_at timestamptz,
  updated_by uuid not null references public.profiles,
  updated_at timestamptz not null default now(),
  check(ends_at>starts_at and ends_at-starts_at<=interval '366 days')
);
alter table public.calendar_blocks enable row level security;
create policy calendar_blocks_staff on public.calendar_blocks for select to authenticated using(public.is_admin());
revoke all on public.calendar_blocks from anon,authenticated;
grant select on public.calendar_blocks to authenticated;

-- Private projection: no participant data or exact location is copied here.
-- Cascading foreign keys also remove slots when local test data is deleted.
create table public.calendar_slots (
  walk_id uuid unique references public.walks on delete cascade,
  consultation_id uuid unique references public.consultations on delete cascade,
  block_id uuid unique references public.calendar_blocks on delete cascade,
  occupied tstzrange not null,
  check(num_nonnulls(walk_id,consultation_id,block_id)=1),
  check(not isempty(occupied) and not lower_inf(occupied) and not upper_inf(occupied)),
  constraint calendar_no_overlap exclude using gist(occupied with &&)
);
alter table public.calendar_slots enable row level security;
revoke all on public.calendar_slots from anon,authenticated;

create function public.sync_calendar_slot() returns trigger language plpgsql security definer set search_path='' as $$
declare slot tstzrange;
begin
  if tg_table_name='walks' then
    if new.status not in ('draft','cancelled','completed') then
      if not isfinite(new.starts_at) then raise exception 'Sprawdź termin spaceru.'; end if;
      slot:=tstzrange(new.starts_at,new.starts_at+make_interval(mins=>new.duration_minutes),'[)');
    end if;
    delete from public.calendar_slots where walk_id=new.id;
    if slot is not null then insert into public.calendar_slots(walk_id,occupied) values(new.id,slot); end if;
  elsif tg_table_name='consultations' then
    if new.status='scheduled' then slot:=tstzrange(new.starts_at,new.starts_at+make_interval(mins=>new.duration_minutes),'[)'); end if;
    delete from public.calendar_slots where consultation_id=new.id;
    if slot is not null then insert into public.calendar_slots(consultation_id,occupied) values(new.id,slot); end if;
  else
    if new.cancelled_at is null then slot:=tstzrange(new.starts_at,new.ends_at,'[)'); end if;
    delete from public.calendar_slots where block_id=new.id;
    if slot is not null then insert into public.calendar_slots(block_id,occupied) values(new.id,slot); end if;
  end if;
  return new;
exception when exclusion_violation then
  raise exception 'Ten czas jest już zajęty przez spacer, konsultację lub blokadę. Sprawdź kalendarz.';
end $$;
revoke all on function public.sync_calendar_slot() from public,anon,authenticated;
create trigger walk_calendar_slot after insert or update of starts_at,duration_minutes,status on public.walks for each row execute function public.sync_calendar_slot();
create trigger consultation_calendar_slot after insert or update of starts_at,duration_minutes,status on public.consultations for each row execute function public.sync_calendar_slot();
create trigger block_calendar_slot after insert or update of starts_at,ends_at,cancelled_at on public.calendar_blocks for each row execute function public.sync_calendar_slot();

-- Do not silently move or drop existing bookings. Conflicting historical data
-- makes this migration fail, so a preflight and explicit correction are required.
insert into public.calendar_slots(walk_id,occupied)
  select id,tstzrange(starts_at,starts_at+make_interval(mins=>duration_minutes),'[)') from public.walks where status not in ('draft','cancelled','completed');
insert into public.calendar_slots(consultation_id,occupied)
  select id,tstzrange(starts_at,starts_at+make_interval(mins=>duration_minutes),'[)') from public.consultations where status='scheduled';

create function public.save_calendar_block(p_id uuid,p_expected_version integer,p_title text,p_starts_at timestamptz,p_ends_at timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
declare b public.calendar_blocks;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647 or
    p_title is null or length(trim(p_title)) not between 3 and 160 or
    p_starts_at is null or not isfinite(p_starts_at) or p_ends_at is null or not isfinite(p_ends_at) or
    p_ends_at<=p_starts_at or p_ends_at-p_starts_at>interval '366 days' then raise exception 'Sprawdź nazwę i zakres blokady.'; end if;
  -- Serializes same-id insert retries without relying on an unchecked existence test.
  perform 1 from public.care_practices where id='00000000-0000-4000-8000-000000000001' for update;
  select * into b from public.calendar_blocks where id=p_id for update;
  if found then
    if b.cancelled_at is not null then raise exception 'Ta blokada została już usunięta.'; end if;
    if b.version=p_expected_version+1 and b.updated_by=auth.uid() and b.title=trim(p_title) and b.starts_at=p_starts_at and b.ends_at=p_ends_at then return b.version; end if;
    if b.version<>p_expected_version then raise exception 'Blokada zmieniła się. Odśwież widok przed zapisem.'; end if;
    if p_ends_at<=now() then raise exception 'Blokada musi obejmować przyszły czas.'; end if;
    update public.calendar_blocks set title=trim(p_title),starts_at=p_starts_at,ends_at=p_ends_at,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into b;
  else
    if p_expected_version<>0 then raise exception 'Nie znaleziono blokady.'; end if;
    if p_ends_at<=now() then raise exception 'Blokada musi obejmować przyszły czas.'; end if;
    insert into public.calendar_blocks(id,title,starts_at,ends_at,updated_by) values(p_id,trim(p_title),p_starts_at,p_ends_at,auth.uid()) returning * into b;
  end if;
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'calendar_block_saved',p_id,jsonb_build_object('version',b.version));
  return b.version;
end $$;
create function public.cancel_calendar_block(p_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare b public.calendar_blocks;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version<1 or p_expected_version>=2147483647 then raise exception 'Sprawdź wersję blokady.'; end if;
  select * into b from public.calendar_blocks where id=p_id for update;
  if not found then raise exception 'Nie znaleziono blokady.'; end if;
  if b.cancelled_at is not null and b.version=p_expected_version+1 and b.updated_by=auth.uid() then return; end if;
  if b.version<>p_expected_version then raise exception 'Blokada zmieniła się. Odśwież widok przed zapisem.'; end if;
  if b.cancelled_at is not null then raise exception 'Ta blokada została już usunięta.'; end if;
  update public.calendar_blocks set cancelled_at=clock_timestamp(),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id;
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'calendar_block_cancelled',p_id);
end $$;
revoke all on function public.save_calendar_block(uuid,integer,text,timestamptz,timestamptz),public.cancel_calendar_block(uuid,integer) from public,anon,authenticated;
grant execute on function public.save_calendar_block(uuid,integer,text,timestamptz,timestamptz),public.cancel_calendar_block(uuid,integer) to authenticated;

-- Exact duration overlap is queried server-side, including appointments crossing
-- midnight. security invoker keeps the underlying table RLS in effect.
create function public.calendar_appointments(p_from timestamptz,p_to timestamptz)
returns table(id uuid,kind text,title text,starts_at timestamptz,ends_at timestamptz,status text,location text,version integer)
language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to-p_from>interval '32 days' then raise exception 'Nieprawidłowy zakres kalendarza.'; end if;
  return query
    select w.id,'walk'::text,w.type,w.starts_at,w.starts_at+make_interval(mins=>w.duration_minutes),w.status::text,w.public_location,null::integer
      from public.walks w
      where w.status not in ('draft','cancelled') and w.starts_at<p_to and w.starts_at+make_interval(mins=>w.duration_minutes)>p_from
        and (public.is_admin() or exists(select 1 from public.walk_registrations r where r.walk_id=w.id and r.status='accepted' and public.owns_dog(r.dog_id)))
    union all
    select c.id,'consultation'::text,coalesce(c.service_name,'Konsultacja')||' · '||d.name,c.starts_at,c.starts_at+make_interval(mins=>c.duration_minutes),c.status,c.location,c.version
      from public.consultations c join public.dogs d on d.id=c.dog_id
      where c.status in ('scheduled','completed') and c.starts_at<p_to and c.starts_at+make_interval(mins=>c.duration_minutes)>p_from
    union all
    select b.id,'block'::text,b.title,b.starts_at,b.ends_at,'blocked'::text,''::text,b.version
      from public.calendar_blocks b where b.cancelled_at is null and b.starts_at<p_to and b.ends_at>p_from
    order by 4,2,1;
end $$;
revoke all on function public.calendar_appointments(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.calendar_appointments(timestamptz,timestamptz) to authenticated;
