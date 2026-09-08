-- Registration decisions concern upcoming walks. Attendance is a separate,
-- correctable record and must not be erased by a later booking decision.
create or replace function public.decide_registration(
  p_registration uuid,
  p_status public.registration_status,
  p_note text default ''
) returns void language plpgsql security definer set search_path='' as $$
declare r public.walk_registrations; w public.walks; wid uuid; allowed boolean;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  select walk_id into wid from public.walk_registrations where id=p_registration;
  select * into w from public.walks where id=wid for update;
  select * into r from public.walk_registrations where id=p_registration for update;
  if r.id is null then raise exception 'Nie znaleziono zgłoszenia.'; end if;
  if p_status=r.status then return; end if;
  if w.starts_at<=now() or w.status in ('completed','cancelled') then
    raise exception 'Nie można zmieniać zgłoszeń po rozpoczęciu lub odwołaniu spaceru.';
  end if;
  allowed=case r.status
    when 'pending' then p_status in ('accepted','waitlisted','rejected')
    when 'accepted' then p_status in ('waitlisted','rejected','cancelled_on_time','cancelled_late')
    when 'waitlisted' then p_status in ('accepted','rejected','pending')
    when 'rejected' then p_status='pending'
    else false
  end;
  if allowed is not true then raise exception 'Niedozwolona zmiana statusu.'; end if;
  if p_status='accepted' then
    if w.status not in ('open','full') then
      raise exception 'Nie można już zaakceptować zgłoszenia.';
    end if;
    if exists(select 1 from public.dogs where id=r.dog_id and status not in ('approved','approved_conditional')) then
      raise exception 'Najpierw zakwalifikuj psa w jego profilu.';
    end if;
  end if;
  update public.walk_registrations set
    status=p_status,decided_at=now(),decided_by=auth.uid(),
    decision_note=left(p_note,2000),
    payment_status=case
      when payment_status='paid' then payment_status
      when p_status in ('accepted','cancelled_late') then 'due'::public.payment_status
      else 'none'::public.payment_status
    end,
    cancelled_at=case when p_status in ('cancelled_on_time','cancelled_late') then now() end
  where id=p_registration;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'registration_decided',r.id,
      jsonb_build_object('from',r.status,'to',p_status,'note',left(p_note,2000)));
end $$;

-- Use the same parent-before-child lock order as decisions and cancellation.
-- The capacity trigger also locks the walk on an accepted registration update.
create or replace function public.mark_attendance(
  p_registration uuid, p_attendance public.attendance_status
) returns void language plpgsql security definer set search_path='' as $$
declare r public.walk_registrations; w public.walks; wid uuid;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  select walk_id into wid from public.walk_registrations where id=p_registration;
  select * into w from public.walks where id=wid for update;
  select * into r from public.walk_registrations where id=p_registration for update;
  if r.id is null or r.status<>'accepted' or w.status='cancelled' then
    raise exception 'Obecność dotyczy zaakceptowanych psów.';
  end if;
  if w.starts_at>now() then raise exception 'Spacer jeszcze się nie rozpoczął.'; end if;
  if p_attendance is null then raise exception 'Wybierz poprawną obecność.'; end if;
  if r.attendance=p_attendance then return; end if;
  update public.walk_registrations set attendance=p_attendance where id=r.id;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'attendance_changed',r.id,
      jsonb_build_object('from',r.attendance,'to',p_attendance));
end $$;

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

  -- A late withdrawal cannot remain chargeable when the organizer subsequently
  -- cancels the service. Keep its original withdrawal time and payment history.
  update public.walk_registrations set
    status='cancelled_on_time',cancelled_at=coalesce(cancelled_at,now()),
    decided_at=now(),decided_by=auth.uid(),decision_note=trim(p_reason),
    payment_status=case
      when payment_status in ('paid','refunded') then payment_status
      else 'none'::public.payment_status
    end
  where walk_id=p_walk and status in ('accepted','pending','waitlisted','cancelled_late');
  get diagnostics affected = row_count;

  -- Read the net reservation after locking the package. Previous returns and
  -- retries must not create another available entry.
  for reservation in
    select distinct t.package_id,t.registration_id
    from public.package_transactions t
    join public.walk_registrations wr on wr.id=t.registration_id
    where wr.walk_id=p_walk
    order by t.package_id,t.registration_id
  loop
    perform 1 from public.packages where id=reservation.package_id for update;
    select coalesce(sum(t.reserved_delta),0)::integer into remaining_reserved
      from public.package_transactions t
      where t.package_id=reservation.package_id and t.registration_id=reservation.registration_id;
    if remaining_reserved>0 then
      insert into public.package_transactions(
        package_id,registration_id,available_delta,reserved_delta,reason,author_id
      ) values(
        reservation.package_id,reservation.registration_id,remaining_reserved,-remaining_reserved,
        'Odwołanie spaceru przez organizatora',auth.uid()
      );
    end if;
  end loop;
  update public.walks set status='cancelled',cancellation_reason=trim(p_reason) where id=p_walk;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'walk_cancelled',p_walk,
      jsonb_build_object('reason',trim(p_reason),'previous_status',w.status,'registrations_closed',affected));
end $$;

revoke execute on function public.decide_registration(uuid,public.registration_status,text),
  public.mark_attendance(uuid,public.attendance_status),public.cancel_walk(uuid,text)
  from public,anon;
grant execute on function public.decide_registration(uuid,public.registration_status,text),
  public.mark_attendance(uuid,public.attendance_status),public.cancel_walk(uuid,text)
  to authenticated;
