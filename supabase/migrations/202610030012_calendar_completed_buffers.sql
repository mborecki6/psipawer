-- A completed meeting still reserves any remaining after-buffer. Cancellation
-- releases planned meetings; completing a course or package cannot erase the
-- actual last meeting's preparation/travel interval. Zero buffers keep the
-- previous projection behaviour. Use fresh reads after a projection lock wait.
create function public.calendar_has_post_buffer(p_starts timestamptz,p_minutes integer) returns boolean
language sql volatile security definer set search_path='' as $$
  select after_minutes>0 and p_starts+make_interval(mins=>p_minutes+after_minutes)>now()
    from public.calendar_settings where practice_id='00000000-0000-4000-8000-000000000001' for share;
$$;
revoke all on function public.calendar_has_post_buffer(timestamptz,integer) from public,anon,authenticated;

create or replace function public.apply_calendar_availability() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.calendar_settings; h public.calendar_weekly_hours;
  a timestamptz; b timestamptz; local_a timestamp; local_b timestamp; day date;
  end_min numeric; changed_offset boolean;
begin
  if tg_op='INSERT' then new.base_occupied:=new.occupied; end if;
  new.occupied:=new.base_occupied;
  -- Blocks are explicit private intervals, including multi-day holidays. They
  -- need neither additional padding nor conformity with working hours.
  if new.block_id is not null then return new; end if;
  select * into strict s from public.calendar_settings
    where practice_id='00000000-0000-4000-8000-000000000001' for share;
  if upper(new.base_occupied)+make_interval(mins=>s.after_minutes)<=now() then return new; end if;
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

create or replace function public.sync_calendar_slot() returns trigger language plpgsql security definer set search_path='' as $$
declare slot tstzrange;
begin
  if tg_table_name='walks' then
    if new.status not in ('draft','cancelled','completed') or (new.status='completed' and public.calendar_has_post_buffer(new.starts_at,new.duration_minutes)) then
      if not isfinite(new.starts_at) then raise exception 'Sprawdź termin spaceru.'; end if;
      slot:=tstzrange(new.starts_at,new.starts_at+make_interval(mins=>new.duration_minutes),'[)');
    end if;
    delete from public.calendar_slots where walk_id=new.id;
    if slot is not null then insert into public.calendar_slots(walk_id,occupied) values(new.id,slot); end if;
  elsif tg_table_name='consultations' then
    if new.status='scheduled' or (new.status='completed' and public.calendar_has_post_buffer(new.starts_at,new.duration_minutes)) then slot:=tstzrange(new.starts_at,new.starts_at+make_interval(mins=>new.duration_minutes),'[)'); end if;
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

create or replace function public.sync_course_calendar(p_course uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  delete from public.calendar_slots where course_session_id in(select id from public.course_sessions where course_id=p_course);
  insert into public.calendar_slots(course_session_id,occupied)
    select s.id,tstzrange(s.starts_at,s.starts_at+make_interval(mins=>s.duration_minutes),'[)')
    from public.course_sessions s join public.courses c on c.id=s.course_id
    where c.id=p_course and ((c.status in ('open','closed') and s.status='scheduled')
      or (s.status='completed' and public.calendar_has_post_buffer(s.starts_at,s.duration_minutes))) order by s.starts_at,s.id;
exception when exclusion_violation then
  raise exception 'Termin kursu nakłada się na inne zajęcia lub blokadę. Sprawdź kalendarz.';
end $$;

create or replace function public.sync_fitness_calendar() returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.calendar_slots where fitness_session_id=new.id;
  if new.status='scheduled' or (new.status='completed' and public.calendar_has_post_buffer(new.starts_at,new.duration_minutes)) then
    insert into public.calendar_slots(fitness_session_id,occupied)
      values(new.id,tstzrange(new.starts_at,new.starts_at+make_interval(mins=>new.duration_minutes),'[)'));
  end if;
  return null;
exception when exclusion_violation then raise exception 'Ten czas jest już zajęty. Sprawdź wspólny kalendarz.';
end $$;
