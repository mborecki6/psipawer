-- Every publication retains its own explicit course enrollment/meeting.
-- No historical associations are inferred and no existing content is changed.
alter table public.courses add constraint course_care_practice_key unique(id,practice_id);
alter table public.course_enrollments add constraint course_care_dog_key unique(id,dog_id,course_id);
alter table public.course_sessions add constraint course_care_session_key unique(id,course_id);
alter table public.care_drafts add column course_id uuid,add column course_enrollment_id uuid,add column course_session_id uuid;
alter table public.care_plan_versions add column course_id uuid,add column course_enrollment_id uuid,add column course_session_id uuid;
alter table public.care_drafts add constraint care_draft_course_context check(
  num_nonnulls(consultation_id,course_enrollment_id)<=1 and
  ((course_enrollment_id is null and course_id is null and course_session_id is null) or (course_enrollment_id is not null and course_id is not null))
), add constraint care_draft_course_fk foreign key(course_id,practice_id) references public.courses(id,practice_id),
  add constraint care_draft_enrollment_fk foreign key(course_enrollment_id,dog_id,course_id) references public.course_enrollments(id,dog_id,course_id),
  add constraint care_draft_course_session_fk foreign key(course_session_id,course_id) references public.course_sessions(id,course_id);
alter table public.care_plan_versions add constraint care_plan_course_context check(
  num_nonnulls(consultation_id,course_enrollment_id)<=1 and
  ((course_enrollment_id is null and course_id is null and course_session_id is null) or (course_enrollment_id is not null and course_id is not null))
), add constraint care_plan_course_fk foreign key(course_id,practice_id) references public.courses(id,practice_id),
  add constraint care_plan_enrollment_fk foreign key(course_enrollment_id,dog_id,course_id) references public.course_enrollments(id,dog_id,course_id),
  add constraint care_plan_course_session_fk foreign key(course_session_id,course_id) references public.course_sessions(id,course_id);
create index care_plan_course_idx on public.care_plan_versions(course_enrollment_id,revision desc) where course_enrollment_id is not null;
create index care_draft_course_idx on public.care_drafts(course_enrollment_id) where course_enrollment_id is not null;
create index course_care_dog_idx on public.course_enrollments(dog_id,course_id) where status='accepted';

-- A bounded, per-enrollment page prevents one frequently edited plan from
-- consuming all rows and hiding the other participants' publications.
create function public.course_care_feed(p_course uuid,p_enrollments uuid[],p_offset integer default 0)
returns table(enrollment_id uuid,plans jsonb,has_draft boolean)
language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  if p_course is null or p_enrollments is null or cardinality(p_enrollments) not between 1 and 20
    or array_position(p_enrollments,null) is not null or p_offset is null or p_offset not between 0 and 1000000 then
    raise exception 'Wybierz zgłoszenia z bieżącej strony kursu.';
  end if;
  return query select e.id,coalesce((select jsonb_agg(to_jsonb(page) order by page.revision desc) from (
    select p.id,p.title,p.revision,p.published_at,p.course_session_id from public.care_plan_versions p
    where p.course_enrollment_id=e.id order by p.revision desc offset p_offset limit 6
  ) page),'[]'::jsonb),case when public.is_admin() then exists(select 1 from public.care_drafts d where d.course_enrollment_id=e.id) else false end
    from public.course_enrollments e where e.course_id=p_course and e.id=any(p_enrollments) order by e.id;
end $$;
revoke all on function public.course_care_feed(uuid,uuid[],integer) from public,anon,authenticated;
grant execute on function public.course_care_feed(uuid,uuid[],integer) to authenticated;

-- Replace the former seven-argument entry point with a single defaulted
-- signature; both existing six/seven-argument clients remain supported.
drop function public.save_care_plan(uuid,integer,text,text,date,boolean,uuid);
create function public.save_care_plan(p_dog uuid,p_expected_version integer,
  p_title text,p_body text,p_follow_up_on date,p_publish boolean,p_consultation uuid default null,p_course_enrollment uuid default null,p_course_session uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  draft public.care_drafts;
  publication public.care_plan_versions;
  meeting public.consultations;
  cycle public.courses; enrollment public.course_enrollments; session public.course_sessions; course uuid;
  dog_guardian uuid;
  next_revision integer;
  next_version integer;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647 or p_publish is null then
    raise exception 'Nieprawidłowa wersja planu.';
  end if;
  if (p_consultation is not null and p_course_enrollment is not null) or (p_course_session is not null and p_course_enrollment is null) then
    raise exception 'Wybierz jedno powiązanie: konsultację lub kurs.';
  end if;
  if p_follow_up_on is not null and not isfinite(p_follow_up_on) then
    raise exception 'Podaj poprawną datę kontaktu.';
  end if;
  if p_title is null or length(trim(p_title)) not between 3 and 160 or
     p_body is null or length(trim(p_body)) not between 3 and 20000 then
    raise exception 'Podaj tytuł i treść planu.';
  end if;
  perform 1 from public.care_practices where id='00000000-0000-4000-8000-000000000001' for key share;
  if p_course_enrollment is not null then
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
      where dog_id=p_dog and source_version=p_expected_version;
    if found then
      if publication.title=trim(p_title) and publication.body=trim(p_body)
         and publication.follow_up_on is not distinct from p_follow_up_on
         and publication.consultation_id is not distinct from p_consultation
         and publication.course_enrollment_id is not distinct from p_course_enrollment
         and publication.course_session_id is not distinct from p_course_session
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
  select * into draft from public.care_drafts where dog_id=p_dog;
  if coalesce(draft.version,0)<>p_expected_version then
    raise exception 'Plan zmienił się. Skopiuj swoje zmiany i odśwież widok.';
  end if;
  next_version=p_expected_version+1;
  insert into public.care_drafts(dog_id,practice_id,title,body,follow_up_on,version,updated_by,consultation_id,course_id,course_enrollment_id,course_session_id)
    values(p_dog,'00000000-0000-4000-8000-000000000001',trim(p_title),trim(p_body),
      p_follow_up_on,next_version,auth.uid(),p_consultation,course,p_course_enrollment,p_course_session)
    on conflict(dog_id) do update set title=excluded.title,body=excluded.body,
      follow_up_on=excluded.follow_up_on,consultation_id=excluded.consultation_id,course_id=excluded.course_id,
      course_enrollment_id=excluded.course_enrollment_id,course_session_id=excluded.course_session_id,version=excluded.version,
      updated_by=excluded.updated_by,updated_at=clock_timestamp();
  if p_publish then
    select coalesce(max(revision),0)+1 into next_revision from public.care_plan_versions where dog_id=p_dog;
    insert into public.care_plan_versions(practice_id,dog_id,revision,source_version,title,body,follow_up_on,published_by,consultation_id,course_id,course_enrollment_id,course_session_id)
      values('00000000-0000-4000-8000-000000000001',p_dog,next_revision,
        p_expected_version,trim(p_title),trim(p_body),p_follow_up_on,auth.uid(),p_consultation,course,p_course_enrollment,p_course_session) returning * into publication;
    insert into public.care_events(practice_id,dog_id,kind,entity_id)
      values(publication.practice_id,p_dog,'plan_published',publication.id);
  end if;
  insert into public.audit_events(actor_id,event,entity_id)
    values(auth.uid(),case when p_publish then 'care_plan_published' else 'care_draft_saved' end,
      coalesce(publication.id,p_dog));
  return jsonb_build_object('version',next_version,'published_id',publication.id);
end $$;
revoke all on function public.save_care_plan(uuid,integer,text,text,date,boolean,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_care_plan(uuid,integer,text,text,date,boolean,uuid,uuid,uuid) to authenticated;
