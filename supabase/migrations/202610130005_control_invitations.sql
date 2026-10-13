-- Opt-in invitations to REQUEST a control consultation, independent of staff
-- follow-ups and appointment reminders. No historical invitations are created.
alter table public.care_drafts add column control_invite_on date check(control_invite_on is null or isfinite(control_invite_on));
alter table public.care_plan_versions add column control_invite_on date check(control_invite_on is null or isfinite(control_invite_on));
create table public.care_control_invitations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique references public.care_plan_versions,
  dog_id uuid not null references public.dogs,
  guardian_id uuid not null references public.profiles,
  context_key text not null,
  due_on date not null check(isfinite(due_on)),
  status text not null default 'open' check(status in ('open','requested','cancelled','superseded')),
  version integer not null default 1 check(version>0),
  consultation_id uuid unique references public.consultations,
  updated_by uuid not null references public.profiles,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check((status='requested')=(consultation_id is not null))
);
create unique index control_invitation_one_open_context on public.care_control_invitations(dog_id,context_key) where status='open';
create table public.care_control_invitation_history (
  invitation_id uuid not null references public.care_control_invitations on delete cascade,
  version integer not null,
  action text not null check(action in ('created','rescheduled','cancelled','superseded','requested','guardian_changed')),
  due_on date not null,
  actor_id uuid references public.profiles,
  note text not null default '' check(length(note)<=2000),
  created_at timestamptz not null default clock_timestamp(),
  primary key(invitation_id,version)
);
alter table public.care_control_invitations enable row level security;
alter table public.care_control_invitation_history enable row level security;
create policy control_invitation_read on public.care_control_invitations for select to authenticated using(
  public.is_admin() or (guardian_id=auth.uid() and public.owns_dog(dog_id)));
create policy control_invitation_history_read on public.care_control_invitation_history for select to authenticated using(
  exists(select 1 from public.care_control_invitations i where i.id=invitation_id));
revoke all on public.care_control_invitations,public.care_control_invitation_history from public,anon,authenticated;
grant select on public.care_control_invitations,public.care_control_invitation_history to authenticated;

-- Private helper for inbox/push delivery. Authorization is rechecked at read
-- and delivery time, including the frozen guardian and exact publication.
create function public.can_read_control_invitation(p_id uuid,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.care_control_invitations i
    join public.dogs d on d.id=i.dog_id and d.guardian_id=i.guardian_id
    join public.user_roles r on r.user_id=i.guardian_id and r.role='client'
    where i.id=p_id and i.guardian_id=p_user and i.status='open'
      and i.plan_id=(select p.id from public.care_plan_versions p where p.dog_id=i.dog_id and p.context_key=i.context_key order by p.revision desc limit 1));
$$;
create function public.can_deliver_control_invitation(p_id uuid,p_source_key text,p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.can_read_control_invitation(p_id,p_user) and exists(
    select 1 from public.reminder_jobs j join public.care_control_invitations i on i.id=j.source_id
    where i.id=p_id and j.kind='control_invitation' and 'reminder:'||j.id=p_source_key
      and j.source_token=i.version::text and j.status in ('pending','retry','sent'));
$$;
revoke all on function public.can_read_control_invitation(uuid,uuid),public.can_deliver_control_invitation(uuid,text,uuid) from public,anon,authenticated;

alter table public.reminder_jobs drop constraint reminder_jobs_kind_check;
alter table public.reminder_jobs add constraint reminder_jobs_kind_check check(kind in ('consultation','walk','follow_up','course','fitness','control_invitation'));
alter function public.reminder_source(text,uuid) rename to reminder_source_before_control;
create function public.reminder_source(p_kind text,p_source uuid)
returns table(dog_id uuid,entity_id uuid,source_token text,target_at timestamptz,due_at timestamptz)
language sql stable security definer set search_path='' as $$
  select * from public.reminder_source_before_control(p_kind,p_source) where p_kind<>'control_invitation'
  union all
  select i.dog_id,i.id,i.version::text,(i.due_on+time '09:00') at time zone 'Europe/Warsaw',(i.due_on+time '09:00') at time zone 'Europe/Warsaw'
    from public.care_control_invitations i where p_kind='control_invitation' and i.id=p_source
      and public.can_read_control_invitation(i.id,i.guardian_id);
$$;
alter function public.lock_reminder_source(text,uuid,uuid) rename to lock_reminder_source_before_control;
create function public.lock_reminder_source(p_kind text,p_source uuid,p_dog uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if p_kind<>'control_invitation' then return public.lock_reminder_source_before_control(p_kind,p_source,p_dog); end if;
  perform 1 from public.dogs where id=p_dog for update skip locked;
  if not found and exists(select 1 from public.dogs where id=p_dog) then return false; end if;
  perform 1 from public.care_control_invitations where id=p_source for update skip locked;
  return found or not exists(select 1 from public.care_control_invitations where id=p_source);
end $$;
create function public.control_invitation_reminder_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Remove stale actionable inbox items and cancel their queued push via FK.
  -- Domain history and reminder attempts remain available to staff.
  if tg_op='UPDATE' then
    delete from public.notifications where kind='control_invitation_due' and entity_id=new.id;
  end if;
  perform public.sync_reminder('control_invitation',new.id);
  return new;
end $$;
create trigger control_invitation_reminder_changed after insert or update of status,due_on,version on public.care_control_invitations
  for each row execute function public.control_invitation_reminder_changed();
create function public.control_invitation_published() returns trigger
language plpgsql security definer set search_path='' as $$
declare i public.care_control_invitations; guardian uuid;
begin
  perform 1 from public.dogs where id=new.dog_id for update;
  for i in update public.care_control_invitations set status='superseded',version=version+1,updated_by=new.published_by,updated_at=clock_timestamp()
    where dog_id=new.dog_id and context_key=new.context_key and status='open' returning *
  loop
    insert into public.care_control_invitation_history(invitation_id,version,action,due_on,actor_id)
      values(i.id,i.version,'superseded',i.due_on,new.published_by);
  end loop;
  if new.control_invite_on is not null then
    select d.guardian_id into guardian from public.dogs d join public.user_roles r on r.user_id=d.guardian_id and r.role='client' where d.id=new.dog_id;
    if guardian is null then raise exception 'Zaproszenie wymaga aktualnego opiekuna psa.'; end if;
    insert into public.care_control_invitations(plan_id,dog_id,guardian_id,context_key,due_on,updated_by)
      values(new.id,new.dog_id,guardian,new.context_key,new.control_invite_on,new.published_by) returning * into i;
    insert into public.care_control_invitation_history(invitation_id,version,action,due_on,actor_id)
      values(i.id,1,'created',i.due_on,new.published_by);
  end if;
  return new;
end $$;
create trigger control_invitation_published after insert on public.care_plan_versions for each row execute function public.control_invitation_published();
create function public.control_invitation_guardian_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare i public.care_control_invitations;
begin
  if new.guardian_id is not distinct from old.guardian_id then return new; end if;
  for i in update public.care_control_invitations set status='cancelled',version=version+1,updated_at=clock_timestamp()
    where dog_id=new.id and status='open' returning *
  loop
    insert into public.care_control_invitation_history(invitation_id,version,action,due_on,actor_id)
      values(i.id,i.version,'guardian_changed',i.due_on,auth.uid());
  end loop;
  return new;
end $$;
create trigger control_invitation_guardian_changed after update of guardian_id on public.dogs for each row execute function public.control_invitation_guardian_changed();

create function public.change_control_invitation(p_id uuid,p_expected_version integer,p_due_on date,p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare i public.care_control_invitations; h public.care_control_invitation_history; dog uuid; action text;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_note is null or length(trim(p_note)) not between 3 and 2000
    or (p_due_on is not null and (not isfinite(p_due_on) or p_due_on<(now() at time zone 'Europe/Warsaw')::date)) then
    raise exception 'Podaj dzisiejszą lub przyszłą datę zaproszenia i krótką notatkę.';
  end if;
  select dog_id into dog from public.care_control_invitations where id=p_id;
  perform 1 from public.dogs where id=dog for update;
  select * into i from public.care_control_invitations where id=p_id for update;
  action:=case when p_due_on is null then 'cancelled' else 'rescheduled' end;
  if i.version=p_expected_version+1 then
    select * into h from public.care_control_invitation_history where invitation_id=i.id and version=i.version;
    if h.actor_id=auth.uid() and h.action=action and h.note=trim(p_note) and (p_due_on is null or h.due_on=p_due_on) then return i.version; end if;
  end if;
  if i.id is null or i.version<>p_expected_version or not public.can_read_control_invitation(i.id,i.guardian_id) then
    raise exception 'Zaproszenie zmieniło się. Otwórz aktualny plan tej usługi.';
  end if;
  if p_due_on=i.due_on then raise exception 'Wybierz inną datę zaproszenia.'; end if;
  update public.care_control_invitations set due_on=coalesce(p_due_on,due_on),status=case when p_due_on is null then 'cancelled' else 'open' end,
    version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into i;
  insert into public.care_control_invitation_history(invitation_id,version,action,due_on,actor_id,note)
    values(i.id,i.version,action,i.due_on,auth.uid(),trim(p_note));
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'control_invitation_changed',i.id);
  return i.version;
end $$;
create function public.request_control_consultation(p_invitation uuid,p_id uuid,p_dog uuid,p_topic text,p_availability text,p_service uuid,p_expected_service_version integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare i public.care_control_invitations; result uuid;
begin
  if auth.uid() is null or not public.owns_dog(p_dog) then raise exception 'Nie znaleziono Twojego psa.'; end if;
  perform 1 from public.dogs where id=p_dog for update;
  select * into i from public.care_control_invitations where id=p_invitation for update;
  if i.id is null or i.dog_id is distinct from p_dog or i.guardian_id is distinct from auth.uid() then raise exception 'Nie znaleziono zaproszenia dla Twojego psa.'; end if;
  if i.status='requested' then return i.consultation_id; end if;
  if not public.can_read_control_invitation(i.id,auth.uid()) then raise exception 'To zaproszenie zostało wycofane. Otwórz aktualny plan.'; end if;
  result:=public.request_consultation(p_id,p_dog,p_topic,p_availability,p_service,p_expected_service_version);
  update public.care_control_invitations set status='requested',consultation_id=result,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
    where id=i.id returning * into i;
  insert into public.care_control_invitation_history(invitation_id,version,action,due_on,actor_id)
    values(i.id,i.version,'requested',i.due_on,auth.uid());
  return result;
end $$;
revoke all on function public.reminder_source(text,uuid),public.lock_reminder_source(text,uuid,uuid),
  public.control_invitation_reminder_changed(),public.control_invitation_published(),public.control_invitation_guardian_changed(),
  public.change_control_invitation(uuid,integer,date,text),public.request_control_consultation(uuid,uuid,uuid,text,text,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.change_control_invitation(uuid,integer,date,text),public.request_control_consultation(uuid,uuid,uuid,text,text,uuid,integer) to authenticated;

-- Preserve the exact-context command and add the independent opt-in date.
drop function public.save_care_plan(uuid,integer,text,text,date,boolean,uuid,uuid,uuid,uuid,uuid);
create or replace function public.save_care_plan(p_dog uuid,p_expected_version integer,
  p_title text,p_body text,p_follow_up_on date,p_publish boolean,p_consultation uuid default null,p_course_enrollment uuid default null,p_course_session uuid default null,p_fitness_package uuid default null,p_fitness_session uuid default null,p_control_invite_on date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  draft public.care_drafts;
  publication public.care_plan_versions;
  meeting public.consultations;
  cycle public.courses; enrollment public.course_enrollments; session public.course_sessions; course uuid;
  fitness public.fitness_packages; fitness_meeting public.fitness_sessions;
  dog_guardian uuid;
  next_revision integer;
  next_version integer;
  context text:=public.care_context_key(p_consultation,p_course_enrollment,p_course_session,p_fitness_package,p_fitness_session);
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647 or p_publish is null then
    raise exception 'Nieprawidłowa wersja planu.';
  end if;
  if num_nonnulls(p_consultation,p_course_enrollment,p_fitness_package)>1
    or (p_course_session is not null and p_course_enrollment is null)
    or (p_fitness_session is not null and p_fitness_package is null) then
    raise exception 'Wybierz jedno powiązanie: konsultację, kurs albo fitness.';
  end if;
  if p_follow_up_on is not null and not isfinite(p_follow_up_on) then
    raise exception 'Podaj poprawną datę kontaktu.';
  end if;
  if p_title is null or length(trim(p_title)) not between 3 and 160 or
     p_body is null or length(trim(p_body)) not between 3 and 20000 then
    raise exception 'Podaj tytuł i treść planu.';
  end if;
  perform 1 from public.care_practices where id='00000000-0000-4000-8000-000000000001' for key share;
  if p_fitness_package is not null then
    -- The dog's NO KEY UPDATE lock serializes drafts and guardian transfers.
    -- Fitness commands acquire dog SHARE before package/session locks, so they
    -- cannot hold a package while waiting for this publication's dog lock.
    select guardian_id into dog_guardian from public.dogs where id=p_dog for no key update;
    if not found then raise exception 'Nie znaleziono psa.'; end if;
    select * into fitness from public.fitness_packages where id=p_fitness_package for share;
    if fitness.id is null or fitness.dog_id is distinct from p_dog
      or fitness.practice_id is distinct from '00000000-0000-4000-8000-000000000001'::uuid then
      raise exception 'Wybierz pakiet fitness tego psa.';
    end if;
    if p_fitness_session is not null then
      select * into fitness_meeting from public.fitness_sessions where id=p_fitness_session for share;
      if fitness_meeting.id is null or fitness_meeting.package_id is distinct from p_fitness_package then
        raise exception 'Wybierz spotkanie tego pakietu fitness.';
      end if;
    end if;
  elsif p_course_enrollment is not null then
    -- Enrollment requests take dog SHARE before the course; course commands
    -- take course before enrollment and acquire dog KEY SHARE through FKs.
    -- NO KEY UPDATE serializes this dog's plans without blocking those FKs.
    select guardian_id into dog_guardian from public.dogs where id=p_dog for no key update;
    if not found then raise exception 'Nie znaleziono psa.'; end if;
    select course_id into course from public.course_enrollments where id=p_course_enrollment;
    select * into cycle from public.courses where id=course for share;
    if p_course_session is not null then
      select * into session from public.course_sessions where id=p_course_session for share;
      if session.id is null or session.course_id is distinct from course then raise exception 'Wybierz spotkanie tego kursu.'; end if;
    end if;
    select * into enrollment from public.course_enrollments where id=p_course_enrollment for share;
    if enrollment.id is null or enrollment.dog_id is distinct from p_dog or cycle.practice_id is distinct from '00000000-0000-4000-8000-000000000001'::uuid then
      raise exception 'Wybierz zgłoszenie tego psa na kurs.';
    end if;
  else
    if p_consultation is not null then
      select * into meeting from public.consultations where id=p_consultation for share;
      if not found or meeting.dog_id is distinct from p_dog or meeting.practice_id<>'00000000-0000-4000-8000-000000000001' then
        raise exception 'Wybierz konsultację tego psa.';
      end if;
    end if;
    perform id from public.dogs where id=p_dog for update;
    if not found then raise exception 'Nie znaleziono psa.'; end if;
  end if;
  if p_publish then
    select * into publication from public.care_plan_versions
      where dog_id=p_dog and context_key=context and source_version=p_expected_version;
    if found then
      if publication.title=trim(p_title) and publication.body=trim(p_body)
         and publication.follow_up_on is not distinct from p_follow_up_on
         and publication.control_invite_on is not distinct from p_control_invite_on
         and publication.consultation_id is not distinct from p_consultation
         and publication.course_enrollment_id is not distinct from p_course_enrollment
         and publication.course_session_id is not distinct from p_course_session
         and publication.fitness_package_id is not distinct from p_fitness_package
         and publication.fitness_session_id is not distinct from p_fitness_session
         and publication.published_by=auth.uid() then
        -- A retry of the same publication must not create a second event.
        return jsonb_build_object('version',p_expected_version+1,'published_id',publication.id);
      end if;
      raise exception 'Plan zmienił się. Skopiuj swoje zmiany i odśwież widok.';
    end if;
  end if;
  if p_control_invite_on is not null and (not isfinite(p_control_invite_on) or (p_publish and p_control_invite_on<(now() at time zone 'Europe/Warsaw')::date)) then
    raise exception 'Wybierz dzisiejszą lub przyszłą datę zaproszenia na kontrolę.';
  end if;
  if p_consultation is not null then
    if meeting.status not in ('scheduled','completed') then
      raise exception 'Wybierz umówioną lub zakończoną konsultację albo plan bez konsultacji.';
    end if;
    if p_publish and meeting.status<>'completed' then
      raise exception 'Najpierw oznacz konsultację jako zakończoną. Teraz możesz zapisać szkic.';
    end if;
  end if;
  if p_course_enrollment is not null then
    if enrollment.status<>'accepted' or cycle.status not in ('open','closed','completed') or enrollment.guardian_id is distinct from dog_guardian then
      raise exception 'Wybierz przyjęte zgłoszenie aktualnego opiekuna na aktywny lub zakończony kurs.';
    end if;
    if p_course_session is not null then
      if session.status not in ('scheduled','completed') then raise exception 'To spotkanie kursu jest odwołane. Wybierz inne powiązanie.'; end if;
      if p_publish and session.status<>'completed' then raise exception 'Najpierw zakończ spotkanie kursu. Teraz możesz zapisać szkic.'; end if;
    end if;
  end if;
  if p_fitness_package is not null then
    if fitness.status not in ('active','completed') or fitness.guardian_id is distinct from dog_guardian then
      raise exception 'Wybierz aktywny lub zakończony pakiet aktualnego opiekuna.';
    end if;
    if p_fitness_session is not null then
      if fitness_meeting.status not in ('scheduled','completed') then
        raise exception 'Wybierz umówione lub zakończone spotkanie fitness.';
      end if;
      if p_publish and fitness_meeting.status<>'completed' then
        raise exception 'Najpierw zakończ spotkanie fitness. Teraz możesz zapisać szkic.';
      end if;
    end if;
  end if;
  select * into draft from public.care_drafts where dog_id=p_dog and context_key=context;
  if coalesce(draft.version,0)<>p_expected_version then
    raise exception 'Plan zmienił się. Skopiuj swoje zmiany i odśwież widok.';
  end if;
  next_version=p_expected_version+1;
  insert into public.care_drafts(dog_id,practice_id,title,body,follow_up_on,control_invite_on,version,updated_by,consultation_id,course_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id)
    values(p_dog,'00000000-0000-4000-8000-000000000001',trim(p_title),trim(p_body),
      p_follow_up_on,p_control_invite_on,next_version,auth.uid(),p_consultation,course,p_course_enrollment,p_course_session,p_fitness_package,p_fitness_session)
    on conflict(dog_id,context_key) do update set title=excluded.title,body=excluded.body,
      follow_up_on=excluded.follow_up_on,control_invite_on=excluded.control_invite_on,consultation_id=excluded.consultation_id,course_id=excluded.course_id,
      course_enrollment_id=excluded.course_enrollment_id,course_session_id=excluded.course_session_id,
      fitness_package_id=excluded.fitness_package_id,fitness_session_id=excluded.fitness_session_id,version=excluded.version,
      updated_by=excluded.updated_by,updated_at=clock_timestamp();
  if p_publish then
    select coalesce(max(revision),0)+1 into next_revision from public.care_plan_versions where dog_id=p_dog;
    insert into public.care_plan_versions(practice_id,dog_id,revision,source_version,title,body,follow_up_on,control_invite_on,published_by,consultation_id,course_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id)
      values('00000000-0000-4000-8000-000000000001',p_dog,next_revision,
        p_expected_version,trim(p_title),trim(p_body),p_follow_up_on,p_control_invite_on,auth.uid(),p_consultation,course,p_course_enrollment,p_course_session,p_fitness_package,p_fitness_session) returning * into publication;
    insert into public.care_events(practice_id,dog_id,kind,entity_id)
      values(publication.practice_id,p_dog,'plan_published',publication.id);
  end if;
  insert into public.audit_events(actor_id,event,entity_id)
    values(auth.uid(),case when p_publish then 'care_plan_published' else 'care_draft_saved' end,
      coalesce(publication.id,p_dog));
  return jsonb_build_object('version',next_version,'published_id',publication.id);
end $$;
revoke all on function public.save_care_plan(uuid,integer,text,text,date,boolean,uuid,uuid,uuid,uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.save_care_plan(uuid,integer,text,text,date,boolean,uuid,uuid,uuid,uuid,uuid,date) to authenticated;

-- Existing delivery mechanics, with one new client invitation branch.
create or replace function public.dispatch_due_reminders(p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; j public.reminder_jobs; s record; recipient uuid;
  sent_count integer:=0; failed_count integer:=0; cancelled_count integer:=0; skipped_count integer:=0;
  result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Sprawdź wielkość partii.'; end if;
  for candidate in select id,kind,source_id,dog_id from public.reminder_jobs
    where status in ('pending','retry') and next_attempt_at<=now() order by next_attempt_at,id limit p_limit
  loop
    if not public.lock_reminder_source(candidate.kind,candidate.source_id,candidate.dog_id) then skipped_count:=skipped_count+1; continue; end if;
    select * into j from public.reminder_jobs where id=candidate.id and status in ('pending','retry') and next_attempt_at<=now() for update skip locked;
    if not found then skipped_count:=skipped_count+1; continue; end if;
    select * into s from public.reminder_source(j.kind,j.source_id);
    if not found or s.source_token is distinct from j.source_token or s.dog_id is distinct from j.dog_id then
      update public.reminder_jobs set status='cancelled',last_error_code='source_changed',finished_at=clock_timestamp(),attempts=attempts+1 where id=j.id;
      insert into public.reminder_attempts(job_id,attempt,outcome,error_code) values(j.id,j.attempts+1,'cancelled','source_changed');
      cancelled_count:=cancelled_count+1; continue;
    end if;
    begin
      if j.kind='follow_up' then
        if not exists(select 1 from public.user_roles where role='admin') then raise exception 'No recipient'; end if;
        perform public.notify_practice_staff(null,j.dog_id,j.entity_id,'follow_up_reminder','reminder:'||j.id);
      elsif j.kind='control_invitation' then
        select i.guardian_id into recipient from public.care_control_invitations i
          join public.user_roles r on r.user_id=i.guardian_id and r.role='client'
          where i.id=j.source_id for share of r;
        if recipient is null or not public.can_deliver_control_invitation(j.source_id,'reminder:'||j.id,recipient) then raise exception 'No recipient'; end if;
        perform public.add_in_app_notification(recipient,null,j.dog_id,j.entity_id,'control_invitation_due','reminder:'||j.id);
      elsif j.kind='fitness' then
        -- Role changes do not lock jobs. Hold the recipient role through commit
        -- so a concurrent promotion cannot turn a client reminder into staff mail.
        select r.user_id into recipient from public.user_roles r
          join public.fitness_packages p on p.guardian_id=r.user_id
          where p.id=j.fitness_package_id and r.role='client' for share of r;
        if recipient is null then raise exception 'No recipient'; end if;
        perform public.add_fitness_notification(recipient,null,j.fitness_package_id,j.fitness_session_id,'fitness_reminder','reminder:'||j.id);
      elsif j.kind='course' then
        select e.guardian_id into recipient from public.course_enrollments e join public.user_roles r on r.user_id=e.guardian_id
          where e.id=j.course_enrollment_id;
        if recipient is null then raise exception 'No recipient'; end if;
        perform public.add_course_notification(recipient,null,j.course_enrollment_id,j.course_session_id,'course_reminder','reminder:'||j.id);
      else
        select d.guardian_id into recipient from public.dogs d join public.user_roles r on r.user_id=d.guardian_id where d.id=j.dog_id;
        if recipient is null then raise exception 'No recipient'; end if;
        perform public.add_in_app_notification(recipient,null,j.dog_id,j.entity_id,j.kind||'_reminder','reminder:'||j.id);
      end if;
      update public.reminder_jobs set status='sent',attempts=attempts+1,cycle_attempts=cycle_attempts+1,last_error_code=null,finished_at=clock_timestamp() where id=j.id;
      insert into public.reminder_attempts(job_id,attempt,outcome) values(j.id,j.attempts+1,'sent');
      sent_count:=sent_count+1;
    exception when others then
      -- Never persist SQLERRM: it can contain private domain data or credentials.
      update public.reminder_jobs set status=case when j.cycle_attempts>=4 then 'failed' else 'retry' end,
        attempts=attempts+1,cycle_attempts=cycle_attempts+1,last_error_code='delivery_failed',
        next_attempt_at=clock_timestamp()+make_interval(mins=>case j.cycle_attempts when 0 then 1 when 1 then 5 when 2 then 15 else 60 end),
        finished_at=case when j.cycle_attempts>=4 then clock_timestamp() else null end where id=j.id;
      insert into public.reminder_attempts(job_id,attempt,outcome,error_code) values(j.id,j.attempts+1,'failed','delivery_failed');
      failed_count:=failed_count+1;
    end;
  end loop;
  result:=jsonb_build_object('sent',sent_count,'failed',failed_count,'cancelled',cancelled_count,'skipped',skipped_count);
  insert into public.reminder_worker_state(last_run_at,result) values(clock_timestamp(),result)
    on conflict(singleton) do update set last_run_at=excluded.last_run_at,result=excluded.result;
  return result;
end $$;
