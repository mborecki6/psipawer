-- Independent drafts and current publications for the exact service/meeting.
-- Generated keys keep the submitted UUIDs authoritative. Existing content,
-- versions, identifiers and chronology are retained; no history is reactivated.
create function public.care_context_key(p_consultation uuid,p_course_enrollment uuid,p_course_session uuid,p_fitness_package uuid,p_fitness_session uuid)
returns text language sql immutable parallel safe set search_path='' as $$
  select case
    when p_consultation is not null then 'consultation:'||p_consultation::text
    when p_course_enrollment is not null then 'course:'||p_course_enrollment::text||':'||coalesce(p_course_session::text,'all')
    when p_fitness_package is not null then 'fitness:'||p_fitness_package::text||':'||coalesce(p_fitness_session::text,'all')
    else 'general' end
$$;
revoke all on function public.care_context_key(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.care_context_key(uuid,uuid,uuid,uuid,uuid) to authenticated;

alter table public.care_drafts
  add column id uuid not null default gen_random_uuid(),
  add column context_key text generated always as (public.care_context_key(consultation_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id)) stored;
alter table public.care_drafts drop constraint care_drafts_pkey;
alter table public.care_drafts add primary key(id),add constraint care_draft_context_unique unique(dog_id,context_key);
alter table public.care_plan_versions
  add column context_key text generated always as (public.care_context_key(consultation_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id)) stored;
alter table public.care_plan_versions drop constraint care_plan_versions_dog_id_source_version_key;
alter table public.care_plan_versions add constraint care_publication_context_source_unique unique(dog_id,context_key,source_version),
  add constraint care_publication_context_identity unique(id,dog_id,practice_id,context_key);
create index care_publication_context_revision on public.care_plan_versions(dog_id,context_key,revision desc);

-- The former single draft moved between services. Restore an editable copy
-- only for historical contexts with no remaining draft, from their latest
-- immutable publication. Preserve the actual existing draft byte-for-byte.
insert into public.care_drafts(dog_id,practice_id,title,body,follow_up_on,version,updated_by,updated_at,
  consultation_id,course_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id)
  select p.dog_id,p.practice_id,p.title,p.body,p.follow_up_on,p.source_version+1,p.published_by,p.published_at,
    p.consultation_id,p.course_id,p.course_enrollment_id,p.course_session_id,p.fitness_package_id,p.fitness_session_id
  from (select distinct on (dog_id,context_key) * from public.care_plan_versions order by dog_id,context_key,revision desc) p
  where not exists(select 1 from public.care_drafts d where d.dog_id=p.dog_id and d.context_key=p.context_key);

alter table public.care_follow_ups add column context_key text;
update public.care_follow_ups f set context_key=p.context_key from public.care_plan_versions p where p.id=f.plan_id;
alter table public.care_follow_ups alter column context_key set not null;
-- Keep a single relationship for PostgREST embedding while strengthening
-- the existing dog/practice binding with the exact publication context.
alter table public.care_follow_ups drop constraint care_follow_ups_plan_id_dog_id_practice_id_fkey;
alter table public.care_follow_ups add constraint care_follow_up_context_fk foreign key(plan_id,dog_id,practice_id,context_key) references public.care_plan_versions(id,dog_id,practice_id,context_key);
drop index public.care_follow_up_one_open_dog;
create unique index care_follow_up_one_open_context on public.care_follow_ups(dog_id,context_key) where status='open';
create function public.care_follow_up_context() returns trigger language plpgsql security definer set search_path='' as $$
begin
  select context_key into new.context_key from public.care_plan_versions where id=new.plan_id;
  return new;
end $$;
revoke all on function public.care_follow_up_context() from public,anon,authenticated;
create trigger care_follow_up_context before insert or update of plan_id on public.care_follow_ups for each row execute function public.care_follow_up_context();

create or replace function public.save_care_plan(p_dog uuid,p_expected_version integer,
  p_title text,p_body text,p_follow_up_on date,p_publish boolean,p_consultation uuid default null,p_course_enrollment uuid default null,p_course_session uuid default null,p_fitness_package uuid default null,p_fitness_session uuid default null)
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
  insert into public.care_drafts(dog_id,practice_id,title,body,follow_up_on,version,updated_by,consultation_id,course_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id)
    values(p_dog,'00000000-0000-4000-8000-000000000001',trim(p_title),trim(p_body),
      p_follow_up_on,next_version,auth.uid(),p_consultation,course,p_course_enrollment,p_course_session,p_fitness_package,p_fitness_session)
    on conflict(dog_id,context_key) do update set title=excluded.title,body=excluded.body,
      follow_up_on=excluded.follow_up_on,consultation_id=excluded.consultation_id,course_id=excluded.course_id,
      course_enrollment_id=excluded.course_enrollment_id,course_session_id=excluded.course_session_id,
      fitness_package_id=excluded.fitness_package_id,fitness_session_id=excluded.fitness_session_id,version=excluded.version,
      updated_by=excluded.updated_by,updated_at=clock_timestamp();
  if p_publish then
    select coalesce(max(revision),0)+1 into next_revision from public.care_plan_versions where dog_id=p_dog;
    insert into public.care_plan_versions(practice_id,dog_id,revision,source_version,title,body,follow_up_on,published_by,consultation_id,course_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id)
      values('00000000-0000-4000-8000-000000000001',p_dog,next_revision,
        p_expected_version,trim(p_title),trim(p_body),p_follow_up_on,auth.uid(),p_consultation,course,p_course_enrollment,p_course_session,p_fitness_package,p_fitness_session) returning * into publication;
    insert into public.care_events(practice_id,dog_id,kind,entity_id)
      values(publication.practice_id,p_dog,'plan_published',publication.id);
  end if;
  insert into public.audit_events(actor_id,event,entity_id)
    values(auth.uid(),case when p_publish then 'care_plan_published' else 'care_draft_saved' end,
      coalesce(publication.id,p_dog));
  return jsonb_build_object('version',next_version,'published_id',publication.id);
end $$;
revoke all on function public.save_care_plan(uuid,integer,text,text,date,boolean,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_care_plan(uuid,integer,text,text,date,boolean,uuid,uuid,uuid,uuid,uuid) to authenticated;

create or replace function public.plan_follow_up_task() returns trigger language plpgsql security definer set search_path='' as $$
declare f public.care_follow_ups;
begin
  -- save_care_plan already locks this parent; repeat for other trusted writers.
  perform 1 from public.dogs where id=new.dog_id for update;
  for f in update public.care_follow_ups set status='superseded',closed_at=clock_timestamp(),version=version+1,
    updated_by=new.published_by,updated_at=clock_timestamp() where dog_id=new.dog_id and context_key=new.context_key and status='open' returning *
  loop
    insert into public.care_follow_up_history(follow_up_id,version,action,due_on,author_id)
      values(f.id,f.version,'superseded',f.due_on,new.published_by);
  end loop;
  if new.follow_up_on is not null then
    insert into public.care_follow_ups(plan_id,dog_id,practice_id,due_on,updated_by)
      values(new.id,new.dog_id,new.practice_id,new.follow_up_on,new.published_by) returning * into f;
    insert into public.care_follow_up_history(follow_up_id,version,action,due_on,author_id)
      values(f.id,f.version,'scheduled',f.due_on,new.published_by);
  end if;
  return new;
end $$;
revoke all on function public.plan_follow_up_task() from public,anon,authenticated;

create or replace function public.change_care_follow_up(p_id uuid,p_expected_version integer,p_action text,p_due_on date,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare f public.care_follow_ups; h public.care_follow_up_history; owner_dog uuid; today date:=(now() at time zone 'Europe/Warsaw')::date;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version<1 or p_expected_version>=2147483647 or
    p_action is null or p_action not in ('rescheduled','completed','cancelled','reopened') or
    p_note is null or length(trim(p_note)) not between 3 and 2000 then raise exception 'Wybierz działanie i dodaj krótką notatkę.'; end if;
  if p_action in ('rescheduled','reopened') and (p_due_on is null or not isfinite(p_due_on)) then raise exception 'Podaj nową datę kontaktu.'; end if;
  if p_action in ('completed','cancelled') and p_due_on is not null then raise exception 'To działanie nie zmienia terminu.'; end if;
  select dog_id into owner_dog from public.care_follow_ups where id=p_id;
  if not found then raise exception 'Nie znaleziono kontaktu kontrolnego.'; end if;
  perform 1 from public.dogs where id=owner_dog for update;
  select * into f from public.care_follow_ups where id=p_id for update;
  if f.version=p_expected_version+1 then
    select * into h from public.care_follow_up_history where follow_up_id=f.id and version=f.version;
    if h.author_id=auth.uid() and h.action=p_action and h.note=trim(p_note) and
       (p_action in ('completed','cancelled') or h.due_on=p_due_on) then return f.version; end if;
  end if;
  if f.version<>p_expected_version then raise exception 'Kontakt zmienił się. Odśwież widok przed zapisem.'; end if;
  if f.status='superseded' or f.plan_id is distinct from (select id from public.care_plan_versions where dog_id=f.dog_id and context_key=f.context_key order by revision desc limit 1) then
    raise exception 'Ten kontakt dotyczy wcześniejszego planu. Otwórz aktualny plan tej usługi.';
  end if;
  if (p_action='reopened' and f.status not in ('done','cancelled')) or (p_action<>'reopened' and f.status<>'open') then raise exception 'Nie można wykonać tego działania w aktualnym stanie.'; end if;
  if p_action in ('rescheduled','reopened') and p_due_on<today then raise exception 'Wybierz dzisiejszą lub przyszłą datę kontaktu.'; end if;
  if p_action='rescheduled' and p_due_on=f.due_on then raise exception 'Wybierz inną datę kontaktu.'; end if;
  update public.care_follow_ups set due_on=coalesce(p_due_on,due_on),
    status=case p_action when 'completed' then 'done' when 'cancelled' then 'cancelled' else 'open' end,
    closed_at=case when p_action in ('completed','cancelled') then clock_timestamp() else null end,
    version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into f;
  insert into public.care_follow_up_history(follow_up_id,version,action,due_on,note,author_id)
    values(f.id,f.version,p_action,f.due_on,trim(p_note),auth.uid());
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'care_follow_up_changed',f.id,jsonb_build_object('version',f.version,'action',p_action));
  return f.version;
end $$;
revoke all on function public.change_care_follow_up(uuid,integer,text,date,text) from public,anon,authenticated;
grant execute on function public.change_care_follow_up(uuid,integer,text,date,text) to authenticated;


create or replace function public.care_plan_summaries(p_offset integer default 0)
returns table(id uuid,dog_id uuid,dog_name text,title text,revision integer,
  follow_up_on date,published_at timestamptz,unread_count bigint)
language sql stable security invoker set search_path='' as $$
  select p.id,p.dog_id,d.name,p.title,p.revision,f.due_on,p.published_at,
    (select count(*) from public.care_progress r join public.care_plan_versions source on source.id=r.plan_id where r.dog_id=p.dog_id and source.context_key=p.context_key and r.reviewed_at is null)
  from (select distinct on (v.dog_id,v.context_key) v.* from public.care_plan_versions v order by v.dog_id,v.context_key,v.revision desc) p
  join public.dogs d on d.id=p.dog_id
  left join public.care_follow_ups f on f.plan_id=p.id and f.status='open'
  order by p.published_at desc,p.id
  limit 21 offset greatest(coalesce(p_offset,0),0)
$$;

-- Only readable publications and private staff drafts contribute contexts.
-- Client queries cannot discover a draft or a context that has no publication.
create function public.dog_care_contexts(p_dog uuid)
returns table(context_key text,consultation_id uuid,course_enrollment_id uuid,course_session_id uuid,fitness_package_id uuid,fitness_session_id uuid,title text,published_id uuid,revision integer,has_draft boolean)
language sql stable security invoker set search_path='' as $$
  with latest as (
    select distinct on (p.context_key) p.* from public.care_plan_versions p
    where p.dog_id=p_dog order by p.context_key,p.revision desc
  ), drafts as (
    select d.* from public.care_drafts d where public.is_admin() and d.dog_id=p_dog
  )
  select coalesce(p.context_key,d.context_key),coalesce(p.consultation_id,d.consultation_id),
    coalesce(p.course_enrollment_id,d.course_enrollment_id),coalesce(p.course_session_id,d.course_session_id),
    coalesce(p.fitness_package_id,d.fitness_package_id),coalesce(p.fitness_session_id,d.fitness_session_id),
    coalesce(p.title,d.title),p.id,p.revision,d.id is not null
  from latest p full join drafts d on d.context_key=p.context_key
  order by p.revision desc nulls last,d.updated_at desc,coalesce(p.context_key,d.context_key)
$$;
revoke all on function public.dog_care_contexts(uuid) from public,anon,authenticated;
grant execute on function public.dog_care_contexts(uuid) to authenticated;
