-- Settings never reprice the cycle or its already accepted enrollments.
create table public.course_settings_receipts (
  id uuid primary key,
  course_id uuid not null references public.courses on delete cascade,
  actor_id uuid not null references public.profiles,
  payload jsonb not null,
  result_version integer not null check(result_version>0)
);
alter table public.course_settings_receipts enable row level security;
create policy course_settings_receipts_staff on public.course_settings_receipts for select to authenticated using((select public.is_admin()));
revoke all on public.course_settings_receipts from anon,authenticated;
grant select on public.course_settings_receipts to authenticated;

create function public.edit_course(p_id uuid,p_expected_version integer,p_title text,p_capacity integer,p_note text,p_request_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.courses; receipt public.course_settings_receipts; payload jsonb;
  v_title text:=trim(p_title); v_note text:=trim(p_note);
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_request_id is null or p_expected_version is null or p_expected_version not between 1 and 2147483646 or
    v_title is null or length(v_title) not between 3 and 160 or p_capacity is null or p_capacity not between 1 and 50 or
    v_note is null or length(v_note) not between 3 and 3000 then raise exception 'Sprawdź nazwę, liczbę miejsc i powód zmiany kursu.'; end if;
  payload:=jsonb_build_object('version',p_expected_version,'title',v_title,'capacity',p_capacity,'note',v_note);
  select * into c from public.courses where id=p_id for update;
  if c.id is null then raise exception 'Nie znaleziono kursu.'; end if;
  -- A receipt key is global. Serialize its reuse even across different courses.
  perform pg_advisory_xact_lock(hashtextextended('course-settings:'||p_request_id::text,0));
  select * into receipt from public.course_settings_receipts where id=p_request_id;
  if receipt.id is not null then
    if receipt.course_id=p_id and receipt.actor_id=auth.uid() and receipt.payload=payload then return receipt.result_version; end if;
    raise exception 'Ten zapis ustawień został już użyty. Odśwież widok przed kolejną zmianą.';
  end if;
  if c.version<>p_expected_version then raise exception 'Kurs zmienił się. Odśwież widok przed zapisem.'; end if;
  if c.status not in ('draft','open','closed') then raise exception 'Ustawienia zmienisz tylko w szkicu lub trwającym kursie.'; end if;
  if c.course_format='individual' and p_capacity<>1 then raise exception 'Kurs indywidualny ma miejsce dla jednego psa z opiekunem.'; end if;
  if p_capacity<(select count(*) from public.course_enrollments where course_id=p_id and status='accepted') then
    raise exception 'Liczba miejsc nie może być mniejsza od liczby przyjętych psów.';
  end if;
  if c.title is distinct from v_title or c.capacity is distinct from p_capacity then
    update public.courses set title=v_title,capacity=p_capacity,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=p_id;
    insert into public.course_history(course_id,action,actor_id,note,details) values(p_id,'settings',auth.uid(),v_note,
      jsonb_build_object('version',c.version+1,'previous_title',c.title,'title',v_title,'previous_capacity',c.capacity,'capacity',p_capacity));
    insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'course_settings_changed',p_id,jsonb_build_object('version',c.version+1));
    c.version:=c.version+1;
  end if;
  insert into public.course_settings_receipts values(p_request_id,p_id,auth.uid(),payload,c.version);
  return c.version;
end $$;
revoke all on function public.edit_course(uuid,integer,text,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.edit_course(uuid,integer,text,integer,text,uuid) to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
  'plan_published','progress_submitted','progress_reviewed',
  'consultation_requested','consultation_scheduled','consultation_rescheduled','consultation_cancelled','consultation_completed','consultation_price_agreed',
  'walk_changed','walk_cancelled','registration_created','registration_changed','registration_cancelled','walk_invitation',
  'payment_recorded','payment_refunded','follow_up_changed','consultation_reminder','walk_reminder','follow_up_reminder',
  'course_enrollment_requested','course_enrollment_accepted','course_enrollment_waitlisted','course_enrollment_rejected','course_enrollment_cancelled',
  'course_cancelled','course_completed','course_session_rescheduled','course_session_cancelled','course_session_completed',
  'course_attendance_recorded','course_settled','course_payment_recorded','course_payment_refunded','course_reminder','course_updated'
));
create function public.notify_course_settings() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.course_enrollments;
begin
  for e in select * from public.course_enrollments where course_id=new.course_id and status in ('requested','accepted','waitlisted') order by guardian_id,id loop
    perform public.add_course_notification(e.guardian_id,new.actor_id,e.id,null,'course_updated','course:'||new.id||':'||e.id);
  end loop;
  return new;
end $$;
create trigger notify_course_settings after insert on public.course_history for each row when(new.action='settings') execute function public.notify_course_settings();
revoke all on function public.notify_course_settings() from public,anon,authenticated;

-- Corrections retain the earlier value, reason and author. The original
-- four-argument recording entry point remains limited to a running meeting.
create table public.course_attendance_corrections (
  session_id uuid not null references public.course_sessions on delete cascade,
  enrollment_id uuid not null references public.course_enrollments on delete cascade,
  source_version integer not null check(source_version>0),
  result_version integer not null check(result_version=source_version+1),
  previous_attendance text not null check(previous_attendance in ('present','absent','excused')),
  attendance text not null check(attendance in ('present','absent','excused') and attendance<>previous_attendance),
  note text not null check(length(trim(note)) between 3 and 3000),
  actor_id uuid not null references public.profiles,
  created_at timestamptz not null default clock_timestamp(),
  primary key(session_id,enrollment_id,source_version)
);
alter table public.course_attendance_corrections enable row level security;
create policy course_attendance_corrections_read on public.course_attendance_corrections for select to authenticated using(
  (select public.is_admin()) or exists(select 1 from public.course_enrollments e where e.id=enrollment_id and e.guardian_id=(select auth.uid())));
revoke all on public.course_attendance_corrections from anon,authenticated;
grant select on public.course_attendance_corrections to authenticated;

create function public.correct_course_attendance(p_session uuid,p_enrollment uuid,p_expected_version integer,p_attendance text,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.courses; s public.course_sessions; e public.course_enrollments; a public.course_attendance;
  receipt public.course_attendance_corrections; course uuid; note text:=trim(p_note); result integer;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_attendance is null or
    p_attendance not in ('present','absent','excused') or note is null or length(note) not between 3 and 3000 then
    raise exception 'Wybierz zapisaną obecność i podaj powód korekty.';
  end if;
  select course_id into course from public.course_sessions where id=p_session;
  select * into c from public.courses where id=course for update;
  select * into s from public.course_sessions where id=p_session for update;
  select * into e from public.course_enrollments where id=p_enrollment for update;
  if c.id is null or e.id is null or e.course_id<>course then raise exception 'Wybierz uczestnika tego kursu.'; end if;
  select * into receipt from public.course_attendance_corrections where session_id=p_session and enrollment_id=p_enrollment and source_version=p_expected_version;
  if receipt.session_id is not null then
    if receipt.actor_id=auth.uid() and receipt.attendance=p_attendance and receipt.note=note then return receipt.result_version; end if;
    raise exception 'Obecność zmieniła się. Odśwież widok przed zapisem.';
  end if;
  select * into a from public.course_attendance where session_id=p_session and enrollment_id=p_enrollment for update;
  if a.session_id is null or s.status<>'completed' then raise exception 'Korekta dotyczy zapisanej obecności na zakończonym spotkaniu.'; end if;
  if a.version<>p_expected_version then raise exception 'Obecność zmieniła się. Odśwież widok przed zapisem.'; end if;
  if a.attendance=p_attendance then raise exception 'Wybierz inną obecność niż aktualnie zapisana.'; end if;
  update public.course_attendance set attendance=p_attendance,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
    where session_id=p_session and enrollment_id=p_enrollment returning version into result;
  insert into public.course_attendance_corrections(session_id,enrollment_id,source_version,result_version,previous_attendance,attendance,note,actor_id)
    values(p_session,p_enrollment,p_expected_version,result,a.attendance,p_attendance,note,auth.uid());
  insert into public.course_history(course_id,session_id,enrollment_id,action,actor_id,note,details)
    values(course,p_session,p_enrollment,'attendance',auth.uid(),note,jsonb_build_object('version',result,'corrected',true,'previous_attendance',a.attendance,'attendance',p_attendance));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'course_attendance_corrected',p_enrollment,jsonb_build_object('version',result));
  return result;
end $$;
revoke all on function public.correct_course_attendance(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.correct_course_attendance(uuid,uuid,integer,text,text) to authenticated;
