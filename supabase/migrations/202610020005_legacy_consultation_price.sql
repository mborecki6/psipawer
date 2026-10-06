-- Local development only. A missing historical price is filled explicitly by
-- staff, never from today's catalogue. Existing agreed amounts stay immutable.
alter table public.consultations drop constraint consultation_service_snapshot;
alter table public.consultations add constraint consultation_service_snapshot check (
  (service_id is null and service_version is null and service_name is null
    and service_duration_minutes is null and service_meeting_mode is null
    and ((agreed_price_cents is null and is_test_price is null)
      or (agreed_price_cents is not null and is_test_price is not null))) or
  (service_id is not null and service_version is not null and service_name is not null
    and agreed_price_cents is not null and service_duration_minutes is not null
    and service_meeting_mode is not null and is_test_price is not null)
);

alter table public.consultation_history drop constraint consultation_history_action_check;
alter table public.consultation_history add constraint consultation_history_action_check
  check(action in ('requested','scheduled','rescheduled','cancelled','completed','price_agreed'));
alter table public.consultation_history add column price_request_id uuid unique;
alter table public.consultation_history add column agreed_price_cents integer;
alter table public.consultation_history add column is_test_price boolean;
alter table public.consultation_history add constraint consultation_price_history check (
  (action='price_agreed' and price_request_id is not null
    and agreed_price_cents is not null and agreed_price_cents between 1 and 1000000
    and is_test_price is not null and length(trim(note))>=3) or
  (action<>'price_agreed' and price_request_id is null
    and agreed_price_cents is null and is_test_price is null)
);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
  'plan_published','progress_submitted','progress_reviewed',
  'consultation_requested','consultation_scheduled','consultation_rescheduled','consultation_cancelled','consultation_completed','consultation_price_agreed',
  'walk_changed','walk_cancelled','registration_created','registration_changed','registration_cancelled','walk_invitation',
  'payment_recorded','payment_refunded','follow_up_changed',
  'consultation_reminder','walk_reminder','follow_up_reminder'
));

create function public.agree_consultation_price(
  p_id uuid,p_expected_version integer,p_amount_cents integer,
  p_is_test_price boolean,p_note text,p_request_id uuid
) returns integer language plpgsql security definer set search_path='' as $$
declare c public.consultations; h public.consultation_history; event_id uuid; paid bigint;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_request_id is null or p_expected_version is null
    or p_expected_version<1 or p_expected_version>=2147483647
    or p_amount_cents is null or p_amount_cents not between 1 and 1000000
    or p_is_test_price is null or p_note is null or length(trim(p_note)) not between 3 and 3000 then
    raise exception 'Podaj uzgodnioną kwotę i uzasadnienie dla opiekuna.';
  end if;
  -- Same lock order as receipts, refunds and cancellation. The amount and
  -- history are one transaction; a failed notification rolls them back too.
  select * into c from public.consultations where id=p_id for update;
  if not found then raise exception 'Nie znaleziono konsultacji.'; end if;
  select * into h from public.consultation_history where price_request_id=p_request_id;
  if found then
    if h.consultation_id=p_id and h.author_id=auth.uid() and h.version=p_expected_version+1
      and h.agreed_price_cents=p_amount_cents and h.is_test_price=p_is_test_price and h.note=trim(p_note) then
      return h.version;
    end if;
    raise exception 'Ten identyfikator uzgodnienia został już użyty dla innych danych.';
  end if;
  if c.version<>p_expected_version then
    raise exception 'Konsultacja zmieniła się. Odśwież widok przed zapisem.';
  end if;
  if c.agreed_price_cents is not null or c.service_id is not null then
    raise exception 'Ta konsultacja ma już ustaloną cenę. Zachowujemy wcześniejsze uzgodnienie.';
  end if;
  if c.status='cancelled' then
    raise exception 'Odwołane spotkanie nie wymaga ustalania należności.';
  end if;
  select coalesce(sum(amount_cents),0) into paid from public.payments
    where consultation_id=p_id and status='paid';
  if paid>p_amount_cents then
    raise exception 'Uzgodniona kwota nie może być niższa od zapisanych wpłat.';
  end if;
  update public.consultations set agreed_price_cents=p_amount_cents,is_test_price=p_is_test_price,
    version=version+1,updated_at=clock_timestamp() where id=p_id returning * into c;
  insert into public.consultation_history(
    consultation_id,version,action,starts_at,duration_minutes,meeting_mode,location,note,
    author_id,price_request_id,agreed_price_cents,is_test_price
  ) values(c.id,c.version,'price_agreed',c.starts_at,c.duration_minutes,c.meeting_mode,c.location,
    trim(p_note),auth.uid(),p_request_id,p_amount_cents,p_is_test_price) returning id into event_id;
  insert into public.consultation_events(history_id) values(event_id);
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'consultation_price_agreed',c.id,jsonb_build_object(
      'version',c.version,'amount_cents',p_amount_cents,'is_test_price',p_is_test_price,'history_id',event_id));
  return c.version;
end $$;
revoke all on function public.agree_consultation_price(uuid,integer,integer,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.agree_consultation_price(uuid,integer,integer,boolean,text,uuid) to authenticated;
