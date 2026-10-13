-- Configurable reporting, retaining unlimited access for existing purchases.
-- The period begins at the first publication for an assignment, never at
-- checkout and never again for a later session or revision of the same plan.
alter table public.services
  add column reporting_included boolean not null default true,
  add column reporting_days integer check(reporting_days between 1 and 36500),
  add constraint reporting_service_terms check(reporting_included or reporting_days is null);
alter table public.service_revisions
  add column reporting_included boolean not null default true,
  add column reporting_days integer check(reporting_days between 1 and 36500);
create function public.service_revision_reporting() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select reporting_included,reporting_days into new.reporting_included,new.reporting_days from public.services where id=new.service_id;
  return new;
end $$;
create trigger service_revision_reporting before insert on public.service_revisions for each row execute function public.service_revision_reporting();
create function public.set_service_reporting(p_service uuid,p_expected_version integer,p_included boolean,p_days integer,p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare s public.services; prior public.service_revisions;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_included is null
    or (p_days is not null and (p_days not between 1 and 36500 or not p_included))
    or p_note is null or length(trim(p_note)) not between 3 and 2000 then raise exception 'Sprawdź dostęp, okres i notatkę.'; end if;
  select * into s from public.services where id=p_service for update;
  if s.id is null then raise exception 'Nie znaleziono usługi.'; end if;
  if s.version=p_expected_version+1 and s.reporting_included=p_included and s.reporting_days is not distinct from p_days
    and exists(select 1 from public.audit_events where actor_id=auth.uid() and event='service_reporting_changed' and entity_id=p_service
      and details=jsonb_build_object('version',s.version,'note',trim(p_note))) then return s.version; end if;
  if s.version<>p_expected_version then raise exception 'Oferta zmieniła się. Odśwież widok przed zapisem.'; end if;
  update public.services set reporting_included=p_included,reporting_days=p_days,version=version+1,updated_at=clock_timestamp() where id=s.id returning * into s;
  insert into public.service_revisions(service_id,version,name,price_cents,price_unit,active,is_test_price,changed_by)
    values(s.id,s.version,s.name,s.price_cents,s.price_unit,s.active,s.is_test_price,auth.uid());
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'service_reporting_changed',s.id,jsonb_build_object('version',s.version,'note',trim(p_note)));
  return s.version;
end $$;

create table public.care_reporting_entitlements (
  id uuid primary key default gen_random_uuid(),
  dog_id uuid not null references public.dogs,
  consultation_id uuid references public.consultations,
  course_enrollment_id uuid references public.course_enrollments,
  fitness_package_id uuid references public.fitness_packages,
  scope_key text generated always as(public.care_context_key(consultation_id,course_enrollment_id,null,fitness_package_id,null)) stored,
  service_id uuid references public.services,
  service_version integer,
  snapshot_included boolean not null default true,
  snapshot_days integer check(snapshot_days between 1 and 36500),
  included boolean not null default true,
  starts_at timestamptz check(starts_at is null or isfinite(starts_at)),
  expires_at timestamptz check(expires_at is null or isfinite(expires_at)),
  overridden boolean not null default false,
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(num_nonnulls(consultation_id,course_enrollment_id,fitness_package_id)<=1),
  check(snapshot_included or snapshot_days is null),
  unique(dog_id,scope_key)
);
create table public.care_reporting_history (
  entitlement_id uuid not null references public.care_reporting_entitlements on delete cascade,
  version integer not null,
  included boolean not null,
  expires_at timestamptz,
  actor_id uuid not null references public.profiles,
  note text not null check(length(trim(note)) between 3 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  primary key(entitlement_id,version)
);
alter table public.care_reporting_entitlements enable row level security;
alter table public.care_reporting_history enable row level security;
create policy care_reporting_read on public.care_reporting_entitlements for select to authenticated using(public.is_admin() or public.owns_dog(dog_id));
create policy care_reporting_history_staff on public.care_reporting_history for select to authenticated using(public.is_admin());
revoke all on public.care_reporting_entitlements,public.care_reporting_history from public,anon,authenticated;
grant select on public.care_reporting_entitlements,public.care_reporting_history to authenticated;

-- Existing assignments explicitly keep the legacy policy, even when no plan
-- exists yet. Do not interpret today's catalogue as their historical terms.
insert into public.care_reporting_entitlements(dog_id,consultation_id,service_id,service_version)
  select dog_id,id,service_id,service_version from public.consultations;
insert into public.care_reporting_entitlements(dog_id,course_enrollment_id,service_id,service_version)
  select e.dog_id,e.id,c.service_id,c.service_version from public.course_enrollments e join public.courses c on c.id=e.course_id;
insert into public.care_reporting_entitlements(dog_id,fitness_package_id,service_id,service_version)
  select dog_id,id,service_id,service_version from public.fitness_packages;
insert into public.care_reporting_entitlements(dog_id)
  select distinct dog_id from public.care_plan_versions where consultation_id is null and course_enrollment_id is null and fitness_package_id is null;
update public.care_reporting_entitlements e set starts_at=(select min(p.published_at) from public.care_plan_versions p where p.dog_id=e.dog_id
  and public.care_context_key(p.consultation_id,p.course_enrollment_id,null,p.fitness_package_id,null)=e.scope_key);

create function public.snapshot_care_reporting() returns trigger
language plpgsql security definer set search_path='' as $$
declare service uuid; s public.services; consultation uuid; enrollment uuid; fitness uuid;
begin
  if tg_table_name='consultations' then service:=new.service_id; consultation:=new.id;
  elsif tg_table_name='course_enrollments' then select service_id into service from public.courses where id=new.course_id; enrollment:=new.id;
  else service:=new.service_id; fitness:=new.id; end if;
  select * into s from public.services where id=service for share;
  insert into public.care_reporting_entitlements(dog_id,consultation_id,course_enrollment_id,fitness_package_id,service_id,service_version,snapshot_included,snapshot_days,included)
    values(new.dog_id,consultation,enrollment,fitness,service,s.version,coalesce(s.reporting_included,true),s.reporting_days,coalesce(s.reporting_included,true));
  return new;
end $$;
create trigger consultation_reporting_snapshot after insert on public.consultations for each row execute function public.snapshot_care_reporting();
create trigger course_reporting_snapshot after insert on public.course_enrollments for each row execute function public.snapshot_care_reporting();
create trigger fitness_reporting_snapshot after insert on public.fitness_packages for each row execute function public.snapshot_care_reporting();
create function public.start_care_reporting() returns trigger
language plpgsql security definer set search_path='' as $$
declare scope text:=public.care_context_key(new.consultation_id,new.course_enrollment_id,null,new.fitness_package_id,null);
begin
  insert into public.care_reporting_entitlements(dog_id,consultation_id,course_enrollment_id,fitness_package_id)
    values(new.dog_id,new.consultation_id,new.course_enrollment_id,new.fitness_package_id) on conflict(dog_id,scope_key) do nothing;
  update public.care_reporting_entitlements set starts_at=new.published_at,
    expires_at=case when overridden then expires_at when snapshot_days is not null then new.published_at+make_interval(days=>snapshot_days) else null end,
    updated_at=clock_timestamp() where dog_id=new.dog_id and scope_key=scope and starts_at is null;
  return new;
end $$;
create trigger start_care_reporting after insert on public.care_plan_versions for each row execute function public.start_care_reporting();

create function public.care_reporting_access(p_plan uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.care_plan_versions; e public.care_reporting_entitlements;
begin
  select * into p from public.care_plan_versions where id=p_plan;
  if p.id is null or not(public.is_admin() or public.owns_dog(p.dog_id)) then raise exception 'Nie znaleziono planu dla Twojego psa.'; end if;
  select * into e from public.care_reporting_entitlements where dog_id=p.dog_id
    and scope_key=public.care_context_key(p.consultation_id,p.course_enrollment_id,null,p.fitness_package_id,null);
  return jsonb_build_object('id',e.id,'included',coalesce(e.included,true),'starts_at',e.starts_at,'expires_at',e.expires_at,
    'allowed',coalesce(e.included,true) and (e.expires_at is null or e.expires_at>now()),'version',e.version,'overridden',coalesce(e.overridden,false),
    'snapshot_days',e.snapshot_days,'service_id',e.service_id);
end $$;
create function public.change_care_reporting(p_id uuid,p_expected_version integer,p_included boolean,p_expires_on date,p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare e public.care_reporting_entitlements; h public.care_reporting_history; dog uuid;
  expiry timestamptz:=(p_expires_on+1)::timestamp at time zone 'Europe/Warsaw';
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_included is null
    or (p_expires_on is not null and not isfinite(p_expires_on)) or p_note is null or length(trim(p_note)) not between 3 and 2000 then
    raise exception 'Sprawdź dostęp, datę końca i notatkę.';
  end if;
  select dog_id into dog from public.care_reporting_entitlements where id=p_id;
  perform 1 from public.dogs where id=dog for update;
  select * into e from public.care_reporting_entitlements where id=p_id for update;
  if e.version=p_expected_version+1 then
    select * into h from public.care_reporting_history where entitlement_id=e.id and version=e.version;
    if h.actor_id=auth.uid() and h.included=p_included and h.expires_at is not distinct from expiry and h.note=trim(p_note) then return e.version; end if;
  end if;
  if e.id is null or e.version<>p_expected_version then raise exception 'Uprawnienie zmieniło się. Odśwież widok przed zapisem.'; end if;
  update public.care_reporting_entitlements set included=p_included,expires_at=expiry,overridden=true,version=version+1,updated_at=clock_timestamp()
    where id=e.id returning * into e;
  insert into public.care_reporting_history(entitlement_id,version,included,expires_at,actor_id,note)
    values(e.id,e.version,e.included,e.expires_at,auth.uid(),trim(p_note));
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'care_reporting_changed',e.id,jsonb_build_object('version',e.version));
  return e.version;
end $$;

create or replace function public.submit_care_progress(p_id uuid,p_plan uuid,p_attempted text,p_went_well text,p_difficult text)
returns void language plpgsql security definer set search_path='' as $$
declare publication public.care_plan_versions; previous public.care_progress; access jsonb;
begin
  if auth.uid() is null then raise exception 'Brak uprawnień.'; end if;
  select * into publication from public.care_plan_versions where id=p_plan;
  if not found or not public.owns_dog(publication.dog_id) then raise exception 'Nie znaleziono planu dla Twojego psa.'; end if;
  if p_id is null or p_attempted is null or length(trim(p_attempted)) not between 3 and 3000
    or p_went_well is null or length(p_went_well)>3000 or p_difficult is null or length(p_difficult)>3000 then
    raise exception 'Opisz Waszą pracę; każde pole może mieć do 3000 znaków.';
  end if;
  -- Serialize new writes with manual entitlement changes and guardian transfer.
  perform 1 from public.dogs where id=publication.dog_id for update;
  if not public.owns_dog(publication.dog_id) then raise exception 'Nie znaleziono planu dla Twojego psa.'; end if;
  select * into previous from public.care_progress where id=p_id;
  if found then
    if previous.plan_id=p_plan and previous.author_id=auth.uid() and previous.attempted=trim(p_attempted)
      and previous.went_well=trim(p_went_well) and previous.difficult=trim(p_difficult) then return; end if;
    raise exception 'Ta odpowiedź została już zapisana. Odśwież widok.';
  end if;
  access:=public.care_reporting_access(p_plan);
  if not (access->>'allowed')::boolean then raise exception 'Raportowanie dla tej usługi jest wyłączone lub zakończone. Wcześniejsze odpowiedzi i zalecenia pozostają dostępne.'; end if;
  insert into public.care_progress(id,practice_id,dog_id,plan_id,author_id,attempted,went_well,difficult)
    values(p_id,publication.practice_id,publication.dog_id,p_plan,auth.uid(),trim(p_attempted),trim(p_went_well),trim(p_difficult));
  insert into public.care_events(practice_id,dog_id,kind,entity_id) values(publication.practice_id,publication.dog_id,'progress_submitted',p_id);
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'care_progress_submitted',p_id);
end $$;
revoke all on function public.service_revision_reporting(),public.snapshot_care_reporting(),public.start_care_reporting(),
  public.set_service_reporting(uuid,integer,boolean,integer,text),public.care_reporting_access(uuid),public.change_care_reporting(uuid,integer,boolean,date,text)
  from public,anon,authenticated;
grant execute on function public.set_service_reporting(uuid,integer,boolean,integer,text),public.care_reporting_access(uuid),public.change_care_reporting(uuid,integer,boolean,date,text) to authenticated;
