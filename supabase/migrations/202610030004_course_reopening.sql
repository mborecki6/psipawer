-- Reopen the original participation explicitly; never invent a second charge
-- or erase a prior settlement, receipt, refund, attendance or care publication.
create table public.course_reopening_receipts (
  enrollment_id uuid not null references public.course_enrollments on delete cascade,
  source_version integer not null check(source_version>0),
  result_version integer not null check(result_version=source_version+1),
  action text not null check(action in ('reconsider','restore')),
  note text not null check(length(trim(note)) between 3 and 3000),
  author_id uuid not null references public.profiles,
  previous_status text not null check(previous_status in ('rejected','cancelled')),
  previous_charge_cents integer not null check(previous_charge_cents between 0 and 1000000),
  previous_settled_at timestamptz,
  previous_settled_by uuid references public.profiles,
  created_at timestamptz not null default clock_timestamp(),
  primary key(enrollment_id,source_version)
);
alter table public.course_reopening_receipts enable row level security;
create policy course_reopening_receipts_staff on public.course_reopening_receipts
  for select to authenticated using((select public.is_admin()));
revoke all on public.course_reopening_receipts from public,anon,authenticated;
grant select on public.course_reopening_receipts to authenticated;

create function public.reopen_course_enrollment(p_id uuid,p_expected_version integer,p_action text,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.courses; e public.course_enrollments; receipt public.course_reopening_receipts;
  course uuid; dog uuid; current_guardian uuid; v_note text:=trim(coalesce(p_note,''));
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_expected_version is null or p_expected_version not between 1 and 2147483646
    or p_action is null or p_action not in ('reconsider','restore') or length(v_note) not between 3 and 3000 then
    raise exception 'Wybierz powrót do zgłoszenia i podaj powód (3–3000 znaków).';
  end if;
  select course_id,dog_id into course,dog from public.course_enrollments where id=p_id;
  -- The same order as a new request: dog -> course -> enrollment. Ownership
  -- cannot change between validation and reopening; care holds the dog first.
  select guardian_id into current_guardian from public.dogs where id=dog for share;
  select * into c from public.courses where id=course for update;
  select * into e from public.course_enrollments where id=p_id for update;
  if e.id is null or c.id is null then raise exception 'Nie znaleziono zgłoszenia na kurs.'; end if;
  select * into receipt from public.course_reopening_receipts where enrollment_id=p_id and source_version=p_expected_version;
  if receipt.enrollment_id is not null then
    if receipt.author_id=auth.uid() and receipt.action=p_action and receipt.note=v_note then return receipt.result_version; end if;
    raise exception 'Zgłoszenie zmieniło się. Odśwież widok przed zapisem.';
  end if;
  if e.version<>p_expected_version then raise exception 'Zgłoszenie zmieniło się. Odśwież widok przed zapisem.'; end if;
  if current_guardian is distinct from e.guardian_id or not exists(
    select 1 from public.user_roles where user_id=e.guardian_id and role='client'
  ) then raise exception 'Opiekun psa zmienił się. Historycznego zgłoszenia nie można przywrócić.'; end if;
  if c.status not in ('open','closed') or not exists(
    select 1 from public.course_sessions where course_id=c.id and status='scheduled'
  ) or exists(select 1 from public.course_sessions where course_id=c.id and starts_at<=clock_timestamp()) then
    raise exception 'Powrót jest dostępny tylko przed pierwszym spotkaniem aktywnego kursu.';
  end if;
  if (p_action='reconsider' and e.status<>'rejected') or (p_action='restore' and e.status<>'cancelled') then
    raise exception 'Ta zmiana zgłoszenia nie jest dostępna.';
  end if;
  if p_action='restore' and (select count(*) from public.course_enrollments where course_id=c.id and status='accepted')>=c.capacity then
    raise exception 'Brak wolnych miejsc na kursie.';
  end if;
  insert into public.course_reopening_receipts(enrollment_id,source_version,result_version,action,note,author_id,
    previous_status,previous_charge_cents,previous_settled_at,previous_settled_by)
    values(e.id,e.version,e.version+1,p_action,v_note,auth.uid(),e.status,e.charge_cents,e.settled_at,e.settled_by)
    returning * into receipt;
  update public.course_enrollments set status=case when p_action='restore' then 'accepted' else 'requested' end,
    charge_cents=case when p_action='restore' then agreed_price_cents else charge_cents end,
    settled_at=case when p_action='restore' then null else settled_at end,
    settled_by=case when p_action='restore' then null else settled_by end,
    version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into e;
  insert into public.course_history(course_id,enrollment_id,action,actor_id,note,details)
    values(c.id,e.id,p_action,auth.uid(),v_note,jsonb_build_object('version',e.version,
      'previous_status',receipt.previous_status,'charge_cents',e.charge_cents,'agreed_price_cents',e.agreed_price_cents,
      'previous_charge_cents',receipt.previous_charge_cents,'previous_settled_at',receipt.previous_settled_at));
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'course_enrollment_reopened',e.id,jsonb_build_object('action',p_action,'version',e.version));
  return e.version;
end $$;
revoke all on function public.reopen_course_enrollment(uuid,integer,text,text) from public,anon;
grant execute on function public.reopen_course_enrollment(uuid,integer,text,text) to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
  'plan_published','progress_submitted','progress_reviewed',
  'consultation_requested','consultation_scheduled','consultation_rescheduled','consultation_cancelled','consultation_completed','consultation_price_agreed',
  'walk_changed','walk_cancelled','registration_created','registration_changed','registration_cancelled','walk_invitation',
  'payment_recorded','payment_refunded','follow_up_changed','consultation_reminder','walk_reminder','follow_up_reminder',
  'course_enrollment_requested','course_enrollment_accepted','course_enrollment_waitlisted','course_enrollment_rejected','course_enrollment_cancelled','course_enrollment_reopened',
  'course_cancelled','course_completed','course_session_rescheduled','course_session_cancelled','course_session_completed',
  'course_attendance_recorded','course_settled','course_payment_recorded','course_payment_refunded','course_reminder','course_updated'
));
create function public.notify_course_reopening() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.course_enrollments; recipient uuid;
begin
  if new.action not in ('restore','reconsider') or new.enrollment_id is null then return new; end if;
  select * into e from public.course_enrollments where id=new.enrollment_id;
  perform public.add_course_notification(e.guardian_id,new.actor_id,e.id,null,'course_enrollment_reopened','course:'||new.id);
  for recipient in select user_id from public.user_roles where role='admin' and user_id is distinct from new.actor_id order by user_id loop
    perform public.add_course_notification(recipient,new.actor_id,e.id,null,'course_enrollment_reopened','course:'||new.id);
  end loop;
  return new;
end $$;
revoke all on function public.notify_course_reopening() from public,anon,authenticated;
create trigger notify_course_reopening after insert on public.course_history
  for each row execute function public.notify_course_reopening();

-- A restored request may have been cancelled before its first acceptance.
-- Its explicit restoration is acceptance evidence for a later settlement.
create or replace function public.settle_course_enrollment(
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
    select 1 from public.course_history where enrollment_id=p_id and action in ('accept','restore')
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

