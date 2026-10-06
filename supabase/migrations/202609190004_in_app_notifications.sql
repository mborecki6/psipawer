-- Local inbox only. No email, push, WhatsApp or external delivery.
-- Store identifiers and event categories; never copy notes, advice or addresses.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles on delete cascade,
  recipient_role public.app_role not null,
  dog_id uuid not null references public.dogs on delete cascade,
  entity_id uuid not null,
  kind text not null check(kind in (
    'plan_published','progress_submitted','progress_reviewed',
    'consultation_requested','consultation_scheduled','consultation_rescheduled','consultation_cancelled','consultation_completed',
    'walk_changed','walk_cancelled','registration_created','registration_changed','registration_cancelled','walk_invitation',
    'payment_recorded','payment_refunded','follow_up_changed'
  )),
  source_key text not null check(length(source_key) between 1 and 180),
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  unique(recipient_id,source_key)
);
create index notification_inbox on public.notifications(recipient_id,created_at desc,id desc);
create index notification_unread on public.notifications(recipient_id,created_at desc,id desc) where read_at is null;
alter table public.notifications enable row level security;
create policy notifications_read on public.notifications for select to authenticated using (
  recipient_id=auth.uid() and (
    (recipient_role='admin' and public.is_admin()) or
    (recipient_role='client' and not public.is_admin() and public.owns_dog(dog_id))
  )
);
revoke all on public.notifications from public,anon,authenticated;
grant select on public.notifications to authenticated;

-- Private fan-out helpers. Recipients and their roles are determined from
-- committed domain records, never from a browser-supplied recipient or URL.
create function public.add_in_app_notification(
  p_recipient uuid,p_actor uuid,p_dog uuid,p_entity uuid,p_kind text,p_source text
) returns void language sql security definer set search_path='' as $$
  insert into public.notifications(recipient_id,recipient_role,dog_id,entity_id,kind,source_key)
    select r.user_id,r.role,p_dog,p_entity,p_kind,p_source from public.user_roles r
    where r.user_id=p_recipient and r.user_id is distinct from p_actor
    on conflict(recipient_id,source_key) do nothing;
$$;
create function public.notify_practice_staff(p_actor uuid,p_dog uuid,p_entity uuid,p_kind text,p_source text)
returns void language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
  for recipient in select user_id from public.user_roles where role='admin' and user_id is distinct from p_actor order by user_id loop
    perform public.add_in_app_notification(recipient,p_actor,p_dog,p_entity,p_kind,p_source);
  end loop;
end $$;

create function public.notify_care_event() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid; recipient uuid;
begin
  if new.kind='plan_published' then
    select published_by into actor from public.care_plan_versions where id=new.entity_id;
    select guardian_id into recipient from public.dogs where id=new.dog_id;
    perform public.add_in_app_notification(recipient,actor,new.dog_id,new.entity_id,'plan_published','care:'||new.id);
  elsif new.kind='progress_submitted' then
    select author_id into actor from public.care_progress where id=new.entity_id;
    perform public.notify_practice_staff(actor,new.dog_id,new.entity_id,'progress_submitted','care:'||new.id);
  end if;
  return new;
end $$;
create trigger notify_care_event after insert on public.care_events for each row execute function public.notify_care_event();

create function public.notify_consultation_event() returns trigger language plpgsql security definer set search_path='' as $$
declare h public.consultation_history; c public.consultations; recipient uuid; kind text;
begin
  select * into h from public.consultation_history where id=new.history_id;
  select * into c from public.consultations where id=h.consultation_id;
  kind:='consultation_'||h.action;
  select guardian_id into recipient from public.dogs where id=c.dog_id;
  perform public.add_in_app_notification(recipient,h.author_id,c.dog_id,c.id,kind,'consultation:'||h.id);
  perform public.notify_practice_staff(h.author_id,c.dog_id,c.id,kind,'consultation:'||h.id);
  return new;
end $$;
create trigger notify_consultation_event after insert on public.consultation_events for each row execute function public.notify_consultation_event();

create function public.notify_follow_up_change() returns trigger language plpgsql security definer set search_path='' as $$
declare f public.care_follow_ups; recipient uuid;
begin
  -- Initial scheduling is part of the published plan's notification. Completion
  -- and superseding are internal task transitions, not extra client messages.
  if new.action in ('rescheduled','reopened','cancelled') then
    select * into f from public.care_follow_ups where id=new.follow_up_id;
    select guardian_id into recipient from public.dogs where id=f.dog_id;
    perform public.add_in_app_notification(recipient,new.author_id,f.dog_id,f.id,'follow_up_changed','followup:'||f.id||':'||new.version);
  end if;
  return new;
end $$;
create trigger notify_follow_up_change after insert on public.care_follow_up_history for each row execute function public.notify_follow_up_change();

create function public.notify_domain_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.walk_registrations; p public.payments; dog uuid; recipient uuid; kind text; item record;
begin
  if new.event in ('registration_created','registration_decided','registration_cancelled','registration_reopened','dog_invited') then
    select * into r from public.walk_registrations where id=new.entity_id;
    if not found then return new; end if;
    select guardian_id into recipient from public.dogs where id=r.dog_id;
    kind:=case new.event when 'registration_created' then 'registration_created'
      when 'registration_cancelled' then 'registration_cancelled' when 'dog_invited' then 'walk_invitation' else 'registration_changed' end;
    perform public.add_in_app_notification(recipient,new.actor_id,r.dog_id,r.walk_id,kind,'audit:'||new.id);
    if new.event in ('registration_created','registration_cancelled') then
      perform public.notify_practice_staff(new.actor_id,r.dog_id,r.walk_id,kind,'audit:'||new.id);
    end if;
  elsif new.event in ('walk_updated','walk_cancelled') then
    kind:=case new.event when 'walk_updated' then 'walk_changed' else 'walk_cancelled' end;
    for item in select wr.dog_id,d.guardian_id from public.walk_registrations wr join public.dogs d on d.id=wr.dog_id
      where wr.walk_id=new.entity_id and (
        (new.event='walk_updated' and wr.status in ('pending','accepted','waitlisted')) or
        (new.event='walk_cancelled' and wr.status='cancelled_on_time')
      ) order by d.guardian_id,wr.dog_id
    loop
      perform public.add_in_app_notification(item.guardian_id,new.actor_id,item.dog_id,new.entity_id,kind,'audit:'||new.id||':'||item.dog_id);
    end loop;
  elsif new.event in ('payment_recorded','payment_refunded') then
    select * into p from public.payments where id=new.entity_id;
    if found and p.dog_id is not null then
      perform public.add_in_app_notification(p.guardian_id,new.actor_id,p.dog_id,p.id,new.event,'audit:'||new.id);
    end if;
  elsif new.event='care_progress_reviewed' then
    select dog_id,author_id into dog,recipient from public.care_progress where id=new.entity_id;
    if found then
      perform public.add_in_app_notification(recipient,new.actor_id,dog,new.entity_id,'progress_reviewed','audit:'||new.id);
    end if;
  end if;
  return new;
end $$;
create trigger notify_domain_audit after insert on public.audit_events for each row execute function public.notify_domain_audit();

-- Keyset pagination remains stable when new notifications arrive at the top.
-- A missing/inaccessible cursor returns an explicit reset instruction.
create function public.notification_feed(p_filter text default 'unread',p_before uuid default null)
returns table(id uuid,kind text,dog_id uuid,dog_name text,entity_id uuid,created_at timestamptz,read_at timestamptz)
language plpgsql stable security invoker set search_path='' as $$
declare boundary timestamptz;
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  if p_filter is null or p_filter not in ('unread','all') then raise exception 'Nieprawidłowy filtr.'; end if;
  if p_before is not null then
    select n.created_at into boundary from public.notifications n where n.id=p_before;
    if not found then raise exception 'Wróć do początku listy powiadomień.'; end if;
  end if;
  return query select n.id,n.kind,n.dog_id,d.name,n.entity_id,n.created_at,n.read_at
    from public.notifications n join public.dogs d on d.id=n.dog_id
    where (p_filter='all' or n.read_at is null) and (p_before is null or (n.created_at,n.id)<(boundary,p_before))
    order by n.created_at desc,n.id desc limit 21;
end $$;

create function public.read_notifications(p_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare ids_count integer; visible_count integer; updated_count integer;
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 20 or array_position(p_ids,null) is not null then
    raise exception 'Wybierz od 1 do 20 powiadomień.';
  end if;
  select count(distinct x) into ids_count from unnest(p_ids) x;
  if ids_count<>cardinality(p_ids) then raise exception 'Nie powtarzaj powiadomień.'; end if;
  -- Same visibility rule as RLS, needed because this is the only permitted
  -- update path. An administrator cannot read someone else's inbox either.
  perform n.id from public.notifications n where n.id=any(p_ids) and n.recipient_id=auth.uid() and (
      (n.recipient_role='admin' and public.is_admin()) or
      (n.recipient_role='client' and not public.is_admin() and public.owns_dog(n.dog_id))
    ) order by n.id for update;
  get diagnostics visible_count = row_count;
  if visible_count<>ids_count then raise exception 'Nie znaleziono Twoich powiadomień.'; end if;
  update public.notifications set read_at=clock_timestamp() where id=any(p_ids) and read_at is null;
  get diagnostics updated_count = row_count;
  return updated_count;
end $$;

revoke all on function public.add_in_app_notification(uuid,uuid,uuid,uuid,text,text),
  public.notify_practice_staff(uuid,uuid,uuid,text,text),public.notify_care_event(),
  public.notify_consultation_event(),public.notify_follow_up_change(),public.notify_domain_audit(),
  public.notification_feed(text,uuid),public.read_notifications(uuid[]) from public,anon,authenticated;
grant execute on function public.notification_feed(text,uuid),public.read_notifications(uuid[]) to authenticated;
-- Historical events remain in their modules. Installation does not backfill
-- an inbox full of stale messages or send invitations to existing users.
