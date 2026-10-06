-- Explicit, optional working hours and preparation/travel buffers for the
-- single-practice pilot. Existing bookings remain unchanged by default.
create table public.calendar_settings (
  practice_id uuid primary key references public.care_practices,
  version integer not null default 1 check(version>0),
  hours_enabled boolean not null default false,
  before_minutes integer not null default 0 check(before_minutes between 0 and 120),
  after_minutes integer not null default 0 check(after_minutes between 0 and 120),
  updated_by uuid references public.profiles,
  updated_at timestamptz not null default now()
);
insert into public.calendar_settings(practice_id) values('00000000-0000-4000-8000-000000000001');
create table public.calendar_weekly_hours (
  practice_id uuid not null references public.calendar_settings,
  weekday integer not null check(weekday between 1 and 7),
  enabled boolean not null,
  start_minute integer not null check(start_minute between 0 and 1425 and start_minute%15=0),
  end_minute integer not null check(end_minute between 15 and 1440 and end_minute%15=0),
  primary key(practice_id,weekday),
  check(end_minute>start_minute)
);
insert into public.calendar_weekly_hours select practice_id,n,n<=5,540,1020
  from public.calendar_settings cross join generate_series(1,7) n;
alter table public.calendar_settings enable row level security;
alter table public.calendar_weekly_hours enable row level security;
create policy calendar_settings_staff on public.calendar_settings for select to authenticated using(public.is_admin());
create policy calendar_hours_staff on public.calendar_weekly_hours for select to authenticated using(public.is_admin());
revoke all on public.calendar_settings,public.calendar_weekly_hours from anon,authenticated;
grant select on public.calendar_settings,public.calendar_weekly_hours to authenticated;

-- Preserve the source interval separately from the reserved interval. Changing
-- buffers must never shift a meeting or cumulatively apply an earlier buffer.
alter table public.calendar_slots add column base_occupied tstzrange;
update public.calendar_slots set base_occupied=occupied;
alter table public.calendar_slots alter column base_occupied set not null;
alter table public.calendar_slots add constraint calendar_base_finite check(
  not isempty(base_occupied) and isfinite(lower(base_occupied)) and isfinite(upper(base_occupied)));
-- A settings change recalculates every interval atomically. Defer only inside
-- that RPC to avoid conflicts with intermediate, earlier buffer values.
alter table public.calendar_slots drop constraint calendar_no_overlap;
alter table public.calendar_slots add constraint calendar_no_overlap
  exclude using gist(occupied with &&) deferrable initially immediate;

create function public.apply_calendar_availability() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.calendar_settings; h public.calendar_weekly_hours;
  a timestamptz; b timestamptz; local_a timestamp; local_b timestamp; day date;
  end_min numeric; changed_offset boolean;
begin
  if tg_op='INSERT' then new.base_occupied:=new.occupied; end if;
  new.occupied:=new.base_occupied;
  -- Blocks are explicit private intervals, including multi-day holidays. They
  -- need neither additional padding nor conformity with working hours.
  if new.block_id is not null or upper(new.base_occupied)<=now() then return new; end if;
  select * into strict s from public.calendar_settings
    where practice_id='00000000-0000-4000-8000-000000000001' for share;
  a:=lower(new.base_occupied)-make_interval(mins=>s.before_minutes);
  b:=upper(new.base_occupied)+make_interval(mins=>s.after_minutes);
  new.occupied:=tstzrange(a,b,'[)');
  if not s.hours_enabled then return new; end if;
  local_a:=a at time zone 'Europe/Warsaw'; local_b:=b at time zone 'Europe/Warsaw'; day:=local_a::date;
  select * into strict h from public.calendar_weekly_hours where practice_id=s.practice_id and weekday=extract(isodow from day);
  end_min:=case when local_b::date=day+1 and local_b::time=time '00:00' then 1440
    else extract(epoch from local_b::time)/60 end;
  changed_offset:=(local_a-(a at time zone 'UTC'))<>(local_b-(b at time zone 'UTC'));
  -- A single window per civil day; an exact midnight end belongs to the day
  -- being closed. On Warsaw's clock-change days a meeting traversing the
  -- repeated hour must fit the whole 02:00–03:00 interval, not only endpoints.
  if not h.enabled or ((b-interval '1 microsecond') at time zone 'Europe/Warsaw')::date<>day
    or extract(epoch from local_a::time)/60<h.start_minute or end_min>h.end_minute
    or (changed_offset and (h.start_minute>120 or h.end_minute<180)) then
    raise exception 'Termin wraz z przerwami wykracza poza godziny pracy. Sprawdź ustawienia kalendarza.';
  end if;
  return new;
end $$;
revoke all on function public.apply_calendar_availability() from public,anon,authenticated;
create trigger calendar_availability before insert or update of occupied on public.calendar_slots
  for each row execute function public.apply_calendar_availability();

create function public.save_calendar_settings(p_expected_version integer,p_hours_enabled boolean,
  p_before_minutes integer,p_after_minutes integer,p_week jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.calendar_settings; existing jsonb;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version<1 or p_expected_version>=2147483647 or p_hours_enabled is null
    or p_before_minutes is null or p_before_minutes not between 0 and 120
    or p_after_minutes is null or p_after_minutes not between 0 and 120 then
    raise exception 'Sprawdź godziny pracy i długość przerw.';
  end if;
  if p_week is null or jsonb_typeof(p_week)<>'array' then raise exception 'Sprawdź godziny pracy i długość przerw.'; end if;
  if jsonb_array_length(p_week)<>7 then raise exception 'Sprawdź godziny pracy i długość przerw.'; end if;
  if exists(select 1 from jsonb_array_elements(p_week) x where not coalesce(
    jsonb_typeof(x)='object' and jsonb_typeof(x->'weekday')='number' and (x->>'weekday')~'^[1-7]$'
    and jsonb_typeof(x->'enabled')='boolean' and jsonb_typeof(x->'start_minute')='number'
    and (x->>'start_minute')~'^(0|[1-9][0-9]{0,3})$' and jsonb_typeof(x->'end_minute')='number'
    and (x->>'end_minute')~'^[1-9][0-9]{0,3}$',false)) then
    raise exception 'Sprawdź godziny pracy i długość przerw.';
  end if;
  if (select count(distinct x->>'weekday') from jsonb_array_elements(p_week) x)<>7
    or exists(select 1 from jsonb_to_recordset(p_week) x(weekday integer,enabled boolean,start_minute integer,end_minute integer)
      where start_minute not between 0 and 1425 or start_minute%15<>0 or end_minute not between 15 and 1440
        or end_minute%15<>0 or end_minute<=start_minute)
    or (p_hours_enabled and not exists(select 1 from jsonb_to_recordset(p_week) x(enabled boolean) where enabled)) then
    raise exception 'Sprawdź godziny pracy i długość przerw.';
  end if;
  -- Take the projection table lock BEFORE the settings row. Source writes
  -- already hold its RowExclusive lock; they can finish without a lock cycle.
  -- Once held, no insertion, deletion or reschedule can evade revalidation.
  lock table public.calendar_slots in share row exclusive mode;
  select * into strict s from public.calendar_settings
    where practice_id='00000000-0000-4000-8000-000000000001' for update;
  select jsonb_agg(jsonb_build_object('weekday',weekday,'enabled',enabled,'start_minute',start_minute,'end_minute',end_minute) order by weekday)
    into existing from public.calendar_weekly_hours where practice_id=s.practice_id;
  if s.version=p_expected_version+1 and s.updated_by=auth.uid() and s.hours_enabled=p_hours_enabled
    and s.before_minutes=p_before_minutes and s.after_minutes=p_after_minutes
    and existing=(select jsonb_agg(x order by (x->>'weekday')::integer) from jsonb_array_elements(p_week) x) then return s.version; end if;
  if s.version<>p_expected_version then raise exception 'Ustawienia kalendarza zmieniły się. Odśwież widok przed zapisem.'; end if;
  update public.calendar_settings set hours_enabled=p_hours_enabled,before_minutes=p_before_minutes,after_minutes=p_after_minutes,
    version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where practice_id=s.practice_id returning * into s;
  update public.calendar_weekly_hours h set enabled=x.enabled,start_minute=x.start_minute,end_minute=x.end_minute
    from jsonb_to_recordset(p_week) x(weekday integer,enabled boolean,start_minute integer,end_minute integer)
    where h.practice_id=s.practice_id and h.weekday=x.weekday;
  set constraints public.calendar_no_overlap deferred;
  update public.calendar_slots set occupied=base_occupied;
  set constraints public.calendar_no_overlap immediate;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'calendar_settings_saved',s.practice_id,jsonb_build_object('version',s.version,'hours_enabled',s.hours_enabled,
      'before_minutes',s.before_minutes,'after_minutes',s.after_minutes));
  return s.version;
exception when exclusion_violation then
  raise exception 'Nowe przerwy powodują kolizję istniejących terminów. Najpierw przełóż spotkania lub zmniejsz przerwy.';
end $$;
revoke all on function public.save_calendar_settings(integer,boolean,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_calendar_settings(integer,boolean,integer,integer,jsonb) to authenticated;
