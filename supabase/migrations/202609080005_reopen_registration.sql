-- Reuse the original registration and preserve its ledger, payments and audit.
-- Restoring an application never restores its former approval automatically.
create function public.reopen_registration(p_registration uuid,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.walk_registrations; w public.walks; target_walk uuid;
  reserved bigint; used bigint;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_note is null or length(trim(p_note)) not between 3 and 2000 then
    raise exception 'Podaj powód przywrócenia zgłoszenia (3–2000 znaków).';
  end if;
  select wr.walk_id into target_walk from public.walk_registrations wr where wr.id=p_registration;
  select * into w from public.walks where id=target_walk for update;
  select * into r from public.walk_registrations where id=p_registration for update;
  if r.id is null then raise exception 'Nie znaleziono zgłoszenia.'; end if;
  if r.status='pending' then return; end if;
  if w.status not in ('open','full') or w.starts_at<=now() then
    raise exception 'Nie można przywrócić zgłoszenia na nieaktywny lub rozpoczęty spacer.';
  end if;
  if r.status not in ('withdrawn','cancelled_on_time') then
    raise exception 'Można przywrócić tylko wycofane lub odwołane w terminie zgłoszenie.';
  end if;
  if r.package_id is not null then
    perform 1 from public.packages where id=r.package_id for update;
    select coalesce(sum(t.reserved_delta),0),coalesce(sum(t.used_delta),0) into reserved,used
      from public.package_transactions t where t.package_id=r.package_id and t.registration_id=r.id;
    if reserved<>0 or used<>0 then
      raise exception 'Pakiet zgłoszenia wymaga rozliczenia przed przywróceniem.';
    end if;
  end if;
  update public.walk_registrations set status='pending',package_id=null,cancelled_at=null,
    cancellation_free_until=null,decision_note=trim(p_note),decided_at=now(),decided_by=auth.uid()
    where id=r.id;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'registration_reopened',r.id,jsonb_build_object(
      'previous_status',r.status,'previous_cancelled_at',r.cancelled_at,
      'previous_package_id',r.package_id,'previous_decision_note',r.decision_note,
      'previous_cancellation_free_until',r.cancellation_free_until,'reason',trim(p_note)));
end $$;
revoke execute on function public.reopen_registration(uuid,text) from public,anon;
grant execute on function public.reopen_registration(uuid,text) to authenticated;
