alter table public.walks add column cancellation_reason text;

create function public.cancel_walk(p_walk uuid, p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare w public.walks; r record;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_reason is null or length(trim(p_reason)) < 3 or length(p_reason) > 2000 then
    raise exception 'Podaj powód odwołania (3–2000 znaków).';
  end if;
  select * into w from public.walks where id=p_walk for update;
  if w.id is null then raise exception 'Nie znaleziono spaceru.'; end if;
  if w.status='cancelled' then return; end if;
  if w.status='completed' or w.starts_at<=now() then
    raise exception 'Nie można odwołać rozpoczętego spaceru.';
  end if;
  -- Keep payment history. Returning money is a separate recorded operation.
  for r in select t.package_id,t.registration_id,sum(t.reserved_delta)::integer as reserved
    from public.package_transactions t join public.walk_registrations wr on wr.id=t.registration_id
    where wr.walk_id=p_walk group by t.package_id,t.registration_id
    having sum(t.reserved_delta)>0 order by t.package_id,t.registration_id
  loop
    perform 1 from public.packages where id=r.package_id for update;
    insert into public.package_transactions(package_id,registration_id,available_delta,reserved_delta,reason,author_id)
    values(r.package_id,r.registration_id,r.reserved,-r.reserved,'Odwołanie spaceru przez organizatora',auth.uid());
  end loop;
  update public.walk_registrations set status='cancelled_on_time',cancelled_at=now(),
    decided_at=now(),decided_by=auth.uid(),decision_note=trim(p_reason),
    payment_status=case when payment_status='paid' then payment_status else 'none'::public.payment_status end
    where walk_id=p_walk and status in ('accepted','pending','waitlisted');
  update public.walks set status='cancelled',cancellation_reason=trim(p_reason) where id=p_walk;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'walk_cancelled',p_walk,jsonb_build_object('reason',trim(p_reason),'previous_status',w.status));
end $$;
revoke execute on function public.cancel_walk(uuid,text) from public,anon;
grant execute on function public.cancel_walk(uuid,text) to authenticated;
