-- Preparation only: no provider configuration or checkout is enabled here.
-- Applied migration 61 remains immutable. Checkout and settlement are separate.
alter table public.online_payment_attempts drop constraint online_payment_attempts_environment_check;
alter table public.online_payment_attempts add constraint online_payment_attempts_environment_check
  check(environment in ('sandbox','simulator','live'));
alter table public.online_payment_attempts
  add column dog_name text,
  add column guardian_name text,
  add column service_name text,
  add column service_at timestamptz,
  add column next_check_at timestamptz default clock_timestamp(),
  add column check_claim uuid,
  add column check_lease_until timestamptz,
  add column check_failures integer not null default 0 check(check_failures>=0),
  add column last_checked_at timestamptz;
alter table public.payments drop constraint payment_online_author;
alter table public.payments add constraint payment_online_author check(
  (online_attempt_id is null and author_id is not null and method not in ('tpay_live','tpay_sandbox','tpay_simulator')) or
  (online_attempt_id is not null and author_id is null and method in ('tpay_live','tpay_sandbox','tpay_simulator'))
);

-- A browser cannot choose an environment or reserve a debt through direct RPC.
drop function public.begin_online_payment(text,uuid,uuid,text);
create function public.begin_online_payment(
  p_guardian uuid,p_kind text,p_target uuid,p_request_id uuid,p_environment text,
  p_expected_due_cents integer,p_merchant_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target jsonb; attempt public.online_payment_attempts; dog_name text; guardian_name text;
  service_name text; service_at timestamptz;
begin
  if current_setting('role',true)<>'service_role' or p_guardian is null or
    not exists(select 1 from public.user_roles where user_id=p_guardian and role='client') then
    raise exception 'Brak uprawnień.';
  end if;
  if not exists(select 1 from public.online_payment_settings where singleton and enabled) then
    raise exception 'Płatności są wyłączone.';
  end if;
  if p_kind is null or p_kind not in ('registration','consultation','course','fitness') or p_target is null or
    p_request_id is null or p_environment is null or p_environment not in ('sandbox','simulator','live') or
    p_expected_due_cents is null or p_expected_due_cents not between 1 and 1000000 or
    p_merchant_id is null or length(p_merchant_id) not between 1 and 100 then
    raise exception 'Niepoprawne dane płatności.';
  end if;
  target=public.lock_online_payment_target(p_kind,p_target);
  perform pg_advisory_xact_lock(hashtextextended('online-payment:'||p_request_id::text,0));
  select * into attempt from public.online_payment_attempts where request_id=p_request_id;
  if attempt.id is not null then
    if attempt.guardian_id=p_guardian and attempt.target_kind=p_kind and attempt.target_id=p_target and
      attempt.environment=p_environment and attempt.merchant_id=p_merchant_id then
      return jsonb_build_object('attempt',to_jsonb(attempt),'created',false);
    end if;
    raise exception 'Ten identyfikator płatności został już użyty.';
  end if;
  if target is null or (target->>'guardian_id')::uuid<>p_guardian or (target->>'stored_guardian_id')::uuid<>p_guardian then
    raise exception 'Nie znaleziono własnej należności.';
  end if;
  if not (target->>'payable')::boolean or (target->>'due_cents')::integer not between 1 and 1000000 then
    raise exception 'Ta usługa nie ma przyjętej należności do zapłaty.';
  end if;
  -- An expected amount is a comparison, never a price supplied by the caller.
  if (target->>'due_cents')::integer<>p_expected_due_cents then
    raise exception 'Należność zmieniła się. Otwórz podsumowanie i potwierdź aktualną kwotę.';
  end if;
  select * into attempt from public.online_payment_attempts where target_kind=p_kind and target_id=p_target
    and status in ('creating','pending','uncertain','requires_review')
    order by (status='requires_review') desc,created_at desc limit 1;
  if attempt.id is not null then
    if attempt.guardian_id<>p_guardian or attempt.environment<>p_environment or attempt.merchant_id is distinct from p_merchant_id then
      raise exception 'Wcześniejsza płatność wymaga sprawdzenia.';
    end if;
    return jsonb_build_object('attempt',to_jsonb(attempt),'created',false);
  end if;
  select d.name,p.full_name into dog_name,guardian_name from public.dogs d
    join public.profiles p on p.id=p_guardian where d.id=(target->>'dog_id')::uuid;
  if p_kind='registration' then
    select w.type,w.starts_at into service_name,service_at from public.walk_registrations r join public.walks w on w.id=r.walk_id where r.id=p_target;
  elsif p_kind='consultation' then
    select coalesce(c.service_name,'Konsultacja indywidualna'),coalesce(c.starts_at,c.created_at) into service_name,service_at from public.consultations c where c.id=p_target;
  elsif p_kind='course' then
    select c.title,(select min(cs.starts_at) from public.course_sessions cs where cs.course_id=c.id and cs.status in ('scheduled','completed')) into service_name,service_at from public.course_enrollments e join public.courses c on c.id=e.course_id where e.id=p_target;
  else
    select f.service_name,(select min(fs.starts_at) from public.fitness_sessions fs where fs.package_id=f.id and fs.status in ('scheduled','completed')) into service_name,service_at from public.fitness_packages f where f.id=p_target;
  end if;
  insert into public.online_payment_attempts(request_id,target_kind,target_id,guardian_id,dog_id,amount_cents,environment,merchant_id,
    dog_name,guardian_name,service_name,service_at)
    values(p_request_id,p_kind,p_target,p_guardian,(target->>'dog_id')::uuid,(target->>'due_cents')::integer,p_environment,p_merchant_id,
      dog_name,guardian_name,service_name,service_at) returning * into attempt;
  insert into public.audit_events(actor_id,event,entity_id,details) values(p_guardian,'online_payment_started',attempt.id,
    jsonb_build_object('target_kind',p_kind,'target_id',p_target,'amount_cents',attempt.amount_cents,'environment',p_environment));
  return jsonb_build_object('attempt',to_jsonb(attempt),'created',true);
end $$;
revoke all on function public.begin_online_payment(uuid,text,uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.begin_online_payment(uuid,text,uuid,uuid,text,integer,text) to service_role;

create or replace function public.bind_online_payment(p_attempt uuid,p_transaction_id text,p_transaction_title text,p_merchant_id text,p_checkout_url text)
returns public.online_payment_attempts language plpgsql security definer set search_path='' as $$
declare attempt public.online_payment_attempts;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Brak uprawnień operatora.'; end if;
  if p_transaction_id is null or length(trim(p_transaction_id)) not between 1 and 200 or
    p_transaction_title is null or length(trim(p_transaction_title)) not between 1 and 200 or
    p_merchant_id is null or length(trim(p_merchant_id)) not between 1 and 100 or p_checkout_url is null or length(p_checkout_url)>2000 then
    raise exception 'Niepoprawna transakcja operatora.';
  end if;
  select * into attempt from public.online_payment_attempts where id=p_attempt for update;
  if attempt.id is null then raise exception 'Nie znaleziono próby płatności.'; end if;
  if (attempt.environment='sandbox' and p_checkout_url!~'^https://secure[.]sandbox[.]tpay[.]com/') or
    (attempt.environment='live' and p_checkout_url!~'^https://secure[.]tpay[.]com/') or
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

create or replace function public.record_online_payment_outcome(
  p_attempt uuid,p_environment text,p_transaction_id text,p_merchant_id text,p_status text,
  p_amount_cents integer,p_currency text,p_transaction_title text default null,p_reason text default null,p_paid_cents integer default null
) returns public.online_payment_attempts language plpgsql security definer set search_path='' as $$
declare attempt public.online_payment_attempts; target jsonb; receipt uuid; review text; kind text; target_id uuid;
  received integer:=coalesce(p_paid_cents,p_amount_cents); previous_received integer;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Brak uprawnień operatora.'; end if;
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
      attempt.amount_cents,case attempt.environment when 'sandbox' then 'tpay_sandbox' when 'live' then 'tpay_live' else 'tpay_simulator' end,'paid',clock_timestamp(),
      case attempt.environment when 'sandbox' then 'Testowa wpłata Tpay BLIK — sandbox.' when 'live' then 'Wpłata Tpay BLIK.' else 'Symulacja lokalna — bez Tpay.' end,
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
    jsonb_build_object('source',case attempt.environment when 'sandbox' then 'tpay_sandbox' when 'live' then 'tpay_live' else 'tpay_simulator' end,
      'target_kind',kind,'target_id',target_id,'payment_id',receipt,'amount_cents',received,
      'transaction_id',attempt.transaction_id,'transaction_title',attempt.transaction_title,'review_reason',review));
  return attempt;
end $$;


-- Minimal verified receipts: private and immutable to application sessions.
-- Exact-body SHA256 provides retry identity without retaining payer data.
create table public.online_payment_notifications (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.online_payment_attempts,
  environment text not null check(environment in ('sandbox','live')),
  payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  transaction_title text not null check(length(transaction_title) between 1 and 128),
  merchant_id text not null check(length(merchant_id) between 1 and 100),
  outcome text not null check(outcome in ('paid','chargeback')),
  amount_cents integer not null check(amount_cents>0),
  paid_cents integer not null check(paid_cents>0),
  currency text not null check(currency='PLN'),
  received_at timestamptz not null default clock_timestamp(),
  unique(environment,payload_sha256)
);
alter table public.online_payment_notifications enable row level security;
revoke all on public.online_payment_notifications from public,anon,authenticated;
grant select on public.online_payment_notifications to service_role;
create function public.record_online_payment_notification(
  p_attempt uuid,p_environment text,p_transaction_id text,p_merchant_id text,p_status text,
  p_amount_cents integer,p_currency text,p_transaction_title text,p_paid_cents integer,p_payload_sha256 text
) returns public.online_payment_attempts language plpgsql security definer set search_path='' as $$
declare result public.online_payment_attempts;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Brak uprawnień operatora.'; end if;
  if p_environment is null or p_environment not in ('sandbox','live') or p_payload_sha256 is null or
    p_payload_sha256 !~ '^[0-9a-f]{64}$' or p_status is null or p_status not in ('paid','chargeback') then
    raise exception 'Niepoprawne potwierdzenie operatora.';
  end if;
  -- Receipt and ledger share one commit. TRUE is returned only after both persist.
  result=public.record_online_payment_outcome(p_attempt,p_environment,p_transaction_id,p_merchant_id,p_status,
    p_amount_cents,p_currency,p_transaction_title,null,p_paid_cents);
  insert into public.online_payment_notifications(attempt_id,environment,payload_sha256,transaction_title,merchant_id,outcome,amount_cents,paid_cents,currency)
    values(p_attempt,p_environment,p_payload_sha256,p_transaction_title,p_merchant_id,p_status,p_amount_cents,p_paid_cents,p_currency)
    on conflict(environment,payload_sha256) do nothing;
  return result;
end $$;
revoke all on function public.record_online_payment_notification(uuid,text,text,text,text,integer,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.record_online_payment_notification(uuid,text,text,text,text,integer,text,text,integer,text) to service_role;

-- Only an authenticated operator GET may supply these identity fields through
-- the server action. Recovery never accepts an asserted paid/failed outcome.
create function public.recover_online_payment_binding(
  p_attempt uuid,p_actor uuid,p_transaction_id text,p_transaction_title text,p_merchant_id text,p_checkout_url text default null
) returns public.online_payment_attempts language plpgsql security definer set search_path='' as $$
declare attempt public.online_payment_attempts;
begin
  if current_setting('role',true)<>'service_role' or p_actor is null or
    not exists(select 1 from public.user_roles where user_id=p_actor and role='admin') then
    raise exception 'Brak uprawnień administratora.';
  end if;
  select * into attempt from public.online_payment_attempts where id=p_attempt for update;
  if attempt.id is null or attempt.environment='simulator' or p_transaction_id is null or p_transaction_id!~'^[A-Za-z0-9_-]{1,128}$' or
    p_transaction_title is null or p_transaction_title!~'^[A-Za-z0-9_-]{1,128}$' or
    p_merchant_id is null or length(p_merchant_id) not between 1 and 100 or
    (attempt.transaction_id is not null and attempt.transaction_id<>p_transaction_id) or
    (attempt.transaction_title is not null and attempt.transaction_title<>p_transaction_title) or
    (attempt.merchant_id is not null and attempt.merchant_id<>p_merchant_id) then
    raise exception 'Transakcja nie odpowiada zapisanej próbie.';
  end if;
  if p_checkout_url is not null and (length(p_checkout_url)>2000 or
    (attempt.environment='sandbox' and p_checkout_url!~'^https://secure[.]sandbox[.]tpay[.]com/') or
    (attempt.environment='live' and p_checkout_url!~'^https://secure[.]tpay[.]com/')) then
    raise exception 'Niepoprawny adres płatności.';
  end if;
  if attempt.transaction_id is null then
    update public.online_payment_attempts set transaction_id=p_transaction_id,transaction_title=p_transaction_title,
      merchant_id=p_merchant_id,checkout_url=p_checkout_url,updated_at=clock_timestamp(),next_check_at=clock_timestamp()
      where id=p_attempt returning * into attempt;
    insert into public.audit_events(actor_id,event,entity_id,details) values(p_actor,'online_payment_binding_recovered',p_attempt,
      jsonb_build_object('transaction_id',p_transaction_id,'environment',attempt.environment));
  end if;
  return attempt;
end $$;
revoke all on function public.recover_online_payment_binding(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.recover_online_payment_binding(uuid,uuid,text,text,text,text) to service_role;

create function public.worker_claim_online_payment_checks(p_limit integer default 3)
returns table(id uuid,claim_token uuid) language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true)<>'service_role' or p_limit is null or p_limit not between 1 and 10 then
    raise exception 'Brak uprawnień lub niepoprawny limit.';
  end if;
  return query with due as (
    select a.id from public.online_payment_attempts a where a.environment in ('sandbox','live') and a.transaction_id is not null
      and a.status in ('creating','pending','uncertain') and a.next_check_at<=clock_timestamp()
      and (a.check_lease_until is null or a.check_lease_until<clock_timestamp())
      order by a.next_check_at,a.id for update skip locked limit p_limit
  ) update public.online_payment_attempts a set check_claim=gen_random_uuid(),check_lease_until=clock_timestamp()+interval '2 minutes'
    from due where a.id=due.id returning a.id,a.check_claim;
end $$;
create function public.worker_finish_online_payment_check(p_id uuid,p_claim uuid,p_outcome text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role',true)<>'service_role' or p_outcome is null or
    p_outcome not in ('pending','confirmed','failed','review','unavailable') then raise exception 'Brak uprawnień lub niepoprawny wynik.'; end if;
  update public.online_payment_attempts set check_claim=null,check_lease_until=null,last_checked_at=clock_timestamp(),
    check_failures=case when p_outcome='unavailable' then least(check_failures+1,20) else 0 end,
    next_check_at=case when p_outcome='unavailable' then clock_timestamp()+make_interval(secs=>least(3600,60*power(2,least(check_failures,6)))::integer)
      when p_outcome='pending' then clock_timestamp()+interval '2 minutes' else null end
    where id=p_id and check_claim=p_claim;
  return found;
end $$;
revoke all on function public.worker_claim_online_payment_checks(integer),public.worker_finish_online_payment_check(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.worker_claim_online_payment_checks(integer),public.worker_finish_online_payment_check(uuid,uuid,text) to service_role;
