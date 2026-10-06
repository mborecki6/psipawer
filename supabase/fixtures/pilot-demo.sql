-- Explicit pilot fixture, never an automatic deployment seed. All people,
-- dogs, receipts and appointments below are fictional and labelled DEMO.
-- The operator supplies two confirmed Auth accounts with the matching marker,
-- and replaces the two gift-code placeholders with private random codes.
-- One transaction and a receipt prevent duplication; no resets or deletions.
begin;
set local timezone='Europe/Warsaw';
do $fixture$
declare
  staff uuid; guardian uuid; other_guardian uuid; base timestamptz;
  k constant uuid := 'd0610000-0000-4000-8000-000000000001';
  b constant uuid := 'd0610000-0000-4000-8000-000000000002';
  l constant uuid := 'd0610000-0000-4000-8000-000000000003';
  f constant uuid := 'd0610000-0000-4000-8000-000000000004';
  course_session uuid; fitness_session uuid; walk_package_id uuid; publication jsonb;
  starts jsonb; fitness_service_version integer; marker constant uuid := 'd0600000-0000-4000-8000-000000000001';
begin
  if exists(select 1 from public.audit_events where event='pilot_demo_seeded' and entity_id=marker) then return; end if;
  select u.id into staff from auth.users u join public.user_roles r on r.user_id=u.id
    where u.email='asiakostrzanowska@gmail.com' and r.role='admin';
  select id into guardian from auth.users where email='demo.opiekun@psipawer.test'
    and raw_user_meta_data->>'psi_demo_seed'='psi-pilot-2026-10-06';
  select id into other_guardian from auth.users where email='demo.opiekun2@psipawer.test'
    and raw_user_meta_data->>'psi_demo_seed'='psi-pilot-2026-10-06';
  if staff is null or guardian is null or other_guardian is null or
    (select count(*) from public.user_roles where user_id in (guardian,other_guardian) and role='client')<>2 then
    raise exception 'Missing authorized pilot staff and two tagged client accounts.';
  end if;
  if exists(select 1 from public.dogs where id in (k,b,l,f)) then
    raise exception 'Fixture IDs already in use; do not overwrite existing data.';
  end if;
  base:=date_trunc('day',clock_timestamp());
  perform set_config('request.jwt.claim.sub',staff::text,true);
  update public.profiles set full_name='DEMO · Anna Testowa',phone='000 000 000',area='Wrocław — dane fikcyjne' where id=guardian;
  update public.profiles set full_name='DEMO · Piotr Testowy',phone='000 000 000',area='Wrocław — dane fikcyjne' where id=other_guardian;
  insert into public.dogs(id,guardian_id,name,approximate_age,breed,sex,status) values
    (k,guardian,'DEMO · Kluska','około 3 lat','Mieszaniec','female','approved'),
    (b,guardian,'DEMO · Borys','około 1 roku','Mieszaniec','male','new'),
    (l,other_guardian,'DEMO · Luna','około 4 lat','Mieszaniec','female','approved'),
    (f,other_guardian,'DEMO · Figa','około 2 lat','Mieszaniec','female','approved');
  insert into public.dog_behavior_profiles(dog_id,comfort_distance,reactions,helps,goals) values
    (k,'DEMO: około 10 metrów','Fikcyjny opis do przeglądu profilu','Spokojne otoczenie — przykład','Testowanie zaleceń i spacerów'),
    (b,'DEMO: do ustalenia','Nowy profil czeka na prowadzącą','Dane demonstracyjne','Uzupełnienie i zatwierdzenie profilu');
  insert into public.dog_notes(dog_id,author_id,body,visibility) values
    (k,staff,'DEMO: prywatna notatka prowadzącej. Opiekun jej nie widzi.','admin_only'),
    (k,staff,'DEMO: wspólna notatka dotycząca fikcyjnego spaceru.','client_visible');
  insert into public.walks(id,starts_at,duration_minutes,public_location,type,price_cents,capacity,leader_id,info,status) values
    ('d0620000-0000-4000-8000-000000000001',base+interval '1 day 17 hours',60,'DEMO · Park Pawłowicki','Spacer socjalizacyjny',10000,4,staff,'DEMO: zgłoszenia oczekujące i lista rezerwowa.','open'),
    ('d0620000-0000-4000-8000-000000000002',base+interval '2 days 17 hours',60,'DEMO · Park Zachodni','Spacer socjalizacyjny',10000,4,staff,'DEMO: potwierdzony spacer z częściową wpłatą.','open'),
    ('d0620000-0000-4000-8000-000000000003',base+interval '8 days 17 hours',60,'DEMO · Niskie Łąki','Spacer socjalizacyjny',10000,4,staff,'DEMO: historyczny spacer i opłacona obecność.','open'),
    ('d0620000-0000-4000-8000-000000000004',base+interval '4 days 17 hours',60,'DEMO · Wolne miejsca','Spacer socjalizacyjny',10000,4,staff,'DEMO: możesz przetestować nowy zapis lub użycie pakietu.','open');
  insert into public.walk_private_details(walk_id,exact_location,instructions)
    select id,'DEMO: fikcyjne miejsce zbiórki — nie przychodź na ten termin.','Wyłącznie test aplikacji. Wszystkie spotkania są fikcyjne.'
    from public.walks where id in ('d0620000-0000-4000-8000-000000000001','d0620000-0000-4000-8000-000000000002','d0620000-0000-4000-8000-000000000003','d0620000-0000-4000-8000-000000000004');
  insert into public.walk_registrations(id,walk_id,dog_id,status,payment_status,decided_by) values
    ('d0630000-0000-4000-8000-000000000001','d0620000-0000-4000-8000-000000000001',k,'pending','none',null),
    ('d0630000-0000-4000-8000-000000000002','d0620000-0000-4000-8000-000000000001',l,'accepted','due',staff),
    ('d0630000-0000-4000-8000-000000000003','d0620000-0000-4000-8000-000000000001',f,'waitlisted','none',staff),
    ('d0630000-0000-4000-8000-000000000004','d0620000-0000-4000-8000-000000000002',k,'accepted','due',staff),
    ('d0630000-0000-4000-8000-000000000005','d0620000-0000-4000-8000-000000000003',k,'accepted','due',staff);
  update public.walks set starts_at=base-interval '3 days'+interval '17 hours',status='completed' where id='d0620000-0000-4000-8000-000000000003';
  insert into public.dog_relations(dog_a,dog_b,level,note,author_id)
    values(least(k,l),greatest(k,l),'caution','DEMO: ostrzeżenie do przejrzenia przed przyjęciem na wspólny spacer.',staff);

  set local role authenticated;
  perform public.mark_attendance('d0630000-0000-4000-8000-000000000005','present');
  perform public.record_payment('d0630000-0000-4000-8000-000000000005',null,10000,'other','DEMO: fikcyjna wpłata 100 zł','d0690000-0000-4000-8000-000000000001');
  perform public.record_payment('d0630000-0000-4000-8000-000000000004',null,4000,'other','DEMO: fikcyjna zaliczka 40 zł','d0690000-0000-4000-8000-000000000002');
  walk_package_id:=public.purchase_package(k,'DEMO · Pakiet trzech spacerów',3,10000,base+interval '60 days','DEMO: fikcyjny pakiet do sprawdzenia wejść.');
  perform public.record_payment(null,walk_package_id,10000,'other','DEMO: fikcyjna wpłata za pakiet','d0690000-0000-4000-8000-000000000003');

  perform set_config('request.jwt.claim.sub',guardian::text,true);
  perform public.request_consultation('d0640000-0000-4000-8000-000000000001',k,'DEMO · Zakończona konsultacja i zalecenia','Dane fikcyjne','60000000-0000-4000-8000-000000000011',1);
  perform set_config('request.jwt.claim.sub',staff::text,true);
  perform public.change_consultation('d0640000-0000-4000-8000-000000000001',1,'schedule',base+interval '7 days 12 hours',60,'online','DEMO: fikcyjne spotkanie online','');
  reset role;
  -- Only fixture rows are backdated to make attendance/completion clickable now.
  update public.consultations set starts_at=base-interval '4 days'+interval '12 hours' where id='d0640000-0000-4000-8000-000000000001';
  set local role authenticated;
  perform public.change_consultation('d0640000-0000-4000-8000-000000000001',2,'complete',null,null,null,null,'DEMO: konsultacja zakończona');
  perform public.record_payment(null,null,10000,'other','DEMO: fikcyjna wpłata za konsultację','d0690000-0000-4000-8000-000000000005','d0640000-0000-4000-8000-000000000001');
  publication:=public.save_care_plan(k,0,'DEMO · Plan po konsultacji','To fikcyjna treść do testowania aplikacji. Zapisz przykładową obserwację i sprawdź historię wersji.',current_date-1,true,'d0640000-0000-4000-8000-000000000001');
  perform set_config('request.jwt.claim.sub',guardian::text,true);
  perform public.submit_care_progress('d0680000-0000-4000-8000-000000000001',(publication->>'published_id')::uuid,'DEMO: ćwiczyliśmy spokojne wyjście.','DEMO: krótszy spacer był łatwiejszy.','DEMO: proszę o przykład kolejnego ćwiczenia.');
  perform public.request_consultation('d0640000-0000-4000-8000-000000000002',k,'DEMO · Zaplanowana konsultacja','Popołudnia — przykład','60000000-0000-4000-8000-000000000011',1);
  perform set_config('request.jwt.claim.sub',staff::text,true);
  perform public.change_consultation('d0640000-0000-4000-8000-000000000002',1,'schedule',base+interval '2 days 10 hours',60,'online','DEMO: spotkanie testowe online','');
  perform public.record_payment(null,null,3000,'other','DEMO: fikcyjna zaliczka 30 zł','d0690000-0000-4000-8000-000000000007','d0640000-0000-4000-8000-000000000002');
  perform set_config('request.jwt.claim.sub',other_guardian::text,true);
  perform public.request_consultation('d0640000-0000-4000-8000-000000000003',l,'DEMO · Nowe zgłoszenie konsultacji','Proszę o zaproponowanie terminu — dane fikcyjne','60000000-0000-4000-8000-000000000011',1);

  perform set_config('request.jwt.claim.sub',staff::text,true);
  select jsonb_agg(to_char(base+interval '3 days 10 hours'+make_interval(days=>n*7),'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') order by n) into starts from generate_series(0,4) n;
  perform public.create_course('d0650000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',1,'DEMO · Kurs grupowy — zapisy i rozliczenia',4,'DEMO · Plac treningowy','Fikcyjna zbiórka. Nie przychodź na termin.',starts);
  perform public.change_course('d0650000-0000-4000-8000-000000000001',1,'publish','');
  perform set_config('request.jwt.claim.sub',guardian::text,true);
  perform public.request_course_enrollment('d0651000-0000-4000-8000-000000000001','d0650000-0000-4000-8000-000000000001',k,2);
  perform set_config('request.jwt.claim.sub',other_guardian::text,true);
  perform public.request_course_enrollment('d0651000-0000-4000-8000-000000000002','d0650000-0000-4000-8000-000000000001',l,2);
  perform set_config('request.jwt.claim.sub',staff::text,true);
  perform public.change_course_enrollment('d0651000-0000-4000-8000-000000000001',1,'accept','');
  perform public.record_payment(null,null,5000,'other','DEMO: fikcyjna zaliczka 50 zł','d0690000-0000-4000-8000-000000000008',null,'d0651000-0000-4000-8000-000000000001');
  select id into course_session from public.course_sessions where course_id='d0650000-0000-4000-8000-000000000001' and ordinal=1;
  reset role;
  update public.course_sessions set starts_at=base-interval '2 days'+interval '10 hours' where id=course_session;
  set local role authenticated;
  perform public.record_course_attendance(course_session,'d0651000-0000-4000-8000-000000000001',0,'present');
  perform public.change_course_session(course_session,1,'complete','DEMO: pierwsze spotkanie zakończone');
  perform public.save_care_plan(k,1,'DEMO · Zalecenia ze spotkania kursu','Fikcyjny plan kursowy. Otwórz poprzedni plan i porównaj publikacje.',current_date+3,true,null,'d0651000-0000-4000-8000-000000000001',course_session);
  select jsonb_agg(to_char(base+interval '5 days 10 hours'+make_interval(days=>n*7),'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') order by n) into starts from generate_series(0,4) n;
  perform public.create_course('d0650000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',1,'DEMO · Szkic kursu do opublikowania',4,'DEMO · Drugi plac','Fikcyjny adres do sprawdzenia publikacji.',starts);

  select version into fitness_service_version from public.services where id='60000000-0000-4000-8000-000000000006';
  perform set_config('request.jwt.claim.sub',guardian::text,true);
  perform public.request_fitness_package('d0660000-0000-4000-8000-000000000001',k,'60000000-0000-4000-8000-000000000006',fitness_service_version,'DEMO · Aktywny pakiet fitness','Fikcyjne terminy');
  perform set_config('request.jwt.claim.sub',staff::text,true);
  perform public.change_fitness_package('d0660000-0000-4000-8000-000000000001',1,'accept','','d0690000-0000-4000-8000-000000000009');
  select id into fitness_session from public.fitness_sessions where package_id='d0660000-0000-4000-8000-000000000001' and ordinal=1;
  perform public.save_fitness_session(fitness_session,1,base+interval '4 days 14 hours','DEMO: fikcyjne miejsce','DEMO: przykładowe spotkanie','d0690000-0000-4000-8000-000000000010');
  reset role;
  update public.fitness_sessions set starts_at=base-interval '1 day'+interval '14 hours' where id=fitness_session;
  set local role authenticated;
  perform public.change_fitness_session(fitness_session,2,'complete','present','DEMO: spotkanie zakończone','d0690000-0000-4000-8000-000000000011');
  perform public.save_care_plan(k,2,'DEMO · Plan po fitness','Fikcyjny plan do sprawdzenia odpowiedzi opiekuna i powiązania ze spotkaniem fitness.',current_date+2,true,null,null,null,'d0660000-0000-4000-8000-000000000001',fitness_session);
  perform public.save_fitness_session((select id from public.fitness_sessions where package_id='d0660000-0000-4000-8000-000000000001' and ordinal=2),1,base+interval '4 days 14 hours','DEMO: fikcyjne miejsce','DEMO: kolejne spotkanie','d0690000-0000-4000-8000-000000000012');
  perform public.record_fitness_payment('d0660000-0000-4000-8000-000000000001',2500,'other','DEMO: fikcyjna wpłata 25 zł','d0690000-0000-4000-8000-000000000013');
  perform public.save_care_plan(k,3,'DEMO · Prywatny szkic kolejnego planu','To prywatny szkic prowadzącej. Opiekun nie powinien widzieć tej treści.',null,false);
  perform set_config('request.jwt.claim.sub',other_guardian::text,true);
  perform public.request_fitness_package('d0660000-0000-4000-8000-000000000002',f,'60000000-0000-4000-8000-000000000006',fitness_service_version,'DEMO · Nowe zgłoszenie fitness','Do uzgodnienia — dane fikcyjne');
  perform public.request_fitness_package('d0660000-0000-4000-8000-000000000003',l,'60000000-0000-4000-8000-000000000006',fitness_service_version,'DEMO · Odwołany pakiet do przywrócenia','Dane fikcyjne');
  perform set_config('request.jwt.claim.sub',staff::text,true);
  perform public.change_fitness_package('d0660000-0000-4000-8000-000000000003',1,'accept','','d0690000-0000-4000-8000-000000000014');
  perform public.change_fitness_package('d0660000-0000-4000-8000-000000000003',2,'cancel','DEMO: przykładowa rezygnacja','d0690000-0000-4000-8000-000000000015');
  perform public.save_care_template('d0680000-0000-4000-8000-000000000002',0,'DEMO · Materiał do skopiowania','Fikcyjny materiał biblioteki. Skopiuj go do nowego szkicu i edytuj treść.');
  perform public.issue_gift_card('d0670000-0000-4000-8000-000000000001',null,null,10000,current_date,'DEMO · Anna','DEMO · Anna','Fikcyjna karta do próby rozliczenia',guardian,'other','DEMO: bez rzeczywistej transakcji','__DEMO_GIFT_CODE_ASSIGNED__');
  perform public.issue_gift_card('d0670000-0000-4000-8000-000000000002',null,null,10000,current_date,'DEMO · Nadawca','DEMO · Do przypisania','Fikcyjna karta do sprawdzenia kodu',null,'other','DEMO: bez rzeczywistej transakcji','__DEMO_GIFT_CODE_UNCLAIMED__');
  reset role;
  insert into public.psiutki_profiles(dog_id,display_name,moderation_status,published,area,headline,seeking)
    values(k,'DEMO · Kluska','approved',true,'Wrocław','Fikcyjny profil do testowania społeczności','DEMO: opis do przejrzenia w katalogu psów.'),
      (l,'DEMO · Luna','approved',true,'Wrocław','Drugi fikcyjny profil społeczności','DEMO: drugi opiekun ma osobne dane i osobny panel.');
  insert into public.psiutki_profile_reviews(dog_id,consented_at,consented_by,reviewed_at,reviewed_by,moderation_note)
    values(k,clock_timestamp(),guardian,clock_timestamp(),staff,'DEMO: fikcyjna zgoda i moderacja profilu.'),
      (l,clock_timestamp(),other_guardian,clock_timestamp(),staff,'DEMO: fikcyjna zgoda i moderacja profilu.');
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(staff,'pilot_demo_seeded',marker,jsonb_build_object('fixture','psi-pilot-2026-10-06','fictional',true));
end $fixture$;
commit;
