-- Pending local-only team calendar. Assignments and resources are private
-- scheduling metadata; domain records, quotes, care content and audit history
-- retain their existing APIs. Legacy creator/last editor is never inferred to
-- be the person delivering an appointment.
create table public.calendar_staff_indices (
  staff_id uuid primary key references public.profiles on delete cascade,
  slot_index integer generated always as identity unique check(slot_index<2147483647)
);
create table public.calendar_resources (
  id uuid primary key,
  slot_index integer generated always as identity unique check(slot_index<2147483647),
  name text not null check(length(trim(name)) between 3 and 160),
  exclusive boolean not null default true,
  active boolean not null default true,
  version integer not null default 1 check(version>0),
  created_by uuid not null references public.profiles,
  updated_by uuid not null references public.profiles,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.calendar_assignments (
  kind text not null check(kind in ('walk','consultation','block','course','fitness')),
  appointment_id uuid not null,
  walk_id uuid unique references public.walks on delete cascade,
  consultation_id uuid unique references public.consultations on delete cascade,
  block_id uuid unique references public.calendar_blocks on delete cascade,
  course_session_id uuid unique references public.course_sessions on delete cascade,
  fitness_session_id uuid unique references public.fitness_sessions on delete cascade,
  assigned_staff_id uuid references public.profiles,
  resource_id uuid references public.calendar_resources,
  version integer not null default 1 check(version>0),
  legacy_unassigned boolean not null default false,
  created_by uuid references public.profiles,
  updated_by uuid references public.profiles,
  updated_at timestamptz not null default clock_timestamp(),
  booked_interval tstzrange,
  booked_staff_id uuid references public.profiles,
  booked_resource_id uuid references public.calendar_resources,
  break_acknowledgement jsonb,
  primary key(kind,appointment_id),
  check(num_nonnulls(walk_id,consultation_id,block_id,course_session_id,fitness_session_id)=1),
  check(case kind when 'walk' then walk_id when 'consultation' then consultation_id
    when 'block' then block_id when 'course' then course_session_id when 'fitness' then fitness_session_id end is not distinct from appointment_id)
);
create table public.calendar_staff_settings (
  staff_id uuid primary key references public.profiles on delete cascade,
  version integer not null default 1 check(version>0),
  use_default boolean not null default true,
  hours_enabled boolean not null default false,
  before_minutes integer not null default 0 check(before_minutes between 0 and 120),
  after_minutes integer not null default 0 check(after_minutes between 0 and 120),
  updated_by uuid references public.profiles,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.calendar_staff_weekly_hours (
  staff_id uuid not null references public.calendar_staff_settings on delete cascade,
  weekday integer not null check(weekday between 1 and 7),
  enabled boolean not null,
  start_minute integer not null check(start_minute between 0 and 1425 and start_minute%15=0),
  end_minute integer not null check(end_minute between 15 and 1440 and end_minute%15=0),
  primary key(staff_id,weekday), check(end_minute>start_minute)
);
alter table public.calendar_staff_indices enable row level security;
alter table public.calendar_resources enable row level security;
alter table public.calendar_assignments enable row level security;
alter table public.calendar_staff_settings enable row level security;
alter table public.calendar_staff_weekly_hours enable row level security;
create policy calendar_resources_staff on public.calendar_resources for select to authenticated using(public.is_admin());
create policy calendar_assignments_staff on public.calendar_assignments for select to authenticated using(public.is_admin());
create policy calendar_staff_settings_read on public.calendar_staff_settings for select to authenticated using(public.is_admin());
create policy calendar_staff_hours_read on public.calendar_staff_weekly_hours for select to authenticated using(public.is_admin());
revoke all on public.calendar_staff_indices,public.calendar_resources,public.calendar_assignments,public.calendar_staff_settings,public.calendar_staff_weekly_hours from anon,authenticated;
grant select on public.calendar_resources,public.calendar_assignments,public.calendar_staff_settings,public.calendar_staff_weekly_hours to authenticated;

-- Every old source is explicitly marked, including inactive/draft sources.
-- Trust a real creation field/creation audit only, never the last editor.
insert into public.calendar_assignments(kind,appointment_id,walk_id,legacy_unassigned,created_by)
  select 'walk',w.id,w.id,true,(select a.actor_id from public.audit_events a where a.entity_id=w.id and a.event='walk_created' order by a.created_at,a.id limit 1) from public.walks w;
insert into public.calendar_assignments(kind,appointment_id,consultation_id,legacy_unassigned,created_by)
  select 'consultation',id,id,true,requested_by from public.consultations;
insert into public.calendar_assignments(kind,appointment_id,block_id,legacy_unassigned,created_by)
  select 'block',b.id,b.id,true,(select a.actor_id from public.audit_events a where a.entity_id=b.id and a.event='calendar_block_saved' order by a.created_at,a.id limit 1) from public.calendar_blocks b;
insert into public.calendar_assignments(kind,appointment_id,course_session_id,legacy_unassigned,created_by)
  select 'course',s.id,s.id,true,c.created_by from public.course_sessions s join public.courses c on c.id=s.course_id;
insert into public.calendar_assignments(kind,appointment_id,fitness_session_id,legacy_unassigned)
  select 'fitness',id,id,true from public.fitness_sessions;
insert into public.calendar_staff_indices(staff_id) select user_id from public.user_roles where role='admin';
insert into public.calendar_staff_settings(staff_id) select user_id from public.user_roles where role='admin';
insert into public.calendar_staff_weekly_hours select s.staff_id,h.weekday,h.enabled,h.start_minute,h.end_minute
  from public.calendar_staff_settings s cross join public.calendar_weekly_hours h;

create function public.ensure_calendar_staff(p_staff uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_staff is null then return; end if;
  if not exists(select 1 from public.user_roles where user_id=p_staff and role='admin') then raise exception 'Wybierz aktywnego członka zespołu.'; end if;
  insert into public.calendar_staff_indices(staff_id) values(p_staff) on conflict do nothing;
  insert into public.calendar_staff_settings(staff_id) values(p_staff) on conflict do nothing;
  insert into public.calendar_staff_weekly_hours select p_staff,weekday,enabled,start_minute,end_minute from public.calendar_weekly_hours on conflict do nothing;
end $$;
revoke all on function public.ensure_calendar_staff(uuid) from public,anon,authenticated;

create function public.capture_calendar_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text; lead uuid;
begin
  k:=case tg_table_name when 'walks' then 'walk' when 'consultations' then 'consultation' when 'calendar_blocks' then 'block' when 'course_sessions' then 'course' else 'fitness' end;
  if public.is_admin() then lead:=auth.uid(); perform public.ensure_calendar_staff(lead); end if;
  insert into public.calendar_assignments(kind,appointment_id,walk_id,consultation_id,block_id,course_session_id,fitness_session_id,assigned_staff_id,created_by,updated_by)
    values(k,new.id,case when k='walk' then new.id end,case when k='consultation' then new.id end,case when k='block' then new.id end,
      case when k='course' then new.id end,case when k='fitness' then new.id end,lead,auth.uid(),auth.uid());
  return null;
end $$;
revoke all on function public.capture_calendar_assignment() from public,anon,authenticated;
-- Trigger name precedes all existing projection triggers on each source table.
create trigger aaa_calendar_assignment after insert on public.walks for each row execute function public.capture_calendar_assignment();
create trigger aaa_calendar_assignment after insert on public.consultations for each row execute function public.capture_calendar_assignment();
create trigger aaa_calendar_assignment after insert on public.calendar_blocks for each row execute function public.capture_calendar_assignment();
create trigger aaa_calendar_assignment after insert on public.course_sessions for each row execute function public.capture_calendar_assignment();
create trigger aaa_calendar_assignment after insert on public.fitness_sessions for each row execute function public.capture_calendar_assignment();

-- A whole-line range represents a genuinely unassigned legacy event. It
-- conflicts with every staff member until a human assigns the event. A finite
-- staff range permits two distinct staff members to work at the same time.
-- Native range GiST operators avoid requiring btree_gist in the existing stack.
alter table public.calendar_slots add column staff_scope int4range;
alter table public.calendar_slots add column resource_scope int4range;
alter table public.calendar_slots add column assigned_staff_id uuid references public.profiles;
alter table public.calendar_slots add column resource_id uuid references public.calendar_resources;
alter table public.calendar_slots drop constraint calendar_no_overlap;
drop trigger calendar_availability on public.calendar_slots;
update public.calendar_slots set occupied=base_occupied,staff_scope=int4range(null,null,'()');
alter table public.calendar_slots alter column staff_scope set not null;
alter table public.calendar_slots add constraint calendar_no_overlap exclude using gist(staff_scope with &&,occupied with &&) deferrable initially immediate;
alter table public.calendar_slots add constraint calendar_resource_no_overlap exclude using gist(resource_scope with &&,occupied with &&) where(resource_scope is not null) deferrable initially immediate;

create function public.calendar_effective_settings(p_staff uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare s public.calendar_settings; u public.calendar_staff_settings; week jsonb;
begin
  select * into strict s from public.calendar_settings where practice_id='00000000-0000-4000-8000-000000000001' ;
  select * into u from public.calendar_staff_settings where staff_id=p_staff;
  if u.staff_id is not null and not u.use_default then
    select jsonb_agg(jsonb_build_object('weekday',weekday,'enabled',enabled,'start_minute',start_minute,'end_minute',end_minute) order by weekday) into week from public.calendar_staff_weekly_hours where staff_id=p_staff;
    return jsonb_build_object('version',u.version,'use_default',false,'hours_enabled',u.hours_enabled,'before_minutes',u.before_minutes,'after_minutes',u.after_minutes,'week',week);
  end if;
  select jsonb_agg(jsonb_build_object('weekday',weekday,'enabled',enabled,'start_minute',start_minute,'end_minute',end_minute) order by weekday) into week from public.calendar_weekly_hours where practice_id=s.practice_id;
  return jsonb_build_object('version',coalesce(u.version,1),'use_default',true,'hours_enabled',s.hours_enabled,'before_minutes',s.before_minutes,'after_minutes',s.after_minutes,'week',week);
end $$;
revoke all on function public.calendar_effective_settings(uuid) from public,anon,authenticated;

create function public.calendar_break_warnings(p_staff uuid,p_range tstzrange,p_kind text,p_id uuid) returns jsonb
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
      and (s.assigned_staff_id=p_staff or s.assigned_staff_id is null or p_staff is null)
      and not (s.base_occupied && p_range)
      and s.base_occupied && tstzrange(lower(p_range)-make_interval(mins=>(pref->>'before_minutes')::integer+(pref->>'after_minutes')::integer),
        upper(p_range)+make_interval(mins=>(pref->>'before_minutes')::integer+(pref->>'after_minutes')::integer),'[)');
  return warnings;
end $$;
revoke all on function public.calendar_break_warnings(uuid,tstzrange,text,uuid) from public,anon,authenticated;

create or replace function public.apply_calendar_availability() returns trigger
language plpgsql security definer set search_path='' as $$
declare a public.calendar_assignments; pref jsonb; h jsonb; k text; source uuid; i integer; r public.calendar_resources;
  local_a timestamp; local_b timestamp; day date; end_min numeric; changed_offset boolean; warnings jsonb; acknowledgement jsonb;
begin
  if tg_op='INSERT' then new.base_occupied:=new.occupied; end if;
  new.occupied:=new.base_occupied;
  source:=coalesce(new.walk_id,new.consultation_id,new.block_id,new.course_session_id,new.fitness_session_id);
  k:=case when new.walk_id is not null then 'walk' when new.consultation_id is not null then 'consultation' when new.block_id is not null then 'block' when new.course_session_id is not null then 'course' else 'fitness' end;
  a:=public.apply_calendar_assignment_context(k,source);
  -- A freshly client-requested appointment obtains its first scheduling actor;
  -- legacy or explicitly cleared assignments are never silently reassigned.
  if a.assigned_staff_id is null and not a.legacy_unassigned and a.version=1 and public.is_admin() and coalesce(current_setting('psi.calendar_assignment',true),'')='' then
    perform public.ensure_calendar_staff(auth.uid());
    update public.calendar_assignments set assigned_staff_id=auth.uid(),updated_by=auth.uid() where kind=k and appointment_id=source returning * into a;
  end if;
  new.assigned_staff_id:=a.assigned_staff_id; new.resource_id:=a.resource_id;
  if a.assigned_staff_id is null then perform pg_advisory_xact_lock(951441,0);
  else
    perform pg_advisory_xact_lock_shared(951441,0);
    select slot_index into strict i from public.calendar_staff_indices where staff_id=a.assigned_staff_id;
    perform pg_advisory_xact_lock(951441,i);
  end if;
  if a.assigned_staff_id is null then new.staff_scope:=int4range(null,null,'()');
  else
    select slot_index into strict i from public.calendar_staff_indices where staff_id=a.assigned_staff_id;
    new.staff_scope:=int4range(i,i+1,'[)');
  end if;
  new.resource_scope:=null;
  if a.resource_id is not null then
    select * into strict r from public.calendar_resources where id=a.resource_id for share;
    if r.exclusive then new.resource_scope:=int4range(r.slot_index,r.slot_index+1,'[)'); end if;
  end if;
  if k='block' or upper(new.base_occupied)<=now() then return new; end if;
  pref:=public.calendar_effective_settings(a.assigned_staff_id);
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
create trigger calendar_availability before insert or update of occupied on public.calendar_slots for each row execute function public.apply_calendar_availability();

create function public.calendar_team_members() returns table(user_id uuid,full_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  return query select p.id,coalesce(nullif(trim(p.full_name),''),'Członek zespołu') from public.profiles p join public.user_roles r on r.user_id=p.id and r.role='admin' order by 2,p.id;
end $$;
create function public.calendar_staff_preferences(p_staff_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_staff_id is not null and not exists(select 1 from public.user_roles where user_id=p_staff_id and role='admin') then raise exception 'Wybierz aktywnego członka zespołu.'; end if;
  if p_staff_id is null then raise exception 'Wybierz członka zespołu.'; end if;
  return public.calendar_effective_settings(p_staff_id);
end $$;

create function public.save_calendar_resource(p_id uuid,p_expected_version integer,p_name text,p_exclusive boolean,p_active boolean) returns integer
language plpgsql security definer set search_path='' as $$
declare r public.calendar_resources;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647 or p_name is null or length(trim(p_name)) not between 3 and 160 or p_exclusive is null or p_active is null then raise exception 'Sprawdź nazwę i ustawienia miejsca.'; end if;
  lock table public.calendar_slots in share row exclusive mode;
  select * into r from public.calendar_resources where id=p_id for update;
  if found then
    if r.version=p_expected_version+1 and r.updated_by=auth.uid() and r.name=trim(p_name) and r.exclusive=p_exclusive and r.active=p_active then return r.version; end if;
    if r.version<>p_expected_version then raise exception 'Miejsce zmieniło się. Odśwież widok przed zapisem.'; end if;
    update public.calendar_resources set name=trim(p_name),exclusive=p_exclusive,active=p_active,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into r;
    perform set_config('psi.calendar_policy_revalidation','true',true);
    update public.calendar_slots set occupied=base_occupied where resource_id=p_id;
    perform set_config('psi.calendar_policy_revalidation','false',true);
  else
    if p_expected_version<>0 then raise exception 'Nie znaleziono miejsca.'; end if;
    insert into public.calendar_resources(id,name,exclusive,active,created_by,updated_by) values(p_id,trim(p_name),p_exclusive,p_active,auth.uid(),auth.uid()) returning * into r;
  end if;
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'calendar_resource_saved',p_id,jsonb_build_object('version',r.version,'exclusive',r.exclusive,'active',r.active));
  return r.version;
exception when exclusion_violation then raise exception 'Sala jest zajęta przez równoległe spotkania. Najpierw zmień ich przypisanie.';
end $$;

create function public.save_calendar_assignment(p_kind text,p_appointment_id uuid,p_expected_version integer,p_staff_id uuid,p_resource_id uuid,p_confirm_short_break boolean default false) returns integer
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
  perform public.ensure_calendar_staff(p_staff_id);
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

create function public.save_calendar_team_block(p_id uuid,p_expected_version integer,p_title text,p_starts_at timestamptz,p_ends_at timestamptz,p_staff_id uuid,p_resource_id uuid,p_expected_assignment_version integer,p_confirm_short_break boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v integer; b public.calendar_blocks; a public.calendar_assignments; previous text;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  lock table public.calendar_slots in share row exclusive mode;
  if p_confirm_short_break is null or p_expected_assignment_version is null or p_expected_assignment_version<0 or p_expected_assignment_version>=2147483647 then raise exception 'Sprawdź przypisanie blokady.'; end if;
  perform public.ensure_calendar_staff(p_staff_id);
  if p_resource_id is not null and not exists(select 1 from public.calendar_resources where id=p_resource_id and active) and not exists(select 1 from public.calendar_assignments where kind='block' and appointment_id=p_id and resource_id=p_resource_id) then raise exception 'Wybierz aktywne miejsce.'; end if;
  select * into b from public.calendar_blocks where id=p_id for update;
  select * into a from public.calendar_assignments where kind='block' and appointment_id=p_id for update;
  if b.cancelled_at is not null then raise exception 'Ta blokada została już usunięta.'; end if;
  if b.id is not null and b.version=p_expected_version+1 and b.updated_by=auth.uid() and b.title=trim(p_title) and b.starts_at=p_starts_at and b.ends_at=p_ends_at
    and a.assigned_staff_id is not distinct from p_staff_id and a.resource_id is not distinct from p_resource_id and a.version=p_expected_assignment_version+1 then return jsonb_build_object('version',b.version,'assignment_version',a.version); end if;
  if b.id is not null and b.version<>p_expected_version then raise exception 'Blokada zmieniła się. Odśwież widok przed zapisem.'; end if;
  if a.appointment_id is not null and a.version<>p_expected_assignment_version then raise exception 'Przypisanie zmieniło się. Odśwież widok przed zapisem.'; end if;
  if a.appointment_id is null and p_expected_assignment_version<>0 then raise exception 'Nie znaleziono przypisania blokady.'; end if;
  previous:=coalesce(current_setting('psi.calendar_assignment',true),'');
  perform set_config('psi.calendar_assignment',jsonb_build_object('staff_id',p_staff_id,'resource_id',p_resource_id,'expected_version',a.version)::text,true);
  if a.appointment_id is not null then
    update public.calendar_assignments set assigned_staff_id=p_staff_id,resource_id=p_resource_id,legacy_unassigned=(p_staff_id is null),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where kind='block' and appointment_id=p_id;
  end if;
  v:=public.save_calendar_block(p_id,p_expected_version,p_title,p_starts_at,p_ends_at);
  perform set_config('psi.calendar_assignment',previous,true);
  select * into strict a from public.calendar_assignments where kind='block' and appointment_id=p_id;
  return jsonb_build_object('version',v,'assignment_version',a.version);
end $$;

create function public.save_calendar_staff_settings(p_staff_id uuid,p_expected_version integer,p_use_default boolean,p_hours_enabled boolean,p_before_minutes integer,p_after_minutes integer,p_week jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.calendar_staff_settings; existing jsonb;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_staff_id is null or p_expected_version is null or p_expected_version<1 or p_expected_version>=2147483647 or p_use_default is null or p_hours_enabled is null or p_before_minutes is null or p_before_minutes not between 0 and 120 or p_after_minutes is null or p_after_minutes not between 0 and 120 or p_week is null or jsonb_typeof(p_week)<>'array' then raise exception 'Sprawdź godziny pracy i długość przerw.'; end if;
  if jsonb_array_length(p_week)<>7 or exists(select 1 from jsonb_array_elements(p_week) x where not coalesce(jsonb_typeof(x)='object' and jsonb_typeof(x->'weekday')='number' and (x->>'weekday')~'^[1-7]$' and jsonb_typeof(x->'enabled')='boolean' and jsonb_typeof(x->'start_minute')='number' and (x->>'start_minute')~'^(0|[1-9][0-9]{0,3})$' and jsonb_typeof(x->'end_minute')='number' and (x->>'end_minute')~'^[1-9][0-9]{0,3}$',false)) then raise exception 'Sprawdź godziny pracy i długość przerw.'; end if;
  if (select count(distinct x->>'weekday') from jsonb_array_elements(p_week) x)<>7 or exists(select 1 from jsonb_to_recordset(p_week) x(weekday integer,enabled boolean,start_minute integer,end_minute integer) where start_minute not between 0 and 1425 or start_minute%15<>0 or end_minute not between 15 and 1440 or end_minute%15<>0 or end_minute<=start_minute) or (not p_use_default and p_hours_enabled and not exists(select 1 from jsonb_to_recordset(p_week) x(enabled boolean) where enabled)) then raise exception 'Sprawdź godziny pracy i długość przerw.'; end if;
  lock table public.calendar_slots in share row exclusive mode;
  perform public.ensure_calendar_staff(p_staff_id);
  select * into strict s from public.calendar_staff_settings where staff_id=p_staff_id for update;
  select jsonb_agg(jsonb_build_object('weekday',weekday,'enabled',enabled,'start_minute',start_minute,'end_minute',end_minute) order by weekday) into existing from public.calendar_staff_weekly_hours where staff_id=p_staff_id;
  if s.version=p_expected_version+1 and s.updated_by=auth.uid() and s.use_default=p_use_default and s.hours_enabled=p_hours_enabled and s.before_minutes=p_before_minutes and s.after_minutes=p_after_minutes and existing=(select jsonb_agg(x order by (x->>'weekday')::integer) from jsonb_array_elements(p_week) x) then return s.version; end if;
  if s.version<>p_expected_version then raise exception 'Ustawienia prowadzącego zmieniły się. Odśwież widok przed zapisem.'; end if;
  update public.calendar_staff_settings set use_default=p_use_default,hours_enabled=p_hours_enabled,before_minutes=p_before_minutes,after_minutes=p_after_minutes,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where staff_id=p_staff_id returning * into s;
  update public.calendar_staff_weekly_hours h set enabled=x.enabled,start_minute=x.start_minute,end_minute=x.end_minute from jsonb_to_recordset(p_week) x(weekday integer,enabled boolean,start_minute integer,end_minute integer) where h.staff_id=p_staff_id and h.weekday=x.weekday;
  perform set_config('psi.calendar_policy_revalidation','true',true);
  update public.calendar_slots set occupied=base_occupied where assigned_staff_id=p_staff_id;
  perform set_config('psi.calendar_policy_revalidation','false',true);
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'calendar_staff_settings_saved',p_staff_id,jsonb_build_object('version',s.version,'use_default',p_use_default));
  return s.version;
end $$;

-- Only wrappers set this transaction-local context; no public function accepts
-- SQL, a table name, session settings, or an arbitrary function to execute.
create function public.apply_calendar_assignment_context(p_kind text,p_id uuid) returns public.calendar_assignments
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
  perform public.ensure_calendar_staff(lead);
  update public.calendar_assignments set assigned_staff_id=lead,resource_id=room,legacy_unassigned=(lead is null),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp(),break_acknowledgement=null where kind=p_kind and appointment_id=p_id returning * into a;
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'calendar_assignment_saved',p_id,jsonb_build_object('kind',p_kind,'version',a.version,'assigned_staff_id',lead,'resource_id',room));
  return a;
end $$;
revoke all on function public.apply_calendar_assignment_context(text,uuid) from public,anon,authenticated;

create or replace function public.capture_calendar_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text; lead uuid; room uuid; choice jsonb;
begin
  k:=case tg_table_name when 'walks' then 'walk' when 'consultations' then 'consultation' when 'calendar_blocks' then 'block' when 'course_sessions' then 'course' else 'fitness' end;
  choice:=nullif(current_setting('psi.calendar_assignment',true),'')::jsonb;
  if choice is not null then lead:=(choice->>'staff_id')::uuid; room:=(choice->>'resource_id')::uuid;
  elsif public.is_admin() then lead:=auth.uid(); end if;
  perform public.ensure_calendar_staff(lead);
  insert into public.calendar_assignments(kind,appointment_id,walk_id,consultation_id,block_id,course_session_id,fitness_session_id,assigned_staff_id,resource_id,legacy_unassigned,created_by,updated_by)
    values(k,new.id,case when k='walk' then new.id end,case when k='consultation' then new.id end,case when k='block' then new.id end,
      case when k='course' then new.id end,case when k='fitness' then new.id end,lead,room,choice is not null and lead is null,auth.uid(),auth.uid());
  return null;
end $$;

create function public.calendar_write(p_operation text,p_arguments jsonb,p_confirm_short_break boolean default false,p_assignment jsonb default null) returns jsonb
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
    if lead is not null and not exists(select 1 from public.user_roles where user_id=lead and role='admin') then raise exception 'Wybierz aktywnego członka zespołu.'; end if;
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

create function public.calendar_team_appointments(p_from timestamptz,p_to timestamptz)
returns table(id uuid,kind text,title text,starts_at timestamptz,ends_at timestamptz,status text,location text,version integer,
  appointment_id uuid,assigned_staff_id uuid,assigned_staff_name text,resource_id uuid,resource_name text,assignment_version integer,created_by uuid,created_by_name text,break_warnings jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to-p_from>interval '43 days' then raise exception 'Nieprawidłowy zakres kalendarza.'; end if;
  return query
    with events as (
      select w.id,'walk'::text kind,w.type title,w.starts_at,w.starts_at+make_interval(mins=>w.duration_minutes) ends_at,w.status::text status,w.public_location location,null::integer version,w.id appointment_id
        from public.walks w where w.status not in ('draft','cancelled') and w.starts_at<p_to and w.starts_at+make_interval(mins=>w.duration_minutes)>p_from
      union all
      select c.id,'consultation',coalesce(c.service_name,'Konsultacja')||' · '||d.name,c.starts_at,c.starts_at+make_interval(mins=>c.duration_minutes),c.status,c.location,c.version,c.id
        from public.consultations c join public.dogs d on d.id=c.dog_id where c.status in ('scheduled','completed') and c.starts_at<p_to and c.starts_at+make_interval(mins=>c.duration_minutes)>p_from
      union all
      select b.id,'block',b.title,b.starts_at,b.ends_at,'blocked','',b.version,b.id
        from public.calendar_blocks b where b.cancelled_at is null and b.starts_at<p_to and b.ends_at>p_from
      union all
      select c.id,'course',c.title||' · spotkanie '||s.ordinal::text||'/'||c.sessions_count::text,s.starts_at,s.starts_at+make_interval(mins=>s.duration_minutes),s.status,coalesce(p.exact_location,s.public_location),s.version,s.id
        from public.courses c join public.course_sessions s on s.course_id=c.id left join public.course_session_private_details p on p.session_id=s.id
        where c.status in ('open','closed','completed') and s.status in ('scheduled','completed') and s.starts_at<p_to and s.starts_at+make_interval(mins=>s.duration_minutes)>p_from
      union all
      select f.id,'fitness',f.service_name||' · spotkanie '||s.ordinal::text||'/'||f.sessions_count::text,s.starts_at,s.starts_at+make_interval(mins=>s.duration_minutes),s.status,coalesce(p.exact_location,'Miejsce do ustalenia'),s.version,s.id
        from public.fitness_packages f join public.fitness_sessions s on s.package_id=f.id left join public.fitness_session_private_details p on p.session_id=s.id
        where f.status in ('active','completed') and s.status in ('scheduled','completed') and s.starts_at<p_to and s.starts_at+make_interval(mins=>s.duration_minutes)>p_from
    ) select e.id,e.kind,e.title,e.starts_at,e.ends_at,e.status,e.location,e.version,a.appointment_id,
      a.assigned_staff_id,coalesce(nullif(trim(lead.full_name),''),case when a.assigned_staff_id is not null then 'Członek zespołu' end),
      a.resource_id,r.name,a.version,a.created_by,coalesce(nullif(trim(creator.full_name),''),case when a.created_by is not null then 'Użytkownik' end),
      public.calendar_break_warnings(a.assigned_staff_id,tstzrange(e.starts_at,e.ends_at,'[)'),e.kind,a.appointment_id)
    from events e join public.calendar_assignments a on a.kind=e.kind and a.appointment_id=e.appointment_id
      left join public.profiles lead on lead.id=a.assigned_staff_id left join public.profiles creator on creator.id=a.created_by left join public.calendar_resources r on r.id=a.resource_id
    order by e.starts_at,e.kind,e.id,a.appointment_id;
end $$;
revoke all on function public.calendar_team_members(),public.calendar_staff_preferences(uuid),public.calendar_team_appointments(timestamptz,timestamptz),public.save_calendar_resource(uuid,integer,text,boolean,boolean),public.save_calendar_assignment(text,uuid,integer,uuid,uuid,boolean),public.save_calendar_team_block(uuid,integer,text,timestamptz,timestamptz,uuid,uuid,integer,boolean),public.save_calendar_staff_settings(uuid,integer,boolean,boolean,integer,integer,jsonb),public.calendar_write(text,jsonb,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.calendar_team_members(),public.calendar_staff_preferences(uuid),public.calendar_team_appointments(timestamptz,timestamptz),public.save_calendar_resource(uuid,integer,text,boolean,boolean),public.save_calendar_assignment(text,uuid,integer,uuid,uuid,boolean),public.save_calendar_team_block(uuid,integer,text,timestamptz,timestamptz,uuid,uuid,integer,boolean),public.save_calendar_staff_settings(uuid,integer,boolean,boolean,integer,integer,jsonb),public.calendar_write(text,jsonb,boolean,jsonb) to authenticated;

-- Existing global settings remain the default for staff without an override.
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
  perform set_config('psi.calendar_policy_revalidation','true',true);
  update public.calendar_slots set occupied=base_occupied where base_occupied is not null;
  perform set_config('psi.calendar_policy_revalidation','false',true);
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'calendar_settings_saved',s.practice_id,jsonb_build_object('version',s.version,'hours_enabled',s.hours_enabled,
      'before_minutes',s.before_minutes,'after_minutes',s.after_minutes));
  return s.version;
exception when exclusion_violation then
  raise exception 'Nowe przerwy powodują kolizję istniejących terminów. Najpierw przełóż spotkania lub zmniejsz przerwy.';
end $$;
revoke all on function public.save_calendar_settings(integer,boolean,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_calendar_settings(integer,boolean,integer,integer,jsonb) to authenticated;

create or replace function public.change_consultation(
  p_id uuid,p_expected_version integer,p_action text,p_starts_at timestamptz,
  p_duration integer,p_mode text,p_location text,p_note text
) returns integer language plpgsql security definer set search_path='' as $$
declare c public.consultations; h public.consultation_history; event_id uuid; kind text; staff boolean;
begin
  lock table public.calendar_slots in row exclusive mode;
  staff:=public.is_admin();
  if auth.uid() is null or (not staff and p_action is distinct from 'cancel') then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version<1 or p_expected_version>=2147483647 or
     p_action is null or p_action not in ('schedule','cancel','complete') or
     p_note is null or length(trim(p_note))>3000 then raise exception 'Sprawdź dane konsultacji.'; end if;
  -- Preserve the established source/receipt lock order; the team projection
  -- below checks assigned staff and shared resources across all booking kinds.
  if p_action='schedule' then
    perform 1 from public.care_practices where id='00000000-0000-4000-8000-000000000001' for update;
    if p_starts_at is null or not isfinite(p_starts_at) or p_duration is null or p_duration not between 15 and 240
       or p_mode is null or p_mode not in ('in_person','online') or p_location is null or length(trim(p_location)) not between 3 and 1000 then
      raise exception 'Sprawdź termin i miejsce spotkania.';
    end if;
  end if;
  select * into c from public.consultations where id=p_id for update;
  if not found or (not staff and not public.owns_dog(c.dog_id)) then raise exception 'Nie znaleziono konsultacji.'; end if;
  -- Exact retry of the immediately preceding operation is a no-op. A stale
  -- form with different values is rejected instead of overwriting a change.
  if c.version=p_expected_version+1 then
    select * into h from public.consultation_history where consultation_id=p_id and version=c.version;
    if h.author_id=auth.uid() and h.note=trim(p_note) and (
      (p_action='schedule' and h.action in ('scheduled','rescheduled') and h.starts_at=p_starts_at and h.duration_minutes=p_duration and h.meeting_mode=p_mode and h.location=trim(p_location)) or
      (p_action='cancel' and h.action='cancelled') or (p_action='complete' and h.action='completed')
    ) then return c.version; end if;
  end if;
  if c.version<>p_expected_version then raise exception 'Konsultacja zmieniła się. Odśwież widok przed zapisem.'; end if;
  if c.status in ('cancelled','completed') then raise exception 'Ta konsultacja jest już zamknięta.'; end if;
  if p_action='schedule' then
    if p_starts_at<=now() then raise exception 'Wybierz przyszły termin.'; end if;
    if c.status='scheduled' and length(trim(p_note))<3 then raise exception 'Podaj powód zmiany terminu.'; end if;
    kind:=case when c.status='requested' then 'scheduled' else 'rescheduled' end;
    update public.consultations set status='scheduled',starts_at=p_starts_at,duration_minutes=p_duration,
      meeting_mode=p_mode,location=trim(p_location),version=version+1,updated_at=clock_timestamp() where id=p_id returning * into c;
  elsif p_action='cancel' then
    if length(trim(p_note))<3 then raise exception 'Podaj powód odwołania.'; end if;
    if not staff and c.status='scheduled' and c.starts_at<=now() then raise exception 'Termin już się rozpoczął. Skontaktuj się z prowadzącą.'; end if;
    kind:='cancelled';
    update public.consultations set status='cancelled',version=version+1,updated_at=clock_timestamp() where id=p_id returning * into c;
  else
    if c.status<>'scheduled' or c.starts_at+make_interval(mins=>c.duration_minutes)>now() then
      raise exception 'Możesz zakończyć konsultację dopiero po jej terminie.';
    end if;
    kind:='completed';
    update public.consultations set status='completed',version=version+1,updated_at=clock_timestamp() where id=p_id returning * into c;
  end if;
  insert into public.consultation_history(consultation_id,version,action,starts_at,duration_minutes,meeting_mode,location,note,author_id)
    values(c.id,c.version,kind,c.starts_at,c.duration_minutes,c.meeting_mode,c.location,trim(p_note),auth.uid()) returning id into event_id;
  insert into public.consultation_events(history_id) values(event_id);
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'consultation_'||kind,p_id,jsonb_build_object('version',c.version));
  return c.version;
end $$;

-- Invoker wrapper's narrow post-retry check: a lost response may cause the
-- domain RPC to return its earlier receipt without firing projection triggers.
create function public.calendar_validate_write_assignment(p_kind text,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.calendar_assignments; prior integer;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  select version into prior from public.calendar_assignments where kind=p_kind and appointment_id=p_id;
  a:=public.apply_calendar_assignment_context(p_kind,p_id);
  -- A retry cannot attach a different lead to a previously committed domain
  -- command without a fresh domain version. Triggered real writes already
  -- consumed the choice; an unconsumed new choice here is rejected atomically.
  if a.version<>prior then raise exception 'Przypisanie zmieniło się. Odśwież widok przed zapisem.'; end if;
end $$;
revoke all on function public.calendar_validate_write_assignment(text,uuid) from public,anon,authenticated;
grant execute on function public.calendar_validate_write_assignment(text,uuid) to authenticated;

-- Keep completed real-time intervals briefly for advisory break checks. They
-- never reserve preferred breaks; staff overrides can request up to 240 total
-- minutes even when the global default has zero preferred minutes.
create or replace function public.calendar_has_post_buffer(p_starts timestamptz,p_minutes integer) returns boolean
language sql volatile security definer set search_path='' as $$
  select p_starts+make_interval(mins=>p_minutes+240)>now();
$$;

-- A six-week month grid remains bounded and respects the existing client RLS.
create or replace function public.calendar_appointments(p_from timestamptz,p_to timestamptz)
returns table(id uuid,kind text,title text,starts_at timestamptz,ends_at timestamptz,status text,location text,version integer)
language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to-p_from>interval '43 days' then raise exception 'Nieprawidłowy zakres kalendarza.'; end if;
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
    union all
    select c.id,'course'::text,c.title||' · spotkanie '||s.ordinal::text||'/'||c.sessions_count::text,
      s.starts_at,s.starts_at+make_interval(mins=>s.duration_minutes),s.status,
      coalesce(p.exact_location,s.public_location),s.version
      from public.courses c join public.course_sessions s on s.course_id=c.id
        left join public.course_session_private_details p on p.session_id=s.id
      where c.status in ('open','closed','completed') and s.status in ('scheduled','completed')
        and s.starts_at<p_to and s.starts_at+make_interval(mins=>s.duration_minutes)>p_from
        and (public.is_admin() or exists(select 1 from public.course_enrollments e
          where e.course_id=c.id and e.status='accepted' and e.guardian_id=auth.uid()))
    union all
    select f.id,'fitness'::text,f.service_name||' · spotkanie '||s.ordinal::text||'/'||f.sessions_count::text,
      s.starts_at,s.starts_at+make_interval(mins=>s.duration_minutes),s.status,
      coalesce(p.exact_location,'Miejsce do ustalenia'),s.version
      from public.fitness_packages f join public.fitness_sessions s on s.package_id=f.id
        left join public.fitness_session_private_details p on p.session_id=s.id
      where f.status in ('active','completed') and s.status in ('scheduled','completed')
        and s.starts_at<p_to and s.starts_at+make_interval(mins=>s.duration_minutes)>p_from
        and (public.is_admin() or (f.guardian_id=auth.uid() and public.owns_dog(f.dog_id)))
    order by 4,2,1;
end $$;

create function public.reserve_calendar_projection() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  lock table public.calendar_slots in row exclusive mode;
  return null;
end $$;
revoke all on function public.reserve_calendar_projection() from public,anon,authenticated;
create trigger aaa_calendar_projection_lock before insert or update or delete on public.walks for each statement execute function public.reserve_calendar_projection();
create trigger aaa_calendar_projection_lock before insert or update or delete on public.consultations for each statement execute function public.reserve_calendar_projection();
create trigger aaa_calendar_projection_lock before insert or update or delete on public.calendar_blocks for each statement execute function public.reserve_calendar_projection();
create trigger aaa_calendar_projection_lock before insert or update or delete on public.course_sessions for each statement execute function public.reserve_calendar_projection();
create trigger aaa_calendar_projection_lock before insert or update or delete on public.fitness_sessions for each statement execute function public.reserve_calendar_projection();
create trigger aaa_calendar_projection_lock before insert or update or delete on public.courses for each statement execute function public.reserve_calendar_projection();
create trigger aaa_calendar_projection_lock before insert or update or delete on public.fitness_packages for each statement execute function public.reserve_calendar_projection();

-- Existing RPC logic/receipts remain intact; only lock order is normalized.
create or replace function public.save_calendar_block(p_id uuid,p_expected_version integer,p_title text,p_starts_at timestamptz,p_ends_at timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
declare b public.calendar_blocks;
begin
  lock table public.calendar_slots in row exclusive mode;
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
create or replace function public.cancel_calendar_block(p_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare b public.calendar_blocks;
begin
  lock table public.calendar_slots in row exclusive mode;
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
create or replace function public.create_walk(payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$declare w uuid;begin
  lock table public.calendar_slots in row exclusive mode;
 if not public.is_admin() then raise exception 'Brak uprawnień.';end if;
 if (payload->>'starts_at')::timestamptz<=now() or length(trim(payload->>'public_location'))<3 or length(trim(payload->>'exact_location'))<3 then raise exception 'Sprawdź datę i lokalizację.';end if;
 insert into public.walks(starts_at,duration_minutes,public_location,type,price_cents,capacity,booking_mode,info,leader_id,cancellation_deadline_hours)
 values((payload->>'starts_at')::timestamptz,(payload->>'duration_minutes')::integer,payload->>'public_location',payload->>'type',(payload->>'price_cents')::integer,(payload->>'capacity')::integer,(payload->>'booking_mode')::public.booking_mode,coalesce(payload->>'info',''),auth.uid(),(payload->>'cancellation_deadline_hours')::integer) returning id into w;
 insert into public.walk_private_details(walk_id,exact_location,map_url,instructions) values(w,payload->>'exact_location',coalesce(payload->>'map_url',''),coalesce(payload->>'instructions',''));
 insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'walk_created',w);return w;
end$$;
create or replace function public.update_walk(p_walk uuid, p_expected_updated_at timestamptz, payload jsonb, p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare w public.walks; active_count integer; has_history boolean;
begin
  lock table public.calendar_slots in row exclusive mode;
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  select * into w from public.walks where id=p_walk for update;
  if w.id is null then raise exception 'Nie znaleziono spaceru.'; end if;
  if w.status in ('completed','cancelled') or w.starts_at<=now() then
    raise exception 'Nie można edytować rozpoczętego lub odwołanego spaceru.';
  end if;
  if p_expected_updated_at is null or w.updated_at<>p_expected_updated_at then
    raise exception 'Spacer zmienił się w międzyczasie. Odśwież formularz przed zapisem.';
  end if;
  if p_note is null or length(trim(p_note))<3 or length(p_note)>2000 then
    raise exception 'Podaj opis zmiany dla uczestników.';
  end if;
  if jsonb_typeof(payload)<>'object' or not (payload ?& array['starts_at','duration_minutes','public_location','type','price_cents','capacity','booking_mode','info','exact_location','map_url','instructions','cancellation_deadline_hours']) then
    raise exception 'Sprawdź dane spaceru.';
  end if;
  if exists(select 1 from jsonb_each(payload) e where e.value='null'::jsonb) or
     (payload->>'starts_at')::timestamptz<=now() or
     length(trim(payload->>'public_location')) not between 3 and 200 or
     length(trim(payload->>'type')) not between 3 and 100 or
     length(trim(payload->>'exact_location')) not between 3 and 500 or
     length(payload->>'info')>4000 or length(payload->>'instructions')>2000 or
     (payload->>'duration_minutes')::int not between 15 and 480 or
     (payload->>'capacity')::int not between 1 and 50 or
     (payload->>'price_cents')::int not between 1 and 1000000 or
     (payload->>'cancellation_deadline_hours')::int not between 0 and 168 or
     (payload->>'booking_mode') not in ('approval','automatic','invite') or
     ((payload->>'map_url')<>'' and (payload->>'map_url') !~ '^https://') then
    raise exception 'Sprawdź dane spaceru.';
  end if;
  select exists(select 1 from public.walk_registrations where walk_id=p_walk) into has_history;
  if has_history and ((payload->>'price_cents')::int<>w.price_cents or
       (payload->>'cancellation_deadline_hours')::int<>w.cancellation_deadline_hours or
       (payload->>'booking_mode')<>w.booking_mode::text) then
    raise exception 'Po pierwszym zgłoszeniu cena, tryb zapisów i zasady odwołania pozostają bez zmian.';
  end if;
  select count(*) into active_count from public.walk_registrations where walk_id=p_walk and status='accepted';
  if (payload->>'capacity')::int<active_count then
    raise exception 'Limit nie może być mniejszy od zaakceptowanego składu.';
  end if;
  -- Existing accepted clients keep the more favorable deadline when the date moves.
  if w.starts_at<>(payload->>'starts_at')::timestamptz then
    update public.walk_registrations set cancellation_free_until=greatest(
      cancellation_free_until,w.starts_at-make_interval(hours=>w.cancellation_deadline_hours),
      (payload->>'starts_at')::timestamptz-make_interval(hours=>w.cancellation_deadline_hours))
      where walk_id=p_walk and status='accepted';
  end if;
  update public.walks set starts_at=(payload->>'starts_at')::timestamptz,
    duration_minutes=(payload->>'duration_minutes')::int,public_location=trim(payload->>'public_location'),
    type=trim(payload->>'type'),price_cents=(payload->>'price_cents')::int,
    capacity=(payload->>'capacity')::int,booking_mode=(payload->>'booking_mode')::public.booking_mode,
    info=trim(payload->>'info'),cancellation_deadline_hours=(payload->>'cancellation_deadline_hours')::int,
    change_note=trim(p_note) where id=p_walk;
  insert into public.walk_private_details(walk_id,exact_location,map_url,instructions)
    values(p_walk,trim(payload->>'exact_location'),payload->>'map_url',trim(payload->>'instructions'))
    on conflict(walk_id) do update set exact_location=excluded.exact_location,map_url=excluded.map_url,instructions=excluded.instructions;
  -- Audit contains no exact location; access remains restricted by the audit RLS policy.
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'walk_updated',p_walk,
    jsonb_build_object('note',trim(p_note),'previous_start',w.starts_at,'new_start',payload->>'starts_at','previous_capacity',w.capacity,'new_capacity',(payload->>'capacity')::int));
end $$;
create or replace function public.cancel_walk(p_walk uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare w public.walks; reservation record; remaining_reserved integer; affected integer;
begin
  lock table public.calendar_slots in row exclusive mode;
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_reason is null or length(trim(p_reason))<3 or length(p_reason)>2000 then
    raise exception 'Podaj powód odwołania (3–2000 znaków).';
  end if;
  select * into w from public.walks where id=p_walk for update;
  if w.id is null then raise exception 'Nie znaleziono spaceru.'; end if;
  if w.status='cancelled' then return; end if;
  if w.status='completed' or w.starts_at<=now() then
    raise exception 'Nie można odwołać rozpoczętego spaceru.';
  end if;
  perform wr.id from public.walk_registrations wr
    where wr.walk_id=p_walk order by wr.id for update;
  perform p.id from public.packages p where p.id in (
    select wr.package_id from public.walk_registrations wr where wr.walk_id=p_walk
    union
    select t.package_id from public.package_transactions t
      join public.walk_registrations wr on wr.id=t.registration_id where wr.walk_id=p_walk
  ) order by p.id for update;

  update public.walk_registrations set
    status='cancelled_on_time',cancelled_at=coalesce(cancelled_at,now()),
    decided_at=now(),decided_by=auth.uid(),decision_note=trim(p_reason),
    payment_status=case when payment_status in ('paid','refunded') then payment_status else 'none'::public.payment_status end
    where walk_id=p_walk and status in ('accepted','pending','waitlisted','cancelled_late');
  get diagnostics affected = row_count;
  -- Current assignments are reconciled by the trigger. Include historical
  -- reservations from before that trigger existed, without duplicating returns.
  for reservation in
    select distinct t.package_id,t.registration_id from public.package_transactions t
      join public.walk_registrations wr on wr.id=t.registration_id
      where wr.walk_id=p_walk order by t.package_id,t.registration_id
  loop
    select coalesce(sum(t.reserved_delta),0)::integer into remaining_reserved
      from public.package_transactions t
      where t.package_id=reservation.package_id and t.registration_id=reservation.registration_id;
    if remaining_reserved>0 then
      insert into public.package_transactions(package_id,registration_id,available_delta,reserved_delta,reason,author_id)
        values(reservation.package_id,reservation.registration_id,remaining_reserved,-remaining_reserved,
          'Odwołanie spaceru przez organizatora',auth.uid());
    end if;
  end loop;
  update public.walks set status='cancelled',cancellation_reason=trim(p_reason) where id=p_walk;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'walk_cancelled',p_walk,
      jsonb_build_object('reason',trim(p_reason),'previous_status',w.status,'registrations_closed',affected));
end $$;
create or replace function public.create_course(p_id uuid,p_service uuid,p_expected_service_version integer,
  p_title text,p_capacity integer,p_public_location text,p_exact_location text,p_starts jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.services; receipt public.course_creation_receipts; payload jsonb;
  item jsonb; at timestamptz; previous_end timestamptz; ordinal integer:=0; session_id uuid;
begin
  lock table public.calendar_slots in row exclusive mode;
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_service is null or p_expected_service_version is null or p_expected_service_version<1 or
     p_title is null or length(trim(p_title)) not between 3 and 160 or p_capacity is null or p_capacity not between 1 and 50 or
     p_public_location is null or length(trim(p_public_location)) not between 3 and 300 or
     p_exact_location is null or length(trim(p_exact_location)) not between 3 and 2000 or
     p_starts is null or jsonb_typeof(p_starts)<>'array' then raise exception 'Sprawdź dane i wszystkie terminy kursu.'; end if;
  payload:=jsonb_build_object('service',p_service,'service_version',p_expected_service_version,'title',trim(p_title),
    'capacity',p_capacity,'public_location',trim(p_public_location),'exact_location',trim(p_exact_location),'starts',p_starts);
  perform 1 from public.care_practices where id='00000000-0000-4000-8000-000000000001' for update;
  select * into receipt from public.course_creation_receipts where course_id=p_id;
  if receipt.course_id is not null then
    if receipt.author_id=auth.uid() and receipt.payload=payload then return p_id; end if;
    raise exception 'Ten identyfikator kursu został już użyty. Odśwież formularz.';
  end if;
  select * into s from public.services where id=p_service for share;
  if s.id is null or not s.active or s.kind<>'course' or s.sessions_count is null or s.duration_minutes is null or s.course_format is null then
    raise exception 'Ta usługa nie jest dostępna jako kurs.';
  end if;
  if s.version<>p_expected_service_version then raise exception 'Oferta zmieniła się. Odśwież formularz i sprawdź cenę.'; end if;
  if s.course_format='individual' and p_capacity<>1 then raise exception 'Kurs indywidualny ma miejsce dla jednego psa z opiekunem.'; end if;
  if jsonb_array_length(p_starts)<>s.sessions_count then raise exception 'Podaj termin każdego spotkania kursu.'; end if;
  insert into public.courses(id,practice_id,service_id,service_version,service_name,price_cents,is_test_price,sessions_count,duration_minutes,course_format,
    title,public_location,capacity,created_by,updated_by)
    values(p_id,s.practice_id,s.id,s.version,s.name,s.price_cents,s.is_test_price,s.sessions_count,s.duration_minutes,s.course_format,
      trim(p_title),trim(p_public_location),p_capacity,auth.uid(),auth.uid());
  insert into public.course_private_details values(p_id,trim(p_exact_location));
  for item in select value from jsonb_array_elements(p_starts) loop
    if jsonb_typeof(item)<>'string' or (item#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'Sprawdź dane i wszystkie terminy kursu.';
    end if;
    at:=(item#>>'{}')::timestamptz;
    if not isfinite(at) or at<=clock_timestamp() or (previous_end is not null and at<previous_end) then
      raise exception 'Terminy kursu muszą być przyszłe, uporządkowane i nie mogą się nakładać.';
    end if;
    ordinal:=ordinal+1;
    insert into public.course_sessions(course_id,ordinal,starts_at,duration_minutes,public_location,updated_by) values(p_id,ordinal,at,s.duration_minutes,trim(p_public_location),auth.uid()) returning id into session_id;
    insert into public.course_session_private_details values(session_id,trim(p_exact_location));
    previous_end:=at+make_interval(mins=>s.duration_minutes);
  end loop;
  insert into public.course_creation_receipts values(p_id,auth.uid(),payload);
  insert into public.course_history(course_id,action,actor_id,details) values(p_id,'created',auth.uid(),jsonb_build_object('version',1));
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'course_created',p_id);
  return p_id;
end $$;
create or replace function public.change_course(p_id uuid,p_expected_version integer,p_action text,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.courses; e public.course_enrollments; desired text; v_note text:=trim(coalesce(p_note,''));
begin
  lock table public.calendar_slots in row exclusive mode;
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_action is null or
    p_action not in ('publish','close','reopen','complete','cancel') or length(v_note)>3000 or
    (p_action='cancel' and length(v_note)<3) then raise exception 'Sprawdź zmianę kursu i podaj powód odwołania.'; end if;
  desired:=case p_action when 'publish' then 'open' when 'reopen' then 'open' when 'close' then 'closed' when 'complete' then 'completed' else 'cancelled' end;
  select * into c from public.courses where id=p_id for update;
  if c.id is null then raise exception 'Nie znaleziono kursu.'; end if;
  if c.version=p_expected_version+1 and c.updated_by=auth.uid() and c.status=desired and
    exists(select 1 from public.course_history h where h.course_id=p_id and h.enrollment_id is null and h.session_id is null and h.action=p_action and h.note=v_note and h.details->>'version'=c.version::text) then return c.version; end if;
  if c.version<>p_expected_version then raise exception 'Kurs zmienił się. Odśwież widok przed zapisem.'; end if;
  if c.status in ('cancelled','completed') or
    (p_action='publish' and c.status<>'draft') or (p_action='close' and c.status<>'open') or
    (p_action='reopen' and c.status<>'closed') or (p_action='complete' and c.status='draft') then
    raise exception 'Ta zmiana kursu nie jest dostępna.';
  end if;
  if p_action in ('publish','reopen') and
    (not exists(select 1 from public.course_sessions where course_id=p_id and status='scheduled') or
     exists(select 1 from public.course_sessions where course_id=p_id and starts_at<=clock_timestamp())) then
    raise exception 'Zapisy można otworzyć przed pierwszym spotkaniem kursu.';
  end if;
  if p_action='complete' and (exists(select 1 from public.course_sessions where course_id=p_id and status='scheduled') or
    not exists(select 1 from public.course_sessions where course_id=p_id and status='completed')) then
    raise exception 'Najpierw zakończ lub odwołaj spotkania kursu.';
  end if;
  if p_action='cancel' then
    update public.course_sessions set status='cancelled',version=version+1,updated_by=auth.uid() where course_id=p_id and status='scheduled';
    for e in select * from public.course_enrollments where course_id=p_id and status in ('requested','accepted','waitlisted') for update loop
      update public.course_enrollments set status='cancelled',version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=e.id;
      insert into public.course_history(course_id,enrollment_id,action,actor_id,note,details)
        values(p_id,e.id,'course_cancelled',auth.uid(),v_note,jsonb_build_object('version',e.version+1,'charge_cents',e.charge_cents));
    end loop;
  end if;
  update public.courses set status=desired,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into c;
  insert into public.course_history(course_id,action,actor_id,note,details) values(p_id,p_action,auth.uid(),v_note,jsonb_build_object('version',c.version));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'course_changed',p_id,jsonb_build_object('action',p_action,'version',c.version));
  return c.version;
end $$;
create or replace function public.reschedule_course_session(p_id uuid,p_expected_version integer,p_starts_at timestamptz,p_note text,p_public_location text default null,p_exact_location text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.courses; s public.course_sessions; course uuid; v_note text:=trim(coalesce(p_note,'')); public_place text; private_place text;
begin
  lock table public.calendar_slots in row exclusive mode;
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_starts_at is null or
    not isfinite(p_starts_at) or length(v_note) not between 3 and 3000 or
    (p_public_location is not null and length(trim(p_public_location)) not between 3 and 300) or
    (p_exact_location is not null and length(trim(p_exact_location)) not between 3 and 2000) then raise exception 'Podaj przyszły termin i wiadomość o zmianie.'; end if;
  select course_id into course from public.course_sessions where id=p_id;
  select * into c from public.courses where id=course for update;
  select * into s from public.course_sessions where id=p_id for update;
  if s.id is null then raise exception 'Nie znaleziono spotkania kursu.'; end if;
  public_place:=coalesce(trim(p_public_location),s.public_location);
  select coalesce(trim(p_exact_location),exact_location) into private_place from public.course_session_private_details where session_id=p_id;
  if s.version=p_expected_version+1 and s.updated_by=auth.uid() and s.starts_at=p_starts_at and s.public_location=public_place and
    exists(select 1 from public.course_session_private_details d where d.session_id=p_id and d.exact_location=private_place) and
    exists(select 1 from public.course_history h where h.session_id=p_id and h.action='rescheduled' and h.note=v_note and h.details->>'version'=s.version::text) then return s.version; end if;
  if s.version<>p_expected_version then raise exception 'Spotkanie zmieniło się. Odśwież widok przed zapisem.'; end if;
  if c.status in ('completed','cancelled') or s.status<>'scheduled' or s.starts_at<=clock_timestamp() or p_starts_at<=clock_timestamp() then
    raise exception 'Można przełożyć tylko przyszłe spotkanie kursu.';
  end if;
  if exists(select 1 from public.course_sessions n where n.course_id=course and n.id<>s.id and
      ((n.ordinal<s.ordinal and n.starts_at+make_interval(mins=>n.duration_minutes)>p_starts_at) or
       (n.ordinal>s.ordinal and n.starts_at<p_starts_at+make_interval(mins=>s.duration_minutes)))) then
    raise exception 'Zachowaj kolejność i odstęp między spotkaniami kursu.';
  end if;
  update public.course_sessions set starts_at=p_starts_at,public_location=public_place,version=version+1,updated_by=auth.uid() where id=p_id returning * into s;
  update public.course_session_private_details set exact_location=private_place where session_id=p_id;
  update public.courses set version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=course;
  insert into public.course_history(course_id,session_id,action,actor_id,note,details)
    values(course,p_id,'rescheduled',auth.uid(),v_note,jsonb_build_object('version',s.version,'starts_at',p_starts_at));
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'course_session_rescheduled',p_id);
  return s.version;
end $$;
create or replace function public.change_course_session(p_id uuid,p_expected_version integer,p_action text,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.courses; s public.course_sessions; course uuid; v_note text:=trim(coalesce(p_note,'')); desired text;
begin
  lock table public.calendar_slots in row exclusive mode;
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_action is null or
    p_action not in ('complete','cancel') or length(v_note)>3000 or (p_action='cancel' and length(v_note)<3) then
    raise exception 'Sprawdź spotkanie i powód odwołania.';
  end if;
  select course_id into course from public.course_sessions where id=p_id;
  select * into c from public.courses where id=course for update;
  select * into s from public.course_sessions where id=p_id for update;
  if s.id is null then raise exception 'Nie znaleziono spotkania kursu.'; end if;
  desired:=case p_action when 'complete' then 'completed' else 'cancelled' end;
  if s.version=p_expected_version+1 and s.updated_by=auth.uid() and s.status=desired and
    exists(select 1 from public.course_history h where h.session_id=p_id and h.action=p_action and h.note=v_note and h.details->>'version'=s.version::text) then return s.version; end if;
  if s.version<>p_expected_version then raise exception 'Spotkanie zmieniło się. Odśwież widok przed zapisem.'; end if;
  if c.status not in ('open','closed') or s.status<>'scheduled' then raise exception 'Ta zmiana spotkania nie jest dostępna.'; end if;
  if p_action='complete' and (s.starts_at+make_interval(mins=>s.duration_minutes)>clock_timestamp() or
    exists(select 1 from public.course_enrollments e where e.course_id=course and e.status='accepted' and
      not exists(select 1 from public.course_attendance a where a.session_id=p_id and a.enrollment_id=e.id))) then
    raise exception 'Poczekaj do końca spotkania i uzupełnij obecności uczestników.';
  end if;
  update public.course_sessions set status=desired,version=version+1,updated_by=auth.uid() where id=p_id returning * into s;
  update public.courses set version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=course;
  insert into public.course_history(course_id,session_id,action,actor_id,note,details)
    values(course,p_id,p_action,auth.uid(),v_note,jsonb_build_object('version',s.version));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'course_session_changed',p_id,jsonb_build_object('action',p_action));
  return s.version;
end $$;
create or replace function public.save_fitness_session(p_id uuid,p_expected_version integer,p_starts_at timestamptz,p_location text,p_note text,p_request_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.fitness_sessions; p public.fitness_packages; target_package uuid; target_dog uuid; payload jsonb; previous integer;
  v_location text:=trim(p_location); v_note text:=trim(coalesce(p_note,'')); prior_start timestamptz;
begin
  lock table public.calendar_slots in row exclusive mode;
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_expected_version is null or p_expected_version not between 1 and 2147483646 or
    p_starts_at is null or not isfinite(p_starts_at) or v_location is null or length(v_location) not between 3 and 2000 or length(v_note)>3000 then
    raise exception 'Podaj termin, miejsce i wersję spotkania.';
  end if;
  select package_id into target_package from public.fitness_sessions where id=p_id;
  select dog_id into target_dog from public.fitness_packages where id=target_package;
  perform 1 from public.dogs where id=target_dog for share;
  select * into p from public.fitness_packages where id=target_package for update;
  select * into s from public.fitness_sessions where id=p_id for update;
  if s.id is null then raise exception 'Nie znaleziono spotkania.'; end if;
  payload:=jsonb_build_object('version',p_expected_version,'starts_at',p_starts_at,'location',v_location,'note',v_note);
  previous:=public.fitness_previous_result(p_request_id,p_id,'schedule',payload);
  if previous is not null then return previous; end if;
  if s.version<>p_expected_version then raise exception 'Spotkanie zmieniło się. Odśwież widok przed zapisem.'; end if;
  if p.status<>'active' or s.status not in ('pending','scheduled') then raise exception 'Termin ustalisz dla niezakończonego spotkania aktywnego pakietu.'; end if;
  if not exists(select 1 from public.dogs where id=p.dog_id and guardian_id=p.guardian_id) then raise exception 'Opiekun psa zmienił się. Uzgodnij nowe zgłoszenie.'; end if;
  if p_starts_at<=clock_timestamp() then raise exception 'Wybierz przyszły termin.'; end if;
  if s.status='scheduled' and length(v_note)<3 then raise exception 'Podaj powód zmiany terminu (co najmniej 3 znaki).'; end if;
  if exists(select 1 from public.fitness_sessions x where x.package_id=p.id and x.id<>s.id and x.status in ('scheduled','completed')
    and x.starts_at<p_starts_at+make_interval(mins=>s.duration_minutes)
    and x.starts_at+make_interval(mins=>x.duration_minutes)>p_starts_at) then
    raise exception 'Spotkania tego samego pakietu nie mogą się nakładać.';
  end if;
  prior_start:=s.starts_at;
  update public.fitness_sessions set status='scheduled',starts_at=p_starts_at,version=version+1,updated_by=auth.uid() where id=p_id returning * into s;
  insert into public.fitness_session_private_details(session_id,exact_location) values(p_id,v_location)
    on conflict(session_id) do update set exact_location=excluded.exact_location;
  update public.fitness_packages set version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p.id;
  insert into public.fitness_history(package_id,session_id,action,actor_id,note,details)
    values(p.id,s.id,case when prior_start is null then 'scheduled' else 'rescheduled' end,auth.uid(),v_note,
      jsonb_build_object('version',s.version,'starts_at',s.starts_at,'previous_starts_at',prior_start));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'fitness_session_saved',s.id,jsonb_build_object('version',s.version));
  perform public.fitness_record_result(p_request_id,p_id,p.id,'schedule',payload,s.version);
  return s.version;
end $$;
create or replace function public.change_fitness_session(p_id uuid,p_expected_version integer,p_action text,p_attendance text,p_note text,p_request_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.fitness_sessions; p public.fitness_packages; target_package uuid; target_dog uuid; payload jsonb; previous integer;
  v_note text:=trim(coalesce(p_note,'')); old_start timestamptz; old_attendance text;
begin
  lock table public.calendar_slots in row exclusive mode;
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_action is null or
    p_action not in ('cancel','complete','reopen','correct') or length(v_note)>3000 or
    (p_action in ('cancel','reopen','correct') and length(v_note)<3) or
    (p_action in ('complete','correct') and (p_attendance is null or p_attendance not in ('present','absent','excused'))) or
    (p_action not in ('complete','correct') and p_attendance is not null) then raise exception 'Sprawdź działanie, obecność i powód zmiany.'; end if;
  select package_id into target_package from public.fitness_sessions where id=p_id;
  select dog_id into target_dog from public.fitness_packages where id=target_package;
  perform 1 from public.dogs where id=target_dog for share;
  select * into p from public.fitness_packages where id=target_package for update;
  select * into s from public.fitness_sessions where id=p_id for update;
  if s.id is null then raise exception 'Nie znaleziono spotkania.'; end if;
  payload:=jsonb_build_object('version',p_expected_version,'action',p_action,'attendance',p_attendance,'note',v_note);
  previous:=public.fitness_previous_result(p_request_id,p_id,'session',payload);
  if previous is not null then return previous; end if;
  if s.version<>p_expected_version then raise exception 'Spotkanie zmieniło się. Odśwież widok przed zapisem.'; end if;
  if p.status<>'active' and not(p_action='correct' and p.status='completed') then raise exception 'Ten pakiet nie jest aktywny.'; end if;
  if not exists(select 1 from public.dogs where id=p.dog_id and guardian_id=p.guardian_id) then raise exception 'Opiekun psa zmienił się. Uzgodnij nowe zgłoszenie.'; end if;
  old_start:=s.starts_at; old_attendance:=s.attendance;
  if p_action='cancel' then
    if s.status<>'scheduled' then raise exception 'Odwołać można umówione spotkanie.'; end if;
    update public.fitness_sessions set status='pending',starts_at=null,attendance=null where id=p_id;
    delete from public.fitness_session_private_details where session_id=p_id;
  elsif p_action='complete' then
    if s.status<>'scheduled' or s.starts_at+make_interval(mins=>s.duration_minutes)>clock_timestamp() then raise exception 'Zakończ umówione spotkanie dopiero po jego zakończeniu.'; end if;
    update public.fitness_sessions set status='completed',attendance=p_attendance where id=p_id;
  elsif p_action='reopen' then
    if s.status<>'completed' then raise exception 'Przywrócić można zakończone spotkanie.'; end if;
    update public.fitness_sessions set status='pending',starts_at=null,attendance=null where id=p_id;
    delete from public.fitness_session_private_details where session_id=p_id;
  else
    if s.status<>'completed' or s.attendance=p_attendance then raise exception 'Wybierz inną obecność zakończonego spotkania.'; end if;
    update public.fitness_sessions set attendance=p_attendance where id=p_id;
  end if;
  update public.fitness_sessions set version=version+1,updated_by=auth.uid() where id=p_id returning * into s;
  update public.fitness_packages set version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p.id;
  insert into public.fitness_history(package_id,session_id,action,actor_id,note,details) values(p.id,s.id,p_action,auth.uid(),v_note,
    jsonb_build_object('version',s.version,'previous_starts_at',old_start,'starts_at',s.starts_at,'previous_attendance',old_attendance,'attendance',s.attendance));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'fitness_session_changed',s.id,jsonb_build_object('action',p_action,'version',s.version));
  perform public.fitness_record_result(p_request_id,p_id,p.id,'session',payload,s.version);
  return s.version;
end $$;
create or replace function public.change_fitness_package(p_id uuid,p_expected_version integer,p_action text,p_note text,p_request_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare p public.fitness_packages; d public.dogs; target_dog uuid; payload jsonb; previous integer;
  v_note text:=trim(coalesce(p_note,'')); next_status text;
begin
  lock table public.calendar_slots in row exclusive mode;
  if auth.uid() is null or p_action is null or p_action not in ('accept','reject','cancel','complete','resume','restore','reconsider') or
    p_expected_version is null or p_expected_version not between 1 and 2147483646 or length(v_note)>3000 or
    (p_action in ('reject','cancel','resume','restore','reconsider') and length(v_note)<3) then raise exception 'Sprawdź działanie, wersję i powód zmiany pakietu.'; end if;
  select dog_id into target_dog from public.fitness_packages where id=p_id;
  select * into d from public.dogs where id=target_dog for share;
  select * into p from public.fitness_packages where id=p_id for update;
  if p.id is null or not(public.is_admin() or (p_action='cancel' and p.guardian_id=auth.uid())) then raise exception 'Brak dostępu do pakietu.'; end if;
  payload:=jsonb_build_object('version',p_expected_version,'action',p_action,'note',v_note);
  previous:=public.fitness_previous_result(p_request_id,p_id,'package',payload);
  if previous is not null then return previous; end if;
  if p.version<>p_expected_version then raise exception 'Pakiet zmienił się. Odśwież widok przed zapisem.'; end if;
  if p_action in ('accept','resume','restore','reconsider') and
    (d.guardian_id is distinct from p.guardian_id or not exists(select 1 from public.user_roles where user_id=p.guardian_id and role='client')) then
    raise exception 'Opiekun psa zmienił się. Uzgodnij nowe zgłoszenie.';
  end if;
  case p_action
    when 'accept' then
      if p.status<>'requested' then raise exception 'Przyjąć można oczekujące zgłoszenie.'; end if;
      insert into public.fitness_sessions(package_id,ordinal,duration_minutes,updated_by)
        select p.id,n,p.duration_minutes,auth.uid() from generate_series(1,p.sessions_count) n;
      next_status:='active';
    when 'reject' then
      if p.status<>'requested' then raise exception 'Odrzucić można oczekujące zgłoszenie.'; end if;
      next_status:='rejected';
    when 'cancel' then
      if p.status not in ('requested','active') then raise exception 'Ten pakiet nie jest otwarty.'; end if;
      update public.fitness_sessions set status='cancelled',version=version+1,updated_by=auth.uid()
        where package_id=p.id and status in ('pending','scheduled');
      delete from public.fitness_session_private_details where session_id in(select id from public.fitness_sessions where package_id=p.id and status='cancelled');
      next_status:='cancelled';
    when 'complete' then
      if p.status<>'active' or (select count(*) from public.fitness_sessions where package_id=p.id and status='completed')<>p.sessions_count then
        raise exception 'Najpierw zakończ każde spotkanie pakietu.';
      end if;
      next_status:='completed';
    when 'resume' then
      if p.status<>'completed' then raise exception 'Wznowić można zakończony pakiet.'; end if;
      next_status:='active';
    when 'restore' then
      if p.status<>'cancelled' or p.accepted_at is null then raise exception 'Przywrócić można wcześniej przyjęty pakiet.'; end if;
      update public.fitness_sessions set status='pending',starts_at=null,attendance=null,version=version+1,updated_by=auth.uid()
        where package_id=p.id and status='cancelled';
      next_status:='active';
    else
      if p.status<>'rejected' and not(p.status='cancelled' and p.accepted_at is null) then raise exception 'Ponownie rozpatrzyć można odmowę lub rezygnację przed przyjęciem.'; end if;
      next_status:='requested';
  end case;
  update public.fitness_packages set status=next_status,
    charge_cents=case when p_action in ('accept','restore') then agreed_price_cents else charge_cents end,
    accepted_at=case when p_action='accept' then clock_timestamp() else accepted_at end,
    settled_at=case when p_action in ('cancel','restore','accept','reconsider') then null else settled_at end,
    settled_by=case when p_action in ('cancel','restore','accept','reconsider') then null else settled_by end,
    version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p.id returning * into p;
  insert into public.fitness_history(package_id,action,actor_id,note,details)
    values(p.id,p_action,auth.uid(),v_note,jsonb_build_object('version',p.version,'charge_cents',p.charge_cents));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'fitness_changed',p.id,jsonb_build_object('action',p_action,'version',p.version));
  perform public.fitness_record_result(p_request_id,p_id,p_id,'package',payload,p.version);
  return p.version;
exception when unique_violation then raise exception 'Ten pies ma już inne otwarte zgłoszenie lub aktywny pakiet fitness.';
end $$;

create function public.calendar_begin_write() returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  lock table public.calendar_slots in row exclusive mode;
end $$;
revoke all on function public.calendar_begin_write() from public,anon,authenticated;
grant execute on function public.calendar_begin_write() to authenticated;

-- A source course update rebuilds all its sessions. Consume a single-session
-- choice once, then take every staff scope in a deterministic order BEFORE
-- deleting/reinserting rows. Two courses with A/B and B/A leads cannot acquire
-- per-staff locks in opposite order. An unassigned batch takes the global
-- exclusive guard before taking any individual staff locks.
create or replace function public.sync_course_calendar(p_course uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target jsonb; i integer;
begin
  target:=nullif(current_setting('psi.calendar_assignment_target',true),'')::jsonb;
  if target->>'kind'='course' and exists(select 1 from public.course_sessions where id=(target->>'appointment_id')::uuid and course_id=p_course) then
    perform public.apply_calendar_assignment_context('course',(target->>'appointment_id')::uuid);
  end if;
  if exists(select 1 from public.calendar_assignments a join public.course_sessions s on s.id=a.course_session_id where s.course_id=p_course and a.assigned_staff_id is null) then
    perform pg_advisory_xact_lock(951441,0);
  else perform pg_advisory_xact_lock_shared(951441,0); end if;
  for i in select distinct n.slot_index from public.calendar_assignments a join public.course_sessions s on s.id=a.course_session_id join public.calendar_staff_indices n on n.staff_id=a.assigned_staff_id where s.course_id=p_course order by n.slot_index loop
    perform pg_advisory_xact_lock(951441,i);
  end loop;
  delete from public.calendar_slots where course_session_id in(select id from public.course_sessions where course_id=p_course);
  insert into public.calendar_slots(course_session_id,occupied)
    select s.id,tstzrange(s.starts_at,s.starts_at+make_interval(mins=>s.duration_minutes),'[)')
    from public.course_sessions s join public.courses c on c.id=s.course_id
    where c.id=p_course and ((c.status in ('open','closed') and s.status='scheduled')
      or (s.status='completed' and public.calendar_has_post_buffer(s.starts_at,s.duration_minutes))) order by s.starts_at,s.id;
exception when exclusion_violation then raise exception 'Termin kursu nakłada się na inne zajęcia lub blokadę. Sprawdź kalendarz.';
end $$;
