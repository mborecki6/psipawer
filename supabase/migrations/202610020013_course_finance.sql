-- Local only. Receipts and refunds record money handled outside the app.
-- A cancellation preserves the quote and receipts until staff explicitly settle
-- the liability; recording a settlement never records an imaginary refund.
alter table public.payments add column course_enrollment_id uuid references public.course_enrollments;
create index payments_course_enrollment_idx on public.payments(course_enrollment_id) where course_enrollment_id is not null;
alter table public.payments drop constraint payment_single_target;
alter table public.payments add constraint payment_single_target
  check(num_nonnulls(registration_id,package_id,consultation_id,course_enrollment_id)=1) not valid;
alter table public.course_enrollments add column settled_at timestamptz;
alter table public.course_enrollments add column settled_by uuid references public.profiles;

create table public.course_settlement_receipts (
  request_id uuid primary key,
  enrollment_id uuid not null references public.course_enrollments on delete cascade,
  author_id uuid not null references public.profiles,
  expected_version integer not null check(expected_version>0),
  result_version integer not null check(result_version>expected_version),
  amount_cents integer not null check(amount_cents between 0 and 1000000),
  note text not null check(length(trim(note)) between 3 and 3000),
  created_at timestamptz not null default clock_timestamp()
);
create index course_settlement_enrollment_idx on public.course_settlement_receipts(enrollment_id);
create table public.course_payment_refunds (
  id uuid primary key,
  payment_id uuid not null references public.payments on delete cascade,
  enrollment_id uuid not null references public.course_enrollments,
  guardian_id uuid not null references public.profiles,
  author_id uuid not null references public.profiles,
  amount_cents integer not null check(amount_cents between 1 and 1000000),
  note text not null check(length(trim(note)) between 3 and 2000),
  enrollment_version integer not null check(enrollment_version>0),
  created_at timestamptz not null default clock_timestamp()
);
create index course_refunds_payment_idx on public.course_payment_refunds(payment_id);
create index course_refunds_enrollment_idx on public.course_payment_refunds(enrollment_id);
alter table public.course_settlement_receipts enable row level security;
alter table public.course_payment_refunds enable row level security;
create policy course_settlement_receipts_read on public.course_settlement_receipts for select to authenticated
  using((select public.is_admin()));
create policy course_payment_refunds_read on public.course_payment_refunds for select to authenticated
  using((select public.is_admin()) or guardian_id=(select auth.uid()));
revoke all on public.course_settlement_receipts,public.course_payment_refunds from public,anon,authenticated;
grant select on public.course_settlement_receipts,public.course_payment_refunds to authenticated;

create function public.settle_course_enrollment(
  p_id uuid,p_expected_version integer,p_amount_cents integer,p_note text,p_request_id uuid
) returns integer language plpgsql security definer set search_path='' as $$
declare e public.course_enrollments; existing public.course_settlement_receipts;
  course uuid; v_note text:=trim(coalesce(p_note,'')); old_charge integer; inserted uuid;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1 or
    p_amount_cents is null or p_amount_cents not between 0 and 1000000 or length(v_note) not between 3 and 3000 then
    raise exception 'Podaj uzgodnioną kwotę i powód rozliczenia (3–3000 znaków).';
  end if;
  select course_id into course from public.course_enrollments where id=p_id;
  perform 1 from public.courses where id=course for update;
  select * into e from public.course_enrollments where id=p_id for update;
  if e.id is null then raise exception 'Nie znaleziono zgłoszenia na kurs.'; end if;
  select * into existing from public.course_settlement_receipts where request_id=p_request_id;
  if existing.request_id is not null then
    if existing.enrollment_id=p_id and existing.author_id=auth.uid() and existing.expected_version=p_expected_version
      and existing.amount_cents=p_amount_cents and existing.note=v_note then return existing.result_version; end if;
    raise exception 'Ten identyfikator rozliczenia został już użyty dla innych danych.';
  end if;
  if e.version<>p_expected_version then raise exception 'Zgłoszenie zmieniło się. Odśwież widok przed zapisem.'; end if;
  if e.status<>'cancelled' then raise exception 'Uzgodnij kwotę po rezygnacji lub odwołaniu zgłoszenia.'; end if;
  if p_amount_cents>e.agreed_price_cents or (p_amount_cents>0 and not exists(
    select 1 from public.course_history where enrollment_id=p_id and action='accept'
  )) then raise exception 'Kwota nie może przekraczać ceny przyjętego zgłoszenia.'; end if;
  insert into public.course_settlement_receipts(request_id,enrollment_id,author_id,expected_version,result_version,amount_cents,note)
    values(p_request_id,p_id,auth.uid(),p_expected_version,e.version+1,p_amount_cents,v_note)
    on conflict(request_id) do nothing returning request_id into inserted;
  if inserted is null then
    select * into existing from public.course_settlement_receipts where request_id=p_request_id;
    if existing.enrollment_id=p_id and existing.author_id=auth.uid() and existing.expected_version=p_expected_version
      and existing.amount_cents=p_amount_cents and existing.note=v_note then return existing.result_version; end if;
    raise exception 'Ten identyfikator rozliczenia został już użyty dla innych danych.';
  end if;
  old_charge=e.charge_cents;
  update public.course_enrollments set charge_cents=p_amount_cents,settled_at=clock_timestamp(),settled_by=auth.uid(),
    version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into e;
  insert into public.course_history(course_id,enrollment_id,action,actor_id,note,details)
    values(course,p_id,'settled',auth.uid(),v_note,jsonb_build_object(
      'previous_charge_cents',old_charge,'charge_cents',p_amount_cents,'version',e.version,'request_id',p_request_id));
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'course_enrollment_settled',p_id,jsonb_build_object(
      'previous_charge_cents',old_charge,'charge_cents',p_amount_cents,'version',e.version,'request_id',p_request_id));
  return e.version;
end $$;

create function public.refund_course_payment(p_payment uuid,p_amount_cents integer,p_note text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare e public.course_enrollments; payment public.payments; existing public.course_payment_refunds;
  target_enrollment uuid; course uuid; already_refunded bigint; inserted uuid; result_version integer;
  v_note text:=trim(coalesce(p_note,''));
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_payment is null or p_request_id is null or p_amount_cents is null or p_amount_cents not between 1 and 1000000
    or length(v_note) not between 3 and 2000 then raise exception 'Podaj kwotę i powód zwrotu (3–2000 znaków).'; end if;
  select course_enrollment_id into target_enrollment from public.payments where id=p_payment;
  select course_id into course from public.course_enrollments where id=target_enrollment;
  perform 1 from public.courses where id=course for update;
  select * into e from public.course_enrollments where id=target_enrollment for update;
  select * into payment from public.payments where id=p_payment for update;
  if payment.id is null or e.id is null then raise exception 'Nie znaleziono wpłaty za kurs.'; end if;
  select * into existing from public.course_payment_refunds where id=p_request_id;
  if existing.id is not null then
    if existing.payment_id=p_payment and existing.author_id=auth.uid() and existing.amount_cents=p_amount_cents
      and existing.note=v_note then return existing.id; end if;
    raise exception 'Ten identyfikator zwrotu został już użyty dla innych danych.';
  end if;
  if payment.status<>'paid' then raise exception 'Można zwrócić wyłącznie zaksięgowaną wpłatę.'; end if;
  select coalesce(sum(amount_cents),0) into already_refunded from public.course_payment_refunds where payment_id=p_payment;
  if already_refunded+p_amount_cents>payment.amount_cents then raise exception 'Zwrot przekracza pozostałą kwotę wpłaty.'; end if;
  result_version=e.version+1;
  insert into public.course_payment_refunds(id,payment_id,enrollment_id,guardian_id,author_id,amount_cents,note,enrollment_version)
    values(p_request_id,p_payment,e.id,e.guardian_id,auth.uid(),p_amount_cents,v_note,result_version)
    on conflict(id) do nothing returning id into inserted;
  if inserted is null then
    select * into existing from public.course_payment_refunds where id=p_request_id;
    if existing.payment_id=p_payment and existing.author_id=auth.uid() and existing.amount_cents=p_amount_cents
      and existing.note=v_note then return existing.id; end if;
    raise exception 'Ten identyfikator zwrotu został już użyty dla innych danych.';
  end if;
  if already_refunded+p_amount_cents=payment.amount_cents then
    update public.payments set status='refunded',refunded_at=clock_timestamp(),refunded_by=auth.uid(),refund_note=v_note where id=p_payment;
  end if;
  update public.course_enrollments set version=result_version,updated_by=auth.uid(),updated_at=clock_timestamp() where id=e.id;
  insert into public.course_history(course_id,enrollment_id,action,actor_id,note,details)
    values(course,e.id,'payment_refunded',auth.uid(),v_note,jsonb_build_object(
      'payment_id',p_payment,'refund_id',p_request_id,'amount_cents',p_amount_cents,'version',result_version));
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'payment_refunded',p_payment,jsonb_build_object(
      'course_enrollment_id',e.id,'refund_id',p_request_id,'amount_cents',p_amount_cents,'reason',v_note));
  return inserted;
end $$;

-- One function signature, supporting existing six/seven-argument callers.
drop function public.record_payment(uuid,uuid,integer,text,text,uuid,uuid);
create function public.record_payment(
  p_registration uuid,p_package uuid,p_amount_cents integer,p_method text,
  p_note text,p_request_id uuid,p_consultation uuid default null,p_course_enrollment uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.payments; registration public.walk_registrations;
  consultation public.consultations; walk public.walks; package public.packages; walk_id uuid; target_dog uuid;
  enrollment public.course_enrollments; course public.courses; course_id uuid;
  target_guardian uuid; target_price integer; already_paid bigint; result_version integer;
  payment_id uuid; note text:=trim(coalesce(p_note,''));
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if num_nonnulls(p_registration,p_package,p_consultation,p_course_enrollment)<>1 or p_request_id is null or
     p_amount_cents is null or p_amount_cents not between 1 and 1000000 or
     p_method is null or p_method not in ('cash','transfer','card','other') or length(note)>2000 then
    raise exception 'Wybierz jedno rozliczenie i podaj poprawną kwotę oraz metodę wpłaty.';
  end if;
  -- Shared order: course → enrollment → payment. Every course money mutation,
  -- participant decision and cancellation serializes on the same parent.
  if p_registration is not null then
    select wr.walk_id into walk_id from public.walk_registrations wr where wr.id=p_registration;
    select * into walk from public.walks where id=walk_id for update;
    select * into registration from public.walk_registrations where id=p_registration for update;
    if registration.id is null then raise exception 'Nie znaleziono zgłoszenia.'; end if;
    target_dog=registration.dog_id; target_price=walk.price_cents;
  elsif p_consultation is not null then
    select * into consultation from public.consultations where id=p_consultation for update;
    if not found then raise exception 'Nie znaleziono konsultacji.'; end if;
    target_dog=consultation.dog_id; target_price=consultation.agreed_price_cents;
  elsif p_course_enrollment is not null then
    select ce.course_id into course_id from public.course_enrollments ce where ce.id=p_course_enrollment;
    select * into course from public.courses where id=course_id for update;
    select * into enrollment from public.course_enrollments where id=p_course_enrollment for update;
    if enrollment.id is null then raise exception 'Nie znaleziono zgłoszenia na kurs.'; end if;
    target_dog=enrollment.dog_id; target_price=enrollment.charge_cents; target_guardian=enrollment.guardian_id;
  else
    select * into package from public.packages where id=p_package for update;
    if package.id is null then raise exception 'Nie znaleziono pakietu.'; end if;
    target_dog=package.dog_id; target_price=package.price_cents;
  end if;
  select * into existing from public.payments where request_id=p_request_id;
  if existing.id is not null then
    if existing.registration_id is not distinct from p_registration and
       existing.package_id is not distinct from p_package and
       existing.consultation_id is not distinct from p_consultation and
       existing.course_enrollment_id is not distinct from p_course_enrollment and
       existing.amount_cents=p_amount_cents and existing.method=p_method and coalesce(existing.note,'')=note then return existing.id; end if;
    raise exception 'Ten identyfikator wpłaty został już użyty dla innych danych.';
  end if;
  if p_registration is not null then
    if registration.status not in ('accepted','cancelled_late') or walk.status='cancelled' or
       (registration.status='accepted' and registration.attendance='absent') then raise exception 'To zgłoszenie nie wymaga wpłaty.'; end if;
    if registration.package_id is not null then raise exception 'To zgłoszenie jest rozliczane pakietem.'; end if;
    select coalesce(sum(amount_cents),0) into already_paid from public.payments where registration_id=p_registration and status='paid';
    if registration.payment_status='paid' and already_paid=0 then raise exception 'Zgłoszenie jest już opłacone. Sprawdź historię rozliczeń.'; end if;
  elsif p_consultation is not null then
    if consultation.status not in ('scheduled','completed') then raise exception 'Wpłatę można zapisać tylko dla umówionej lub zakończonej konsultacji.'; end if;
    if target_price is null then raise exception 'Konsultacja nie ma ustalonej ceny.'; end if;
    select coalesce(sum(amount_cents),0) into already_paid from public.payments where consultation_id=p_consultation and status='paid';
  elsif p_course_enrollment is not null then
    if not ((enrollment.status='accepted' and course.status in ('open','closed','completed')) or
      (enrollment.status='cancelled' and enrollment.settled_at is not null)) then
      raise exception 'Wpłatę za kurs zapisz dla przyjętego lub uzgodnionego po rezygnacji zgłoszenia.';
    end if;
    select coalesce(sum(p.amount_cents-(select coalesce(sum(r.amount_cents),0) from public.course_payment_refunds r where r.payment_id=p.id)),0)
      into already_paid from public.payments p where p.course_enrollment_id=p_course_enrollment and p.status='paid';
  else
    if package.status='cancelled' then raise exception 'Pakiet został anulowany.'; end if;
    select coalesce(sum(amount_cents),0) into already_paid from public.payments where package_id=p_package and status='paid';
  end if;
  if already_paid+p_amount_cents>target_price then raise exception 'Wpłata przekracza pozostałą kwotę do zapłaty.'; end if;
  if p_course_enrollment is null then select guardian_id into target_guardian from public.dogs where id=target_dog; end if;
  insert into public.payments(
    guardian_id,dog_id,registration_id,package_id,consultation_id,course_enrollment_id,amount_cents,method,status,paid_at,note,author_id,request_id
  ) values(target_guardian,target_dog,p_registration,p_package,p_consultation,p_course_enrollment,p_amount_cents,p_method,'paid',now(),note,auth.uid(),p_request_id)
    on conflict(request_id) do nothing returning id into payment_id;
  if payment_id is null then
    select * into existing from public.payments where request_id=p_request_id;
    if existing.registration_id is not distinct from p_registration and existing.package_id is not distinct from p_package and
       existing.consultation_id is not distinct from p_consultation and existing.course_enrollment_id is not distinct from p_course_enrollment and
       existing.amount_cents=p_amount_cents and existing.method=p_method and coalesce(existing.note,'')=note then return existing.id; end if;
    raise exception 'Ten identyfikator wpłaty został już użyty dla innych danych.';
  end if;
  if p_registration is not null then
    update public.walk_registrations set payment_status=case when already_paid+p_amount_cents=target_price then 'paid'::public.payment_status else 'due'::public.payment_status end where id=p_registration;
  elsif p_course_enrollment is not null then
    update public.course_enrollments set version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=p_course_enrollment returning version into result_version;
    insert into public.course_history(course_id,enrollment_id,action,actor_id,note,details)
      values(course.id,p_course_enrollment,'payment_recorded',auth.uid(),note,jsonb_build_object(
        'payment_id',payment_id,'amount_cents',p_amount_cents,'method',p_method,'version',result_version));
  end if;
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'payment_recorded',payment_id,jsonb_build_object(
    'registration_id',p_registration,'package_id',p_package,'consultation_id',p_consultation,
    'course_enrollment_id',p_course_enrollment,'amount_cents',p_amount_cents,'method',p_method));
  return payment_id;
end $$;

create or replace function public.void_payment(p_payment uuid,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare payment public.payments; registration public.walk_registrations; walk public.walks;
  target_registration uuid; target_package uuid; target_consultation uuid; target_walk uuid;
  target_enrollment uuid; target_course uuid; remaining_paid bigint; remaining_receipt integer;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_note is null or length(trim(p_note)) not between 3 and 2000 then raise exception 'Podaj powód korekty lub zwrotu wpłaty (3–2000 znaków).'; end if;
  select p.registration_id,p.package_id,p.consultation_id,p.course_enrollment_id into target_registration,target_package,target_consultation,target_enrollment
    from public.payments p where p.id=p_payment;
  if target_registration is not null then
    select wr.walk_id into target_walk from public.walk_registrations wr where wr.id=target_registration;
    select * into walk from public.walks where id=target_walk for update;
    select * into registration from public.walk_registrations where id=target_registration for update;
  elsif target_consultation is not null then perform 1 from public.consultations where id=target_consultation for update;
  elsif target_enrollment is not null then
    select course_id into target_course from public.course_enrollments where id=target_enrollment;
    perform 1 from public.courses where id=target_course for update;
    perform 1 from public.course_enrollments where id=target_enrollment for update;
  elsif target_package is not null then perform 1 from public.packages where id=target_package for update;
  end if;
  select * into payment from public.payments where id=p_payment for update;
  if payment.id is null then raise exception 'Nie znaleziono wpłaty.'; end if;
  if payment.status='refunded' then return payment.id; end if;
  if payment.status<>'paid' then raise exception 'Można skorygować wyłącznie zaksięgowaną wpłatę.'; end if;
  if target_enrollment is not null then
    select payment.amount_cents-coalesce(sum(amount_cents),0) into remaining_receipt from public.course_payment_refunds where payment_id=p_payment;
    perform public.refund_course_payment(p_payment,remaining_receipt,trim(p_note),gen_random_uuid());
    return p_payment;
  end if;
  update public.payments set status='refunded',refunded_at=now(),refunded_by=auth.uid(),refund_note=trim(p_note) where id=p_payment;
  if target_registration is not null then
    select coalesce(sum(p.amount_cents),0) into remaining_paid from public.payments p where p.registration_id=target_registration and p.status='paid';
    update public.walk_registrations wr set payment_status=case
      when wr.package_id is not null then 'none'::public.payment_status
      when (wr.status='cancelled_late' or (wr.status='accepted' and wr.attendance<>'absent')) and walk.status<>'cancelled'
        then case when remaining_paid>=walk.price_cents then 'paid'::public.payment_status else 'due'::public.payment_status end
      when remaining_paid>0 then 'paid'::public.payment_status else 'refunded'::public.payment_status end where id=target_registration;
  end if;
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'payment_refunded',p_payment,jsonb_build_object('amount_cents',payment.amount_cents,'reason',trim(p_note)));
  return p_payment;
end $$;

-- RLS on enrollments, courses, payments and refunds applies as the caller. One
-- statement observes all parts of the balance. Fully refunded receipts are
-- excluded from net paid; only partial refunds reduce still-paid receipts.
create view public.course_balances with(security_invoker=true) as
select e.id,e.course_id,e.dog_id,e.guardian_id,c.title as course_title,c.service_name,c.status as course_status,
  e.status,e.version,e.agreed_price_cents,e.is_test_price,e.charge_cents,e.created_at,e.settled_at,
  s.starts_at,p.paid_cents,r.refunded_cents,
  case when review.needs_settlement then 0 else greatest(e.charge_cents-p.paid_cents,0) end as due_cents,
  greatest(p.paid_cents-e.charge_cents,0) as refund_due_cents,review.needs_settlement,
  (review.needs_settlement or p.paid_cents>e.charge_cents) as needs_review,
  (((e.status='accepted' and c.status in ('open','closed','completed')) or (e.status='cancelled' and e.settled_at is not null))
    and e.charge_cents>p.paid_cents) as can_pay
from public.course_enrollments e join public.courses c on c.id=e.course_id
cross join lateral(select min(starts_at) as starts_at from public.course_sessions where course_id=e.course_id) s
cross join lateral(select coalesce(sum(payment.amount_cents-(select coalesce(sum(refund.amount_cents),0)
  from public.course_payment_refunds refund where refund.payment_id=payment.id)),0)::integer as paid_cents
  from public.payments payment where payment.course_enrollment_id=e.id and payment.status='paid') p
cross join lateral(select coalesce(sum(amount_cents),0) as refunded_cents from public.course_payment_refunds where enrollment_id=e.id) r
cross join lateral(select (e.status='cancelled' and e.settled_at is null and (e.charge_cents>0 or p.paid_cents>0)) as needs_settlement) review;
revoke all on public.course_balances from public,anon,authenticated;
grant select on public.course_balances to authenticated;
revoke all on function public.settle_course_enrollment(uuid,integer,integer,text,uuid),
  public.refund_course_payment(uuid,integer,text,uuid),public.record_payment(uuid,uuid,integer,text,text,uuid,uuid,uuid),
  public.void_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.settle_course_enrollment(uuid,integer,integer,text,uuid),
  public.refund_course_payment(uuid,integer,text,uuid),public.record_payment(uuid,uuid,integer,text,text,uuid,uuid,uuid),
  public.void_payment(uuid,text) to authenticated;
