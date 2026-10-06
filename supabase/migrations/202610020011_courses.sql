-- Local course domain: one catalogue quote for an entire scheduled cycle.
-- Payment integration and browser panels follow separately; no automatic refund
-- policy is invented by these operations. A cancelled accepted enrollment keeps
-- its agreed charge for an explicit settlement by the team.
alter table public.services add column course_format text check(course_format in ('individual','group'));
alter table public.services add constraint service_course_format check(course_format is null or kind='course');
update public.services set course_format=case when source_url like '%-indywidualne' then 'individual' else 'group' end where kind='course';
create table public.courses (
  id uuid primary key,
  practice_id uuid not null references public.care_practices,
  service_id uuid not null references public.services,
  service_version integer not null check(service_version>0),
  service_name text not null,
  price_cents integer not null check(price_cents between 1 and 1000000),
  is_test_price boolean not null,
  sessions_count integer not null check(sessions_count between 1 and 100),
  duration_minutes integer not null check(duration_minutes between 15 and 480),
  course_format text not null check(course_format in ('individual','group')),
  title text not null check(length(trim(title)) between 3 and 160),
  public_location text not null check(length(trim(public_location)) between 3 and 300),
  capacity integer not null check(capacity between 1 and 50),
  status text not null default 'draft' check(status in ('draft','open','closed','completed','cancelled')),
  version integer not null default 1 check(version>0),
  created_by uuid not null references public.profiles,
  updated_by uuid not null references public.profiles,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(course_format<>'individual' or capacity=1)
);
create table public.course_creation_receipts (
  course_id uuid primary key references public.courses on delete cascade,
  author_id uuid not null references public.profiles,
  payload jsonb not null
);
create table public.course_private_details (
  course_id uuid primary key references public.courses on delete cascade,
  exact_location text not null check(length(trim(exact_location)) between 3 and 2000)
);
create table public.course_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses on delete cascade,
  ordinal integer not null check(ordinal between 1 and 100),
  starts_at timestamptz not null check(isfinite(starts_at)),
  duration_minutes integer not null check(duration_minutes between 15 and 480),
  public_location text not null check(length(trim(public_location)) between 3 and 300),
  status text not null default 'scheduled' check(status in ('scheduled','completed','cancelled')),
  version integer not null default 1 check(version>0),
  updated_by uuid not null references public.profiles,
  unique(course_id,ordinal)
);
create index course_sessions_time_idx on public.course_sessions(starts_at,course_id);
create table public.course_session_private_details (
  session_id uuid primary key references public.course_sessions on delete cascade,
  exact_location text not null check(length(trim(exact_location)) between 3 and 2000)
);
create table public.course_enrollments (
  id uuid primary key,
  course_id uuid not null references public.courses on delete cascade,
  dog_id uuid not null references public.dogs,
  guardian_id uuid not null references public.profiles,
  selected_course_version integer not null check(selected_course_version>0),
  status text not null default 'requested' check(status in ('requested','accepted','waitlisted','rejected','cancelled')),
  agreed_price_cents integer not null check(agreed_price_cents between 1 and 1000000),
  is_test_price boolean not null,
  charge_cents integer not null default 0 check(charge_cents between 0 and 1000000),
  version integer not null default 1 check(version>0),
  updated_by uuid not null references public.profiles,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(course_id,dog_id)
);
create index course_enrollments_guardian_idx on public.course_enrollments(guardian_id,course_id);
create table public.course_history (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses on delete cascade,
  session_id uuid references public.course_sessions on delete cascade,
  enrollment_id uuid references public.course_enrollments on delete cascade,
  action text not null,
  actor_id uuid not null references public.profiles,
  note text not null default '' check(length(note)<=3000),
  details jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index course_history_course_idx on public.course_history(course_id,created_at,id);
create table public.course_attendance (
  session_id uuid not null references public.course_sessions on delete cascade,
  enrollment_id uuid not null references public.course_enrollments on delete cascade,
  attendance text not null check(attendance in ('present','absent','excused')),
  version integer not null default 1 check(version>0),
  updated_by uuid not null references public.profiles,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(session_id,enrollment_id)
);

alter table public.courses enable row level security;
alter table public.course_creation_receipts enable row level security;
alter table public.course_private_details enable row level security;
alter table public.course_sessions enable row level security;
alter table public.course_session_private_details enable row level security;
alter table public.course_enrollments enable row level security;
alter table public.course_history enable row level security;
alter table public.course_attendance enable row level security;
create policy course_enrollments_read on public.course_enrollments for select to authenticated
  using((select public.is_admin()) or guardian_id=(select auth.uid()));
create policy courses_read on public.courses for select to authenticated using(
  (select public.is_admin()) or status='open' or exists(select 1 from public.course_enrollments e where e.course_id=courses.id));
create policy course_sessions_read on public.course_sessions for select to authenticated
  using(exists(select 1 from public.courses c where c.id=course_sessions.course_id));
create policy course_receipts_staff on public.course_creation_receipts for select to authenticated using((select public.is_admin()));
create policy course_private_read on public.course_private_details for select to authenticated using(
  (select public.is_admin()) or exists(select 1 from public.course_enrollments e where e.course_id=course_private_details.course_id and e.status='accepted' and e.guardian_id=(select auth.uid())));
create policy course_session_private_read on public.course_session_private_details for select to authenticated using(
  (select public.is_admin()) or exists(select 1 from public.course_sessions s join public.course_enrollments e on e.course_id=s.course_id
    where s.id=course_session_private_details.session_id and e.status='accepted' and e.guardian_id=(select auth.uid())));
-- Course-wide public changes are visible only for a visible course. Enrollment
-- and attendance history is limited to the enrollment's actual guardian.
create policy course_history_read on public.course_history for select to authenticated using(
  (select public.is_admin()) or ((enrollment_id is null and exists(select 1 from public.courses c where c.id=course_history.course_id))
    or exists(select 1 from public.course_enrollments e where e.id=course_history.enrollment_id and e.guardian_id=(select auth.uid()))));
create policy course_attendance_read on public.course_attendance for select to authenticated using(
  (select public.is_admin()) or exists(select 1 from public.course_enrollments e where e.id=course_attendance.enrollment_id and e.guardian_id=(select auth.uid())));
revoke all on public.courses,public.course_creation_receipts,public.course_private_details,
  public.course_sessions,public.course_session_private_details,public.course_enrollments,public.course_history,public.course_attendance from anon,authenticated;
grant select on public.courses,public.course_creation_receipts,public.course_private_details,
  public.course_sessions,public.course_session_private_details,public.course_enrollments,public.course_history,public.course_attendance to authenticated;

-- Reuse the calendar's global exclusion constraint across all appointment kinds.
alter table public.calendar_slots add column course_session_id uuid unique references public.course_sessions on delete cascade;
alter table public.calendar_slots drop constraint calendar_slots_check;
alter table public.calendar_slots add constraint calendar_single_source
  check(num_nonnulls(walk_id,consultation_id,block_id,course_session_id)=1);
create function public.sync_course_calendar(p_course uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  delete from public.calendar_slots where course_session_id in(select id from public.course_sessions where course_id=p_course);
  insert into public.calendar_slots(course_session_id,occupied)
    select s.id,tstzrange(s.starts_at,s.starts_at+make_interval(mins=>s.duration_minutes),'[)')
    from public.course_sessions s join public.courses c on c.id=s.course_id
    where c.id=p_course and c.status in ('open','closed') and s.status='scheduled' order by s.starts_at,s.id;
exception when exclusion_violation then
  raise exception 'Termin kursu nakłada się na inne zajęcia lub blokadę. Sprawdź kalendarz.';
end $$;
create function public.course_calendar_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='courses' then perform public.sync_course_calendar(new.id);
  else perform public.sync_course_calendar(new.course_id); end if;
  return null;
end $$;
create trigger course_calendar_changed after update of status on public.courses
  for each row execute function public.course_calendar_changed();
create trigger course_session_calendar_changed after insert or update of starts_at,duration_minutes,status on public.course_sessions
  for each row execute function public.course_calendar_changed();

create function public.create_course(p_id uuid,p_service uuid,p_expected_service_version integer,
  p_title text,p_capacity integer,p_public_location text,p_exact_location text,p_starts jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.services; receipt public.course_creation_receipts; payload jsonb;
  item jsonb; at timestamptz; previous_end timestamptz; ordinal integer:=0; session_id uuid;
begin
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

create function public.change_course(p_id uuid,p_expected_version integer,p_action text,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.courses; e public.course_enrollments; desired text; v_note text:=trim(coalesce(p_note,''));
begin
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

create function public.request_course_enrollment(p_id uuid,p_course uuid,p_dog uuid,p_expected_course_version integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.courses; e public.course_enrollments;
begin
  if auth.uid() is null or p_id is null or p_expected_course_version is null or p_expected_course_version<1 then raise exception 'Wybierz swojego psa i aktualny kurs.'; end if;
  perform 1 from public.dogs where id=p_dog and guardian_id=auth.uid() for share;
  if not found then raise exception 'Wybierz swojego psa i aktualny kurs.'; end if;
  select * into c from public.courses where id=p_course for update;
  if c.id is null then raise exception 'Nie znaleziono kursu.'; end if;
  select * into e from public.course_enrollments where id=p_id;
  if e.id is not null then
    if e.course_id=p_course and e.dog_id=p_dog and e.guardian_id=auth.uid() and e.selected_course_version=p_expected_course_version then return e.id; end if;
    raise exception 'Ten identyfikator zgłoszenia został już użyty. Odśwież formularz.';
  end if;
  if c.version<>p_expected_course_version then raise exception 'Kurs zmienił się. Odśwież widok przed zapisem.'; end if;
  if c.status<>'open' or exists(select 1 from public.course_sessions where course_id=p_course and starts_at<=clock_timestamp()) then
    raise exception 'Zapisy na ten kurs są zamknięte.';
  end if;
  if exists(select 1 from public.course_enrollments where course_id=p_course and dog_id=p_dog) then raise exception 'Ten pies ma już zgłoszenie na kurs.'; end if;
  insert into public.course_enrollments(id,course_id,dog_id,guardian_id,selected_course_version,agreed_price_cents,is_test_price,updated_by)
    values(p_id,c.id,p_dog,auth.uid(),c.version,c.price_cents,c.is_test_price,auth.uid());
  insert into public.course_history(course_id,enrollment_id,action,actor_id,details)
    values(c.id,p_id,'requested',auth.uid(),jsonb_build_object('version',1));
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'course_enrollment_requested',p_id);
  return p_id;
end $$;

create function public.change_course_enrollment(p_id uuid,p_expected_version integer,p_action text,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.courses; e public.course_enrollments; course uuid; v_note text:=trim(coalesce(p_note,'')); desired text;
begin
  if auth.uid() is null or p_expected_version is null or p_expected_version not between 1 and 2147483646 or
    p_action is null or p_action not in ('accept','waitlist','reject','cancel') or length(v_note)>3000 or
    (p_action in ('reject','cancel') and length(v_note)<3) then raise exception 'Sprawdź decyzję i podaj jej powód.'; end if;
  select course_id into course from public.course_enrollments where id=p_id;
  select * into c from public.courses where id=course for update;
  select * into e from public.course_enrollments where id=p_id for update;
  if e.id is null or not(public.is_admin() or (e.guardian_id=auth.uid() and p_action='cancel')) then raise exception 'Brak dostępu do zgłoszenia.'; end if;
  desired:=case p_action when 'accept' then 'accepted' when 'waitlist' then 'waitlisted' when 'reject' then 'rejected' else 'cancelled' end;
  if e.version=p_expected_version+1 and e.updated_by=auth.uid() and e.status=desired and
    exists(select 1 from public.course_history h where h.enrollment_id=p_id and h.action=p_action and h.note=v_note and h.details->>'version'=e.version::text) then return e.version; end if;
  if e.version<>p_expected_version then raise exception 'Zgłoszenie zmieniło się. Odśwież widok przed zapisem.'; end if;
  if c.status in ('draft','cancelled','completed') or e.status in ('rejected','cancelled') or
    (p_action<>'cancel' and (e.status not in ('requested','waitlisted') or
      exists(select 1 from public.course_sessions where course_id=c.id and starts_at<=clock_timestamp()))) then
    raise exception 'Ta zmiana zgłoszenia nie jest dostępna.';
  end if;
  if p_action='accept' and (select count(*) from public.course_enrollments where course_id=c.id and status='accepted')>=c.capacity then
    raise exception 'Brak wolnych miejsc na kursie.';
  end if;
  update public.course_enrollments set status=desired,charge_cents=case when p_action='accept' then agreed_price_cents else charge_cents end,
    version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into e;
  insert into public.course_history(course_id,enrollment_id,action,actor_id,note,details)
    values(c.id,p_id,p_action,auth.uid(),v_note,jsonb_build_object('version',e.version,'charge_cents',e.charge_cents));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'course_enrollment_changed',p_id,jsonb_build_object('action',p_action));
  return e.version;
end $$;

create function public.reschedule_course_session(p_id uuid,p_expected_version integer,p_starts_at timestamptz,p_note text,p_public_location text default null,p_exact_location text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.courses; s public.course_sessions; course uuid; v_note text:=trim(coalesce(p_note,'')); public_place text; private_place text;
begin
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

create function public.record_course_attendance(p_session uuid,p_enrollment uuid,p_expected_version integer,p_attendance text)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.courses; s public.course_sessions; e public.course_enrollments; a public.course_attendance; course uuid; result integer;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version not between 0 and 2147483646 or
    p_attendance is null or p_attendance not in ('present','absent','excused') then raise exception 'Wybierz obecność na spotkaniu.'; end if;
  select course_id into course from public.course_sessions where id=p_session;
  select * into c from public.courses where id=course for update;
  select * into s from public.course_sessions where id=p_session for update;
  select * into e from public.course_enrollments where id=p_enrollment for update;
  if c.id is null or e.id is null or e.course_id<>course then raise exception 'Wybierz uczestnika tego kursu.'; end if;
  select * into a from public.course_attendance where session_id=p_session and enrollment_id=p_enrollment for update;
  if a.version=p_expected_version+1 and a.updated_by=auth.uid() and a.attendance=p_attendance then return a.version; end if;
  if coalesce(a.version,0)<>p_expected_version then raise exception 'Obecność zmieniła się. Odśwież widok przed zapisem.'; end if;
  if c.status not in ('open','closed') or e.status<>'accepted' or s.status<>'scheduled' or s.starts_at>clock_timestamp() then
    raise exception 'Obecność zapisz po rozpoczęciu spotkania dla przyjętego uczestnika.';
  end if;
  insert into public.course_attendance(session_id,enrollment_id,attendance,version,updated_by)
    values(p_session,p_enrollment,p_attendance,p_expected_version+1,auth.uid())
    on conflict(session_id,enrollment_id) do update set attendance=excluded.attendance,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp()
    returning version into result;
  insert into public.course_history(course_id,session_id,enrollment_id,action,actor_id,details)
    values(course,p_session,p_enrollment,'attendance',auth.uid(),jsonb_build_object('version',result,'attendance',p_attendance));
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'course_attendance_recorded',p_enrollment);
  return result;
end $$;

create function public.change_course_session(p_id uuid,p_expected_version integer,p_action text,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.courses; s public.course_sessions; course uuid; v_note text:=trim(coalesce(p_note,'')); desired text;
begin
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

revoke all on function public.sync_course_calendar(uuid),public.course_calendar_changed(),
  public.create_course(uuid,uuid,integer,text,integer,text,text,jsonb),public.change_course(uuid,integer,text,text),
  public.request_course_enrollment(uuid,uuid,uuid,integer),public.change_course_enrollment(uuid,integer,text,text),
  public.reschedule_course_session(uuid,integer,timestamptz,text,text,text),public.record_course_attendance(uuid,uuid,integer,text),
  public.change_course_session(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.create_course(uuid,uuid,integer,text,integer,text,text,jsonb),public.change_course(uuid,integer,text,text),
  public.request_course_enrollment(uuid,uuid,uuid,integer),public.change_course_enrollment(uuid,integer,text,text),
  public.reschedule_course_session(uuid,integer,timestamptz,text,text,text),public.record_course_attendance(uuid,uuid,integer,text),
  public.change_course_session(uuid,integer,text,text) to authenticated;
