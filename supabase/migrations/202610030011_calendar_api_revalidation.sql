-- PostgREST enables safe-update protection. The recalculation deliberately
-- targets every finite source interval with an explicit predicate, retaining
-- the projection lock and deferred atomic validation of the whole calendar.
create or replace function public.save_calendar_settings(p_expected_version integer,p_hours_enabled boolean,
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
  update public.calendar_slots set occupied=base_occupied where base_occupied is not null;
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
