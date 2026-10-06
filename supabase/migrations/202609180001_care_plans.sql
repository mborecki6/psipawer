-- Care owns drafts, immutable publications, templates and guardian responses.
-- The current pilot has ONE practice and the existing global admin role.
-- This singleton is an explicit boundary, not multi-tenant authorization.
create table public.care_practices (
  id uuid primary key,
  name text not null,
  singleton boolean not null default true unique check (singleton)
);
insert into public.care_practices(id,name)
values ('00000000-0000-4000-8000-000000000001','Psi Pawer');

create table public.care_templates (
  id uuid primary key,
  practice_id uuid not null references public.care_practices,
  title text not null check(length(trim(title)) between 3 and 160),
  body text not null check(length(trim(body)) between 3 and 20000),
  version integer not null default 1 check(version > 0),
  updated_by uuid not null references public.profiles,
  updated_at timestamptz not null default now()
);
create table public.care_drafts (
  dog_id uuid primary key references public.dogs,
  practice_id uuid not null references public.care_practices,
  title text not null check(length(trim(title)) between 3 and 160),
  body text not null check(length(trim(body)) between 3 and 20000),
  follow_up_on date,
  version integer not null check(version > 0),
  updated_by uuid not null references public.profiles,
  updated_at timestamptz not null default now()
);
create table public.care_plan_versions (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.care_practices,
  dog_id uuid not null references public.dogs,
  revision integer not null check(revision > 0),
  source_version integer not null check(source_version >= 0),
  title text not null check(length(trim(title)) between 3 and 160),
  body text not null check(length(trim(body)) between 3 and 20000),
  follow_up_on date,
  published_by uuid not null references public.profiles,
  published_at timestamptz not null default now(),
  unique(dog_id,revision),
  unique(dog_id,source_version),
  unique(id,dog_id,practice_id)
);
create table public.care_progress (
  id uuid primary key,
  practice_id uuid not null references public.care_practices,
  dog_id uuid not null references public.dogs,
  plan_id uuid not null,
  author_id uuid not null references public.profiles,
  attempted text not null check(length(trim(attempted)) between 3 and 3000),
  went_well text not null default '' check(length(went_well) <= 3000),
  difficult text not null default '' check(length(difficult) <= 3000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles,
  foreign key(plan_id,dog_id,practice_id)
    references public.care_plan_versions(id,dog_id,practice_id),
  check ((reviewed_at is null) = (reviewed_by is null))
);
create index care_progress_dog_idx on public.care_progress(dog_id,created_at desc,id);
create index care_progress_unread_idx on public.care_progress(created_at,id) where reviewed_at is null;

-- Transactional outbox only. No consumer or external delivery is enabled here.
-- Payload contains identifiers, never the private text of a plan or response.
create table public.care_events (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.care_practices,
  dog_id uuid not null references public.dogs,
  kind text not null check(kind in ('plan_published','progress_submitted')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique(kind,entity_id)
);

alter table public.care_practices enable row level security;
alter table public.care_templates enable row level security;
alter table public.care_drafts enable row level security;
alter table public.care_plan_versions enable row level security;
alter table public.care_progress enable row level security;
alter table public.care_events enable row level security;
create policy care_practice_read on public.care_practices for select to authenticated using(public.is_admin());
create policy care_template_read on public.care_templates for select to authenticated using(public.is_admin());
create policy care_draft_read on public.care_drafts for select to authenticated using(public.is_admin());
create policy care_plan_read on public.care_plan_versions for select to authenticated
  using(public.is_admin() or public.owns_dog(dog_id));
create policy care_progress_read on public.care_progress for select to authenticated
  using(public.is_admin() or (author_id=auth.uid() and public.owns_dog(dog_id)));
revoke all on public.care_practices,public.care_templates,public.care_drafts,
  public.care_plan_versions,public.care_progress,public.care_events from anon,authenticated;
grant select on public.care_practices,public.care_templates,public.care_drafts,
  public.care_plan_versions,public.care_progress to authenticated;

create function public.save_care_template(p_id uuid,p_expected_version integer,p_title text,p_body text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_expected_version is null or p_expected_version<0 then
    raise exception 'Nieprawidłowa wersja materiału.';
  end if;
  if p_title is null or length(trim(p_title)) not between 3 and 160 or
     p_body is null or length(trim(p_body)) not between 3 and 20000 then
    raise exception 'Podaj tytuł i treść materiału.';
  end if;
  if p_expected_version=0 then
    insert into public.care_templates(id,practice_id,title,body,updated_by)
      values(p_id,'00000000-0000-4000-8000-000000000001',trim(p_title),trim(p_body),auth.uid())
      on conflict(id) do nothing;
  else
    update public.care_templates set title=trim(p_title),body=trim(p_body),
      version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=p_id and version=p_expected_version;
  end if;
  if not found then raise exception 'Materiał zmienił się. Odśwież widok przed edycją.'; end if;
  insert into public.audit_events(actor_id,event,entity_id)
    values(auth.uid(),'care_template_saved',p_id);
end $$;

-- Save and publish use the submitted text in ONE operation. Publication cannot
-- accidentally send the previous draft while the editor contains unsaved text.
create function public.save_care_plan(p_dog uuid,p_expected_version integer,
  p_title text,p_body text,p_follow_up_on date,p_publish boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  draft public.care_drafts;
  publication public.care_plan_versions;
  next_revision integer;
  next_version integer;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version<0 or p_publish is null then
    raise exception 'Nieprawidłowa wersja planu.';
  end if;
  if p_follow_up_on is not null and not isfinite(p_follow_up_on) then
    raise exception 'Podaj poprawną datę kontaktu.';
  end if;
  if p_title is null or length(trim(p_title)) not between 3 and 160 or
     p_body is null or length(trim(p_body)) not between 3 and 20000 then
    raise exception 'Podaj tytuł i treść planu.';
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
         and publication.published_by=auth.uid() then
        -- A retry of the same publication must not create a second event.
        return jsonb_build_object('version',p_expected_version+1,'published_id',publication.id);
      end if;
      raise exception 'Plan zmienił się. Skopiuj swoje zmiany i odśwież widok.';
    end if;
  end if;
  select * into draft from public.care_drafts where dog_id=p_dog;
  if coalesce(draft.version,0)<>p_expected_version then
    raise exception 'Plan zmienił się. Skopiuj swoje zmiany i odśwież widok.';
  end if;
  next_version=p_expected_version+1;
  insert into public.care_drafts(dog_id,practice_id,title,body,follow_up_on,version,updated_by)
    values(p_dog,'00000000-0000-4000-8000-000000000001',trim(p_title),trim(p_body),
      p_follow_up_on,next_version,auth.uid())
    on conflict(dog_id) do update set title=excluded.title,body=excluded.body,
      follow_up_on=excluded.follow_up_on,version=excluded.version,
      updated_by=excluded.updated_by,updated_at=clock_timestamp();
  if p_publish then
    select coalesce(max(revision),0)+1 into next_revision from public.care_plan_versions where dog_id=p_dog;
    insert into public.care_plan_versions(practice_id,dog_id,revision,source_version,title,body,follow_up_on,published_by)
      values('00000000-0000-4000-8000-000000000001',p_dog,next_revision,
        p_expected_version,trim(p_title),trim(p_body),p_follow_up_on,auth.uid()) returning * into publication;
    insert into public.care_events(practice_id,dog_id,kind,entity_id)
      values(publication.practice_id,p_dog,'plan_published',publication.id);
  end if;
  insert into public.audit_events(actor_id,event,entity_id)
    values(auth.uid(),case when p_publish then 'care_plan_published' else 'care_draft_saved' end,
      coalesce(publication.id,p_dog));
  return jsonb_build_object('version',next_version,'published_id',publication.id);
end $$;

create function public.submit_care_progress(p_id uuid,p_plan uuid,p_attempted text,p_went_well text,p_difficult text)
returns void language plpgsql security definer set search_path='' as $$
declare publication public.care_plan_versions; previous public.care_progress;
begin
  if auth.uid() is null then raise exception 'Brak uprawnień.'; end if;
  select * into publication from public.care_plan_versions where id=p_plan;
  if not found or not public.owns_dog(publication.dog_id) then
    raise exception 'Nie znaleziono planu dla Twojego psa.';
  end if;
  if p_id is null or p_attempted is null or length(trim(p_attempted)) not between 3 and 3000
     or p_went_well is null or length(p_went_well)>3000
     or p_difficult is null or length(p_difficult)>3000 then
    raise exception 'Opisz Waszą pracę; każde pole może mieć do 3000 znaków.';
  end if;
  insert into public.care_progress(id,practice_id,dog_id,plan_id,author_id,attempted,went_well,difficult)
    values(p_id,publication.practice_id,publication.dog_id,p_plan,auth.uid(),trim(p_attempted),trim(p_went_well),trim(p_difficult))
    on conflict(id) do nothing;
  if not found then
    select * into previous from public.care_progress where id=p_id;
    if previous.plan_id=p_plan and previous.author_id=auth.uid()
       and previous.attempted=trim(p_attempted) and previous.went_well=trim(p_went_well)
       and previous.difficult=trim(p_difficult) then return; end if;
    raise exception 'Ta odpowiedź została już zapisana. Odśwież widok.';
  end if;
  insert into public.care_events(practice_id,dog_id,kind,entity_id)
    values(publication.practice_id,publication.dog_id,'progress_submitted',p_id);
  insert into public.audit_events(actor_id,event,entity_id)
    values(auth.uid(),'care_progress_submitted',p_id);
end $$;

create function public.review_care_progress(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if not exists(select 1 from public.care_progress where id=p_id) then
    raise exception 'Nie znaleziono odpowiedzi.';
  end if;
  update public.care_progress set reviewed_at=clock_timestamp(),reviewed_by=auth.uid()
    where id=p_id and reviewed_at is null;
  if found then
    insert into public.audit_events(actor_id,event,entity_id)
      values(auth.uid(),'care_progress_reviewed',p_id);
  end if;
end $$;

-- Invoker rights deliberately preserve RLS on plans, dogs and responses.
create function public.care_plan_summaries(p_offset integer default 0)
returns table(id uuid,dog_id uuid,dog_name text,title text,revision integer,
  follow_up_on date,published_at timestamptz,unread_count bigint)
language sql stable security invoker set search_path='' as $$
  select p.id,p.dog_id,d.name,p.title,p.revision,p.follow_up_on,p.published_at,
    (select count(*) from public.care_progress r where r.dog_id=p.dog_id and r.reviewed_at is null)
  from (select distinct on (v.dog_id) v.* from public.care_plan_versions v order by v.dog_id,v.revision desc) p
  join public.dogs d on d.id=p.dog_id
  order by p.published_at desc,p.id
  limit 21 offset greatest(coalesce(p_offset,0),0)
$$;

revoke all on function public.save_care_template(uuid,integer,text,text),
  public.save_care_plan(uuid,integer,text,text,date,boolean),
  public.submit_care_progress(uuid,uuid,text,text,text),public.review_care_progress(uuid),
  public.care_plan_summaries(integer) from public,anon,authenticated;
grant execute on function public.save_care_template(uuid,integer,text,text),
  public.save_care_plan(uuid,integer,text,text,date,boolean),
  public.submit_care_progress(uuid,uuid,text,text,text),public.review_care_progress(uuid),
  public.care_plan_summaries(integer) to authenticated;
