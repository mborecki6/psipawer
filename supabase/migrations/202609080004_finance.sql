-- These records document money received outside the app; no money is transferred.
alter table public.payments add column request_id uuid unique;
alter table public.payments add column refunded_at timestamptz;
alter table public.payments add column refunded_by uuid references public.profiles;
alter table public.payments add column refund_note text;
alter table public.payments add constraint payment_single_target
  check (num_nonnulls(registration_id,package_id)=1) not valid;

create function public.purchase_package(
  p_dog uuid,p_name text,p_entries integer,p_price_cents integer,
  p_expires_at timestamptz,p_note text
) returns uuid language plpgsql security definer set search_path='' as $$
declare package_id uuid;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_name is null or length(trim(p_name)) not between 3 and 120 or
     p_entries is null or p_entries not between 1 and 100 or
     p_price_cents is null or p_price_cents not between 1 and 1000000 or
     (p_expires_at is not null and p_expires_at<=now()) or
     length(coalesce(p_note,''))>2000 then
    raise exception 'Sprawdź nazwę, liczbę wejść, cenę i termin ważności pakietu.';
  end if;
  if not exists(select 1 from public.dogs where id=p_dog) then
    raise exception 'Nie znaleziono psa.';
  end if;
  insert into public.packages(dog_id,name,price_cents,expires_at)
    values(p_dog,trim(p_name),p_price_cents,p_expires_at) returning id into package_id;
  insert into public.package_transactions(package_id,available_delta,reason,author_id)
    values(package_id,p_entries,'Przyznanie pakietu: '||trim(p_name),auth.uid());
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'package_purchased',package_id,jsonb_build_object(
      'dog_id',p_dog,'entries',p_entries,'price_cents',p_price_cents,'note',trim(coalesce(p_note,''))));
  return package_id;
end $$;

create function public.record_payment(
  p_registration uuid,p_package uuid,p_amount_cents integer,p_method text,
  p_note text,p_request_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.payments; registration public.walk_registrations;
  walk public.walks; package public.packages; walk_id uuid; target_dog uuid;
  target_guardian uuid; target_price integer; already_paid bigint;
  payment_id uuid; note text:=trim(coalesce(p_note,''));
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if num_nonnulls(p_registration,p_package)<>1 or p_request_id is null or
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
  else
    select * into package from public.packages where id=p_package for update;
    if package.id is null then raise exception 'Nie znaleziono pakietu.'; end if;
    target_dog=package.dog_id; target_price=package.price_cents;
  end if;
  select * into existing from public.payments where request_id=p_request_id;
  if existing.id is not null then
    if existing.registration_id is not distinct from p_registration and
       existing.package_id is not distinct from p_package and
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
    guardian_id,dog_id,registration_id,package_id,amount_cents,method,status,paid_at,note,author_id,request_id
  ) values(
    target_guardian,target_dog,p_registration,p_package,p_amount_cents,p_method,'paid',now(),note,auth.uid(),p_request_id
  ) on conflict(request_id) do nothing returning id into payment_id;
  -- The unique request key also serializes a reused key targeting a different
  -- charge. No extra payment or audit event survives a mismatched reuse.
  if payment_id is null then
    select * into existing from public.payments where request_id=p_request_id;
    if existing.registration_id is not distinct from p_registration and
       existing.package_id is not distinct from p_package and
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
      'registration_id',p_registration,'package_id',p_package,'amount_cents',p_amount_cents,'method',p_method));
  return payment_id;
end $$;

-- All supported booking/attendance actions already lock walk -> registration.
-- This private trigger then locks the package and records the difference from
-- its current allocation. Repeated actions and corrections cannot double debit.
create function public.reconcile_registration_package() returns trigger
language plpgsql security definer set search_path='' as $$
declare package public.packages; available bigint; reserved bigint; used bigint;
  desired_reserved integer:=0; desired_used integer:=0;
  available_change integer; reserved_change integer; used_change integer; reason text;
begin
  if TG_OP='UPDATE' and old.package_id is not null and old.package_id is distinct from new.package_id then
    if new.package_id is not null or not public.is_admin() then
      raise exception 'Nie można zmienić przypisanego pakietu bez rozliczenia poprzedniego.';
    end if;
    select coalesce(sum(reserved_delta),0),coalesce(sum(used_delta),0) into reserved,used
      from public.package_transactions where package_id=old.package_id and registration_id=new.id;
    if reserved<>0 or used<>0 then
      raise exception 'Przed odpięciem pakietu trzeba rozliczyć przypisane wejście.';
    end if;
    return new;
  end if;
  if new.package_id is null then return new; end if;
  select * into package from public.packages where id=new.package_id for update;
  if package.dog_id<>new.dog_id then raise exception 'Pakiet należy do innego psa.'; end if;
  if exists(select 1 from public.payments where registration_id=new.id and status='paid') then
    raise exception 'Zgłoszenie ma już wpłatę. Nie można rozliczyć go ponownie pakietem.';
  end if;
  if new.status='accepted' then
    if new.attendance='pending' then
      desired_reserved=1; reason='Rezerwacja wejścia na spacer';
    elsif new.attendance in ('present','no_show') then
      desired_used=1;
      reason=case when new.attendance='present' then 'Rozliczenie obecności na spacerze' else 'Nieobecność płatna: niestawienie się' end;
    else reason='Zwrot wejścia: usprawiedliwiona nieobecność';
    end if;
  elsif new.status='cancelled_late' then
    desired_used=1; reason='Zużycie wejścia: późne odwołanie';
  else reason=case new.status
    when 'cancelled_on_time' then 'Zwrot wejścia: odwołanie bez opłaty'
    when 'waitlisted' then 'Zwrot wejścia: przeniesienie na listę rezerwową'
    when 'rejected' then 'Zwrot wejścia: odrzucone zgłoszenie'
    when 'withdrawn' then 'Zwrot wejścia: wycofane zgłoszenie'
    else 'Zwrot wejścia: zgłoszenie oczekuje na decyzję' end;
  end if;
  select coalesce(sum(available_delta),0) into available from public.package_transactions where package_id=new.package_id;
  select coalesce(sum(reserved_delta),0),coalesce(sum(used_delta),0) into reserved,used
    from public.package_transactions where package_id=new.package_id and registration_id=new.id;
  if reserved<0 or used<0 or reserved+used>1 then
    raise exception 'Historia wejścia wymaga sprawdzenia przez administratora.';
  end if;
  reserved_change=desired_reserved-reserved; used_change=desired_used-used;
  available_change=-(reserved_change+used_change);
  if available_change<0 then
    if package.status<>'active' or (package.expires_at is not null and package.expires_at<=now()) then
      raise exception 'Pakiet nie jest aktywny lub utracił ważność.';
    end if;
    if available+available_change<0 then raise exception 'Brak dostępnych wejść w pakiecie.'; end if;
  end if;
  if reserved_change<>0 or used_change<>0 then
    insert into public.package_transactions(
      package_id,registration_id,available_delta,reserved_delta,used_delta,reason,author_id
    ) values(new.package_id,new.id,available_change,reserved_change,used_change,reason,auth.uid());
  end if;
  -- A package covers this booking; its own purchase is settled separately.
  -- Do not report package usage as receipt of a cash payment.
  update public.walk_registrations set payment_status='none'
    where id=new.id and payment_status<>'none';
  return new;
end $$;
create trigger reconcile_registration_package
  after insert or update of status,attendance,package_id on public.walk_registrations
  for each row execute function public.reconcile_registration_package();

-- Excused absence and free cancellation also release a monetary charge. Keep
-- actual receipts visible for a separate refund/correction; never invent one.
create function public.reconcile_registration_cash() returns trigger
language plpgsql security definer set search_path='' as $$
declare walk public.walks; received bigint; chargeable boolean; desired public.payment_status;
begin
  if new.package_id is not null then return new; end if;
  select * into walk from public.walks where id=new.walk_id;
  select coalesce(sum(amount_cents),0) into received from public.payments
    where registration_id=new.id and status='paid';
  chargeable=walk.status<>'cancelled' and
    (new.status='cancelled_late' or (new.status='accepted' and new.attendance<>'absent'));
  if received>0 then
    desired=case when not chargeable or received>=walk.price_cents
      then 'paid'::public.payment_status else 'due'::public.payment_status end;
  elsif chargeable then
    -- Retain legacy recorded receipts that predate the payments ledger.
    desired=case when new.payment_status='paid' then 'paid'::public.payment_status else 'due'::public.payment_status end;
  else
    desired=case when new.payment_status in ('paid','refunded') then new.payment_status else 'none'::public.payment_status end;
  end if;
  update public.walk_registrations set payment_status=desired
    where id=new.id and payment_status is distinct from desired;
  return new;
end $$;
create trigger reconcile_registration_cash
  after update of status,attendance,package_id on public.walk_registrations
  for each row execute function public.reconcile_registration_cash();

create function public.use_package(p_registration uuid,p_package uuid,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare registration public.walk_registrations; walk public.walks; package public.packages; walk_id uuid;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if length(coalesce(p_note,''))>2000 then raise exception 'Notatka jest za długa.'; end if;
  select wr.walk_id into walk_id from public.walk_registrations wr where wr.id=p_registration;
  select * into walk from public.walks where id=walk_id for update;
  select * into registration from public.walk_registrations where id=p_registration for update;
  if registration.id is null then raise exception 'Nie znaleziono zgłoszenia.'; end if;
  if registration.status<>'accepted' or walk.starts_at<=now() or walk.status not in ('open','full','closed') then
    raise exception 'Pakiet można przypisać do zaakceptowanego przyszłego spaceru.';
  end if;
  select * into package from public.packages where id=p_package for update;
  if package.id is null or package.dog_id<>registration.dog_id then
    raise exception 'Wybierz pakiet przypisany do tego psa.';
  end if;
  if registration.package_id=p_package then return; end if;
  if registration.package_id is not null then raise exception 'Zgłoszenie ma już przypisany pakiet.'; end if;
  if package.status<>'active' or (package.expires_at is not null and package.expires_at<=now()) then
    raise exception 'Pakiet nie jest aktywny lub utracił ważność.';
  end if;
  if registration.payment_status='paid' or exists(
    select 1 from public.payments where registration_id=p_registration and status='paid'
  ) then raise exception 'Zgłoszenie ma już wpłatę. Nie można rozliczyć go ponownie pakietem.'; end if;
  update public.walk_registrations set package_id=p_package where id=p_registration;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'package_assigned',p_registration,jsonb_build_object('package_id',p_package,'note',trim(coalesce(p_note,''))));
end $$;

create function public.release_package(p_registration uuid,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare registration public.walk_registrations; walk public.walks; target_walk uuid;
  reserved bigint; used bigint;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_note is null or length(trim(p_note)) not between 3 and 2000 then
    raise exception 'Podaj powód odpięcia pakietu (3–2000 znaków).';
  end if;
  select wr.walk_id into target_walk from public.walk_registrations wr where wr.id=p_registration;
  select * into walk from public.walks where id=target_walk for update;
  select * into registration from public.walk_registrations where id=p_registration for update;
  if registration.id is null then raise exception 'Nie znaleziono zgłoszenia.'; end if;
  if registration.package_id is null then return; end if;
  if registration.status<>'accepted' or registration.attendance<>'pending' or
     walk.starts_at<=now() or walk.status in ('completed','cancelled') then
    raise exception 'Pakiet można odpiąć przed rozpoczęciem zaakceptowanego spaceru.';
  end if;
  perform 1 from public.packages where id=registration.package_id for update;
  select coalesce(sum(t.reserved_delta),0),coalesce(sum(t.used_delta),0) into reserved,used
    from public.package_transactions t
    where t.package_id=registration.package_id and t.registration_id=p_registration;
  if reserved<0 or used<>0 then
    raise exception 'Nie można odpiąć wykorzystanego lub nieprawidłowo rozliczonego wejścia.';
  end if;
  if reserved>0 then
    insert into public.package_transactions(
      package_id,registration_id,available_delta,reserved_delta,reason,author_id
    ) values(registration.package_id,p_registration,reserved,-reserved,
      'Odpięcie pakietu: '||trim(p_note),auth.uid());
  end if;
  update public.walk_registrations set package_id=null where id=p_registration;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'package_released',p_registration,
      jsonb_build_object('package_id',registration.package_id,'reason',trim(p_note)));
end $$;

create function public.cancel_package(p_package uuid,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare package public.packages; available bigint; reserved bigint; used bigint;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_note is null or length(trim(p_note)) not between 3 and 2000 then
    raise exception 'Podaj powód anulowania pakietu (3–2000 znaków).';
  end if;
  select * into package from public.packages where id=p_package for update;
  if package.id is null then raise exception 'Nie znaleziono pakietu.'; end if;
  if package.status='cancelled' then return; end if;
  select coalesce(sum(t.available_delta),0),coalesce(sum(t.reserved_delta),0),coalesce(sum(t.used_delta),0)
    into available,reserved,used from public.package_transactions t where t.package_id=p_package;
  if reserved<>0 or used<>0 then
    raise exception 'Pakiet ma zarezerwowane lub wykorzystane wejścia. Najpierw rozlicz powiązane spacery.';
  end if;
  if available<0 then raise exception 'Saldo pakietu wymaga sprawdzenia.'; end if;
  if available>0 then
    insert into public.package_transactions(package_id,available_delta,reason,author_id)
      values(p_package,-available,'Anulowanie niewykorzystanego pakietu: '||trim(p_note),auth.uid());
  end if;
  update public.packages set status='cancelled' where id=p_package;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'package_cancelled',p_package,
      jsonb_build_object('previous_status',package.status,'entries_removed',available,'reason',trim(p_note)));
end $$;

-- A bulk cancellation may touch several packages shared with other walks.
-- Lock all children, then all packages in a stable order before ledger triggers
-- execute. Scalar operations use the same walk -> registration -> package order.
create or replace function public.cancel_walk(p_walk uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare w public.walks; reservation record; remaining_reserved integer; affected integer;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_reason is null or length(trim(p_reason))<3 or length(p_reason)>2000 then
    raise exception 'Podaj powód odwołania (3–2000 znaków).';
  end if;
  select * into w from public.walks where id=p_walk for update;
  if w.id is null then raise exception 'Nie znaleziono spaceru.'; end if;
  if w.status='cancelled' then return; end if;
  if w.status='completed' or w.starts_at<=now() then
    raise exception 'Nie można odwołać rozpoczętego spaceru.';
  end if;
  perform wr.id from public.walk_registrations wr
    where wr.walk_id=p_walk order by wr.id for update;
  perform p.id from public.packages p where p.id in (
    select wr.package_id from public.walk_registrations wr where wr.walk_id=p_walk
    union
    select t.package_id from public.package_transactions t
      join public.walk_registrations wr on wr.id=t.registration_id where wr.walk_id=p_walk
  ) order by p.id for update;

  update public.walk_registrations set
    status='cancelled_on_time',cancelled_at=coalesce(cancelled_at,now()),
    decided_at=now(),decided_by=auth.uid(),decision_note=trim(p_reason),
    payment_status=case when payment_status in ('paid','refunded') then payment_status else 'none'::public.payment_status end
    where walk_id=p_walk and status in ('accepted','pending','waitlisted','cancelled_late');
  get diagnostics affected = row_count;
  -- Current assignments are reconciled by the trigger. Include historical
  -- reservations from before that trigger existed, without duplicating returns.
  for reservation in
    select distinct t.package_id,t.registration_id from public.package_transactions t
      join public.walk_registrations wr on wr.id=t.registration_id
      where wr.walk_id=p_walk order by t.package_id,t.registration_id
  loop
    select coalesce(sum(t.reserved_delta),0)::integer into remaining_reserved
      from public.package_transactions t
      where t.package_id=reservation.package_id and t.registration_id=reservation.registration_id;
    if remaining_reserved>0 then
      insert into public.package_transactions(package_id,registration_id,available_delta,reserved_delta,reason,author_id)
        values(reservation.package_id,reservation.registration_id,remaining_reserved,-remaining_reserved,
          'Odwołanie spaceru przez organizatora',auth.uid());
    end if;
  end loop;
  update public.walks set status='cancelled',cancellation_reason=trim(p_reason) where id=p_walk;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'walk_cancelled',p_walk,
      jsonb_build_object('reason',trim(p_reason),'previous_status',w.status,'registrations_closed',affected));
end $$;

create function public.void_payment(p_payment uuid,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare payment public.payments; registration public.walk_registrations;
  walk public.walks; target_registration uuid; target_package uuid; target_walk uuid; remaining_paid bigint;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_note is null or length(trim(p_note)) not between 3 and 2000 then
    raise exception 'Podaj powód korekty lub zwrotu wpłaty (3–2000 znaków).';
  end if;
  select p.registration_id,p.package_id into target_registration,target_package
    from public.payments p where p.id=p_payment;
  if target_registration is not null then
    select wr.walk_id into target_walk from public.walk_registrations wr where wr.id=target_registration;
    select * into walk from public.walks where id=target_walk for update;
    select * into registration from public.walk_registrations where id=target_registration for update;
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

revoke execute on function public.purchase_package(uuid,text,integer,integer,timestamptz,text),
  public.record_payment(uuid,uuid,integer,text,text,uuid),public.use_package(uuid,uuid,text),
  public.release_package(uuid,text),public.cancel_package(uuid,text),public.void_payment(uuid,text),
  public.reconcile_registration_package(),public.reconcile_registration_cash() from public,anon,authenticated;
grant execute on function public.purchase_package(uuid,text,integer,integer,timestamptz,text),
  public.record_payment(uuid,uuid,integer,text,text,uuid),public.use_package(uuid,uuid,text),
  public.release_package(uuid,text),public.cancel_package(uuid,text),public.void_payment(uuid,text) to authenticated;
