-- Local catalogue imported from psipawer.pl. All initial amounts are deliberately
-- 100 PLN at the user's request, NOT the website's real prices.
create table public.services (
  id uuid primary key,
  practice_id uuid not null references public.care_practices,
  name text not null check(length(trim(name)) between 3 and 160),
  description text not null default '' check(length(description)<=2000),
  kind text not null check(kind in ('individual','group','course','package','voucher')),
  booking_flow text not null check(booking_flow in ('consultation','walk','catalogue')),
  meeting_mode text check(meeting_mode in ('in_person','online')),
  price_cents integer not null check(price_cents between 1 and 1000000),
  price_unit text not null check(length(trim(price_unit)) between 3 and 80),
  duration_minutes integer check(duration_minutes between 15 and 480),
  sessions_count integer check(sessions_count between 1 and 100),
  active boolean not null default true,
  is_test_price boolean not null default true,
  source_url text not null check(source_url ~ '^https://www\.psipawer\.pl/'),
  source_note text not null default '',
  version integer not null default 1 check(version>0),
  updated_by uuid references public.profiles,
  updated_at timestamptz not null default now(),
  check(booking_flow<>'consultation' or (sessions_count=1 and duration_minutes is not null and duration_minutes<=240 and meeting_mode is not null))
);
create table public.service_revisions (
  service_id uuid not null references public.services,
  version integer not null,
  name text not null,
  price_cents integer not null,
  price_unit text not null,
  active boolean not null,
  is_test_price boolean not null,
  changed_by uuid references public.profiles,
  created_at timestamptz not null default now(),
  primary key(service_id,version)
);
alter table public.services enable row level security;
alter table public.service_revisions enable row level security;
create policy services_read on public.services for select to authenticated using(active or public.is_admin());
create policy service_revisions_read on public.service_revisions for select to authenticated using(public.is_admin());
revoke all on public.services,public.service_revisions from anon,authenticated;
grant select on public.services,public.service_revisions to authenticated;

insert into public.services(id,practice_id,name,description,kind,booking_flow,meeting_mode,price_cents,price_unit,duration_minutes,sessions_count,source_url,source_note)
select ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000001'::uuid,
  name,description,kind,flow,mode,10000,unit,duration,sessions,'https://www.psipawer.pl/'||path,note
from (values
  (1,'Psie Przedszkole — grupowe','Kurs dla opiekunów ze szczeniętami do 5. miesiąca życia.','course','catalogue','in_person','za cały kurs',60,5,'psie-przedszkole-grupowe',''),
  (2,'Psia Szkółka — grupowe','Kurs podstawowych umiejętności dla psów powyżej 5. miesiąca życia.','course','catalogue','in_person','za cały kurs',60,5,'psia-szk%C3%B3%C5%82ka-grupowe',''),
  (3,'Psie Przedszkole — indywidualne','Indywidualny kurs dla opiekunów ze szczenięciem.','course','catalogue','in_person','za cały kurs',60,5,'psie-przedszkole-indywidualne',''),
  (4,'Psia Szkółka — indywidualne','Indywidualny kurs umiejętności przydatnych w codziennym życiu z psem.','course','catalogue','in_person','za cały kurs',60,5,'psia-szk%C3%B3%C5%82ka-indywidualne',''),
  (5,'PSI FITNESS — ocena ruchowa i plan','Indywidualna ocena ruchowa z przygotowaniem planu ćwiczeń.','individual','consultation','in_person','za spotkanie',60,1,'psi-fitness-zajecia',''),
  (6,'PSI FITNESS — pakiet 4 spotkań','Cztery indywidualne treningi ruchowe po 45 minut.','package','catalogue','in_person','za cały pakiet',45,4,'psi-fitness-zajecia',''),
  (7,'Trening indywidualny','Pojedyncze spotkanie dopasowane do potrzeb opiekuna i psa.','individual','consultation','in_person','za spotkanie',60,1,'trening-indywidualny',''),
  (8,'Posłuszeństwo PAWER UP!','Kurs rozwijający umiejętności psa, który zna już podstawy.','course','catalogue','in_person','za cały kurs',60,5,'pawer-up',''),
  (9,'CITY CHALLENGE','Kurs spokojnego poruszania się po mieście, skupienia i budowania pewności siebie psa. Pięć spotkań w różnych przestrzeniach Wrocławia, w grupie do czterech psów z opiekunami.','course','catalogue','in_person','za cały kurs',60,5,'city-challenge',''),
  (10,'Konsultacja behawioralna — stacjonarna','Indywidualne omówienie trudności i dalszego planu pracy z psem.','individual','consultation','in_person','za spotkanie',90,1,'konsultacja-behawioralna',''),
  (11,'Konsultacja behawioralna — online','Konsultacja behawioralna podczas wideorozmowy.','individual','consultation','online','za spotkanie',90,1,'konsultacja-behawioralna',''),
  (12,'Walk for a dog','Indywidualna praca nad trudnościami pojawiającymi się podczas spacerów.','individual','consultation','in_person','za spotkanie',60,1,'walk-for-a-dog',''),
  (13,'Spacery socjalizacyjne — pojedynczy spacer','Spotkanie spacerowe w małej grupie psów i opiekunów.','group','walk','in_person','za psa / spacer',60,1,'spacery-socjalizacyjne',''),
  (14,'Spacery socjalizacyjne — pakiet 4 spacerów','Pakiet czterech spacerów socjalizacyjnych dla jednego psa.','package','catalogue','in_person','za psa / cały pakiet',60,4,'spacery-socjalizacyjne',''),
  (15,'Spacery socjalizacyjne — duet','Spacer w składzie dwóch psów z opiekunami.','group','walk','in_person','za psa / spacer',60,1,'spacery-socjalizacyjne',''),
  (16,'Treningi tematyczne','Grupowe spotkanie poświęcone wybranemu zagadnieniu treningowemu.','group','catalogue','in_person','za spotkanie',45,1,'treningi-tematyczne',''),
  (17,'Karta podarunkowa','Podarunek na usługę lub określoną wartość do wykorzystania.','voucher','catalogue',null,'za kartę',null,null,'karty-podarunkowe','Roboczy wariant o wartości 100 zł; obsługa wystawiania i realizacji kart jest osobnym etapem.')
) as source(n,name,description,kind,flow,mode,unit,duration,sessions,path,note);
insert into public.service_revisions(service_id,version,name,price_cents,price_unit,active,is_test_price)
  select id,version,name,price_cents,price_unit,active,is_test_price from public.services;

create function public.update_service(p_id uuid,p_expected_version integer,p_name text,p_description text,p_price_cents integer,p_price_unit text,p_duration integer,p_sessions integer,p_active boolean,p_is_test_price boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare s public.services;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version<1 or p_expected_version>=2147483647 or
    p_name is null or length(trim(p_name)) not between 3 and 160 or p_description is null or length(trim(p_description))>2000 or
    p_price_cents is null or p_price_cents not between 1 and 1000000 or p_price_unit is null or length(trim(p_price_unit)) not between 3 and 80 or
    (p_duration is not null and p_duration not between 15 and 480) or (p_sessions is not null and p_sessions not between 1 and 100) or
    p_active is null or p_is_test_price is null then raise exception 'Sprawdź dane usługi.'; end if;
  select * into s from public.services where id=p_id for update;
  if not found then raise exception 'Nie znaleziono usługi.'; end if;
  if s.booking_flow='consultation' and (p_duration is null or p_duration>240 or p_sessions is distinct from 1) then
    raise exception 'Pojedyncze spotkanie wymaga czasu 15–240 minut i liczby spotkań 1.';
  end if;
  if s.version=p_expected_version+1 and s.updated_by=auth.uid() and s.name=trim(p_name) and s.description=trim(p_description) and s.price_cents=p_price_cents and s.price_unit=trim(p_price_unit) and s.duration_minutes is not distinct from p_duration and s.sessions_count is not distinct from p_sessions and s.active=p_active and s.is_test_price=p_is_test_price then return s.version; end if;
  if s.version<>p_expected_version then raise exception 'Usługa zmieniła się. Odśwież widok przed zapisem.'; end if;
  update public.services set name=trim(p_name),description=trim(p_description),price_cents=p_price_cents,price_unit=trim(p_price_unit),duration_minutes=p_duration,sessions_count=p_sessions,active=p_active,is_test_price=p_is_test_price,version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into s;
  insert into public.service_revisions(service_id,version,name,price_cents,price_unit,active,is_test_price,changed_by)
    values(s.id,s.version,s.name,s.price_cents,s.price_unit,s.active,s.is_test_price,auth.uid());
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'service_updated',s.id,jsonb_build_object('version',s.version));
  return s.version;
end $$;
revoke all on function public.update_service(uuid,integer,text,text,integer,text,integer,integer,boolean,boolean) from public,anon,authenticated;
grant execute on function public.update_service(uuid,integer,text,text,integer,text,integer,integer,boolean,boolean) to authenticated;

-- Existing records have no invented price. New requests preserve the selected
-- service terms immediately, including retries after a later catalogue change.
alter table public.consultations add column service_id uuid references public.services;
alter table public.consultations add column service_version integer;
alter table public.consultations add column service_name text;
alter table public.consultations add column agreed_price_cents integer check(agreed_price_cents between 1 and 1000000);
alter table public.consultations add column service_duration_minutes integer;
alter table public.consultations add column service_meeting_mode text;
alter table public.consultations add column is_test_price boolean;
alter table public.consultations add constraint consultation_service_snapshot check(
  (service_id is null and service_version is null and service_name is null and agreed_price_cents is null and service_duration_minutes is null and service_meeting_mode is null and is_test_price is null) or
  (service_id is not null and service_version is not null and service_name is not null and agreed_price_cents is not null and service_duration_minutes is not null and service_meeting_mode is not null and is_test_price is not null));

drop function public.request_consultation(uuid,uuid,text,text);
create function public.request_consultation(p_id uuid,p_dog uuid,p_topic text,p_availability text,p_service uuid,p_expected_service_version integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.consultations; s public.services; event_id uuid;
begin
  if auth.uid() is null or not public.owns_dog(p_dog) then raise exception 'Nie znaleziono Twojego psa.'; end if;
  if p_id is null or p_topic is null or length(trim(p_topic)) not between 3 and 3000 or p_availability is null or length(trim(p_availability))>1000 or p_service is null or p_expected_service_version is null or p_expected_service_version<1 then raise exception 'Sprawdź treść zgłoszenia i wybierz usługę.'; end if;
  perform 1 from public.dogs where id=p_dog for update;
  select * into existing from public.consultations where id=p_id;
  if found then
    if existing.dog_id=p_dog and existing.requested_by=auth.uid() and existing.topic=trim(p_topic) and existing.availability=trim(p_availability) and existing.service_id=p_service and existing.service_version=p_expected_service_version then return existing.id; end if;
    raise exception 'To zgłoszenie zostało już zapisane. Odśwież widok.';
  end if;
  select * into s from public.services where id=p_service for share;
  if not found or not s.active or s.booking_flow<>'consultation' then raise exception 'Ta usługa nie jest dostępna do zgłoszenia.'; end if;
  if s.version<>p_expected_service_version then raise exception 'Oferta zmieniła się. Odśwież formularz i sprawdź cenę.'; end if;
  if exists(select 1 from public.consultations where dog_id=p_dog and status in ('requested','scheduled')) then raise exception 'Ten pies ma już otwarte zgłoszenie lub umówioną konsultację.'; end if;
  insert into public.consultations(id,practice_id,dog_id,requested_by,topic,availability,service_id,service_version,service_name,agreed_price_cents,service_duration_minutes,service_meeting_mode,is_test_price)
    values(p_id,s.practice_id,p_dog,auth.uid(),trim(p_topic),trim(p_availability),s.id,s.version,s.name,s.price_cents,s.duration_minutes,s.meeting_mode,s.is_test_price);
  insert into public.consultation_history(consultation_id,version,action,author_id) values(p_id,1,'requested',auth.uid()) returning id into event_id;
  insert into public.consultation_events(history_id) values(event_id);
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'consultation_requested',p_id);
  return p_id;
end $$;
revoke all on function public.request_consultation(uuid,uuid,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.request_consultation(uuid,uuid,text,text,uuid,integer) to authenticated;

-- Do not silently switch an online service to an in-person one while keeping
-- the old quoted price. That requires a separate, explicit service change.
create function public.guard_consultation_service_mode() returns trigger language plpgsql set search_path='' as $$
begin
  if new.service_id is not null and new.status in ('scheduled','completed') and new.meeting_mode is distinct from new.service_meeting_mode then raise exception 'Forma spotkania musi odpowiadać wybranej usłudze.'; end if;
  return new;
end $$;
revoke all on function public.guard_consultation_service_mode() from public,anon,authenticated;
create trigger consultation_service_mode before insert or update on public.consultations for each row execute function public.guard_consultation_service_mode();
