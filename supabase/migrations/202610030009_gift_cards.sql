-- Local-only gift-card core. No previous cards, prices or receipts are
-- inferred. Face value is preserved; a service card restricts that value.
create table public.gift_cards (
  id uuid primary key,
  practice_id uuid not null references public.care_practices,
  beneficiary_id uuid references public.profiles,
  service_id uuid references public.services,
  service_version integer,
  service_name text,
  is_test_price boolean not null,
  value_cents integer not null check(value_cents between 1 and 1000000),
  purchased_on date not null check(isfinite(purchased_on)),
  expires_on date not null check(isfinite(expires_on) and expires_on>purchased_on),
  sender_label text not null check(length(sender_label) between 1 and 120),
  recipient_label text not null check(length(recipient_label) between 1 and 120),
  message text not null default '' check(length(message)<=500),
  status text not null default 'active' check(status in ('active','cancelled')),
  version integer not null default 1 check(version>0),
  issued_by uuid not null references public.profiles,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check((service_id is null and service_version is null and service_name is null)
    or(service_id is not null and service_version is not null and service_version>0
      and service_name is not null and length(service_name)>0))
);
create index gift_cards_beneficiary on public.gift_cards(beneficiary_id,created_at desc,id);
create table public.gift_card_codes (
  card_id uuid primary key references public.gift_cards on delete cascade,
  code text not null unique check(code~'^[A-F0-9]{40}$')
);
create table public.gift_card_sales (
  card_id uuid primary key references public.gift_cards on delete cascade,
  amount_cents integer not null check(amount_cents between 1 and 1000000),
  method text not null check(method in ('cash','transfer','card','other')),
  note text not null default '' check(length(note)<=2000),
  author_id uuid not null references public.profiles,
  created_at timestamptz not null default clock_timestamp()
);
create table public.gift_card_command_receipts (
  request_id uuid primary key,
  card_id uuid not null references public.gift_cards on delete cascade,
  actor_id uuid not null references public.profiles,
  command text not null check(command in ('issue','change','redeem','cash_refund')),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.gift_card_history (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.gift_cards on delete cascade,
  action text not null check(action in ('issued','assigned','claimed','unassigned','cancelled','restored','redeemed','returned','cash_refunded')),
  actor_id uuid not null references public.profiles,
  note text not null default '' check(length(note)<=2000),
  details jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index gift_card_history_card on public.gift_card_history(card_id,created_at desc,id);
create table public.gift_card_claim_limits (
  user_id uuid primary key references public.profiles on delete cascade,
  window_started_at timestamptz not null,
  failures integer not null check(failures between 0 and 5)
);
alter table public.payments add column gift_card_id uuid references public.gift_cards;
alter table public.payments add constraint payment_gift_card_pair unique(id,gift_card_id);
alter table public.payments add constraint payment_gift_card_method
  check((gift_card_id is null and method<>'gift_card') or(gift_card_id is not null and method='gift_card')) not valid;
create index payment_gift_card on public.payments(gift_card_id) where gift_card_id is not null;
-- Older walks/packages have free-form names. Staff explicitly identify their
-- catalogue service; the system never infers one from a name or price.
create table public.gift_card_service_links (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid unique references public.walk_registrations on delete cascade,
  package_id uuid unique references public.packages on delete cascade,
  service_id uuid not null references public.services,
  version integer not null default 1 check(version>0),
  source_version integer not null check(source_version>=0),
  note text not null check(length(note) between 3 and 2000),
  author_id uuid not null references public.profiles,
  created_at timestamptz not null default clock_timestamp(),
  check(num_nonnulls(registration_id,package_id)=1)
);
alter table public.gift_card_service_links enable row level security;
create policy gift_service_links_read on public.gift_card_service_links for select to authenticated using((select public.is_admin()));
revoke all on public.gift_card_service_links from public,anon,authenticated;
grant select on public.gift_card_service_links to authenticated;
create table public.gift_card_ledger (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.gift_cards on delete cascade,
  kind text not null check(kind in ('issue','redemption','return','cash_refund')),
  delta_cents integer not null check(delta_cents<>0 and abs(delta_cents)<=1000000),
  payment_id uuid,
  actor_id uuid not null references public.profiles,
  note text not null default '' check(length(note)<=2000),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(payment_id,card_id) references public.payments(id,gift_card_id) on delete cascade,
  check((kind in ('issue','return') and delta_cents>0) or(kind in ('redemption','cash_refund') and delta_cents<0)),
  check((kind in ('redemption','return') and payment_id is not null) or(kind in ('issue','cash_refund') and payment_id is null))
);
create unique index gift_card_one_issue on public.gift_card_ledger(card_id) where kind='issue';
create unique index gift_card_one_debit on public.gift_card_ledger(payment_id) where kind='redemption';
create index gift_card_ledger_card on public.gift_card_ledger(card_id,created_at,id);
create index gift_card_ledger_payment on public.gift_card_ledger(payment_id) where payment_id is not null;

alter table public.gift_cards enable row level security;
alter table public.gift_card_codes enable row level security;
alter table public.gift_card_sales enable row level security;
alter table public.gift_card_command_receipts enable row level security;
alter table public.gift_card_history enable row level security;
alter table public.gift_card_claim_limits enable row level security;
alter table public.gift_card_ledger enable row level security;
create policy gift_cards_read on public.gift_cards for select to authenticated
  using((select public.is_admin()) or beneficiary_id=(select auth.uid()));
create policy gift_codes_read on public.gift_card_codes for select to authenticated using((select public.is_admin()));
create policy gift_sales_read on public.gift_card_sales for select to authenticated using((select public.is_admin()));
create policy gift_receipts_read on public.gift_card_command_receipts for select to authenticated using((select public.is_admin()));
create policy gift_history_read on public.gift_card_history for select to authenticated using((select public.is_admin()));
create policy gift_ledger_read on public.gift_card_ledger for select to authenticated
  using((select public.is_admin()) or card_id in(select id from public.gift_cards where beneficiary_id=(select auth.uid())));
revoke all on public.gift_cards,public.gift_card_codes,public.gift_card_sales,public.gift_card_command_receipts,
  public.gift_card_history,public.gift_card_claim_limits,public.gift_card_ledger from public,anon,authenticated;
grant select on public.gift_cards,public.gift_card_codes,public.gift_card_sales,public.gift_card_command_receipts,
  public.gift_card_history,public.gift_card_ledger to authenticated;
create view public.gift_card_balances with(security_invoker=true) as
select c.*,l.balance_cents,l.redeemed_cents,l.returned_cents,l.cash_refunded_cents,
  (c.status='active' and c.expires_on>=(clock_timestamp() at time zone 'Europe/Warsaw')::date
    and c.beneficiary_id is not null and l.balance_cents>0) as usable
from public.gift_cards c cross join lateral(select coalesce(sum(delta_cents),0)::integer as balance_cents,
  -coalesce(sum(delta_cents) filter(where kind='redemption'),0) as redeemed_cents,
  coalesce(sum(delta_cents) filter(where kind='return'),0) as returned_cents,
  -coalesce(sum(delta_cents) filter(where kind='cash_refund'),0) as cash_refunded_cents
  from public.gift_card_ledger where card_id=c.id) l;
revoke all on public.gift_card_balances from public,anon,authenticated;
grant select on public.gift_card_balances to authenticated;

-- One shared private receipt namespace serializes identical request keys.
create function public.gift_card_previous_result(p_key uuid,p_card uuid,p_command text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.gift_card_command_receipts;
begin
  if p_key is null then raise exception 'Brak identyfikatora operacji karty.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('gift-card-command:'||p_key::text,0));
  select * into r from public.gift_card_command_receipts where request_id=p_key;
  if r.request_id is null then return null; end if;
  if r.card_id=p_card and r.actor_id=auth.uid() and r.command=p_command and r.payload=p_payload then return r.result; end if;
  raise exception 'Ten identyfikator operacji karty został użyty dla innych danych.';
end $$;

create function public.change_gift_card(p_id uuid,p_expected_version integer,p_action text,p_beneficiary uuid,p_note text,p_request_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.gift_cards; payload jsonb; previous jsonb; v_note text:=trim(p_note); action text;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_action is null
    or p_action not in ('assign','unassign','cancel','restore') or v_note is null or length(v_note) not between 3 and 2000
    or (p_action<>'assign' and p_beneficiary is not null) then raise exception 'Wybierz działanie karty i podaj powód.'; end if;
  payload:=jsonb_build_object('version',p_expected_version,'action',p_action,'beneficiary',p_beneficiary,'note',v_note);
  previous:=public.gift_card_previous_result(p_request_id,p_id,'change',payload);
  if previous is not null then return (previous->>'version')::integer; end if;
  select * into c from public.gift_cards where id=p_id for update;
  if c.id is null then raise exception 'Nie znaleziono karty.'; end if;
  if c.version<>p_expected_version then raise exception 'Karta zmieniła się. Odśwież widok przed zapisem.'; end if;
  if p_action in ('assign','unassign') then
    if c.status<>'active' then raise exception 'Przypisanie dotyczy aktywnej karty.'; end if;
    if exists(select 1 from public.gift_card_ledger where card_id=c.id and kind='redemption') then
      raise exception 'Wykorzystana karta zachowuje swojego opiekuna i historię.';
    end if;
    if p_action='assign' and (p_beneficiary is null or not exists(select 1 from public.user_roles where user_id=p_beneficiary and role='client')) then
      raise exception 'Wybierz konto opiekuna.';
    end if;
    update public.gift_cards set beneficiary_id=case when p_action='assign' then p_beneficiary else null end where id=c.id;
    action:=case when p_action='assign' then 'assigned' else 'unassigned' end;
  elsif p_action='cancel' then
    if c.status<>'active' then raise exception 'Karta jest już wycofana.'; end if;
    update public.gift_cards set status='cancelled' where id=c.id;action:='cancelled';
  else
    if c.status<>'cancelled' then raise exception 'Karta nie jest wycofana.'; end if;
    update public.gift_cards set status='active' where id=c.id;action:='restored';
  end if;
  update public.gift_cards set version=version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  insert into public.gift_card_history(card_id,action,actor_id,note,details) values(c.id,action,auth.uid(),v_note,jsonb_build_object('version',c.version,'beneficiary',c.beneficiary_id));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'gift_card_changed',c.id,jsonb_build_object('action',action,'version',c.version));
  perform public.gift_card_record_result(p_request_id,c.id,'change',payload,jsonb_build_object('version',c.version));
  return c.version;
end $$;

-- Failed claims return a safe result instead of raising, so the rate-limit
-- record commits. Possessing the opaque code never grants access to sales.
create function public.claim_gift_card(p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.gift_cards; limits public.gift_card_claim_limits; v_code text:=upper(replace(trim(coalesce(p_code,'')),'-',''));
  denied text:='Nie można przypisać tej karty. Sprawdź kod lub skontaktuj się z prowadzącą.';
begin
  if auth.uid() is null or not exists(select 1 from public.user_roles where user_id=auth.uid() and role='client') then
    raise exception 'Brak uprawnień.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gift-card-claim:'||auth.uid()::text,0));
  insert into public.gift_card_claim_limits(user_id,window_started_at,failures) values(auth.uid(),clock_timestamp(),0)
    on conflict(user_id) do update set
      failures=case when public.gift_card_claim_limits.window_started_at<=clock_timestamp()-interval '15 minutes' then 0 else public.gift_card_claim_limits.failures end,
      window_started_at=case when public.gift_card_claim_limits.window_started_at<=clock_timestamp()-interval '15 minutes' then clock_timestamp() else public.gift_card_claim_limits.window_started_at end
    returning * into limits;
  if v_code~'^[A-F0-9]{40}$' then
    select gc.* into c from public.gift_cards gc join public.gift_card_codes secret on secret.card_id=gc.id where secret.code=v_code for update of gc;
  end if;
  if c.id is not null and c.beneficiary_id=auth.uid() then return jsonb_build_object('id',c.id); end if;
  if limits.failures>=5 then return jsonb_build_object('error','Zbyt wiele prób. Spróbuj ponownie za 15 minut.'); end if;
  if c.id is null or c.beneficiary_id is not null or c.status<>'active' or c.expires_on<(clock_timestamp() at time zone 'Europe/Warsaw')::date then
    update public.gift_card_claim_limits set failures=failures+1 where user_id=auth.uid();
    return jsonb_build_object('error',denied);
  end if;
  update public.gift_cards set beneficiary_id=auth.uid(),version=version+1,updated_at=clock_timestamp() where id=c.id returning * into c;
  insert into public.gift_card_history(card_id,action,actor_id,details) values(c.id,'claimed',auth.uid(),jsonb_build_object('version',c.version));
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'gift_card_claimed',c.id);
  return jsonb_build_object('id',c.id);
end $$;
create function public.gift_card_record_result(p_key uuid,p_card uuid,p_command text,p_payload jsonb,p_result jsonb)
returns void language sql security definer set search_path='' as $$
  insert into public.gift_card_command_receipts(request_id,card_id,actor_id,command,payload,result)
    values(p_key,p_card,auth.uid(),p_command,p_payload,p_result)
$$;

-- Issuance confirms the whole payment already received outside the app. The
-- private sale is counted once; later credits to services are non-cash.
create function public.issue_gift_card(p_id uuid,p_service uuid,p_expected_service_version integer,p_value_cents integer,
  p_purchased_on date,p_sender text,p_recipient text,p_message text,p_beneficiary uuid,p_method text,p_note text,p_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.services; amount integer; payload jsonb; previous jsonb; v_code text:=upper(replace(trim(p_code),'-',''));
  v_sender text:=trim(p_sender);v_recipient text:=trim(p_recipient);v_message text:=trim(coalesce(p_message,''));v_note text:=trim(coalesce(p_note,''));
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_purchased_on is null or not isfinite(p_purchased_on) or p_purchased_on<'2000-01-01'::date
    or p_purchased_on>(clock_timestamp() at time zone 'Europe/Warsaw')::date or v_sender is null or length(v_sender) not between 1 and 120
    or v_recipient is null or length(v_recipient) not between 1 and 120 or length(v_message)>500 or length(v_note)>2000
    or p_method is null or p_method not in ('cash','transfer','card','other') or v_code is null or v_code!~'^[A-F0-9]{40}$' then
    raise exception 'Sprawdź dane karty i potwierdź otrzymaną wpłatę.';
  end if;
  payload:=jsonb_build_object('service',p_service,'service_version',p_expected_service_version,'value',p_value_cents,'purchased_on',p_purchased_on,
    'sender',v_sender,'recipient',v_recipient,'message',v_message,'beneficiary',p_beneficiary,'method',p_method,'note',v_note,'code_hash',md5(v_code));
  previous:=public.gift_card_previous_result(p_id,p_id,'issue',payload);
  if previous is not null then return (previous->>'id')::uuid; end if;
  if p_beneficiary is not null and not exists(select 1 from public.user_roles where user_id=p_beneficiary and role='client') then
    raise exception 'Wybierz konto opiekuna.';
  end if;
  if p_service is not null then
    select * into s from public.services where id=p_service for share;
    if s.id is null or not s.active or s.kind='voucher' then raise exception 'Wybierz aktywną usługę dla karty.'; end if;
    if p_expected_service_version is null or s.version<>p_expected_service_version then raise exception 'Usługa zmieniła się. Odśwież widok przed zapisem.'; end if;
    amount:=s.price_cents;
    if p_value_cents is not null and p_value_cents<>amount then raise exception 'Wartość karty na usługę wynika z jej aktualnej ceny.'; end if;
  else
    if p_expected_service_version is not null or p_value_cents is null or p_value_cents not between 1 and 1000000 then raise exception 'Podaj wartość karty od 0,01 do 10 000 zł.'; end if;
    amount:=p_value_cents;
  end if;
  insert into public.gift_cards(id,practice_id,beneficiary_id,service_id,service_version,service_name,is_test_price,value_cents,purchased_on,expires_on,
    sender_label,recipient_label,message,issued_by)
    values(p_id,'00000000-0000-4000-8000-000000000001',p_beneficiary,p_service,s.version,s.name,coalesce(s.is_test_price,true),amount,
      p_purchased_on,(p_purchased_on+interval '6 months')::date,v_sender,v_recipient,v_message,auth.uid());
  insert into public.gift_card_codes(card_id,code) values(p_id,v_code);
  insert into public.gift_card_sales(card_id,amount_cents,method,note,author_id) values(p_id,amount,p_method,v_note,auth.uid());
  insert into public.gift_card_ledger(card_id,kind,delta_cents,actor_id) values(p_id,'issue',amount,auth.uid());
  insert into public.gift_card_history(card_id,action,actor_id,note,details) values(p_id,'issued',auth.uid(),v_note,jsonb_build_object('value_cents',amount,'beneficiary',p_beneficiary));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'gift_card_issued',p_id,jsonb_build_object('value_cents',amount));
  perform public.gift_card_record_result(p_id,p_id,'issue',payload,jsonb_build_object('id',p_id));
  return p_id;
end $$;

create function public.bind_gift_card_service(p_registration uuid,p_package uuid,p_service uuid,p_expected_version integer,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare dog uuid; walk uuid; s public.services; previous public.gift_card_service_links; result uuid; v_note text:=trim(p_note);
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if num_nonnulls(p_registration,p_package)<>1 or p_expected_version is null or p_expected_version not between 0 and 2147483646
    or v_note is null or length(v_note) not between 3 and 2000 then raise exception 'Wybierz usługę i potwierdź jej powiązanie z rozliczeniem.'; end if;
  if p_registration is not null then select dog_id,walk_id into dog,walk from public.walk_registrations where id=p_registration;
  else select dog_id into dog from public.packages where id=p_package; end if;
  if dog is null then raise exception 'Nie znaleziono rozliczenia.'; end if;
  perform 1 from public.dogs where id=dog for share;
  if p_registration is not null then
    perform 1 from public.walks where id=walk for update;
    perform 1 from public.walk_registrations where id=p_registration for update;
  else perform 1 from public.packages where id=p_package for update; end if;
  select * into s from public.services where id=p_service for share;
  if s.id is null or (p_registration is not null and s.kind<>'group')
    or(p_package is not null and (s.kind<>'package' or s.booking_flow='fitness')) then raise exception 'Wybierz usługę zgodną z rodzajem rozliczenia.'; end if;
  select * into previous from public.gift_card_service_links where registration_id=p_registration or package_id=p_package for update;
  if previous.id is not null and previous.service_id=p_service and previous.note=v_note and previous.author_id=auth.uid()
    and previous.source_version=p_expected_version then return previous.id; end if;
  if coalesce(previous.version,0)<>p_expected_version then raise exception 'Powiązanie usługi zmieniło się. Odśwież widok.'; end if;
  if exists(select 1 from public.payments where gift_card_id is not null and (registration_id=p_registration or package_id=p_package)) then
    raise exception 'Rozliczenie kartą zachowuje wcześniejsze powiązanie usługi.';
  end if;
  if previous.id is null then
    insert into public.gift_card_service_links(registration_id,package_id,service_id,source_version,note,author_id)
      values(p_registration,p_package,p_service,p_expected_version,v_note,auth.uid()) returning id into result;
  else
    update public.gift_card_service_links set service_id=p_service,version=version+1,source_version=p_expected_version,note=v_note,author_id=auth.uid()
      where id=previous.id returning id into result;
  end if;
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'gift_card_service_bound',result,jsonb_build_object('service',p_service));
  return result;
end $$;

create function public.redeem_gift_card(p_card uuid,p_expected_version integer,p_kind text,p_target uuid,p_amount_cents integer,p_note text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.gift_cards; payment public.payments; payload jsonb; previous jsonb; balance bigint; target_dog uuid; target_service uuid;
  result uuid; v_note text:=trim(coalesce(p_note,'')); internal_key uuid:=gen_random_uuid();
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_card is null or p_target is null or p_expected_version is null or p_expected_version not between 1 and 2147483646 or
    p_kind is null or p_kind not in ('registration','package','consultation','course','fitness') or p_amount_cents is null
    or p_amount_cents not between 1 and 1000000 or length(v_note)>2000 then raise exception 'Sprawdź kartę, należność i kwotę wykorzystania.'; end if;
  payload:=jsonb_build_object('version',p_expected_version,'kind',p_kind,'target',p_target,'amount',p_amount_cents,'note',v_note);
  previous:=public.gift_card_previous_result(p_request_id,p_card,'redeem',payload);
  if previous is not null then return (previous->>'id')::uuid; end if;
  if p_kind='registration' then select dog_id into target_dog from public.walk_registrations where id=p_target;
  elsif p_kind='package' then select dog_id into target_dog from public.packages where id=p_target;
  elsif p_kind='consultation' then select dog_id into target_dog from public.consultations where id=p_target;
  elsif p_kind='course' then select dog_id into target_dog from public.course_enrollments where id=p_target;
  else select dog_id into target_dog from public.fitness_packages where id=p_target; end if;
  if target_dog is null then raise exception 'Nie znaleziono rozliczenia.'; end if;
  -- Dog → existing source/receipt locks → card. Returns have the same order;
  -- card changes/refunds never acquire source locks after taking the card.
  perform 1 from public.dogs where id=target_dog for share;
  if p_kind='fitness' then
    result:=public.record_fitness_payment(p_target,p_amount_cents,'other',v_note,internal_key);
    select service_id into target_service from public.fitness_packages where id=p_target;
  else
    result:=public.record_payment(case when p_kind='registration' then p_target end,case when p_kind='package' then p_target end,
      p_amount_cents,'other',v_note,internal_key,case when p_kind='consultation' then p_target end,case when p_kind='course' then p_target end);
    if p_kind='consultation' then select service_id into target_service from public.consultations where id=p_target;
    elsif p_kind='course' then select course.service_id into target_service from public.course_enrollments e join public.courses course on course.id=e.course_id where e.id=p_target;
    else select service_id into target_service from public.gift_card_service_links where registration_id=p_target or package_id=p_target; end if;
  end if;
  select * into payment from public.payments where id=result;
  select * into c from public.gift_cards where id=p_card for update;
  if c.id is null then raise exception 'Nie znaleziono karty.'; end if;
  if c.version<>p_expected_version then raise exception 'Karta zmieniła się. Odśwież widok przed zapisem.'; end if;
  if c.status<>'active' or c.expires_on<(clock_timestamp() at time zone 'Europe/Warsaw')::date then raise exception 'Karta jest wycofana lub minął jej termin ważności.'; end if;
  if c.beneficiary_id is null or c.beneficiary_id<>payment.guardian_id then raise exception 'Karta i należność muszą należeć do tego samego opiekuna.'; end if;
  if c.service_id is not null and c.service_id is distinct from target_service then raise exception 'Ta karta jest przeznaczona na inną usługę. Sprawdź powiązanie oferty.'; end if;
  select coalesce(sum(delta_cents),0) into balance from public.gift_card_ledger where card_id=c.id;
  if p_amount_cents>balance then raise exception 'Kwota przekracza dostępne saldo karty.'; end if;
  -- The shared money command constructs/validates the receipt. Conversion and
  -- its original audit metadata occur before commit; no cash entry is exposed.
  update public.payments set gift_card_id=c.id,method='gift_card' where id=result;
  update public.audit_events set details=details||jsonb_build_object('method','gift_card','gift_card_id',c.id)
    where entity_id=result and actor_id=auth.uid() and event='payment_recorded';
  insert into public.gift_card_ledger(card_id,kind,delta_cents,payment_id,actor_id,note) values(c.id,'redemption',-p_amount_cents,result,auth.uid(),v_note);
  update public.gift_cards set version=version+1,updated_at=clock_timestamp() where id=c.id;
  insert into public.gift_card_history(card_id,action,actor_id,note,details) values(c.id,'redeemed',auth.uid(),v_note,
    jsonb_build_object('payment_id',result,'amount_cents',p_amount_cents,'kind',p_kind,'target',p_target,'service',target_service));
  perform public.gift_card_record_result(p_request_id,c.id,'redeem',payload,jsonb_build_object('id',result));
  return result;
end $$;

-- A service refund restores its original card, never an imaginary cash refund.
-- Reconcile absolute returned totals: the final partial-refund INSERT followed
-- by status='refunded' must credit only the still-unreturned difference.
create function public.gift_card_return_credit(p_payment uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p public.payments; wanted bigint; returned bigint; difference integer; c public.gift_cards;
begin
  select * into p from public.payments where id=p_payment;
  if p.gift_card_id is null then return; end if;
  select * into c from public.gift_cards where id=p.gift_card_id for update;
  if p.status='refunded' then wanted:=p.amount_cents;
  else
    select (select coalesce(sum(amount_cents),0) from public.course_payment_refunds where payment_id=p.id)
      +(select coalesce(sum(amount_cents),0) from public.fitness_payment_refunds where payment_id=p.id) into wanted;
  end if;
  select coalesce(sum(delta_cents),0) into returned from public.gift_card_ledger where payment_id=p.id and kind='return';
  if wanted>p.amount_cents or wanted<returned then raise exception 'Niespójna korekta salda karty.'; end if;
  difference:=(wanted-returned)::integer;
  if difference=0 then return; end if;
  insert into public.gift_card_ledger(card_id,kind,delta_cents,payment_id,actor_id,note)
    values(c.id,'return',difference,p.id,auth.uid(),'Przywrócenie salda po korekcie rozliczenia');
  update public.gift_cards set version=version+1,updated_at=clock_timestamp() where id=c.id;
  insert into public.gift_card_history(card_id,action,actor_id,details) values(c.id,'returned',auth.uid(),jsonb_build_object('payment_id',p.id,'amount_cents',difference));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'gift_card_balance_returned',c.id,jsonb_build_object('payment_id',p.id,'amount_cents',difference));
end $$;
create function public.sync_gift_card_return()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='payments' then perform public.gift_card_return_credit(new.id);
  else perform public.gift_card_return_credit(new.payment_id); end if;
  return null;
end $$;
create trigger gift_card_payment_return after update of status on public.payments for each row
  when(new.gift_card_id is not null) execute function public.sync_gift_card_return();
create trigger gift_card_course_return after insert on public.course_payment_refunds for each row execute function public.sync_gift_card_return();
create trigger gift_card_fitness_return after insert on public.fitness_payment_refunds for each row execute function public.sync_gift_card_return();
create function public.guard_gift_card_payment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.gift_card_id is distinct from old.gift_card_id or new.method<>old.method or new.amount_cents<>old.amount_cents
    or new.guardian_id<>old.guardian_id or new.dog_id is distinct from old.dog_id
    or new.registration_id is distinct from old.registration_id or new.package_id is distinct from old.package_id
    or new.consultation_id is distinct from old.consultation_id or new.course_enrollment_id is distinct from old.course_enrollment_id
    or new.fitness_package_id is distinct from old.fitness_package_id or new.status not in ('paid','refunded')
    or(old.status='refunded' and new.status<>'refunded') then
    raise exception 'Rozliczenie kartą zachowuje kwotę, opiekuna i źródło.';
  end if;
  return new;
end $$;
create trigger gift_card_payment_immutable before update on public.payments for each row
  when(old.gift_card_id is not null) execute function public.guard_gift_card_payment();

-- Cash returned for a cancelled card is a distinct confirmed operation, not
-- the cancellation itself. It cannot consume value already spent on services.
create function public.refund_gift_card_sale(p_card uuid,p_expected_version integer,p_amount_cents integer,p_note text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.gift_cards; payload jsonb; previous jsonb; balance bigint; result uuid; v_note text:=trim(p_note);
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_card is null or p_expected_version is null or p_expected_version not between 1 and 2147483646 or p_amount_cents is null
    or p_amount_cents not between 1 and 1000000 or v_note is null or length(v_note) not between 3 and 2000 then raise exception 'Podaj kwotę i potwierdź zwrot pieniędzy za kartę.'; end if;
  payload:=jsonb_build_object('version',p_expected_version,'amount',p_amount_cents,'note',v_note);
  previous:=public.gift_card_previous_result(p_request_id,p_card,'cash_refund',payload);
  if previous is not null then return (previous->>'id')::uuid; end if;
  select * into c from public.gift_cards where id=p_card for update;
  if c.id is null then raise exception 'Nie znaleziono karty.'; end if;
  if c.version<>p_expected_version then raise exception 'Karta zmieniła się. Odśwież widok przed zapisem.'; end if;
  if c.status<>'cancelled' then raise exception 'Przed zwrotem pieniędzy wycofaj kartę.'; end if;
  select coalesce(sum(delta_cents),0) into balance from public.gift_card_ledger where card_id=c.id;
  if p_amount_cents>balance then raise exception 'Zwrot przekracza niewykorzystane saldo karty.'; end if;
  insert into public.gift_card_ledger(card_id,kind,delta_cents,actor_id,note) values(c.id,'cash_refund',-p_amount_cents,auth.uid(),v_note) returning id into result;
  update public.gift_cards set version=version+1,updated_at=clock_timestamp() where id=c.id;
  insert into public.gift_card_history(card_id,action,actor_id,note,details) values(c.id,'cash_refunded',auth.uid(),v_note,jsonb_build_object('amount_cents',p_amount_cents,'ledger_id',result));
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'gift_card_cash_refunded',c.id,jsonb_build_object('amount_cents',p_amount_cents));
  perform public.gift_card_record_result(p_request_id,c.id,'cash_refund',payload,jsonb_build_object('id',result));
  return result;
end $$;

revoke all on function public.gift_card_previous_result(uuid,uuid,text,jsonb),public.gift_card_record_result(uuid,uuid,text,jsonb,jsonb),
  public.gift_card_return_credit(uuid),public.sync_gift_card_return(),public.guard_gift_card_payment() from public,anon,authenticated;
revoke all on function public.issue_gift_card(uuid,uuid,integer,integer,date,text,text,text,uuid,text,text,text),
  public.change_gift_card(uuid,integer,text,uuid,text,uuid),public.claim_gift_card(text),public.bind_gift_card_service(uuid,uuid,uuid,integer,text),
  public.redeem_gift_card(uuid,integer,text,uuid,integer,text,uuid),public.refund_gift_card_sale(uuid,integer,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.issue_gift_card(uuid,uuid,integer,integer,date,text,text,text,uuid,text,text,text),
  public.change_gift_card(uuid,integer,text,uuid,text,uuid),public.claim_gift_card(text),public.bind_gift_card_service(uuid,uuid,uuid,integer,text),
  public.redeem_gift_card(uuid,integer,text,uuid,integer,text,uuid),public.refund_gift_card_sale(uuid,integer,integer,text,uuid) to authenticated;
