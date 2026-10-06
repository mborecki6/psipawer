-- Fitness events use the immutable domain history. Inbox rows contain only
-- category and identifiers: no meeting points, notes or financial amounts.
alter table public.notifications
  add column fitness_package_id uuid references public.fitness_packages on delete cascade,
  add column fitness_session_id uuid,
  add constraint notification_fitness_session foreign key(fitness_session_id,fitness_package_id)
    references public.fitness_sessions(id,package_id) on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
  'plan_published','progress_submitted','progress_reviewed',
  'consultation_requested','consultation_scheduled','consultation_rescheduled','consultation_cancelled','consultation_completed','consultation_price_agreed',
  'walk_changed','walk_cancelled','registration_created','registration_changed','registration_cancelled','walk_invitation',
  'payment_recorded','payment_refunded','follow_up_changed','consultation_reminder','walk_reminder','follow_up_reminder',
  'course_enrollment_requested','course_enrollment_accepted','course_enrollment_waitlisted','course_enrollment_rejected','course_enrollment_cancelled','course_enrollment_reopened',
  'course_cancelled','course_completed','course_session_rescheduled','course_session_cancelled','course_session_completed',
  'course_attendance_recorded','course_settled','course_payment_recorded','course_payment_refunded','course_reminder','course_updated',
  'fitness_requested','fitness_accepted','fitness_rejected','fitness_cancelled','fitness_completed','fitness_reopened',
  'fitness_session_scheduled','fitness_session_rescheduled','fitness_session_cancelled','fitness_session_completed','fitness_session_reopened',
  'fitness_attendance_corrected','fitness_settled','fitness_payment_recorded','fitness_payment_refunded'
));
alter table public.notifications add constraint notification_fitness_context check(
  (kind like 'fitness\_%' escape '\' and fitness_package_id is not null and entity_id=fitness_package_id) or
  (kind not like 'fitness\_%' escape '\' and fitness_package_id is null and fitness_session_id is null)
);
create index notification_fitness_package on public.notifications(fitness_package_id) where fitness_package_id is not null;

drop policy notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  recipient_id=(select auth.uid()) and (
    (recipient_role='admin' and (select public.is_admin())) or
    (recipient_role='client' and not (select public.is_admin()) and (
      (course_enrollment_id is null and fitness_package_id is null and public.owns_dog(dog_id)) or
      exists(select 1 from public.course_enrollments e join public.user_roles r on r.user_id=e.guardian_id
        where e.id=notifications.course_enrollment_id and e.course_id=notifications.entity_id
          and e.guardian_id=(select auth.uid()) and r.role='client') or
      exists(select 1 from public.fitness_packages p join public.user_roles r on r.user_id=p.guardian_id
        where p.id=notifications.fitness_package_id and p.id=notifications.entity_id
          and p.guardian_id=(select auth.uid()) and r.role='client')
    ))
  )
);

create function public.add_fitness_notification(p_recipient uuid,p_actor uuid,p_package uuid,p_session uuid,p_kind text,p_source text)
returns void language sql security definer set search_path='' as $$
  insert into public.notifications(recipient_id,recipient_role,dog_id,entity_id,kind,source_key,fitness_package_id,fitness_session_id)
    select r.user_id,r.role,p.dog_id,p.id,p_kind,p_source,p.id,p_session
    from public.fitness_packages p join public.user_roles r on r.user_id=p_recipient
    where p.id=p_package and (r.role='admin' or p.guardian_id=r.user_id)
      and r.user_id is distinct from p_actor
      and (p_session is null or exists(select 1 from public.fitness_sessions s where s.id=p_session and s.package_id=p.id))
    on conflict(recipient_id,source_key) do nothing;
$$;
create function public.notify_fitness_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.fitness_packages; recipient uuid; kind text;
begin
  select * into p from public.fitness_packages where id=new.package_id;
  kind:=case when new.session_id is not null then case new.action
    when 'scheduled' then 'fitness_session_scheduled' when 'rescheduled' then 'fitness_session_rescheduled'
    when 'cancel' then 'fitness_session_cancelled' when 'complete' then 'fitness_session_completed'
    when 'reopen' then 'fitness_session_reopened' when 'correct' then 'fitness_attendance_corrected' end
    else case new.action
    when 'requested' then 'fitness_requested' when 'accept' then 'fitness_accepted' when 'reject' then 'fitness_rejected'
    when 'cancel' then 'fitness_cancelled' when 'complete' then 'fitness_completed'
    when 'resume' then 'fitness_reopened' when 'restore' then 'fitness_reopened' when 'reconsider' then 'fitness_reopened'
    when 'settled' then 'fitness_settled' when 'payment_recorded' then 'fitness_payment_recorded'
    when 'payment_refunded' then 'fitness_payment_refunded' end end;
  if kind is null then return new; end if;
  perform public.add_fitness_notification(p.guardian_id,new.actor_id,p.id,new.session_id,kind,'fitness:'||new.id);
  for recipient in select user_id from public.user_roles where role='admin' and user_id is distinct from new.actor_id order by user_id loop
    perform public.add_fitness_notification(recipient,new.actor_id,p.id,new.session_id,kind,'fitness:'||new.id);
  end loop;
  return new;
end $$;
create trigger notify_fitness_history after insert on public.fitness_history for each row execute function public.notify_fitness_history();

-- Retain the existing keyset order, count and read semantics for every domain.
drop function public.notification_feed(text,uuid);
create function public.notification_feed(p_filter text default 'unread',p_before uuid default null)
returns table(id uuid,kind text,dog_id uuid,dog_name text,entity_id uuid,created_at timestamptz,read_at timestamptz,
  course_enrollment_id uuid,course_session_id uuid,fitness_package_id uuid,fitness_session_id uuid)
language plpgsql stable security invoker set search_path='' as $$
declare boundary timestamptz;
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  if p_filter is null or p_filter not in ('unread','all') then raise exception 'Nieprawidłowy filtr.'; end if;
  if p_before is not null then
    select n.created_at into boundary from public.notifications n where n.id=p_before;
    if not found then raise exception 'Wróć do początku listy powiadomień.'; end if;
  end if;
  return query select n.id,n.kind,n.dog_id,coalesce(d.name,'Pies zgłoszenia'),n.entity_id,n.created_at,n.read_at,
    n.course_enrollment_id,n.course_session_id,n.fitness_package_id,n.fitness_session_id
    from public.notifications n left join public.dogs d on d.id=n.dog_id
    where (p_filter='all' or n.read_at is null) and (p_before is null or (n.created_at,n.id)<(boundary,p_before))
    order by n.created_at desc,n.id desc limit 21;
end $$;
create or replace function public.read_notifications(p_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare ids_count integer; visible_count integer; updated_count integer;
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 20 or array_position(p_ids,null) is not null then
    raise exception 'Wybierz od 1 do 20 powiadomień.';
  end if;
  select count(distinct x) into ids_count from unnest(p_ids) x;
  if ids_count<>cardinality(p_ids) then raise exception 'Nie powtarzaj powiadomień.'; end if;
  perform n.id from public.notifications n where n.id=any(p_ids) and n.recipient_id=auth.uid() and (
    (n.recipient_role='admin' and public.is_admin()) or
    (n.recipient_role='client' and not public.is_admin() and (
      (n.course_enrollment_id is null and n.fitness_package_id is null and public.owns_dog(n.dog_id)) or
      exists(select 1 from public.course_enrollments e join public.user_roles r on r.user_id=e.guardian_id
        where e.id=n.course_enrollment_id and e.course_id=n.entity_id and e.guardian_id=auth.uid() and r.role='client') or
      exists(select 1 from public.fitness_packages p join public.user_roles r on r.user_id=p.guardian_id
        where p.id=n.fitness_package_id and p.id=n.entity_id and p.guardian_id=auth.uid() and r.role='client')
    ))
  ) order by n.id for update;
  get diagnostics visible_count = row_count;
  if visible_count<>ids_count then raise exception 'Nie znaleziono Twoich powiadomień.'; end if;
  update public.notifications set read_at=clock_timestamp() where id=any(p_ids) and read_at is null;
  get diagnostics updated_count = row_count;
  return updated_count;
end $$;
revoke all on function public.add_fitness_notification(uuid,uuid,uuid,uuid,text,text),public.notify_fitness_history(),
  public.notification_feed(text,uuid) from public,anon,authenticated;
grant execute on function public.notification_feed(text,uuid) to authenticated;

-- One actionable row per package, including unfinished attendance and money
-- after cancellation. Viewing the queue never changes the package or history.
create or replace function public.staff_work_items()
returns table(kind text,id uuid,dog_id uuid,dog_name text,title text,due_on date,created_at timestamptz,priority integer,source_id uuid)
language plpgsql stable security invoker set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  return query
  select 'followups'::text,f.id,f.dog_id,d.name,'Kontakt kontrolny'::text,f.due_on,f.created_at,
    case when f.due_on<(now() at time zone 'Europe/Warsaw')::date then 0 when f.due_on=(now() at time zone 'Europe/Warsaw')::date then 1 else 6 end,f.plan_id
    from public.care_follow_ups f join public.dogs d on d.id=f.dog_id where f.status='open'
  union all
  select 'consultations',c.id,c.dog_id,d.name,coalesce(c.service_name,'Konsultacja do ustalenia'),null::date,c.created_at,2,c.id
    from public.consultations c join public.dogs d on d.id=c.dog_id where c.status='requested'
  union all
  select 'progress',p.id,p.dog_id,d.name,'Odpowiedź o postępach',null::date,p.created_at,3,p.plan_id
    from public.care_progress p join public.dogs d on d.id=p.dog_id where p.reviewed_at is null
  union all
  select 'profiles',d.id,d.id,d.name,case when d.status='new' then 'Nowy profil do oceny' else 'Profil do ponownej oceny' end,null::date,d.created_at,4,d.id
    from public.dogs d where d.status in ('new','needs_review')
  union all
  select 'walks',r.id,r.dog_id,d.name,'Zgłoszenie na spacer',(w.starts_at at time zone 'Europe/Warsaw')::date,r.created_at,5,w.id
    from public.walk_registrations r join public.walks w on w.id=r.walk_id join public.dogs d on d.id=r.dog_id
    where r.status='pending' and w.starts_at>now() and w.status not in ('draft','cancelled','completed')
  union all
  select 'fitness',b.id,b.dog_id,d.name,
    case when b.status='requested' then 'Rozpatrz zgłoszenie fitness'
      when b.status='cancelled' and b.needs_settlement then 'Uzgodnij należność po rezygnacji z fitness'
      when b.refund_due_cents>0 then 'Odnotuj uzgodniony zwrot za fitness'
      when d.guardian_id<>b.guardian_id then 'Uzgodnij zmianę opiekuna pakietu fitness'
      when ended.starts_at is not null then 'Zapisz obecność zakończonego spotkania fitness'
      when b.completed_sessions=b.sessions_count then 'Zakończ obsłużony pakiet fitness'
      else 'Ustal pozostałe terminy fitness' end,
    (ended.starts_at at time zone 'Europe/Warsaw')::date,b.created_at,
    case when ended.starts_at is not null then 1 when b.status in ('requested','cancelled') or d.guardian_id<>b.guardian_id then 2 else 5 end,b.id
    from public.fitness_balances b join public.dogs d on d.id=b.dog_id
    left join lateral(select min(s.starts_at) starts_at from public.fitness_sessions s where s.package_id=b.id
      and s.status='scheduled' and s.starts_at+make_interval(mins=>s.duration_minutes)<=now()) ended on true
    where b.status='requested' or (b.status='cancelled' and (b.needs_settlement or b.refund_due_cents>0))
      or (b.status='active' and (d.guardian_id<>b.guardian_id or ended.starts_at is not null
        or b.completed_sessions=b.sessions_count or exists(select 1 from public.fitness_sessions s where s.package_id=b.id and s.status='pending')));
end $$;
create or replace function public.staff_work_queue(p_filter text default 'all',p_offset integer default 0)
returns table(kind text,id uuid,dog_id uuid,dog_name text,title text,due_on date,created_at timestamptz,priority integer,source_id uuid)
language plpgsql stable security invoker set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_filter is null or p_filter not in ('all','followups','consultations','progress','profiles','walks','fitness')
    or p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Nieprawidłowy filtr listy.'; end if;
  return query select * from public.staff_work_items() w where p_filter='all' or w.kind=p_filter
    order by w.priority,w.due_on nulls last,w.created_at,w.kind,w.id limit 21 offset p_offset;
end $$;
create or replace function public.staff_work_counts()
returns table(kind text,total bigint,overdue bigint)
language sql stable security invoker set search_path='' as $$
  select w.kind,count(*),count(*) filter(where w.kind in ('followups','fitness') and w.due_on<(now() at time zone 'Europe/Warsaw')::date)
    from public.staff_work_items() w group by w.kind order by w.kind;
$$;

-- Fitness cash events already produce a domain notification. Keep legacy
-- audit delivery for the other payment targets without duplicate messages.
create or replace function public.notify_domain_audit() returns trigger language plpgsql security definer set search_path='' as $$
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
    if found and p.dog_id is not null and p.course_enrollment_id is null and p.fitness_package_id is null then
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
