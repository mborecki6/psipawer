-- Local test integration only. This migration deliberately leaves payment
-- creation disabled; the local coordinator must explicitly enable its fixture.
create table public.online_payment_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  walk_gate text not null default 'disabled' check(walk_gate in ('disabled','accepted'))
);
insert into public.online_payment_settings(singleton) values(true);
alter table public.online_payment_settings enable row level security;
revoke all on public.online_payment_settings from public,anon,authenticated;
grant select,update on public.online_payment_settings to service_role;

create table public.online_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  target_kind text not null check(target_kind in ('registration','consultation','course','fitness')),
  target_id uuid not null,
  guardian_id uuid not null references public.profiles,
  dog_id uuid not null references public.dogs,
  amount_cents integer not null check(amount_cents between 1 and 1000000),
  currency text not null default 'PLN' check(currency='PLN'),
  environment text not null check(environment in ('sandbox','simulator')),
  status text not null default 'creating' check(status in ('creating','pending','uncertain','failed','paid','requires_review')),
  transaction_id text,
  transaction_title text,
  merchant_id text,
  checkout_url text,
  payment_id uuid unique references public.payments,
  confirmed_amount_cents integer check(confirmed_amount_cents>0),
  confirmed_at timestamptz,
  review_reason text check(review_reason in ('owner_changed','no_longer_payable','balance_changed','unbound_transaction','chargeback','amount_mismatch')),
  error_code text check(length(error_code)<=200),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check((confirmed_amount_cents is null)=(confirmed_at is null)),
  check(status<>'paid' or (payment_id is not null and confirmed_at is not null)),
  check(status<>'requires_review' or review_reason is not null)
);
create unique index online_payment_transaction on public.online_payment_attempts(environment,transaction_id) where transaction_id is not null;
create unique index online_payment_title on public.online_payment_attempts(environment,transaction_title) where transaction_title is not null;
-- Only one externally unfinished creation can be started. Several previously
-- failed transactions may genuinely arrive late, so review receipts cannot be
-- unique here; begin checks them explicitly before starting anything new.
create unique index online_payment_one_active on public.online_payment_attempts(target_kind,target_id)
  where status in ('creating','pending','uncertain');
create index online_payment_guardian_history on public.online_payment_attempts(guardian_id,created_at desc,id);
alter table public.online_payment_attempts enable row level security;
create policy online_payment_read on public.online_payment_attempts for select to authenticated
  using((select public.is_admin()) or guardian_id=(select auth.uid()));
revoke all on public.online_payment_attempts from public,anon,authenticated;
grant select on public.online_payment_attempts to authenticated,service_role;

-- A system receipt has its own provenance; it never impersonates a profile.
alter table public.payments add column online_attempt_id uuid unique references public.online_payment_attempts;
alter table public.payments alter column author_id drop not null;
alter table public.payments add constraint payment_online_author check(
  (online_attempt_id is null and author_id is not null and method not in ('tpay_sandbox','tpay_simulator')) or
  (online_attempt_id is not null and author_id is null and method in ('tpay_sandbox','tpay_simulator'))
);

-- All callers lock the same charge parents as the existing manual functions.
-- The dog lock also serializes a receipt against a concurrent owner transfer.
create function public.lock_online_payment_target(p_kind text,p_target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.walk_registrations; w public.walks; c public.consultations;
  e public.course_enrollments; course public.courses; f public.fitness_packages;
  d public.dogs; parent_id uuid; price integer; paid bigint:=0; eligible boolean:=false;
  stored_guardian uuid; gate text;
begin
  if p_kind='registration' then
    select walk_id into parent_id from public.walk_registrations where id=p_target;
    select * into w from public.walks where id=parent_id for update;
    select * into r from public.walk_registrations where id=p_target for update;
    if r.id is null then return null; end if;
    select * into d from public.dogs where id=r.dog_id for share;
    price=w.price_cents;
    select coalesce(sum(amount_cents),0) into paid from public.payments where registration_id=r.id and status='paid';
    -- Preserve legacy paid markers which have no ledger receipt.
    if r.payment_status='paid' and paid=0 then paid=price; end if;
    select walk_gate into gate from public.online_payment_settings where singleton;
    eligible=r.status='accepted' and w.status in ('open','full','closed','completed')
      and r.attendance<>'absent' and r.package_id is null
      and gate='accepted';
  elsif p_kind='consultation' then
    select * into c from public.consultations where id=p_target for update;
    if c.id is null then return null; end if;
    select * into d from public.dogs where id=c.dog_id for share;
    price=c.agreed_price_cents;
    select coalesce(sum(amount_cents),0) into paid from public.payments where consultation_id=c.id and status='paid';
    eligible=c.status in ('scheduled','completed') and price is not null;
  elsif p_kind='course' then
    select course_id into parent_id from public.course_enrollments where id=p_target;
    select * into course from public.courses where id=parent_id for update;
    select * into e from public.course_enrollments where id=p_target for update;
    if e.id is null then return null; end if;
    select * into d from public.dogs where id=e.dog_id for share;
    stored_guardian=e.guardian_id; price=e.charge_cents;
    select coalesce(sum(p.amount_cents-(select coalesce(sum(amount_cents),0) from public.course_payment_refunds where payment_id=p.id)),0)
      into paid from public.payments p where p.course_enrollment_id=e.id and p.status='paid';
    eligible=e.status='accepted' and course.status in ('open','closed','completed');
  elsif p_kind='fitness' then
    select * into f from public.fitness_packages where id=p_target for update;
    if f.id is null then return null; end if;
    select * into d from public.dogs where id=f.dog_id for share;
    stored_guardian=f.guardian_id; price=f.charge_cents;
    select coalesce(sum(p.amount_cents-(select coalesce(sum(amount_cents),0) from public.fitness_payment_refunds where payment_id=p.id)),0)
      into paid from public.payments p where p.fitness_package_id=f.id and p.status='paid';
    eligible=f.status in ('active','completed') and f.accepted_at is not null;
  else
    return null;
  end if;
  if d.id is null then return null; end if;
  return jsonb_build_object('dog_id',d.id,'guardian_id',d.guardian_id,
    'stored_guardian_id',coalesce(stored_guardian,d.guardian_id),'due_cents',greatest(coalesce(price,0)-paid,0),
    'payable',coalesce(eligible,false) and coalesce(price,0)>0);
end $$;
revoke all on function public.lock_online_payment_target(text,uuid) from public,anon,authenticated,service_role;

create function public.begin_online_payment(p_kind text,p_target uuid,p_request_id uuid,p_environment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target jsonb; attempt public.online_payment_attempts;
begin
  if auth.uid() is null or not exists(select 1 from public.user_roles where user_id=auth.uid() and role='client') then
    raise exception 'Brak uprawnień.';
  end if;
  if not exists(select 1 from public.online_payment_settings where singleton and enabled) then
    raise exception 'Płatności testowe są wyłączone.';
  end if;
  if p_kind is null or p_kind not in ('registration','consultation','course','fitness') or p_target is null or
    p_request_id is null or p_environment is null or p_environment not in ('sandbox','simulator') then
    raise exception 'Niepoprawne dane płatności testowej.';
  end if;
  target=public.lock_online_payment_target(p_kind,p_target);
  -- Serialize request-key reuse even across different charge parents.
  perform pg_advisory_xact_lock(hashtextextended('online-payment:'||p_request_id::text,0));
  select * into attempt from public.online_payment_attempts where request_id=p_request_id;
  if attempt.id is not null then
    if attempt.guardian_id=auth.uid() and attempt.target_kind=p_kind and attempt.target_id=p_target and attempt.environment=p_environment then
      return jsonb_build_object('attempt',to_jsonb(attempt),'created',false);
    end if;
    raise exception 'Ten identyfikator płatności został już użyty.';
  end if;
  if target is null or (target->>'guardian_id')::uuid<>auth.uid() or (target->>'stored_guardian_id')::uuid<>auth.uid() then
    raise exception 'Nie znaleziono własnej należności.';
  end if;
  if not (target->>'payable')::boolean or (target->>'due_cents')::integer not between 1 and 1000000 then
    raise exception 'Ta usługa nie ma przyjętej należności do zapłaty.';
  end if;
  select * into attempt from public.online_payment_attempts where target_kind=p_kind and target_id=p_target
    and status in ('creating','pending','uncertain','requires_review')
    order by (status='requires_review') desc,created_at desc limit 1;
  if attempt.id is not null then
    if attempt.guardian_id<>auth.uid() or attempt.environment<>p_environment then
      raise exception 'Wcześniejsza płatność wymaga sprawdzenia.';
    end if;
    return jsonb_build_object('attempt',to_jsonb(attempt),'created',false);
  end if;
  insert into public.online_payment_attempts(request_id,target_kind,target_id,guardian_id,dog_id,amount_cents,environment)
    values(p_request_id,p_kind,p_target,auth.uid(),(target->>'dog_id')::uuid,(target->>'due_cents')::integer,p_environment)
    returning * into attempt;
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'online_payment_started',attempt.id,
    jsonb_build_object('target_kind',p_kind,'target_id',p_target,'amount_cents',attempt.amount_cents,'environment',p_environment));
  return jsonb_build_object('attempt',to_jsonb(attempt),'created',true);
end $$;

create function public.bind_online_payment(p_attempt uuid,p_transaction_id text,p_transaction_title text,p_merchant_id text,p_checkout_url text)
returns public.online_payment_attempts language plpgsql security definer set search_path='' as $$
declare attempt public.online_payment_attempts;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Brak uprawnień operatora.'; end if;
  if not exists(select 1 from public.online_payment_settings where singleton and enabled) then raise exception 'Płatności testowe są wyłączone.'; end if;
  if p_transaction_id is null or length(trim(p_transaction_id)) not between 1 and 200 or
    p_transaction_title is null or length(trim(p_transaction_title)) not between 1 and 200 or
    p_merchant_id is null or length(trim(p_merchant_id)) not between 1 and 100 or p_checkout_url is null or length(p_checkout_url)>2000 then
    raise exception 'Niepoprawna transakcja operatora.';
  end if;
  select * into attempt from public.online_payment_attempts where id=p_attempt for update;
  if attempt.id is null then raise exception 'Nie znaleziono próby płatności.'; end if;
  if (attempt.environment='sandbox' and p_checkout_url!~'^https://secure[.]sandbox[.]tpay[.]com/') or
    (attempt.environment='simulator' and p_checkout_url!~'^http://(localhost|127[.]0[.]0[.]1)(:[0-9]+)?/') then
    raise exception 'Niepoprawny adres płatności testowej.';
  end if;
  if (attempt.transaction_id is not null and attempt.transaction_id<>p_transaction_id) or
    (attempt.transaction_title is not null and attempt.transaction_title<>p_transaction_title) or
    (attempt.merchant_id is not null and attempt.merchant_id<>p_merchant_id) or
    (attempt.checkout_url is not null and attempt.checkout_url<>p_checkout_url) then
    raise exception 'Transakcja nie odpowiada zapisanej próbie.';
  end if;
  update public.online_payment_attempts set transaction_id=p_transaction_id,transaction_title=p_transaction_title,
    merchant_id=p_merchant_id,checkout_url=p_checkout_url,
    status=case when status in ('creating','uncertain') then 'pending' else status end,updated_at=clock_timestamp()
    where id=p_attempt returning * into attempt;
  return attempt;
end $$;

create function public.record_online_payment_outcome(
  p_attempt uuid,p_environment text,p_transaction_id text,p_merchant_id text,p_status text,
  p_amount_cents integer,p_currency text,p_transaction_title text default null,p_reason text default null,p_paid_cents integer default null
) returns public.online_payment_attempts language plpgsql security definer set search_path='' as $$
declare attempt public.online_payment_attempts; target jsonb; receipt uuid; review text; kind text; target_id uuid;
  received integer:=coalesce(p_paid_cents,p_amount_cents); previous_received integer;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Brak uprawnień operatora.'; end if;
  if not exists(select 1 from public.online_payment_settings where singleton and enabled) then raise exception 'Płatności testowe są wyłączone.'; end if;
  if p_status is null or p_status not in ('pending','uncertain','failed','paid','chargeback') or length(coalesce(p_reason,''))>200 then
    raise exception 'Niepoprawny wynik operatora.';
  end if;
  select target_kind,a.target_id into kind,target_id from public.online_payment_attempts a where id=p_attempt;
  if kind is null then raise exception 'Nie znaleziono próby płatności.'; end if;
  -- Charge first, then attempt: the same order as begin and manual settlement.
  target=public.lock_online_payment_target(kind,target_id);
  select * into attempt from public.online_payment_attempts where id=p_attempt for update;
  if p_environment is distinct from attempt.environment or p_currency is distinct from attempt.currency or
    p_amount_cents is distinct from attempt.amount_cents or
    (attempt.transaction_id is not null and p_transaction_id is distinct from attempt.transaction_id) or
    (attempt.transaction_title is not null and p_transaction_title is distinct from attempt.transaction_title) or
    (attempt.merchant_id is not null and p_merchant_id is distinct from attempt.merchant_id) then
    raise exception 'Potwierdzenie nie odpowiada zapisanej próbie.';
  end if;
  if p_status in ('paid','chargeback') and (p_merchant_id is null or length(p_merchant_id) not between 1 and 100 or
    p_transaction_title is null or length(p_transaction_title) not between 1 and 200 or
    (p_transaction_id is not null and length(p_transaction_id) not between 1 and 200) or received is null or received<=0) then
    raise exception 'Brak tożsamości potwierdzonej transakcji.';
  end if;
  -- Once money is received, transport errors/old pending messages cannot erase it.
  if attempt.confirmed_at is not null then
    -- The operator may later report a larger cumulative receipt for this same
    -- transaction. Preserve that money without adding another debt allocation;
    -- identical or older lower totals remain once-only, out-of-order retries.
    if p_status in ('paid','chargeback') and received>attempt.confirmed_amount_cents then
      previous_received=attempt.confirmed_amount_cents;
      update public.online_payment_attempts set status='requires_review',confirmed_amount_cents=received,
        review_reason=case when review_reason='chargeback' then 'chargeback' else 'amount_mismatch' end,
        updated_at=clock_timestamp() where id=p_attempt returning * into attempt;
      insert into public.audit_events(actor_id,event,entity_id,details) values(null,'online_payment_amount_increased',attempt.id,
        jsonb_build_object('environment',attempt.environment,'transaction_id',attempt.transaction_id,
          'previous_amount_cents',previous_received,'amount_cents',received,'payment_id',attempt.payment_id));
    end if;
    if p_status='chargeback' and attempt.review_reason is distinct from 'chargeback' then
      update public.online_payment_attempts set status='requires_review',review_reason='chargeback',updated_at=clock_timestamp()
        where id=p_attempt returning * into attempt;
      insert into public.audit_events(actor_id,event,entity_id,details) values(null,'online_payment_chargeback',attempt.id,
        jsonb_build_object('environment',attempt.environment,'transaction_id',attempt.transaction_id,'amount_cents',attempt.confirmed_amount_cents));
    end if;
    return attempt;
  end if;
  if p_status not in ('paid','chargeback') then
    if attempt.status='failed' and p_status in ('pending','uncertain') then return attempt; end if;
    update public.online_payment_attempts set status=p_status,error_code=nullif(p_reason,''),updated_at=clock_timestamp()
      where id=p_attempt returning * into attempt;
    return attempt;
  end if;
  if p_status='chargeback' then review='chargeback';
  elsif received<>attempt.amount_cents then review='amount_mismatch';
  elsif attempt.transaction_id is null then review='unbound_transaction';
  elsif target is null or (target->>'dog_id')::uuid is distinct from attempt.dog_id or
    (target->>'guardian_id')::uuid is distinct from attempt.guardian_id or
    (target->>'stored_guardian_id')::uuid is distinct from attempt.guardian_id then review='owner_changed';
  elsif not (target->>'payable')::boolean then review='no_longer_payable';
  elsif (target->>'due_cents')::integer<>attempt.amount_cents then review='balance_changed';
  end if;
  if review is null then
    insert into public.payments(guardian_id,dog_id,registration_id,consultation_id,course_enrollment_id,fitness_package_id,
      amount_cents,method,status,paid_at,note,author_id,request_id,online_attempt_id)
    values(attempt.guardian_id,attempt.dog_id,
      case when kind='registration' then target_id end,case when kind='consultation' then target_id end,
      case when kind='course' then target_id end,case when kind='fitness' then target_id end,
      attempt.amount_cents,case when attempt.environment='sandbox' then 'tpay_sandbox' else 'tpay_simulator' end,'paid',clock_timestamp(),
      case when attempt.environment='sandbox' then 'Testowa wpłata Tpay BLIK — sandbox.' else 'Symulacja lokalna — bez Tpay.' end,
      null,attempt.id,attempt.id) returning id into receipt;
    if kind='registration' then update public.walk_registrations set payment_status='paid' where id=target_id; end if;
    -- Preserve manual author attribution. System activity is recorded separately
    -- below; parent versions still invalidate stale participant/money forms.
    if kind='course' then update public.course_enrollments set version=version+1,updated_at=clock_timestamp() where id=target_id; end if;
    if kind='fitness' then update public.fitness_packages set version=version+1,updated_at=clock_timestamp() where id=target_id; end if;
  end if;
  update public.online_payment_attempts set status=case when review is null then 'paid' else 'requires_review' end,
    transaction_id=coalesce(transaction_id,p_transaction_id),transaction_title=coalesce(transaction_title,p_transaction_title),
    merchant_id=coalesce(merchant_id,p_merchant_id),payment_id=receipt,confirmed_amount_cents=received,
    confirmed_at=clock_timestamp(),review_reason=review,error_code=null,updated_at=clock_timestamp()
    where id=p_attempt returning * into attempt;
  insert into public.audit_events(actor_id,event,entity_id,details) values(null,'online_payment_confirmed',attempt.id,
    jsonb_build_object('source',case when attempt.environment='sandbox' then 'tpay_sandbox' else 'tpay_simulator' end,
      'target_kind',kind,'target_id',target_id,'payment_id',receipt,'amount_cents',received,
      'transaction_id',attempt.transaction_id,'transaction_title',attempt.transaction_title,'review_reason',review));
  return attempt;
end $$;

revoke all on function public.begin_online_payment(text,uuid,uuid,text),
  public.bind_online_payment(uuid,text,text,text,text),
  public.record_online_payment_outcome(uuid,text,text,text,text,integer,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.begin_online_payment(text,uuid,uuid,text) to authenticated;
grant execute on function public.bind_online_payment(uuid,text,text,text,text),
  public.record_online_payment_outcome(uuid,text,text,text,text,integer,text,text,text,integer) to service_role;
