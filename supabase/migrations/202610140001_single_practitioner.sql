-- One conducting practitioner, independent from the administrators organising
-- appointments. This configuration is deliberately empty until an existing
-- account is selected for this environment. No assignments or accounts move.
alter table public.calendar_settings add column primary_practitioner_id uuid references public.profiles;

-- Stop atomically if the previously separate staff calendars already overlap.
-- A coordinator must resolve that business conflict; migration never does so.
do $$ begin
  if exists(select 1 from public.calendar_slots a join public.calendar_slots b
    on a.ctid<b.ctid and a.occupied && b.occupied) then
    raise exception 'Istnieją nakładające się terminy. Uzgodnij je przed włączeniem jednej prowadzącej.';
  end if;
end $$;
alter table public.calendar_slots drop constraint calendar_no_overlap;
alter table public.calendar_slots add constraint calendar_no_overlap
  exclude using gist(occupied with &&) deferrable initially immediate;
update public.calendar_slots set staff_scope=int4range(null,null,'()') where base_occupied is not null;

create function public.calendar_primary_practitioner() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare lead uuid;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  select s.primary_practitioner_id into lead from public.calendar_settings s
    join public.user_roles r on r.user_id=s.primary_practitioner_id and r.role='admin'
    where s.practice_id='00000000-0000-4000-8000-000000000001';
  return lead;
end $$;
revoke all on function public.calendar_primary_practitioner() from public,anon,authenticated;
grant execute on function public.calendar_primary_practitioner() to authenticated;

create function public.calendar_require_primary() returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare lead uuid;
begin
  select s.primary_practitioner_id into lead from public.calendar_settings s
    join public.user_roles r on r.user_id=s.primary_practitioner_id and r.role='admin'
    where s.practice_id='00000000-0000-4000-8000-000000000001';
  if lead is null then raise exception 'Brak aktywnej prowadzącej w ustawieniach kalendarza.'; end if;
  return lead;
end $$;
revoke all on function public.calendar_require_primary() from public,anon,authenticated;


-- Internal storage preparation also accepts a retained historical profile.
create or replace function public.ensure_calendar_staff(p_staff uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_staff is null then return; end if;
  insert into public.calendar_staff_indices(staff_id) values(p_staff) on conflict do nothing;
  insert into public.calendar_staff_settings(staff_id) values(p_staff) on conflict do nothing;
  insert into public.calendar_staff_weekly_hours select p_staff,weekday,enabled,start_minute,end_minute from public.calendar_weekly_hours on conflict do nothing;
end $$;

create function public.validate_calendar_staff_choice(p_kind text,p_id uuid,p_staff uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.calendar_assignments; lead uuid;
begin
  select * into a from public.calendar_assignments where kind=p_kind and appointment_id=p_id;
  -- Only an unchanged existing choice may retain a former administrator or null.
  if a.appointment_id is not null and a.assigned_staff_id is not distinct from p_staff
    and (p_staff is not null or a.legacy_unassigned or a.version>1 or a.booked_interval is not null) then
    perform public.ensure_calendar_staff(p_staff);
    return;
  end if;
  lead:=public.calendar_require_primary();
  if p_staff is distinct from lead then raise exception 'Wybierz aktywną prowadzącą.'; end if;
  perform public.ensure_calendar_staff(p_staff);
end $$;
revoke all on function public.validate_calendar_staff_choice(text,uuid,uuid) from public,anon,authenticated;


create or replace function public.calendar_effective_settings(p_staff uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s public.calendar_settings; u public.calendar_staff_settings; week jsonb;
begin
  -- Historical assignment metadata never creates a different availability policy.
  select policy.primary_practitioner_id into p_staff from public.calendar_settings policy
    join public.user_roles r on r.user_id=policy.primary_practitioner_id and r.role='admin'
    where policy.practice_id='00000000-0000-4000-8000-000000000001';
  select * into strict s from public.calendar_settings where practice_id='00000000-0000-4000-8000-000000000001' ;
  select * into u from public.calendar_staff_settings where staff_id=p_staff;
  if u.staff_id is not null and not u.use_default then
    select jsonb_agg(jsonb_build_object('weekday',weekday,'enabled',enabled,'start_minute',start_minute,'end_minute',end_minute) order by weekday) into week from public.calendar_staff_weekly_hours where staff_id=p_staff;
    return jsonb_build_object('version',u.version,'use_default',false,'hours_enabled',u.hours_enabled,'before_minutes',u.before_minutes,'after_minutes',u.after_minutes,'week',week);
  end if;
  select jsonb_agg(jsonb_build_object('weekday',weekday,'enabled',enabled,'start_minute',start_minute,'end_minute',end_minute) order by weekday) into week from public.calendar_weekly_hours where practice_id=s.practice_id;
  return jsonb_build_object('version',coalesce(u.version,1),'use_default',true,'hours_enabled',s.hours_enabled,'before_minutes',s.before_minutes,'after_minutes',s.after_minutes,'week',week);
end $$;

create or replace function public.calendar_break_warnings(p_staff uuid,p_range tstzrange,p_kind text,p_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare pref jsonb; warnings jsonb;
begin
  if p_kind='block' or upper(p_range)<=now() then return '[]'::jsonb; end if;
  pref:=public.calendar_effective_settings(p_staff);
  select coalesce(jsonb_agg(jsonb_build_object('neighbor_kind',a.kind,'appointment_id',a.appointment_id,
    'previous_end',case when upper(s.base_occupied)<=lower(p_range) then upper(s.base_occupied) else upper(p_range) end,
    'next_start',case when lower(s.base_occupied)>=upper(p_range) then lower(s.base_occupied) else lower(p_range) end,
    'gap_minutes',floor(extract(epoch from case when upper(s.base_occupied)<=lower(p_range) then lower(p_range)-upper(s.base_occupied) else lower(s.base_occupied)-upper(p_range) end)/60),
    'required_minutes',(pref->>'before_minutes')::integer+(pref->>'after_minutes')::integer) order by lower(s.base_occupied)), '[]'::jsonb)
    into warnings from public.calendar_slots s join public.calendar_assignments a on
      a.appointment_id=coalesce(s.walk_id,s.consultation_id,s.block_id,s.course_session_id,s.fitness_session_id) and a.kind=case when s.walk_id is not null then 'walk' when s.consultation_id is not null then 'consultation' when s.block_id is not null then 'block' when s.course_session_id is not null then 'course' else 'fitness' end
    where a.kind<>'block' and not (a.kind=p_kind and a.appointment_id=p_id)
      and not (s.base_occupied && p_range)
      and s.base_occupied && tstzrange(lower(p_range)-make_interval(mins=>(pref->>'before_minutes')::integer+(pref->>'after_minutes')::integer),
        upper(p_range)+make_interval(mins=>(pref->>'before_minutes')::integer+(pref->>'after_minutes')::integer),'[)');
  return warnings;
end $$;

create or replace function public.apply_calendar_assignment_context(p_kind text,p_id uuid) returns public.calendar_assignments
language plpgsql security definer set search_path='' as $$
declare a public.calendar_assignments; choice jsonb; v integer; lead uuid; room uuid; target jsonb;
begin
  select * into strict a from public.calendar_assignments where kind=p_kind and appointment_id=p_id for update;
  choice:=nullif(current_setting('psi.calendar_assignment',true),'')::jsonb;
  target:=nullif(current_setting('psi.calendar_assignment_target',true),'')::jsonb;
  if target is not null and (target->>'kind'<>p_kind or (target->>'appointment_id')::uuid<>p_id) then return a; end if;
  if choice is null then return a; end if;
  lead:=(choice->>'staff_id')::uuid; room:=(choice->>'resource_id')::uuid;
  v:=coalesce((choice->>'expected_version')::integer,0);
  if a.assigned_staff_id is not distinct from lead and a.resource_id is not distinct from room and (lead is not null or a.legacy_unassigned) then
    if v=a.version or (a.version=v+1 and a.updated_by=auth.uid()) then return a; end if;
  end if;
  if v<>a.version then raise exception 'Przypisanie zmieniło się. Odśwież widok przed zapisem.'; end if;
  perform public.validate_calendar_staff_choice(p_kind,p_id,lead);
  update public.calendar_assignments set assigned_staff_id=lead,resource_id=room,legacy_unassigned=(lead is null),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp(),break_acknowledgement=null where kind=p_kind and appointment_id=p_id returning * into a;
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'calendar_assignment_saved',p_id,jsonb_build_object('kind',p_kind,'version',a.version,'assigned_staff_id',lead,'resource_id',room));
  return a;
end $$;

create or replace function public.capture_calendar_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text; lead uuid; room uuid; choice jsonb;
begin
  k:=case tg_table_name when 'walks' then 'walk' when 'consultations' then 'consultation' when 'calendar_blocks' then 'block' when 'course_sessions' then 'course' else 'fitness' end;
  choice:=nullif(current_setting('psi.calendar_assignment',true),'')::jsonb;
  if choice is not null then lead:=(choice->>'staff_id')::uuid; room:=(choice->>'resource_id')::uuid;
  elsif public.is_admin() then lead:=public.calendar_require_primary();
  else
    -- A client may request work without reserving time, even before configuration.
    select s.primary_practitioner_id into lead from public.calendar_settings s
      join public.user_roles r on r.user_id=s.primary_practitioner_id and r.role='admin'
      where s.practice_id='00000000-0000-4000-8000-000000000001';
  end if;
  if public.is_admin() then
    perform public.validate_calendar_staff_choice(k,new.id,lead);
  end if;
  perform public.ensure_calendar_staff(lead);
  insert into public.calendar_assignments(kind,appointment_id,walk_id,consultation_id,block_id,course_session_id,fitness_session_id,assigned_staff_id,resource_id,legacy_unassigned,created_by,updated_by)
    values(k,new.id,case when k='walk' then new.id end,case when k='consultation' then new.id end,case when k='block' then new.id end,
      case when k='course' then new.id end,case when k='fitness' then new.id end,lead,room,choice is not null and lead is null,auth.uid(),auth.uid());
  return null;
end $$;

create or replace function public.apply_calendar_availability() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.calendar_assignments; pref jsonb; h jsonb; k text; source uuid; r public.calendar_resources; lead uuid;
  local_a timestamp; local_b timestamp; day date; end_min numeric; changed_offset boolean; warnings jsonb; acknowledgement jsonb;
begin
  if tg_op='INSERT' then new.base_occupied:=new.occupied; end if;
  new.occupied:=new.base_occupied;
  source:=coalesce(new.walk_id,new.consultation_id,new.block_id,new.course_session_id,new.fitness_session_id);
  k:=case when new.walk_id is not null then 'walk' when new.consultation_id is not null then 'consultation' when new.block_id is not null then 'block' when new.course_session_id is not null then 'course' else 'fitness' end;
  a:=public.apply_calendar_assignment_context(k,source);
  -- A fresh request created before configuration gets its first practitioner.
  -- Explicitly unassigned history never takes this path.
  if a.assigned_staff_id is null and not a.legacy_unassigned and a.version=1
    and a.booked_interval is null and public.is_admin() then
    lead:=public.calendar_require_primary();
    perform public.ensure_calendar_staff(lead);
    update public.calendar_assignments set assigned_staff_id=lead,updated_by=auth.uid()
      where kind=k and appointment_id=source returning * into a;
  end if;
  -- Retain the historical assignment exactly; all bookings reserve one practice.
  new.assigned_staff_id:=a.assigned_staff_id; new.resource_id:=a.resource_id;
  perform pg_advisory_xact_lock(951441,0);
  new.staff_scope:=int4range(null,null,'()');
  new.resource_scope:=null;
  if a.resource_id is not null then
    select * into strict r from public.calendar_resources where id=a.resource_id for share;
    if r.exclusive then new.resource_scope:=int4range(r.slot_index,r.slot_index+1,'[)'); end if;
  end if;
  if upper(new.base_occupied)<=now() then return new; end if;
  lead:=public.calendar_require_primary();
  if k='block' then return new; end if;
  pref:=public.calendar_effective_settings(lead);
  -- Preferred breaks produce warnings, never expand the hard booked interval.
  -- Only the actual meeting must fit the configured Warsaw working window.
  if (pref->>'hours_enabled')::boolean then
    local_a:=lower(new.base_occupied) at time zone 'Europe/Warsaw'; local_b:=upper(new.base_occupied) at time zone 'Europe/Warsaw'; day:=local_a::date;
    select x into strict h from jsonb_array_elements(pref->'week') x where (x->>'weekday')::integer=extract(isodow from day);
    end_min:=case when local_b::date=day+1 and local_b::time=time '00:00' then 1440 else extract(epoch from local_b::time)/60 end;
    changed_offset:=(local_a-(lower(new.base_occupied) at time zone 'UTC'))<>(local_b-(upper(new.base_occupied) at time zone 'UTC'));
    if not (h->>'enabled')::boolean or ((upper(new.base_occupied)-interval '1 microsecond') at time zone 'Europe/Warsaw')::date<>day
      or extract(epoch from local_a::time)/60<(h->>'start_minute')::integer or end_min>(h->>'end_minute')::integer
      or (changed_offset and ((h->>'start_minute')::integer>120 or (h->>'end_minute')::integer<180)) then
      raise exception 'Termin wykracza poza godziny pracy prowadzącego. Sprawdź ustawienia kalendarza.';
    end if;
  end if;
  -- Policy revalidation and unchanged projection rebuilds don't demand a new
  -- acknowledgement. Native exclusion constraints still protect every write.
  if current_setting('psi.calendar_policy_revalidation',true)='true' then return new; end if;
  if tg_op='UPDATE' and new.base_occupied=old.base_occupied and new.assigned_staff_id is not distinct from old.assigned_staff_id and new.resource_id is not distinct from old.resource_id then return new; end if;
  if a.booked_interval=new.base_occupied and a.booked_staff_id is not distinct from a.assigned_staff_id and a.booked_resource_id is not distinct from a.resource_id then return new; end if;
  warnings:=public.calendar_break_warnings(a.assigned_staff_id,new.base_occupied,k,source);
  acknowledgement:=jsonb_build_object('range',new.base_occupied::text,'staff_id',a.assigned_staff_id,'resource_id',a.resource_id,'warnings',warnings);
  if a.break_acknowledgement=acknowledgement then
    update public.calendar_assignments set booked_interval=new.base_occupied,booked_staff_id=a.assigned_staff_id,booked_resource_id=a.resource_id where kind=k and appointment_id=source;
    return new;
  end if;
  if jsonb_array_length(warnings)>0 and coalesce(current_setting('psi.calendar_confirm_short_break',true),'')<>'true' then
    raise exception using message='Krótka przerwa między spotkaniami. Sprawdź termin i potwierdź zapis mimo krótkiej przerwy.',hint='CALENDAR_SHORT_BREAK',detail=warnings::text;
  end if;
  if jsonb_array_length(warnings)>0 then
    update public.calendar_assignments set break_acknowledgement=acknowledgement where kind=k and appointment_id=source;
    insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'calendar_short_break_confirmed',source,jsonb_build_object('kind',k,'warnings',warnings));
  end if;
  update public.calendar_assignments set booked_interval=new.base_occupied,booked_staff_id=a.assigned_staff_id,booked_resource_id=a.resource_id where kind=k and appointment_id=source;
  return new;
end $$;

create or replace function public.calendar_team_members() returns table(user_id uuid,full_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  return query select p.id,coalesce(nullif(trim(p.full_name),''),'Członek zespołu') from public.profiles p
    where exists(select 1 from public.calendar_settings policy join public.user_roles r on r.user_id=policy.primary_practitioner_id and r.role='admin'
        where policy.primary_practitioner_id=p.id)
      or exists(select 1 from public.calendar_assignments a where a.assigned_staff_id=p.id)
    order by 2,p.id;
end $$;

create or replace function public.calendar_staff_preferences(p_staff_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_staff_id is distinct from public.calendar_require_primary() then raise exception 'Wybierz aktywną prowadzącą.'; end if;
  return public.calendar_effective_settings(p_staff_id);
end $$;

create or replace function public.save_calendar_assignment(p_kind text,p_appointment_id uuid,p_expected_version integer,p_staff_id uuid,p_resource_id uuid,p_confirm_short_break boolean default false) returns integer
language plpgsql security definer set search_path='' as $$
declare a public.calendar_assignments; previous text;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_kind is null or p_kind not in ('walk','consultation','block','course','fitness') or p_appointment_id is null or p_expected_version is null or p_expected_version<1 or p_expected_version>=2147483647 or p_confirm_short_break is null then raise exception 'Sprawdź przypisanie wydarzenia.'; end if;
  lock table public.calendar_slots in share row exclusive mode;
  select * into a from public.calendar_assignments where kind=p_kind and appointment_id=p_appointment_id for update;
  if not found then raise exception 'Nie znaleziono wydarzenia.'; end if;
  if a.version=p_expected_version+1 and a.updated_by=auth.uid() and a.assigned_staff_id is not distinct from p_staff_id and a.resource_id is not distinct from p_resource_id then return a.version; end if;
  if a.version<>p_expected_version then raise exception 'Przypisanie zmieniło się. Odśwież widok przed zapisem.'; end if;
  perform public.validate_calendar_staff_choice(p_kind,p_appointment_id,p_staff_id);
  if p_resource_id is not null and p_resource_id is distinct from a.resource_id and not exists(select 1 from public.calendar_resources where id=p_resource_id and active) then raise exception 'Wybierz aktywne miejsce.'; end if;
  previous:=coalesce(current_setting('psi.calendar_confirm_short_break',true),'');
  perform set_config('psi.calendar_confirm_short_break',p_confirm_short_break::text,true);
  update public.calendar_assignments set assigned_staff_id=p_staff_id,resource_id=p_resource_id,legacy_unassigned=(p_staff_id is null),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
    where kind=p_kind and appointment_id=p_appointment_id returning * into a;
  update public.calendar_slots set occupied=base_occupied where coalesce(walk_id,consultation_id,block_id,course_session_id,fitness_session_id)=p_appointment_id and p_kind=case when walk_id is not null then 'walk' when consultation_id is not null then 'consultation' when block_id is not null then 'block' when course_session_id is not null then 'course' else 'fitness' end;
  perform set_config('psi.calendar_confirm_short_break',previous,true);
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'calendar_assignment_saved',p_appointment_id,jsonb_build_object('kind',p_kind,'version',a.version,'assigned_staff_id',p_staff_id,'resource_id',p_resource_id));
  return a.version;
exception when exclusion_violation then raise exception 'Ten czas jest już zajęty dla wybranego prowadzącego lub sali. Sprawdź kalendarz.';
end $$;

create or replace function public.save_calendar_team_block(p_id uuid,p_expected_version integer,p_title text,p_starts_at timestamptz,p_ends_at timestamptz,p_staff_id uuid,p_resource_id uuid,p_expected_assignment_version integer,p_confirm_short_break boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v integer; b public.calendar_blocks; a public.calendar_assignments; previous text;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  lock table public.calendar_slots in share row exclusive mode;
  if p_confirm_short_break is null or p_expected_assignment_version is null or p_expected_assignment_version<0 or p_expected_assignment_version>=2147483647 then raise exception 'Sprawdź przypisanie blokady.'; end if;
  if p_resource_id is not null and not exists(select 1 from public.calendar_resources where id=p_resource_id and active) and not exists(select 1 from public.calendar_assignments where kind='block' and appointment_id=p_id and resource_id=p_resource_id) then raise exception 'Wybierz aktywne miejsce.'; end if;
  select * into b from public.calendar_blocks where id=p_id for update;
  select * into a from public.calendar_assignments where kind='block' and appointment_id=p_id for update;
  if b.cancelled_at is not null then raise exception 'Ta blokada została już usunięta.'; end if;
  if b.id is not null and b.version=p_expected_version+1 and b.updated_by=auth.uid() and b.title=trim(p_title) and b.starts_at=p_starts_at and b.ends_at=p_ends_at
    and a.assigned_staff_id is not distinct from p_staff_id and a.resource_id is not distinct from p_resource_id and a.version=p_expected_assignment_version+1 then return jsonb_build_object('version',b.version,'assignment_version',a.version); end if;
  if b.id is not null and b.version<>p_expected_version then raise exception 'Blokada zmieniła się. Odśwież widok przed zapisem.'; end if;
  if a.appointment_id is not null and a.version<>p_expected_assignment_version then raise exception 'Przypisanie zmieniło się. Odśwież widok przed zapisem.'; end if;
  if a.appointment_id is null and p_expected_assignment_version<>0 then raise exception 'Nie znaleziono przypisania blokady.'; end if;
  perform public.validate_calendar_staff_choice('block',p_id,p_staff_id);
  previous:=coalesce(current_setting('psi.calendar_assignment',true),'');
  perform set_config('psi.calendar_assignment',jsonb_build_object('staff_id',p_staff_id,'resource_id',p_resource_id,'expected_version',a.version)::text,true);
  if a.appointment_id is not null then
    if a.assigned_staff_id is distinct from p_staff_id or a.resource_id is distinct from p_resource_id then
      insert into public.audit_events(actor_id,event,entity_id,details)
        values(auth.uid(),'calendar_assignment_saved',p_id,jsonb_build_object('kind','block','version',a.version+1,
          'assigned_staff_id',p_staff_id,'resource_id',p_resource_id));
    end if;
    update public.calendar_assignments set assigned_staff_id=p_staff_id,resource_id=p_resource_id,legacy_unassigned=(p_staff_id is null),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where kind='block' and appointment_id=p_id;
  end if;
  v:=public.save_calendar_block(p_id,p_expected_version,p_title,p_starts_at,p_ends_at);
  perform set_config('psi.calendar_assignment',previous,true);
  select * into strict a from public.calendar_assignments where kind='block' and appointment_id=p_id;
  return jsonb_build_object('version',v,'assignment_version',a.version);
end $$;

create or replace function public.save_calendar_staff_settings(p_staff_id uuid,p_expected_version integer,p_use_default boolean,p_hours_enabled boolean,p_before_minutes integer,p_after_minutes integer,p_week jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.calendar_staff_settings; existing jsonb;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_staff_id is null or p_expected_version is null or p_expected_version<1 or p_expected_version>=2147483647 or p_use_default is null or p_hours_enabled is null or p_before_minutes is null or p_before_minutes not between 0 and 120 or p_after_minutes is null or p_after_minutes not between 0 and 120 or p_week is null or jsonb_typeof(p_week)<>'array' then raise exception 'Sprawdź godziny pracy i długość przerw.'; end if;
  if jsonb_array_length(p_week)<>7 or exists(select 1 from jsonb_array_elements(p_week) x where not coalesce(jsonb_typeof(x)='object' and jsonb_typeof(x->'weekday')='number' and (x->>'weekday')~'^[1-7]$' and jsonb_typeof(x->'enabled')='boolean' and jsonb_typeof(x->'start_minute')='number' and (x->>'start_minute')~'^(0|[1-9][0-9]{0,3})$' and jsonb_typeof(x->'end_minute')='number' and (x->>'end_minute')~'^[1-9][0-9]{0,3}$',false)) then raise exception 'Sprawdź godziny pracy i długość przerw.'; end if;
  if (select count(distinct x->>'weekday') from jsonb_array_elements(p_week) x)<>7 or exists(select 1 from jsonb_to_recordset(p_week) x(weekday integer,enabled boolean,start_minute integer,end_minute integer) where start_minute not between 0 and 1425 or start_minute%15<>0 or end_minute not between 15 and 1440 or end_minute%15<>0 or end_minute<=start_minute) or (not p_use_default and p_hours_enabled and not exists(select 1 from jsonb_to_recordset(p_week) x(enabled boolean) where enabled)) then raise exception 'Sprawdź godziny pracy i długość przerw.'; end if;
  lock table public.calendar_slots in share row exclusive mode;
  if p_staff_id is distinct from public.calendar_require_primary() then raise exception 'Wybierz aktywną prowadzącą.'; end if;
  perform public.ensure_calendar_staff(p_staff_id);
  select * into strict s from public.calendar_staff_settings where staff_id=p_staff_id for update;
  select jsonb_agg(jsonb_build_object('weekday',weekday,'enabled',enabled,'start_minute',start_minute,'end_minute',end_minute) order by weekday) into existing from public.calendar_staff_weekly_hours where staff_id=p_staff_id;
  if s.version=p_expected_version+1 and s.updated_by=auth.uid() and s.use_default=p_use_default and s.hours_enabled=p_hours_enabled and s.before_minutes=p_before_minutes and s.after_minutes=p_after_minutes and existing=(select jsonb_agg(x order by (x->>'weekday')::integer) from jsonb_array_elements(p_week) x) then return s.version; end if;
  if s.version<>p_expected_version then raise exception 'Ustawienia prowadzącego zmieniły się. Odśwież widok przed zapisem.'; end if;
  update public.calendar_staff_settings set use_default=p_use_default,hours_enabled=p_hours_enabled,before_minutes=p_before_minutes,after_minutes=p_after_minutes,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where staff_id=p_staff_id returning * into s;
  update public.calendar_staff_weekly_hours h set enabled=x.enabled,start_minute=x.start_minute,end_minute=x.end_minute from jsonb_to_recordset(p_week) x(weekday integer,enabled boolean,start_minute integer,end_minute integer) where h.staff_id=p_staff_id and h.weekday=x.weekday;
  perform set_config('psi.calendar_policy_revalidation','true',true);
  update public.calendar_slots set occupied=base_occupied where base_occupied is not null;
  perform set_config('psi.calendar_policy_revalidation','false',true);
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'calendar_staff_settings_saved',p_staff_id,jsonb_build_object('version',s.version,'use_default',p_use_default));
  return s.version;
end $$;

create or replace function public.calendar_write(p_operation text,p_arguments jsonb,p_confirm_short_break boolean default false,p_assignment jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; previous_confirm text; previous_assignment text; previous_target text; target jsonb; lead uuid; room uuid; source_id uuid;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  perform public.calendar_begin_write();
  if p_operation is null or p_operation not in ('create_walk','update_walk','change_consultation','create_course','change_course','reschedule_course_session','save_fitness_session') or p_arguments is null or jsonb_typeof(p_arguments)<>'object' or p_confirm_short_break is null then raise exception 'Nieprawidłowa operacja kalendarza.'; end if;
  if p_assignment is not null then
    if jsonb_typeof(p_assignment)<>'object' or not(p_assignment ? 'staff_id' and p_assignment ? 'resource_id') or exists(select 1 from jsonb_object_keys(p_assignment) k where k not in ('staff_id','resource_id','expected_version'))
      or not coalesce(jsonb_typeof(p_assignment->'staff_id') in ('string','null') and jsonb_typeof(p_assignment->'resource_id') in ('string','null'),false)
      or (p_assignment ? 'expected_version' and not coalesce(jsonb_typeof(p_assignment->'expected_version')='number' and (p_assignment->>'expected_version')~'^(0|[1-9][0-9]{0,9})$' and (p_assignment->>'expected_version')::bigint<2147483647,false)) then raise exception 'Sprawdź przypisanie wydarzenia.'; end if;
    lead:=(p_assignment->>'staff_id')::uuid; room:=(p_assignment->>'resource_id')::uuid;
    -- Capture/context triggers validate the choice inside the domain write.
    -- Keeping this wrapper an invoker prevents a new privileged dispatch API.
    if room is not null and not exists(select 1 from public.calendar_resources where id=room and active)
      and not (p_operation in ('update_walk','change_consultation','reschedule_course_session','save_fitness_session') and exists(select 1 from public.calendar_assignments where
        kind=case p_operation when 'update_walk' then 'walk' when 'change_consultation' then 'consultation' when 'reschedule_course_session' then 'course' else 'fitness' end
        and appointment_id=coalesce((p_arguments->>'p_id')::uuid,(p_arguments->>'p_walk')::uuid) and resource_id=room)) then raise exception 'Wybierz aktywne miejsce.'; end if;
    if p_operation='change_course' then raise exception 'Przypisanie spotkań kursu zmienisz osobno w kalendarzu.'; end if;
  end if;
  previous_target:=coalesce(current_setting('psi.calendar_assignment_target',true),'');
  if p_operation in ('update_walk','change_consultation','reschedule_course_session','save_fitness_session') then
    target:=jsonb_build_object('kind',case p_operation when 'update_walk' then 'walk' when 'change_consultation' then 'consultation' when 'reschedule_course_session' then 'course' else 'fitness' end,
      'appointment_id',coalesce((p_arguments->>'p_id')::uuid,(p_arguments->>'p_walk')::uuid));
  end if;
  perform set_config('psi.calendar_assignment_target',coalesce(target::text,''),true);
  previous_confirm:=coalesce(current_setting('psi.calendar_confirm_short_break',true),'');
  previous_assignment:=coalesce(current_setting('psi.calendar_assignment',true),'');
  perform set_config('psi.calendar_confirm_short_break',p_confirm_short_break::text,true);
  perform set_config('psi.calendar_assignment',coalesce(p_assignment::text,''),true);
  case p_operation
    when 'create_walk' then result:=to_jsonb(public.create_walk(p_arguments->'payload'));
    when 'update_walk' then result:=to_jsonb(public.update_walk((p_arguments->>'p_walk')::uuid,(p_arguments->>'p_expected_updated_at')::timestamptz,p_arguments->'payload',p_arguments->>'p_note'));
    when 'change_consultation' then result:=to_jsonb(public.change_consultation((p_arguments->>'p_id')::uuid,(p_arguments->>'p_expected_version')::integer,p_arguments->>'p_action',(p_arguments->>'p_starts_at')::timestamptz,(p_arguments->>'p_duration')::integer,p_arguments->>'p_mode',p_arguments->>'p_location',p_arguments->>'p_note'));
    when 'create_course' then result:=to_jsonb(public.create_course((p_arguments->>'p_id')::uuid,(p_arguments->>'p_service')::uuid,(p_arguments->>'p_expected_service_version')::integer,p_arguments->>'p_title',(p_arguments->>'p_capacity')::integer,p_arguments->>'p_public_location',p_arguments->>'p_exact_location',p_arguments->'p_starts'));
    when 'change_course' then result:=to_jsonb(public.change_course((p_arguments->>'p_id')::uuid,(p_arguments->>'p_expected_version')::integer,p_arguments->>'p_action',p_arguments->>'p_note'));
    when 'reschedule_course_session' then result:=to_jsonb(public.reschedule_course_session((p_arguments->>'p_id')::uuid,(p_arguments->>'p_expected_version')::integer,(p_arguments->>'p_starts_at')::timestamptz,p_arguments->>'p_note',p_arguments->>'p_public_location',p_arguments->>'p_exact_location'));
    when 'save_fitness_session' then result:=to_jsonb(public.save_fitness_session((p_arguments->>'p_id')::uuid,(p_arguments->>'p_expected_version')::integer,(p_arguments->>'p_starts_at')::timestamptz,p_arguments->>'p_location',p_arguments->>'p_note',(p_arguments->>'p_request_id')::uuid));
  end case;
  if p_assignment is not null and p_operation='create_walk' then
    perform public.calendar_validate_write_assignment('walk',(result#>>'{}')::uuid);
  elsif p_assignment is not null and p_operation='create_course' then
    for source_id in select id from public.course_sessions where course_id=(result#>>'{}')::uuid loop
      perform public.calendar_validate_write_assignment('course',source_id);
    end loop;
  end if;
  if p_assignment is not null and p_operation in ('update_walk','change_consultation','reschedule_course_session','save_fitness_session') then
    perform public.calendar_validate_write_assignment(case p_operation when 'update_walk' then 'walk' when 'change_consultation' then 'consultation' when 'reschedule_course_session' then 'course' else 'fitness' end,
      coalesce((p_arguments->>'p_id')::uuid,(p_arguments->>'p_walk')::uuid));
  end if;
  perform set_config('psi.calendar_confirm_short_break',previous_confirm,true);
  perform set_config('psi.calendar_assignment',previous_assignment,true);
  perform set_config('psi.calendar_assignment_target',previous_target,true);
  return result;
end $$;

-- Preserve unchanged sibling projections. An administrative cancellation must
-- work without primary, while every new or moved interval still reaches the
-- same fail-closed availability trigger.
create or replace function public.sync_course_calendar(p_course uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target jsonb;
begin
  target:=nullif(current_setting('psi.calendar_assignment_target',true),'')::jsonb;
  if target->>'kind'='course' and exists(select 1 from public.course_sessions where id=(target->>'appointment_id')::uuid and course_id=p_course) then
    perform public.apply_calendar_assignment_context('course',(target->>'appointment_id')::uuid);
  end if;
  perform pg_advisory_xact_lock(951441,0);
  delete from public.calendar_slots slot using public.course_sessions session,public.courses course
    where slot.course_session_id=session.id and session.course_id=course.id and course.id=p_course
      and not ((course.status in ('open','closed') and session.status='scheduled')
        or (session.status='completed' and public.calendar_has_post_buffer(session.starts_at,session.duration_minutes)));
  update public.calendar_slots slot set base_occupied=tstzrange(session.starts_at,session.starts_at+make_interval(mins=>session.duration_minutes),'[)'),
    occupied=tstzrange(session.starts_at,session.starts_at+make_interval(mins=>session.duration_minutes),'[)')
    from public.course_sessions session join public.courses course on course.id=session.course_id
      join public.calendar_assignments assignment on assignment.course_session_id=session.id
    where slot.course_session_id=session.id and course.id=p_course
      and ((course.status in ('open','closed') and session.status='scheduled')
        or (session.status='completed' and public.calendar_has_post_buffer(session.starts_at,session.duration_minutes)))
      and (slot.base_occupied is distinct from tstzrange(session.starts_at,session.starts_at+make_interval(mins=>session.duration_minutes),'[)')
        or slot.assigned_staff_id is distinct from assignment.assigned_staff_id or slot.resource_id is distinct from assignment.resource_id);
  insert into public.calendar_slots(course_session_id,occupied)
    select session.id,tstzrange(session.starts_at,session.starts_at+make_interval(mins=>session.duration_minutes),'[)')
    from public.course_sessions session join public.courses course on course.id=session.course_id
    where course.id=p_course and ((course.status in ('open','closed') and session.status='scheduled')
      or (session.status='completed' and public.calendar_has_post_buffer(session.starts_at,session.duration_minutes)))
      and not exists(select 1 from public.calendar_slots slot where slot.course_session_id=session.id)
    order by session.starts_at,session.id;
exception when exclusion_violation then raise exception 'Termin kursu nakłada się na inne zajęcia lub blokadę. Sprawdź kalendarz.';
end $$;
