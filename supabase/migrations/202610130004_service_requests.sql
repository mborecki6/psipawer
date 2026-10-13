-- Private requests to arrange an individual catalogue service. These records
-- do not reserve calendar time, enroll a dog, create a price or send a message.
create table public.service_requests (
  id uuid primary key,
  dog_id uuid not null references public.dogs,
  guardian_id uuid not null references public.profiles,
  service_id uuid not null references public.services,
  service_name text not null,
  message text not null check(length(trim(message)) between 3 and 2000),
  availability text not null default '' check(length(availability)<=1000),
  status text not null default 'open' check(status in ('open','handled','cancelled')),
  version integer not null default 1 check(version>0),
  resolution_note text not null default '' check(length(resolution_note)<=2000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index service_request_one_open on public.service_requests(dog_id,service_id) where status='open';
create index service_requests_guardian on public.service_requests(guardian_id,created_at,id);
create index service_requests_status on public.service_requests(status,created_at,id);
create table public.service_request_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests,
  actor_id uuid not null references public.profiles,
  action text not null check(action in ('requested','handled','cancelled')),
  note text not null default '' check(length(note)<=2000),
  version integer not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(request_id,version)
);
create table public.service_request_receipts (
  request_id uuid primary key,
  result_id uuid not null references public.service_requests,
  guardian_id uuid not null references public.profiles,
  payload jsonb not null
);
alter table public.service_requests enable row level security;
alter table public.service_request_history enable row level security;
alter table public.service_request_receipts enable row level security;
create policy service_requests_read on public.service_requests for select to authenticated using(
  (select public.is_admin()) or (guardian_id=(select auth.uid()) and dog_id in
    (select d.id from public.dogs d where d.guardian_id=(select auth.uid()))));
create policy service_request_history_read on public.service_request_history for select to authenticated using(
  exists(select 1 from public.service_requests r where r.id=service_request_history.request_id));
revoke all on public.service_requests,public.service_request_history,public.service_request_receipts from anon,authenticated;
grant select on public.service_requests,public.service_request_history to authenticated;

create function public.request_service_date(p_request_id uuid,p_service uuid,p_dog uuid,p_message text,p_availability text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.services; r public.service_requests; receipt public.service_request_receipts;
  payload jsonb; result_id uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.user_roles where user_id=auth.uid() and role='client') then
    raise exception 'Brak uprawnień.';
  end if;
  if p_request_id is null or p_service is null or p_dog is null or p_message is null
    or length(trim(p_message)) not between 3 and 2000 or p_availability is null or length(trim(p_availability))>1000 then
    raise exception 'Wybierz psa i opisz potrzebę spotkania.';
  end if;
  payload=jsonb_build_object('service',p_service,'dog',p_dog,'message',trim(p_message),'availability',trim(p_availability));
  -- A receipt key is serialized independently of the dog; the dog lock also
  -- serializes two different forms requesting the same dog/service.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  perform 1 from public.dogs where id=p_dog and guardian_id=auth.uid() for update;
  if not found then raise exception 'Wybierz swojego psa.'; end if;
  select * into receipt from public.service_request_receipts where request_id=p_request_id;
  if receipt.request_id is not null then
    if receipt.guardian_id=auth.uid() and receipt.payload=payload then return receipt.result_id; end if;
    raise exception 'Ten identyfikator zgłoszenia został już użyty. Odśwież formularz.';
  end if;
  select * into r from public.service_requests where dog_id=p_dog and service_id=p_service and status='open' for update;
  if r.id is not null then
    if r.guardian_id<>auth.uid() then raise exception 'Ustalenie terminu dla tego psa wymaga kontaktu z prowadzącą.'; end if;
    result_id=r.id;
  else
    select * into s from public.services where id=p_service for share;
    if s.id is null or not s.active or not (
      (s.kind='course' and s.course_format='individual') or (s.kind='individual' and s.booking_flow='catalogue')
    ) then raise exception 'Ta usługa nie jest dostępna do ustalenia terminu.'; end if;
    if s.kind='course' and exists(select 1 from public.courses c where c.service_id=s.id and c.status='open'
      and not exists(select 1 from public.course_sessions past where past.course_id=c.id and past.starts_at<=clock_timestamp())
      and exists(select 1 from public.course_sessions future where future.course_id=c.id and future.status='scheduled' and future.starts_at>clock_timestamp())) then
      raise exception 'Ten kurs ma opublikowany termin. Przejdź do zapisów na kurs.';
    end if;
    result_id=p_request_id;
    insert into public.service_requests(id,dog_id,guardian_id,service_id,service_name,message,availability)
      values(result_id,p_dog,auth.uid(),s.id,s.name,trim(p_message),trim(p_availability));
    insert into public.service_request_history(request_id,actor_id,action,version)
      values(result_id,auth.uid(),'requested',1);
  end if;
  insert into public.service_request_receipts(request_id,result_id,guardian_id,payload)
    values(p_request_id,result_id,auth.uid(),payload);
  return result_id;
end $$;

create function public.change_service_request(p_id uuid,p_expected_version integer,p_action text,p_note text default '')
returns integer language plpgsql security definer set search_path='' as $$
declare r public.service_requests; dog uuid; change_note text;
begin
  if auth.uid() is null or p_expected_version is null or p_expected_version<1 or p_action is null
    or p_action not in ('handled','cancelled') then raise exception 'Sprawdź dane zgłoszenia.'; end if;
  select dog_id into dog from public.service_requests where id=p_id;
  perform 1 from public.dogs where id=dog for update;
  select * into r from public.service_requests where id=p_id for update;
  if r.id is null or not (public.is_admin() or (r.guardian_id=auth.uid() and public.owns_dog(r.dog_id))) then
    raise exception 'Nie znaleziono zgłoszenia.';
  end if;
  if p_action='handled' and not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_action='cancelled' and (r.guardian_id<>auth.uid() or not public.owns_dog(r.dog_id)) then raise exception 'Brak uprawnień.'; end if;
  change_note=case when p_action='cancelled' then 'Wycofane przez opiekuna.' else trim(p_note) end;
  if change_note is null or length(change_note) not between 3 and 2000 then raise exception 'Dodaj notatkę dla opiekuna (3–2000 znaków).'; end if;
  if r.status=p_action and r.version=p_expected_version+1 and exists(select 1 from public.service_request_history h
    where h.request_id=r.id and h.version=r.version and h.actor_id=auth.uid() and h.action=p_action and h.note=change_note) then return r.version; end if;
  if r.version<>p_expected_version or r.status<>'open' then raise exception 'Zgłoszenie zmieniło się. Odśwież widok.'; end if;
  update public.service_requests set status=p_action,resolution_note=change_note,version=version+1,updated_at=clock_timestamp() where id=r.id;
  insert into public.service_request_history(request_id,actor_id,action,note,version)
    values(r.id,auth.uid(),p_action,change_note,r.version+1);
  return r.version+1;
end $$;
revoke all on function public.request_service_date(uuid,uuid,uuid,text,text),public.change_service_request(uuid,integer,text,text) from public,anon;
grant execute on function public.request_service_date(uuid,uuid,uuid,text,text),public.change_service_request(uuid,integer,text,text) to authenticated;
