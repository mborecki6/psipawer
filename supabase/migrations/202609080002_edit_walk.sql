-- Editing is atomic with registration decisions (both lock the walk first).
alter table public.walks add column change_note text;
alter table public.walk_registrations add column cancellation_free_until timestamptz;

create function public.update_walk(p_walk uuid, p_expected_updated_at timestamptz, payload jsonb, p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare w public.walks; active_count integer; has_history boolean;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  select * into w from public.walks where id=p_walk for update;
  if w.id is null then raise exception 'Nie znaleziono spaceru.'; end if;
  if w.status in ('completed','cancelled') or w.starts_at<=now() then
    raise exception 'Nie można edytować rozpoczętego lub odwołanego spaceru.';
  end if;
  if p_expected_updated_at is null or w.updated_at<>p_expected_updated_at then
    raise exception 'Spacer zmienił się w międzyczasie. Odśwież formularz przed zapisem.';
  end if;
  if p_note is null or length(trim(p_note))<3 or length(p_note)>2000 then
    raise exception 'Podaj opis zmiany dla uczestników.';
  end if;
  if jsonb_typeof(payload)<>'object' or not (payload ?& array['starts_at','duration_minutes','public_location','type','price_cents','capacity','booking_mode','info','exact_location','map_url','instructions','cancellation_deadline_hours']) then
    raise exception 'Sprawdź dane spaceru.';
  end if;
  if exists(select 1 from jsonb_each(payload) e where e.value='null'::jsonb) or
     (payload->>'starts_at')::timestamptz<=now() or
     length(trim(payload->>'public_location')) not between 3 and 200 or
     length(trim(payload->>'type')) not between 3 and 100 or
     length(trim(payload->>'exact_location')) not between 3 and 500 or
     length(payload->>'info')>4000 or length(payload->>'instructions')>2000 or
     (payload->>'duration_minutes')::int not between 15 and 480 or
     (payload->>'capacity')::int not between 1 and 50 or
     (payload->>'price_cents')::int not between 1 and 1000000 or
     (payload->>'cancellation_deadline_hours')::int not between 0 and 168 or
     (payload->>'booking_mode') not in ('approval','automatic','invite') or
     ((payload->>'map_url')<>'' and (payload->>'map_url') !~ '^https://') then
    raise exception 'Sprawdź dane spaceru.';
  end if;
  select exists(select 1 from public.walk_registrations where walk_id=p_walk) into has_history;
  if has_history and ((payload->>'price_cents')::int<>w.price_cents or
       (payload->>'cancellation_deadline_hours')::int<>w.cancellation_deadline_hours or
       (payload->>'booking_mode')<>w.booking_mode::text) then
    raise exception 'Po pierwszym zgłoszeniu cena, tryb zapisów i zasady odwołania pozostają bez zmian.';
  end if;
  select count(*) into active_count from public.walk_registrations where walk_id=p_walk and status='accepted';
  if (payload->>'capacity')::int<active_count then
    raise exception 'Limit nie może być mniejszy od zaakceptowanego składu.';
  end if;
  -- Existing accepted clients keep the more favorable deadline when the date moves.
  if w.starts_at<>(payload->>'starts_at')::timestamptz then
    update public.walk_registrations set cancellation_free_until=greatest(
      cancellation_free_until,w.starts_at-make_interval(hours=>w.cancellation_deadline_hours),
      (payload->>'starts_at')::timestamptz-make_interval(hours=>w.cancellation_deadline_hours))
      where walk_id=p_walk and status='accepted';
  end if;
  update public.walks set starts_at=(payload->>'starts_at')::timestamptz,
    duration_minutes=(payload->>'duration_minutes')::int,public_location=trim(payload->>'public_location'),
    type=trim(payload->>'type'),price_cents=(payload->>'price_cents')::int,
    capacity=(payload->>'capacity')::int,booking_mode=(payload->>'booking_mode')::public.booking_mode,
    info=trim(payload->>'info'),cancellation_deadline_hours=(payload->>'cancellation_deadline_hours')::int,
    change_note=trim(p_note) where id=p_walk;
  insert into public.walk_private_details(walk_id,exact_location,map_url,instructions)
    values(p_walk,trim(payload->>'exact_location'),payload->>'map_url',trim(payload->>'instructions'))
    on conflict(walk_id) do update set exact_location=excluded.exact_location,map_url=excluded.map_url,instructions=excluded.instructions;
  -- Audit contains no exact location; access remains restricted by the audit RLS policy.
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'walk_updated',p_walk,
    jsonb_build_object('note',trim(p_note),'previous_start',w.starts_at,'new_start',payload->>'starts_at','previous_capacity',w.capacity,'new_capacity',(payload->>'capacity')::int));
end $$;
revoke execute on function public.update_walk(uuid,timestamptz,jsonb,text) from public,anon;
grant execute on function public.update_walk(uuid,timestamptz,jsonb,text) to authenticated;

create or replace function public.cancel_registration(p_registration uuid) returns void language plpgsql security definer set search_path='' as $$declare r public.walk_registrations;w public.walks;wid uuid;s public.registration_status;begin
 if auth.uid() is null then raise exception 'Zaloguj się.';end if;
 select walk_id into wid from public.walk_registrations where id=p_registration;
 select * into w from public.walks where id=wid for update;
 select * into r from public.walk_registrations where id=p_registration for update;
 if r.id is null or not public.owns_dog(r.dog_id) then raise exception 'Brak uprawnień.';end if;
 if r.status not in ('pending','waitlisted','accepted') or w.starts_at<=now() or w.status in ('completed','cancelled') then raise exception 'Nie można odwołać tego zgłoszenia.';end if;
 s=case when r.status<>'accepted' then 'withdrawn'::public.registration_status when now()<=coalesce(r.cancellation_free_until,w.starts_at-make_interval(hours=>w.cancellation_deadline_hours)) then 'cancelled_on_time'::public.registration_status else 'cancelled_late'::public.registration_status end;
 update public.walk_registrations set status=s,cancelled_at=now(),payment_status=case when r.payment_status in ('paid','refunded') then r.payment_status when s='cancelled_late' then 'due'::public.payment_status else 'none'::public.payment_status end where id=p_registration;
 insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'registration_cancelled',r.id,jsonb_build_object('status',s));
end$$;
