-- Local only. Consultation receivables derive from the confirmed appointment's
-- frozen price, never the current catalogue. This records external receipts;
-- it does not charge a card or send money. Cancellation releases the unpaid
-- balance; retained receipts remain flagged for a manual settlement.
alter table public.payments add column consultation_id uuid references public.consultations;
create index payments_consultation_idx on public.payments(consultation_id) where consultation_id is not null;
alter table public.payments drop constraint payment_single_target;
alter table public.payments add constraint payment_single_target
  check(num_nonnulls(registration_id,package_id,consultation_id)=1) not valid;

-- Keep the old six-argument call supported through a default seventh parameter,
-- but remove the old overload so PostgREST has one unambiguous operation.
drop function public.record_payment(uuid,uuid,integer,text,text,uuid);
create function public.record_payment(
  p_registration uuid,p_package uuid,p_amount_cents integer,p_method text,
  p_note text,p_request_id uuid,p_consultation uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.payments; registration public.walk_registrations;
  consultation public.consultations; walk public.walks; package public.packages; walk_id uuid; target_dog uuid;
  target_guardian uuid; target_price integer; already_paid bigint;
  payment_id uuid; note text:=trim(coalesce(p_note,''));
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if num_nonnulls(p_registration,p_package,p_consultation)<>1 or p_request_id is null or
     p_amount_cents is null or p_amount_cents not between 1 and 1000000 or
     p_method is null or p_method not in ('cash','transfer','card','other') or
     length(note)>2000 then
    raise exception 'Wybierz jedno rozliczenie i podaj poprawną kwotę oraz metodę wpłaty.';
  end if;
  -- Lock the charge before reading its balance. Different requests for the same
  -- target cannot both spend the last remaining amount.
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
       existing.amount_cents=p_amount_cents and existing.method=p_method and
       coalesce(existing.note,'')=note then return existing.id; end if;
    raise exception 'Ten identyfikator wpłaty został już użyty dla innych danych.';
  end if;
  if p_registration is not null then
    if registration.status not in ('accepted','cancelled_late') or walk.status='cancelled' or
       (registration.status='accepted' and registration.attendance='absent') then
      raise exception 'To zgłoszenie nie wymaga wpłaty.';
    end if;
    if registration.package_id is not null then
      raise exception 'To zgłoszenie jest rozliczane pakietem.';
    end if;
    select coalesce(sum(amount_cents),0) into already_paid from public.payments
      where registration_id=p_registration and status='paid';
    if registration.payment_status='paid' and already_paid=0 then
      raise exception 'Zgłoszenie jest już opłacone. Sprawdź historię rozliczeń.';
    end if;
  elsif p_consultation is not null then
    if consultation.status not in ('scheduled','completed') then
      raise exception 'Wpłatę można zapisać tylko dla umówionej lub zakończonej konsultacji.';
    end if;
    if target_price is null then raise exception 'Konsultacja nie ma ustalonej ceny.'; end if;
    select coalesce(sum(amount_cents),0) into already_paid from public.payments
      where consultation_id=p_consultation and status='paid';
  else
    if package.status='cancelled' then raise exception 'Pakiet został anulowany.'; end if;
    select coalesce(sum(amount_cents),0) into already_paid from public.payments
      where package_id=p_package and status='paid';
  end if;
  if already_paid+p_amount_cents>target_price then
    raise exception 'Wpłata przekracza pozostałą kwotę do zapłaty.';
  end if;
  select guardian_id into target_guardian from public.dogs where id=target_dog;
  insert into public.payments(
    guardian_id,dog_id,registration_id,package_id,consultation_id,amount_cents,method,status,paid_at,note,author_id,request_id
  ) values(
    target_guardian,target_dog,p_registration,p_package,p_consultation,p_amount_cents,p_method,'paid',now(),note,auth.uid(),p_request_id
  ) on conflict(request_id) do nothing returning id into payment_id;
  -- The unique request key also serializes a reused key targeting a different
  -- charge. No extra payment or audit event survives a mismatched reuse.
  if payment_id is null then
    select * into existing from public.payments where request_id=p_request_id;
    if existing.registration_id is not distinct from p_registration and
       existing.package_id is not distinct from p_package and
       existing.consultation_id is not distinct from p_consultation and
       existing.amount_cents=p_amount_cents and existing.method=p_method and
       coalesce(existing.note,'')=note then return existing.id; end if;
    raise exception 'Ten identyfikator wpłaty został już użyty dla innych danych.';
  end if;
  if p_registration is not null then
    update public.walk_registrations set payment_status=case
      when already_paid+p_amount_cents=target_price then 'paid'::public.payment_status
      else 'due'::public.payment_status end where id=p_registration;
  end if;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'payment_recorded',payment_id,jsonb_build_object(
      'registration_id',p_registration,'package_id',p_package,'consultation_id',p_consultation,'amount_cents',p_amount_cents,'method',p_method));
  return payment_id;
end $$;

create or replace function public.void_payment(p_payment uuid,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare payment public.payments; registration public.walk_registrations;
  walk public.walks; target_registration uuid; target_package uuid; target_consultation uuid; target_walk uuid; remaining_paid bigint;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_note is null or length(trim(p_note)) not between 3 and 2000 then
    raise exception 'Podaj powód korekty lub zwrotu wpłaty (3–2000 znaków).';
  end if;
  select p.registration_id,p.package_id,p.consultation_id into target_registration,target_package,target_consultation
    from public.payments p where p.id=p_payment;
  if target_registration is not null then
    select wr.walk_id into target_walk from public.walk_registrations wr where wr.id=target_registration;
    select * into walk from public.walks where id=target_walk for update;
    select * into registration from public.walk_registrations where id=target_registration for update;
  elsif target_consultation is not null then
    perform 1 from public.consultations where id=target_consultation for update;
  elsif target_package is not null then
    perform 1 from public.packages where id=target_package for update;
  end if;
  select * into payment from public.payments where id=p_payment for update;
  if payment.id is null then raise exception 'Nie znaleziono wpłaty.'; end if;
  if payment.status='refunded' then return payment.id; end if;
  if payment.status<>'paid' then raise exception 'Można skorygować wyłącznie zaksięgowaną wpłatę.'; end if;
  update public.payments set status='refunded',refunded_at=now(),refunded_by=auth.uid(),refund_note=trim(p_note)
    where id=p_payment;
  if target_registration is not null then
    select coalesce(sum(p.amount_cents),0) into remaining_paid
      from public.payments p where p.registration_id=target_registration and p.status='paid';
    update public.walk_registrations wr set payment_status=case
      when wr.package_id is not null then 'none'::public.payment_status
      when (wr.status='cancelled_late' or (wr.status='accepted' and wr.attendance<>'absent')) and walk.status<>'cancelled'
        then case when remaining_paid>=walk.price_cents then 'paid'::public.payment_status else 'due'::public.payment_status end
      when remaining_paid>0 then 'paid'::public.payment_status
      else 'refunded'::public.payment_status end
    where id=target_registration;
  end if;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'payment_refunded',p_payment,jsonb_build_object('amount_cents',payment.amount_cents,'reason',trim(p_note)));
  return p_payment;
end $$;

-- Both base tables enforce RLS as the caller. Do not expose the view through
-- the view owner's privileges. A single statement observes price, state and
-- receipts together, including older confirmed consultations with a quote.
create view public.consultation_balances with (security_invoker=true) as
select c.id,c.dog_id,c.status,c.starts_at,c.created_at,c.service_name,
  c.agreed_price_cents,c.is_test_price,p.paid_cents,
  case when c.status in ('scheduled','completed') and c.agreed_price_cents is not null
    then greatest(c.agreed_price_cents-p.paid_cents,0) else 0 end as due_cents,
  (c.status='cancelled' and p.paid_cents>0) as needs_review
from public.consultations c
cross join lateral (
  select coalesce(sum(amount_cents) filter(where status='paid'),0)::integer as paid_cents
  from public.payments where consultation_id=c.id
) p;
revoke all on public.consultation_balances from public,anon,authenticated;
grant select on public.consultation_balances to authenticated;
revoke all on function public.record_payment(uuid,uuid,integer,text,text,uuid,uuid),
  public.void_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.record_payment(uuid,uuid,integer,text,text,uuid,uuid),
  public.void_payment(uuid,text) to authenticated;
