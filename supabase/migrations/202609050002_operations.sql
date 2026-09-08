create function public.create_walk(payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$declare w uuid;begin
 if not public.is_admin() then raise exception 'Brak uprawnień.';end if;
 if (payload->>'starts_at')::timestamptz<=now() or length(trim(payload->>'public_location'))<3 or length(trim(payload->>'exact_location'))<3 then raise exception 'Sprawdź datę i lokalizację.';end if;
 insert into public.walks(starts_at,duration_minutes,public_location,type,price_cents,capacity,booking_mode,info,leader_id,cancellation_deadline_hours)
 values((payload->>'starts_at')::timestamptz,(payload->>'duration_minutes')::integer,payload->>'public_location',payload->>'type',(payload->>'price_cents')::integer,(payload->>'capacity')::integer,(payload->>'booking_mode')::public.booking_mode,coalesce(payload->>'info',''),auth.uid(),(payload->>'cancellation_deadline_hours')::integer) returning id into w;
 insert into public.walk_private_details(walk_id,exact_location,map_url,instructions) values(w,payload->>'exact_location',coalesce(payload->>'map_url',''),coalesce(payload->>'instructions',''));
 insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'walk_created',w);return w;
end$$;
create function public.register_dog(p_walk uuid,p_dog uuid) returns uuid language plpgsql security definer set search_path='' as $$declare w public.walks;d public.dogs;r uuid;s public.registration_status:='pending';begin
 if auth.uid() is null then raise exception 'Zaloguj się.';end if;
 select * into w from public.walks where id=p_walk for update;
 select * into d from public.dogs where id=p_dog;
 if d.id is null or d.guardian_id<>auth.uid() then raise exception 'To nie jest Twój pies.';end if;
 if w.id is null or w.status<>'open' or w.starts_at<=now() then raise exception 'Zapisy są zamknięte.';end if;
 if w.booking_mode='invite' then raise exception 'Spacer tylko na zaproszenie.';end if;
 if d.status in ('suspended','not_eligible','consultation_required') then raise exception 'Przed zapisem skontaktuj się z behawiorystą.';end if;
 if exists(select 1 from public.walk_registrations where walk_id=p_walk and dog_id=p_dog) then raise exception 'Zgłoszenie już istnieje.';end if;
 if w.booking_mode='automatic' then
  if d.status not in ('approved','approved_conditional') then raise exception 'Profil psa wymaga akceptacji behawiorysty.';end if;
  if (select count(*) from public.walk_registrations where walk_id=p_walk and status='accepted')>=w.capacity then raise exception 'Brak wolnych miejsc.';end if;
  s='accepted';
 end if;
 insert into public.walk_registrations(walk_id,dog_id,status,payment_status,decided_at) values(p_walk,p_dog,s,case when s='accepted' then 'due'::public.payment_status else 'none'::public.payment_status end,case when s='accepted' then now() end) returning id into r;
 insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'registration_created',r,jsonb_build_object('status',s));return r;
end$$;
create function public.decide_registration(p_registration uuid,p_status public.registration_status,p_note text default '') returns void language plpgsql security definer set search_path='' as $$declare r public.walk_registrations;w public.walks;wid uuid;allowed boolean;begin
 if not public.is_admin() then raise exception 'Brak uprawnień.';end if;
 select walk_id into wid from public.walk_registrations where id=p_registration;
 select * into w from public.walks where id=wid for update;
 select * into r from public.walk_registrations where id=p_registration for update;
 if r.id is null then raise exception 'Nie znaleziono zgłoszenia.';end if;
 if p_status=r.status then return;end if;
 allowed=case r.status when 'pending' then p_status in ('accepted','waitlisted','rejected') when 'accepted' then p_status in ('waitlisted','rejected','cancelled_on_time','cancelled_late') when 'waitlisted' then p_status in ('accepted','rejected','pending') when 'rejected' then p_status='pending' else false end;
 if not allowed then raise exception 'Niedozwolona zmiana statusu.';end if;
 if p_status='accepted' then
  if w.status not in ('open','full') or w.starts_at<=now() then raise exception 'Nie można już zaakceptować zgłoszenia.';end if;
  if exists(select 1 from public.dogs where id=r.dog_id and status not in ('approved','approved_conditional')) then raise exception 'Najpierw zakwalifikuj psa w jego profilu.';end if;
 end if;
 update public.walk_registrations set status=p_status,decided_at=now(),decided_by=auth.uid(),decision_note=left(p_note,2000),payment_status=case when payment_status='paid' then payment_status when p_status in ('accepted','cancelled_late') then 'due'::public.payment_status else 'none'::public.payment_status end,cancelled_at=case when p_status in ('cancelled_on_time','cancelled_late') then now() end where id=p_registration;
 insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'registration_decided',r.id,jsonb_build_object('from',r.status,'to',p_status,'note',left(p_note,2000)));
end$$;
create function public.cancel_registration(p_registration uuid) returns void language plpgsql security definer set search_path='' as $$declare r public.walk_registrations;w public.walks;wid uuid;s public.registration_status;begin
 if auth.uid() is null then raise exception 'Zaloguj się.';end if;
 select walk_id into wid from public.walk_registrations where id=p_registration;
 select * into w from public.walks where id=wid for update;
 select * into r from public.walk_registrations where id=p_registration for update;
 if r.id is null or not public.owns_dog(r.dog_id) then raise exception 'Brak uprawnień.';end if;
 if r.status not in ('pending','waitlisted','accepted') or w.starts_at<=now() or w.status in ('completed','cancelled') then raise exception 'Nie można odwołać tego zgłoszenia.';end if;
 s=case when r.status<>'accepted' then 'withdrawn'::public.registration_status when now()<=w.starts_at-make_interval(hours=>w.cancellation_deadline_hours) then 'cancelled_on_time'::public.registration_status else 'cancelled_late'::public.registration_status end;
 update public.walk_registrations set status=s,cancelled_at=now(),payment_status=case when r.payment_status='paid' then 'paid'::public.payment_status when s='cancelled_late' then 'due'::public.payment_status else 'none'::public.payment_status end where id=p_registration;
 insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'registration_cancelled',r.id,jsonb_build_object('status',s));
end$$;
create function public.set_dog_status(p_dog uuid,p_status public.dog_status,p_note text) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_admin() then raise exception 'Brak uprawnień.';end if;
 if length(trim(p_note))<3 then raise exception 'Podaj powód zmiany.';end if;
 update public.dogs set status=p_status where id=p_dog;
 if not found then raise exception 'Nie znaleziono psa.';end if;
 insert into public.dog_notes(dog_id,author_id,body) values(p_dog,auth.uid(),left(p_note,8000));
 insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'dog_status_changed',p_dog,jsonb_build_object('status',p_status));
end$$;
create function public.mark_attendance(p_registration uuid,p_attendance public.attendance_status) returns void language plpgsql security definer set search_path='' as $$declare r public.walk_registrations;begin
 if not public.is_admin() then raise exception 'Brak uprawnień.';end if;
 select * into r from public.walk_registrations where id=p_registration for update;
 if r.id is null or r.status<>'accepted' then raise exception 'Obecność dotyczy zaakceptowanych psów.';end if;
 if exists(select 1 from public.walks where id=r.walk_id and starts_at>now()) then raise exception 'Spacer jeszcze się nie rozpoczął.';end if;
 update public.walk_registrations set attendance=p_attendance where id=r.id;
 insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'attendance_changed',r.id,jsonb_build_object('from',r.attendance,'to',p_attendance));
end$$;
revoke execute on function public.create_walk(jsonb),public.register_dog(uuid,uuid),public.decide_registration(uuid,public.registration_status,text),public.cancel_registration(uuid),public.set_dog_status(uuid,public.dog_status,text),public.mark_attendance(uuid,public.attendance_status) from public,anon;
grant execute on function public.create_walk(jsonb),public.register_dog(uuid,uuid),public.decide_registration(uuid,public.registration_status,text),public.cancel_registration(uuid),public.set_dog_status(uuid,public.dog_status,text),public.mark_attendance(uuid,public.attendance_status) to authenticated;
create function public.invite_dog(p_walk uuid,p_dog uuid) returns uuid language plpgsql security definer set search_path='' as $$declare w public.walks;r uuid;begin
 if not public.is_admin() then raise exception 'Brak uprawnień.';end if;
 select * into w from public.walks where id=p_walk for update;
 if w.id is null or w.starts_at<=now() or w.status not in ('open','full') then raise exception 'Zapisy są zamknięte.';end if;
 if not exists(select 1 from public.dogs where id=p_dog) then raise exception 'Nie znaleziono psa.';end if;
 if exists(select 1 from public.walk_registrations where walk_id=p_walk and dog_id=p_dog) then raise exception 'Zgłoszenie już istnieje.';end if;
 insert into public.walk_registrations(walk_id,dog_id,decided_by) values(p_walk,p_dog,auth.uid()) returning id into r;
 insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'dog_invited',r);return r;
end$$;
revoke execute on function public.invite_dog(uuid,uuid) from public,anon;
grant execute on function public.invite_dog(uuid,uuid) to authenticated;
