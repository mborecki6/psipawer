-- Explicit association of each draft/publication with a consultation.
-- Existing publications remain unassociated: no inferred historical links.
alter table public.consultations add constraint consultation_dog_practice_unique unique(id,dog_id,practice_id);
alter table public.care_drafts add column consultation_id uuid;
alter table public.care_plan_versions add column consultation_id uuid;
alter table public.care_drafts add constraint care_draft_consultation_fk
  foreign key(consultation_id,dog_id,practice_id) references public.consultations(id,dog_id,practice_id);
alter table public.care_plan_versions add constraint care_plan_consultation_fk
  foreign key(consultation_id,dog_id,practice_id) references public.consultations(id,dog_id,practice_id);
create index care_plan_consultation_idx on public.care_plan_versions(consultation_id,revision desc) where consultation_id is not null;
create index care_draft_consultation_idx on public.care_drafts(consultation_id) where consultation_id is not null;

-- One signature with a default keeps six-argument unlinked calls compatible.
drop function public.save_care_plan(uuid,integer,text,text,date,boolean);
create function public.save_care_plan(p_dog uuid,p_expected_version integer,
  p_title text,p_body text,p_follow_up_on date,p_publish boolean,p_consultation uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  draft public.care_drafts;
  publication public.care_plan_versions;
  meeting public.consultations;
  next_revision integer;
  next_version integer;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version<0 or p_expected_version>=2147483647 or p_publish is null then
    raise exception 'Nieprawidłowa wersja planu.';
  end if;
  if p_follow_up_on is not null and not isfinite(p_follow_up_on) then
    raise exception 'Podaj poprawną datę kontaktu.';
  end if;
  if p_title is null or length(trim(p_title)) not between 3 and 160 or
     p_body is null or length(trim(p_body)) not between 3 and 20000 then
    raise exception 'Podaj tytuł i treść planu.';
  end if;
  -- Lock the practice before the meeting, then the dog. Scheduling takes the
  -- practice first, while completion/cancellation take the meeting first.
  -- The key-share prevents a later practice FK lock from inverting that order.
  perform 1 from public.care_practices where id='00000000-0000-4000-8000-000000000001' for key share;
  if p_consultation is not null then
    select * into meeting from public.consultations where id=p_consultation for share;
    if not found or meeting.dog_id is distinct from p_dog or
      meeting.practice_id<>'00000000-0000-4000-8000-000000000001' then
      raise exception 'Wybierz konsultację tego psa.';
    end if;
  end if;
  -- A per-dog lock also serializes concurrent creation when no draft exists.
  perform id from public.dogs where id=p_dog for update;
  if not found then raise exception 'Nie znaleziono psa.'; end if;
  if p_publish then
    select * into publication from public.care_plan_versions
      where dog_id=p_dog and source_version=p_expected_version;
    if found then
      if publication.title=trim(p_title) and publication.body=trim(p_body)
         and publication.follow_up_on is not distinct from p_follow_up_on
         and publication.consultation_id is not distinct from p_consultation
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
  select * into draft from public.care_drafts where dog_id=p_dog;
  if coalesce(draft.version,0)<>p_expected_version then
    raise exception 'Plan zmienił się. Skopiuj swoje zmiany i odśwież widok.';
  end if;
  next_version=p_expected_version+1;
  insert into public.care_drafts(dog_id,practice_id,title,body,follow_up_on,version,updated_by,consultation_id)
    values(p_dog,'00000000-0000-4000-8000-000000000001',trim(p_title),trim(p_body),
      p_follow_up_on,next_version,auth.uid(),p_consultation)
    on conflict(dog_id) do update set title=excluded.title,body=excluded.body,
      follow_up_on=excluded.follow_up_on,consultation_id=excluded.consultation_id,version=excluded.version,
      updated_by=excluded.updated_by,updated_at=clock_timestamp();
  if p_publish then
    select coalesce(max(revision),0)+1 into next_revision from public.care_plan_versions where dog_id=p_dog;
    insert into public.care_plan_versions(practice_id,dog_id,revision,source_version,title,body,follow_up_on,published_by,consultation_id)
      values('00000000-0000-4000-8000-000000000001',p_dog,next_revision,
        p_expected_version,trim(p_title),trim(p_body),p_follow_up_on,auth.uid(),p_consultation) returning * into publication;
    insert into public.care_events(practice_id,dog_id,kind,entity_id)
      values(publication.practice_id,p_dog,'plan_published',publication.id);
  end if;
  insert into public.audit_events(actor_id,event,entity_id)
    values(auth.uid(),case when p_publish then 'care_plan_published' else 'care_draft_saved' end,
      coalesce(publication.id,p_dog));
  return jsonb_build_object('version',next_version,'published_id',publication.id);
end $$;

revoke all on function public.save_care_plan(uuid,integer,text,text,date,boolean,uuid) from public,anon,authenticated;
grant execute on function public.save_care_plan(uuid,integer,text,text,date,boolean,uuid) to authenticated;
