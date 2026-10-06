-- Fitness is an individual entitlement with flexible appointment dates, not a
-- group course or a walk-entry package. Its quote covers the whole entitlement.
alter table public.services drop constraint services_booking_flow_check;
alter table public.services add constraint services_booking_flow_check check(booking_flow in ('consultation','walk','catalogue','fitness'));
alter table public.services add constraint service_fitness_terms check(booking_flow<>'fitness' or
  (kind='package' and meeting_mode is not distinct from 'in_person' and sessions_count is not null and duration_minutes is not null));
update public.services set booking_flow='fitness',version=version+1,updated_at=clock_timestamp()
  where id='60000000-0000-4000-8000-000000000006' and kind='package' and booking_flow='catalogue';
insert into public.service_revisions(service_id,version,name,price_cents,price_unit,active,is_test_price)
  select id,version,name,price_cents,price_unit,active,is_test_price from public.services where booking_flow='fitness';

create table public.fitness_packages (
  id uuid primary key,
  practice_id uuid not null references public.care_practices,
  dog_id uuid not null references public.dogs,
  guardian_id uuid not null references public.profiles,
  service_id uuid not null references public.services,
  service_version integer not null check(service_version>0),
  service_name text not null,
  sessions_count integer not null check(sessions_count between 1 and 100),
  duration_minutes integer not null check(duration_minutes between 15 and 480),
  agreed_price_cents integer not null check(agreed_price_cents between 1 and 1000000),
  is_test_price boolean not null,
  topic text not null check(length(trim(topic)) between 3 and 3000),
  availability text not null default '' check(length(availability)<=1000),
  status text not null default 'requested' check(status in ('requested','active','completed','cancelled','rejected')),
  charge_cents integer not null default 0 check(charge_cents between 0 and 1000000),
  accepted_at timestamptz,
  settled_at timestamptz,
  settled_by uuid references public.profiles,
  version integer not null default 1 check(version>0),
  updated_by uuid not null references public.profiles,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(charge_cents<=agreed_price_cents),
  check((settled_at is null)=(settled_by is null)),
  check(status not in ('active','completed') or accepted_at is not null)
);
create unique index fitness_one_open_dog on public.fitness_packages(dog_id) where status in ('requested','active');
create index fitness_guardian_created on public.fitness_packages(guardian_id,created_at desc,id);
create table public.fitness_sessions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.fitness_packages on delete cascade,
  ordinal integer not null check(ordinal between 1 and 100),
  status text not null default 'pending' check(status in ('pending','scheduled','completed','cancelled')),
  starts_at timestamptz check(starts_at is null or isfinite(starts_at)),
  duration_minutes integer not null check(duration_minutes between 15 and 480),
  attendance text check(attendance in ('present','absent','excused')),
  version integer not null default 1 check(version>0),
  updated_by uuid not null references public.profiles,
  unique(package_id,ordinal),
  unique(id,package_id),
  check(status not in ('scheduled','completed') or starts_at is not null),
  check((status='completed')=(attendance is not null))
);
create index fitness_session_time on public.fitness_sessions(starts_at,package_id) where starts_at is not null;
create table public.fitness_session_private_details (
  session_id uuid primary key references public.fitness_sessions on delete cascade,
  exact_location text not null check(length(trim(exact_location)) between 3 and 2000)
);
create table public.fitness_history (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.fitness_packages on delete cascade,
  session_id uuid,
  action text not null,
  actor_id uuid not null references public.profiles,
  note text not null default '' check(length(note)<=3000),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(session_id,package_id) references public.fitness_sessions(id,package_id) on delete cascade
);
create index fitness_history_package on public.fitness_history(package_id,created_at desc,id);
create table public.fitness_receipts (
  id uuid primary key,
  entity_id uuid not null,
  package_id uuid not null references public.fitness_packages on delete cascade,
  actor_id uuid not null references public.profiles,
  kind text not null,
  payload jsonb not null,
  result_version integer not null check(result_version>0)
);
alter table public.fitness_packages enable row level security;
alter table public.fitness_sessions enable row level security;
alter table public.fitness_session_private_details enable row level security;
alter table public.fitness_history enable row level security;
alter table public.fitness_receipts enable row level security;
create policy fitness_packages_read on public.fitness_packages for select to authenticated
  using((select public.is_admin()) or guardian_id=(select auth.uid()));
create policy fitness_sessions_read on public.fitness_sessions for select to authenticated
  using(exists(select 1 from public.fitness_packages p where p.id=fitness_sessions.package_id));
create policy fitness_history_read on public.fitness_history for select to authenticated
  using(exists(select 1 from public.fitness_packages p where p.id=fitness_history.package_id));
create policy fitness_receipts_staff on public.fitness_receipts for select to authenticated using((select public.is_admin()));
create policy fitness_location_read on public.fitness_session_private_details for select to authenticated using(
  (select public.is_admin()) or exists(select 1 from public.fitness_sessions s join public.fitness_packages p on p.id=s.package_id
    where s.id=fitness_session_private_details.session_id and s.status in ('scheduled','completed')
      and p.status in ('active','completed') and p.guardian_id=(select auth.uid()) and public.owns_dog(p.dog_id)));
revoke all on public.fitness_packages,public.fitness_sessions,public.fitness_session_private_details,public.fitness_history,public.fitness_receipts from public,anon,authenticated;
grant select on public.fitness_packages,public.fitness_sessions,public.fitness_session_private_details,public.fitness_history,public.fitness_receipts to authenticated;

-- These helpers are private. The parent record is locked before the receipt key
-- in every operation; exact retries retain the original author and result.
create function public.fitness_previous_result(p_id uuid,p_entity uuid,p_kind text,p_payload jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare r public.fitness_receipts;
begin
  if p_id is null then raise exception 'Brak identyfikatora zapisu. Odśwież formularz.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fitness-receipt:'||p_id::text,0));
  select * into r from public.fitness_receipts where id=p_id;
  if r.id is null then return null; end if;
  if r.entity_id=p_entity and r.kind=p_kind and r.actor_id=auth.uid() and r.payload=p_payload then return r.result_version; end if;
  raise exception 'Ten zapis został już użyty dla innych danych. Odśwież widok.';
end $$;
create function public.fitness_record_result(p_id uuid,p_entity uuid,p_package uuid,p_kind text,p_payload jsonb,p_result integer)
returns void language sql security definer set search_path='' as $$
  insert into public.fitness_receipts(id,entity_id,package_id,actor_id,kind,payload,result_version)
    values(p_id,p_entity,p_package,auth.uid(),p_kind,p_payload,p_result);
$$;
revoke all on function public.fitness_previous_result(uuid,uuid,text,jsonb),public.fitness_record_result(uuid,uuid,uuid,text,jsonb,integer) from public,anon,authenticated;

create function public.request_fitness_package(p_id uuid,p_dog uuid,p_service uuid,p_expected_service_version integer,p_topic text,p_availability text)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.fitness_packages; s public.services;
begin
  if auth.uid() is null or not exists(select 1 from public.user_roles where user_id=auth.uid() and role='client') then raise exception 'Zgłoszenie wymaga konta opiekuna.'; end if;
  if p_id is null or p_expected_service_version is null or p_expected_service_version<1 or p_topic is null
    or length(trim(p_topic)) not between 3 and 3000 or p_availability is null or length(trim(p_availability))>1000 then
    raise exception 'Opisz cel spotkań i wybierz aktualny pakiet.';
  end if;
  perform 1 from public.dogs where id=p_dog and guardian_id=auth.uid() for share;
  if not found then raise exception 'Wybierz swojego psa.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fitness-request:'||p_id::text,0));
  select * into p from public.fitness_packages where id=p_id;
  if p.id is not null then
    if p.dog_id=p_dog and p.guardian_id=auth.uid() and p.service_id=p_service and p.service_version=p_expected_service_version
      and p.topic=trim(p_topic) and p.availability=trim(p_availability) then return p.id; end if;
    raise exception 'Ten identyfikator zgłoszenia został już użyty. Odśwież formularz.';
  end if;
  select * into s from public.services where id=p_service for share;
  if s.id is null or not s.active or s.booking_flow<>'fitness' then raise exception 'Ten pakiet nie jest dostępny do zgłoszenia.'; end if;
  if s.version<>p_expected_service_version then raise exception 'Oferta zmieniła się. Odśwież formularz i sprawdź cenę.'; end if;
  insert into public.fitness_packages(id,practice_id,dog_id,guardian_id,service_id,service_version,service_name,sessions_count,duration_minutes,
    agreed_price_cents,is_test_price,topic,availability,updated_by)
    values(p_id,s.practice_id,p_dog,auth.uid(),s.id,s.version,s.name,s.sessions_count,s.duration_minutes,s.price_cents,s.is_test_price,trim(p_topic),trim(p_availability),auth.uid());
  insert into public.fitness_history(package_id,action,actor_id) values(p_id,'requested',auth.uid());
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'fitness_requested',p_id);
  return p_id;
exception when unique_violation then raise exception 'Ten pies ma już otwarte zgłoszenie lub aktywny pakiet fitness.';
end $$;

create function public.change_fitness_package(p_id uuid,p_expected_version integer,p_action text,p_note text,p_request_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare p public.fitness_packages; d public.dogs; target_dog uuid; payload jsonb; previous integer;
  v_note text:=trim(coalesce(p_note,'')); next_status text;
begin
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

-- A session occupies the same exclusion-protected calendar as all other kinds.
alter table public.calendar_slots add column fitness_session_id uuid unique references public.fitness_sessions on delete cascade;
alter table public.calendar_slots drop constraint calendar_single_source;
alter table public.calendar_slots add constraint calendar_single_source check(num_nonnulls(walk_id,consultation_id,block_id,course_session_id,fitness_session_id)=1);
create function public.sync_fitness_calendar() returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.calendar_slots where fitness_session_id=new.id;
  if new.status='scheduled' then
    insert into public.calendar_slots(fitness_session_id,occupied)
      values(new.id,tstzrange(new.starts_at,new.starts_at+make_interval(mins=>new.duration_minutes),'[)'));
  end if;
  return null;
exception when exclusion_violation then raise exception 'Ten czas jest już zajęty. Sprawdź wspólny kalendarz.';
end $$;
revoke all on function public.sync_fitness_calendar() from public,anon,authenticated;
create trigger fitness_calendar_slot after insert or update of starts_at,duration_minutes,status on public.fitness_sessions
  for each row execute function public.sync_fitness_calendar();

create function public.save_fitness_session(p_id uuid,p_expected_version integer,p_starts_at timestamptz,p_location text,p_note text,p_request_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.fitness_sessions; p public.fitness_packages; target_package uuid; target_dog uuid; payload jsonb; previous integer;
  v_location text:=trim(p_location); v_note text:=trim(coalesce(p_note,'')); prior_start timestamptz;
begin
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

create function public.change_fitness_session(p_id uuid,p_expected_version integer,p_action text,p_attendance text,p_note text,p_request_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.fitness_sessions; p public.fitness_packages; target_package uuid; target_dog uuid; payload jsonb; previous integer;
  v_note text:=trim(coalesce(p_note,'')); old_start timestamptz; old_attendance text;
begin
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

alter table public.payments add column fitness_package_id uuid references public.fitness_packages;
alter table public.payments add constraint fitness_payment_pair unique(id,fitness_package_id);
create index payment_fitness_package on public.payments(fitness_package_id) where fitness_package_id is not null;
alter table public.payments drop constraint payment_single_target;
alter table public.payments add constraint payment_single_target check(num_nonnulls(registration_id,package_id,consultation_id,course_enrollment_id,fitness_package_id)=1) not valid;
create table public.fitness_payment_refunds (
  id uuid primary key,
  payment_id uuid not null,
  package_id uuid not null references public.fitness_packages,
  guardian_id uuid not null references public.profiles,
  author_id uuid not null references public.profiles,
  amount_cents integer not null check(amount_cents between 1 and 1000000),
  note text not null check(length(trim(note)) between 3 and 2000),
  package_version integer not null check(package_version>0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(payment_id,package_id) references public.payments(id,fitness_package_id) on delete cascade
);
create index fitness_refunds_package on public.fitness_payment_refunds(package_id);
create index fitness_refunds_payment on public.fitness_payment_refunds(payment_id);
alter table public.fitness_payment_refunds enable row level security;
create policy fitness_refunds_read on public.fitness_payment_refunds for select to authenticated using((select public.is_admin()) or guardian_id=(select auth.uid()));
revoke all on public.fitness_payment_refunds from public,anon,authenticated;
grant select on public.fitness_payment_refunds to authenticated;

create function public.record_fitness_payment(p_package uuid,p_amount_cents integer,p_method text,p_note text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.fitness_packages; existing public.payments; paid bigint; inserted uuid; v_note text:=trim(coalesce(p_note,''));
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_package is null or p_request_id is null or p_amount_cents is null or p_amount_cents not between 1 and 1000000 or
    p_method is null or p_method not in ('cash','transfer','card','other') or length(v_note)>2000 then raise exception 'Sprawdź kwotę i metodę wpłaty.'; end if;
  select * into p from public.fitness_packages where id=p_package for update;
  if p.id is null then raise exception 'Nie znaleziono pakietu.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fitness-payment:'||p_request_id::text,0));
  select * into existing from public.payments where request_id=p_request_id;
  if existing.id is not null then
    if existing.fitness_package_id=p_package and existing.author_id=auth.uid() and existing.amount_cents=p_amount_cents
      and existing.method=p_method and coalesce(existing.note,'')=v_note then return existing.id; end if;
    raise exception 'Ten identyfikator wpłaty został już użyty dla innych danych.';
  end if;
  if p.status not in ('active','completed') and not(p.status='cancelled' and p.settled_at is not null) then raise exception 'Najpierw przyjmij pakiet lub uzgodnij należność po rezygnacji.'; end if;
  select coalesce(sum(payment.amount_cents-(select coalesce(sum(r.amount_cents),0) from public.fitness_payment_refunds r where r.payment_id=payment.id)),0)
    into paid from public.payments payment where fitness_package_id=p.id and status='paid';
  if paid+p_amount_cents>p.charge_cents then raise exception 'Wpłata przekracza pozostałą kwotę do zapłaty.'; end if;
  insert into public.payments(guardian_id,dog_id,fitness_package_id,amount_cents,method,status,paid_at,note,author_id,request_id)
    values(p.guardian_id,p.dog_id,p.id,p_amount_cents,p_method,'paid',clock_timestamp(),v_note,auth.uid(),p_request_id)
    on conflict(request_id) do nothing returning id into inserted;
  if inserted is null then raise exception 'Ten identyfikator wpłaty został już użyty dla innych danych.'; end if;
  update public.fitness_packages set version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p.id;
  insert into public.fitness_history(package_id,action,actor_id,note,details) values(p.id,'payment_recorded',auth.uid(),v_note,jsonb_build_object('payment_id',inserted,'amount_cents',p_amount_cents));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'payment_recorded',inserted,jsonb_build_object('fitness_package_id',p.id,'amount_cents',p_amount_cents));
  return inserted;
end $$;

create function public.refund_fitness_payment(p_payment uuid,p_amount_cents integer,p_note text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.fitness_packages; payment public.payments; r public.fitness_payment_refunds; target uuid; refunded bigint; v_note text:=trim(p_note);
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_payment is null or p_request_id is null or p_amount_cents is null or p_amount_cents not between 1 and 1000000 or v_note is null or length(v_note) not between 3 and 2000 then
    raise exception 'Podaj kwotę i powód zwrotu (3–2000 znaków).';
  end if;
  select fitness_package_id into target from public.payments where id=p_payment;
  select * into p from public.fitness_packages where id=target for update;
  select * into payment from public.payments where id=p_payment for update;
  if p.id is null or payment.id is null then raise exception 'Nie znaleziono wpłaty za pakiet fitness.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fitness-refund:'||p_request_id::text,0));
  select * into r from public.fitness_payment_refunds where id=p_request_id;
  if r.id is not null then
    if r.payment_id=p_payment and r.author_id=auth.uid() and r.amount_cents=p_amount_cents and r.note=v_note then return r.id; end if;
    raise exception 'Ten identyfikator zwrotu został już użyty dla innych danych.';
  end if;
  if payment.status<>'paid' then raise exception 'Można zwrócić wyłącznie zaksięgowaną wpłatę.'; end if;
  select coalesce(sum(amount_cents),0) into refunded from public.fitness_payment_refunds where payment_id=p_payment;
  if refunded+p_amount_cents>payment.amount_cents then raise exception 'Zwrot przekracza pozostałą kwotę wpłaty.'; end if;
  insert into public.fitness_payment_refunds(id,payment_id,package_id,guardian_id,author_id,amount_cents,note,package_version)
    values(p_request_id,p_payment,p.id,p.guardian_id,auth.uid(),p_amount_cents,v_note,p.version+1);
  if refunded+p_amount_cents=payment.amount_cents then
    update public.payments set status='refunded',refunded_at=clock_timestamp(),refunded_by=auth.uid(),refund_note=v_note where id=p_payment;
  end if;
  update public.fitness_packages set version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p.id;
  insert into public.fitness_history(package_id,action,actor_id,note,details) values(p.id,'payment_refunded',auth.uid(),v_note,jsonb_build_object('payment_id',p_payment,'refund_id',p_request_id,'amount_cents',p_amount_cents));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'payment_refunded',p_payment,jsonb_build_object('fitness_package_id',p.id,'refund_id',p_request_id,'amount_cents',p_amount_cents));
  return p_request_id;
end $$;

create function public.settle_fitness_package(p_id uuid,p_expected_version integer,p_amount_cents integer,p_note text,p_request_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare p public.fitness_packages; payload jsonb; previous integer; v_note text:=trim(p_note);
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_amount_cents is null or
    p_amount_cents not between 0 and 1000000 or v_note is null or length(v_note) not between 3 and 3000 then raise exception 'Podaj uzgodnioną należność i powód zmiany.'; end if;
  select * into p from public.fitness_packages where id=p_id for update;
  if p.id is null then raise exception 'Nie znaleziono pakietu.'; end if;
  payload:=jsonb_build_object('version',p_expected_version,'amount_cents',p_amount_cents,'note',v_note);
  previous:=public.fitness_previous_result(p_request_id,p_id,'settlement',payload);
  if previous is not null then return previous; end if;
  if p.version<>p_expected_version then raise exception 'Pakiet zmienił się. Odśwież widok przed zapisem.'; end if;
  if p.status<>'cancelled' then raise exception 'Uzgodnienie dotyczy rezygnacji z pakietu.'; end if;
  if p_amount_cents>p.agreed_price_cents or (p.accepted_at is null and p_amount_cents>0) then raise exception 'Należność nie może przekroczyć ceny wcześniej przyjętego pakietu.'; end if;
  update public.fitness_packages set charge_cents=p_amount_cents,settled_at=clock_timestamp(),settled_by=auth.uid(),version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
    where id=p.id returning * into p;
  insert into public.fitness_history(package_id,action,actor_id,note,details) values(p.id,'settled',auth.uid(),v_note,jsonb_build_object('version',p.version,'charge_cents',p_amount_cents));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'fitness_settled',p.id,jsonb_build_object('version',p.version,'charge_cents',p_amount_cents));
  perform public.fitness_record_result(p_request_id,p_id,p_id,'settlement',payload,p.version);
  return p.version;
end $$;

create view public.fitness_balances with(security_invoker=true) as
select f.id,f.dog_id,f.guardian_id,f.service_name,f.status,f.version,f.created_at,f.agreed_price_cents,f.charge_cents,f.is_test_price,
  f.sessions_count,f.duration_minutes,f.settled_at,p.paid_cents,r.refunded_cents,s.completed_sessions,s.next_starts_at,
  case when review.needs_settlement then 0 else greatest(f.charge_cents-p.paid_cents,0) end as due_cents,
  greatest(p.paid_cents-f.charge_cents,0) as refund_due_cents,review.needs_settlement,
  (review.needs_settlement or p.paid_cents>f.charge_cents) as needs_review,
  ((f.status in ('active','completed') or (f.status='cancelled' and f.settled_at is not null)) and f.charge_cents>p.paid_cents) as can_pay
from public.fitness_packages f
cross join lateral(select coalesce(sum(payment.amount_cents-(select coalesce(sum(refund.amount_cents),0)
  from public.fitness_payment_refunds refund where refund.payment_id=payment.id)),0)::integer as paid_cents
  from public.payments payment where payment.fitness_package_id=f.id and payment.status='paid') p
cross join lateral(select coalesce(sum(amount_cents),0)::integer as refunded_cents from public.fitness_payment_refunds where package_id=f.id) r
cross join lateral(select count(*) filter(where status='completed')::integer as completed_sessions,min(starts_at) filter(where status='scheduled') as next_starts_at
  from public.fitness_sessions where package_id=f.id) s
cross join lateral(select (f.status='cancelled' and f.settled_at is null and (f.charge_cents>0 or p.paid_cents>0)) as needs_settlement) review;
revoke all on public.fitness_balances from public,anon,authenticated;
grant select on public.fitness_balances to authenticated;

-- Keep older callers intact. Fitness refunds always go through their immutable
-- partial-refund ledger, including a full void from the shared finance panel.
alter function public.void_payment(uuid,text) rename to void_nonfitness_payment;
revoke all on function public.void_nonfitness_payment(uuid,text) from public,anon,authenticated;
create function public.void_payment(p_payment uuid,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; p public.payments; remaining integer;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_note is null or length(trim(p_note)) not between 3 and 2000 then raise exception 'Podaj powód korekty lub zwrotu wpłaty (3–2000 znaków).'; end if;
  select fitness_package_id into target from public.payments where id=p_payment;
  if target is null then return public.void_nonfitness_payment(p_payment,p_note); end if;
  perform 1 from public.fitness_packages where id=target for update;
  select * into p from public.payments where id=p_payment for update;
  if p.status='refunded' then return p.id; end if;
  select p.amount_cents-coalesce(sum(amount_cents),0)::integer into remaining from public.fitness_payment_refunds where payment_id=p_payment;
  perform public.refund_fitness_payment(p_payment,remaining,p_note,gen_random_uuid());
  return p_payment;
end $$;

revoke all on function public.request_fitness_package(uuid,uuid,uuid,integer,text,text),
  public.change_fitness_package(uuid,integer,text,text,uuid),public.save_fitness_session(uuid,integer,timestamptz,text,text,uuid),
  public.change_fitness_session(uuid,integer,text,text,text,uuid),public.record_fitness_payment(uuid,integer,text,text,uuid),
  public.refund_fitness_payment(uuid,integer,text,uuid),public.settle_fitness_package(uuid,integer,integer,text,uuid),public.void_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.request_fitness_package(uuid,uuid,uuid,integer,text,text),
  public.change_fitness_package(uuid,integer,text,text,uuid),public.save_fitness_session(uuid,integer,timestamptz,text,text,uuid),
  public.change_fitness_session(uuid,integer,text,text,text,uuid),public.record_fitness_payment(uuid,integer,text,text,uuid),
  public.refund_fitness_payment(uuid,integer,text,uuid),public.settle_fitness_package(uuid,integer,integer,text,uuid),public.void_payment(uuid,text) to authenticated;

-- Keep the existing read API and its invoker privileges. A course appointment
-- links to the cycle; starts_at distinguishes its multiple meetings in the UI.
create or replace function public.calendar_appointments(p_from timestamptz,p_to timestamptz)
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
