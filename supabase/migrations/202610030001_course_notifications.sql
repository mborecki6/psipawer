-- Course messages stay inside the app. Only IDs/categories are stored here;
-- exact meeting points, reasons and monetary details remain in their domains.
alter table public.notifications
  add column course_enrollment_id uuid references public.course_enrollments on delete cascade,
  add column course_session_id uuid references public.course_sessions on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
  'plan_published','progress_submitted','progress_reviewed',
  'consultation_requested','consultation_scheduled','consultation_rescheduled','consultation_cancelled','consultation_completed','consultation_price_agreed',
  'walk_changed','walk_cancelled','registration_created','registration_changed','registration_cancelled','walk_invitation',
  'payment_recorded','payment_refunded','follow_up_changed','consultation_reminder','walk_reminder','follow_up_reminder',
  'course_enrollment_requested','course_enrollment_accepted','course_enrollment_waitlisted','course_enrollment_rejected','course_enrollment_cancelled',
  'course_cancelled','course_completed','course_session_rescheduled','course_session_cancelled','course_session_completed',
  'course_attendance_recorded','course_settled','course_payment_recorded','course_payment_refunded','course_reminder'
));
alter table public.notifications add constraint notification_course_context check(
  (kind like 'course\_%' escape '\' and course_enrollment_id is not null) or
  (kind not like 'course\_%' escape '\' and course_enrollment_id is null and course_session_id is null)
);
create index notification_course_enrollment on public.notifications(course_enrollment_id) where course_enrollment_id is not null;
create index notification_course_session on public.notifications(course_session_id) where course_session_id is not null;

drop policy notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  recipient_id=(select auth.uid()) and (
    (recipient_role='admin' and (select public.is_admin())) or
    (recipient_role='client' and not (select public.is_admin()) and (
      (course_enrollment_id is null and public.owns_dog(dog_id)) or
      exists(select 1 from public.course_enrollments e join public.user_roles r on r.user_id=e.guardian_id
        where e.id=notifications.course_enrollment_id and e.course_id=notifications.entity_id
        and e.guardian_id=(select auth.uid()) and r.role='client')
    ))
  )
);

create function public.add_course_notification(p_recipient uuid,p_actor uuid,p_enrollment uuid,p_session uuid,p_kind text,p_source text)
returns void language sql security definer set search_path='' as $$
  insert into public.notifications(recipient_id,recipient_role,dog_id,entity_id,kind,source_key,course_enrollment_id,course_session_id)
    select r.user_id,r.role,e.dog_id,e.course_id,p_kind,p_source,e.id,p_session
    from public.course_enrollments e join public.user_roles r on r.user_id=p_recipient
    where e.id=p_enrollment and (r.role='admin' or e.guardian_id=r.user_id)
      and r.user_id is distinct from p_actor
      and (p_session is null or exists(select 1 from public.course_sessions s where s.id=p_session and s.course_id=e.course_id))
    on conflict(recipient_id,source_key) do nothing;
$$;
create function public.notify_course_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.course_enrollments; recipient uuid; kind text; source text;
begin
  if new.enrollment_id is not null then
    select * into e from public.course_enrollments where id=new.enrollment_id;
    kind:=case new.action
      when 'requested' then 'course_enrollment_requested' when 'accept' then 'course_enrollment_accepted'
      when 'waitlist' then 'course_enrollment_waitlisted' when 'reject' then 'course_enrollment_rejected'
      when 'cancel' then 'course_enrollment_cancelled' when 'course_cancelled' then 'course_cancelled'
      when 'settled' then 'course_settled' when 'payment_recorded' then 'course_payment_recorded'
      when 'payment_refunded' then 'course_payment_refunded' when 'attendance' then 'course_attendance_recorded' end;
    if kind is null then return new; end if;
    source:='course:'||new.id;
    if new.action<>'requested' then
      perform public.add_course_notification(e.guardian_id,new.actor_id,e.id,new.session_id,kind,source);
    end if;
    for recipient in select user_id from public.user_roles where role='admin' and user_id is distinct from new.actor_id order by user_id loop
      perform public.add_course_notification(recipient,new.actor_id,e.id,new.session_id,kind,source);
    end loop;
  else
    -- Bulk cancellation has one enrollment event per active guardian already.
    -- Changes to individual meetings concern active applicants and participants.
    kind:=case when new.session_id is not null then case new.action
      when 'rescheduled' then 'course_session_rescheduled' when 'cancel' then 'course_session_cancelled'
      when 'complete' then 'course_session_completed' end
      when new.action='complete' then 'course_completed' end;
    if kind is null then return new; end if;
    for e in select * from public.course_enrollments where course_id=new.course_id
      and (status='accepted' or (new.session_id is not null and new.action in ('rescheduled','cancel') and status in ('requested','waitlisted')))
      order by guardian_id,id loop
      perform public.add_course_notification(e.guardian_id,new.actor_id,e.id,new.session_id,kind,'course:'||new.id||':'||e.id);
    end loop;
  end if;
  return new;
end $$;
create trigger notify_course_history after insert on public.course_history for each row execute function public.notify_course_history();

-- Keep keyset pagination and frozen enrollment access after a dog transfer.
-- A left join never exposes a dog's new private profile to the previous owner.
drop function public.notification_feed(text,uuid);
create function public.notification_feed(p_filter text default 'unread',p_before uuid default null)
returns table(id uuid,kind text,dog_id uuid,dog_name text,entity_id uuid,created_at timestamptz,read_at timestamptz,course_enrollment_id uuid,course_session_id uuid)
language plpgsql stable security invoker set search_path='' as $$
declare boundary timestamptz;
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  if p_filter is null or p_filter not in ('unread','all') then raise exception 'Nieprawidłowy filtr.'; end if;
  if p_before is not null then
    select n.created_at into boundary from public.notifications n where n.id=p_before;
    if not found then raise exception 'Wróć do początku listy powiadomień.'; end if;
  end if;
  return query select n.id,n.kind,n.dog_id,coalesce(d.name,'Pies zgłoszenia'),n.entity_id,n.created_at,n.read_at,n.course_enrollment_id,n.course_session_id
    from public.notifications n left join public.dogs d on d.id=n.dog_id
    where (p_filter='all' or n.read_at is null) and (p_before is null or (n.created_at,n.id)<(boundary,p_before))
    order by n.created_at desc,n.id desc limit 21;
end $$;

-- One immutable source identity per meeting and enrollment, never one reminder
-- for an entire cycle. Financial versions do not change participation tokens.
alter table public.course_enrollments add column reminder_generation integer not null default 0 check(reminder_generation>=0);
create table public.course_reminder_sources (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.course_sessions on delete cascade,
  enrollment_id uuid not null references public.course_enrollments on delete cascade,
  unique(session_id,enrollment_id)
);
create index course_reminder_enrollment on public.course_reminder_sources(enrollment_id);
alter table public.course_reminder_sources enable row level security;
revoke all on public.course_reminder_sources from public,anon,authenticated;
alter table public.reminder_jobs drop constraint reminder_jobs_kind_check;
alter table public.reminder_jobs add constraint reminder_jobs_kind_check check(kind in ('consultation','walk','follow_up','course'));
alter table public.reminder_jobs
  add column course_enrollment_id uuid references public.course_enrollments on delete cascade,
  add column course_session_id uuid references public.course_sessions on delete cascade;
alter table public.reminder_jobs add constraint reminder_course_context check(
  (kind='course' and course_enrollment_id is not null and course_session_id is not null) or
  (kind<>'course' and course_enrollment_id is null and course_session_id is null)
);
create index reminder_course_enrollment on public.reminder_jobs(course_enrollment_id) where course_enrollment_id is not null;
create index reminder_course_session on public.reminder_jobs(course_session_id) where course_session_id is not null;

alter function public.reminder_source(text,uuid) rename to reminder_source_before_courses;
create function public.reminder_source(p_kind text,p_source uuid)
returns table(dog_id uuid,entity_id uuid,source_token text,target_at timestamptz,due_at timestamptz)
language sql stable security definer set search_path='' as $$
  select * from public.reminder_source_before_courses(p_kind,p_source) where p_kind<>'course'
  union all
  select e.dog_id,e.course_id,s.version::text||':'||extract(epoch from s.starts_at)::text||':'||e.reminder_generation::text,s.starts_at,s.starts_at-interval '24 hours'
    from public.course_reminder_sources source join public.course_sessions s on s.id=source.session_id
    join public.course_enrollments e on e.id=source.enrollment_id and e.course_id=s.course_id
    join public.courses c on c.id=e.course_id
    where p_kind='course' and source.id=p_source and e.status='accepted' and c.status in ('open','closed')
      and s.status='scheduled' and s.starts_at>now();
$$;
create function public.course_reminder_context() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='course_enrollments' then
    if new.status is distinct from old.status then new.reminder_generation:=old.reminder_generation+1; end if;
  elsif new.kind='course' then
    select source.enrollment_id,source.session_id into new.course_enrollment_id,new.course_session_id
      from public.course_reminder_sources source where source.id=new.source_id;
    if new.course_enrollment_id is null then raise exception 'Nie znaleziono źródła przypomnienia kursu.'; end if;
  end if;
  return new;
end $$;
create trigger course_participation_generation before update of status on public.course_enrollments
  for each row execute function public.course_reminder_context();
create trigger course_job_context before insert on public.reminder_jobs for each row execute function public.course_reminder_context();

create function public.sync_course_reminders(p_course uuid,p_session uuid default null,p_enrollment uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare source uuid;
begin
  insert into public.course_reminder_sources(session_id,enrollment_id)
    select s.id,e.id from public.course_sessions s join public.course_enrollments e on e.course_id=s.course_id
    join public.courses c on c.id=s.course_id where c.id=p_course and c.status in ('open','closed')
      and s.status='scheduled' and s.starts_at>now() and e.status='accepted'
      and (p_session is null or s.id=p_session) and (p_enrollment is null or e.id=p_enrollment)
    order by s.id,e.id on conflict(session_id,enrollment_id) do nothing;
  for source in select source.id from public.course_reminder_sources source
    join public.course_sessions s on s.id=source.session_id where s.course_id=p_course
      and (p_session is null or s.id=p_session) and (p_enrollment is null or source.enrollment_id=p_enrollment) order by source.id loop
    perform public.sync_reminder('course',source);
  end loop;
end $$;
create function public.sync_course_reminders_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='courses' then
    if old.status in ('open','closed') and new.status in ('open','closed') then return null; end if;
    perform public.sync_course_reminders(new.id);
  elsif tg_table_name='course_sessions' then
    perform public.sync_course_reminders(new.course_id,new.id,null);
  else
    perform public.sync_course_reminders(new.course_id,null,new.id);
  end if;
  return null;
end $$;
create trigger course_reminders_changed after update of status on public.courses for each row execute function public.sync_course_reminders_changed();
create trigger course_enrollment_reminders_changed after insert or update of status on public.course_enrollments for each row execute function public.sync_course_reminders_changed();
create trigger course_session_reminders_changed after insert or update of starts_at,status,version on public.course_sessions for each row execute function public.sync_course_reminders_changed();

alter function public.lock_reminder_source(text,uuid,uuid) rename to lock_reminder_source_before_courses;
create function public.lock_reminder_source(p_kind text,p_source uuid,p_dog uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare parent uuid; meeting uuid; enrollment uuid;
begin
  if p_kind<>'course' then return public.lock_reminder_source_before_courses(p_kind,p_source,p_dog); end if;
  select s.course_id,source.session_id,source.enrollment_id into parent,meeting,enrollment
    from public.course_reminder_sources source join public.course_sessions s on s.id=source.session_id where source.id=p_source;
  if parent is null then return true; end if;
  -- Same order as course commands: course -> meeting -> enrollment -> job.
  perform 1 from public.courses where id=parent for update skip locked;
  if not found and exists(select 1 from public.courses where id=parent) then return false; end if;
  perform 1 from public.course_sessions where id=meeting for update skip locked;
  if not found and exists(select 1 from public.course_sessions where id=meeting) then return false; end if;
  perform 1 from public.course_enrollments where id=enrollment for update skip locked;
  return found or not exists(select 1 from public.course_enrollments where id=enrollment);
end $$;

-- Installation schedules eligible future meetings, without delivering history.
do $$ declare cycle uuid; begin
  for cycle in select id from public.courses where status in ('open','closed') order by id loop
    perform public.sync_course_reminders(cycle);
  end loop;
end $$;
revoke all on function public.add_course_notification(uuid,uuid,uuid,uuid,text,text),public.notify_course_history(),
  public.reminder_source(text,uuid),public.lock_reminder_source(text,uuid,uuid),public.course_reminder_context(),
  public.sync_course_reminders(uuid,uuid,uuid),public.sync_course_reminders_changed(),public.notification_feed(text,uuid) from public,anon,authenticated;
grant execute on function public.notification_feed(text,uuid) to authenticated;

-- Updated authoritative write paths use the same course visibility and source.
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
  -- Same visibility rule as RLS, needed because this is the only permitted
  -- update path. An administrator cannot read someone else's inbox either.
  perform n.id from public.notifications n where n.id=any(p_ids) and n.recipient_id=auth.uid() and (
      (n.recipient_role='admin' and public.is_admin()) or
      (n.recipient_role='client' and not public.is_admin() and (
        (n.course_enrollment_id is null and public.owns_dog(n.dog_id)) or
        exists(select 1 from public.course_enrollments e join public.user_roles r on r.user_id=e.guardian_id
          where e.id=n.course_enrollment_id and e.course_id=n.entity_id and e.guardian_id=auth.uid() and r.role='client')
      ))
    ) order by n.id for update;
  get diagnostics visible_count = row_count;
  if visible_count<>ids_count then raise exception 'Nie znaleziono Twoich powiadomień.'; end if;
  update public.notifications set read_at=clock_timestamp() where id=any(p_ids) and read_at is null;
  get diagnostics updated_count = row_count;
  return updated_count;
end $$;
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
    if found and p.dog_id is not null and p.course_enrollment_id is null then
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
create or replace function public.sync_reminder(p_kind text,p_source uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s record; j public.reminder_jobs; eligible boolean;
begin
  select * into s from public.reminder_source(p_kind,p_source); eligible:=found;
  select * into j from public.reminder_jobs where kind=p_kind and source_id=p_source order by generation desc limit 1 for update;
  if eligible and j.id is not null and j.source_token=s.source_token and j.status<>'cancelled' then return; end if;
  update public.reminder_jobs set status='cancelled',finished_at=clock_timestamp(),last_error_code='source_changed'
    where kind=p_kind and source_id=p_source and status in ('pending','retry','failed');
  if eligible then
    insert into public.reminder_jobs(kind,source_id,dog_id,entity_id,generation,source_token,target_at,due_at,next_attempt_at)
      values(p_kind,p_source,s.dog_id,s.entity_id,coalesce(j.generation,0)+1,s.source_token,s.target_at,s.due_at,greatest(s.due_at,clock_timestamp()));
  end if;
end $$;
create or replace function public.dispatch_due_reminders(p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; j public.reminder_jobs; s record; recipient uuid;
  sent_count integer:=0; failed_count integer:=0; cancelled_count integer:=0; skipped_count integer:=0;
  result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Sprawdź wielkość partii.'; end if;
  for candidate in select id,kind,source_id,dog_id from public.reminder_jobs
    where status in ('pending','retry') and next_attempt_at<=now() order by next_attempt_at,id limit p_limit
  loop
    if not public.lock_reminder_source(candidate.kind,candidate.source_id,candidate.dog_id) then skipped_count:=skipped_count+1; continue; end if;
    select * into j from public.reminder_jobs where id=candidate.id and status in ('pending','retry') and next_attempt_at<=now() for update skip locked;
    if not found then skipped_count:=skipped_count+1; continue; end if;
    select * into s from public.reminder_source(j.kind,j.source_id);
    if not found or s.source_token is distinct from j.source_token or s.dog_id is distinct from j.dog_id then
      update public.reminder_jobs set status='cancelled',last_error_code='source_changed',finished_at=clock_timestamp(),attempts=attempts+1 where id=j.id;
      insert into public.reminder_attempts(job_id,attempt,outcome,error_code) values(j.id,j.attempts+1,'cancelled','source_changed');
      cancelled_count:=cancelled_count+1; continue;
    end if;
    begin
      if j.kind='follow_up' then
        if not exists(select 1 from public.user_roles where role='admin') then raise exception 'No recipient'; end if;
        perform public.notify_practice_staff(null,j.dog_id,j.entity_id,'follow_up_reminder','reminder:'||j.id);
      elsif j.kind='course' then
        select e.guardian_id into recipient from public.course_enrollments e join public.user_roles r on r.user_id=e.guardian_id
          where e.id=j.course_enrollment_id;
        if recipient is null then raise exception 'No recipient'; end if;
        perform public.add_course_notification(recipient,null,j.course_enrollment_id,j.course_session_id,'course_reminder','reminder:'||j.id);
      else
        select d.guardian_id into recipient from public.dogs d join public.user_roles r on r.user_id=d.guardian_id where d.id=j.dog_id;
        if recipient is null then raise exception 'No recipient'; end if;
        perform public.add_in_app_notification(recipient,null,j.dog_id,j.entity_id,j.kind||'_reminder','reminder:'||j.id);
      end if;
      update public.reminder_jobs set status='sent',attempts=attempts+1,cycle_attempts=cycle_attempts+1,last_error_code=null,finished_at=clock_timestamp() where id=j.id;
      insert into public.reminder_attempts(job_id,attempt,outcome) values(j.id,j.attempts+1,'sent');
      sent_count:=sent_count+1;
    exception when others then
      -- Never persist SQLERRM: it can contain private domain data or credentials.
      update public.reminder_jobs set status=case when j.cycle_attempts>=4 then 'failed' else 'retry' end,
        attempts=attempts+1,cycle_attempts=cycle_attempts+1,last_error_code='delivery_failed',
        next_attempt_at=clock_timestamp()+make_interval(mins=>case j.cycle_attempts when 0 then 1 when 1 then 5 when 2 then 15 else 60 end),
        finished_at=case when j.cycle_attempts>=4 then clock_timestamp() else null end where id=j.id;
      insert into public.reminder_attempts(job_id,attempt,outcome,error_code) values(j.id,j.attempts+1,'failed','delivery_failed');
      failed_count:=failed_count+1;
    end;
  end loop;
  result:=jsonb_build_object('sent',sent_count,'failed',failed_count,'cancelled',cancelled_count,'skipped',skipped_count);
  insert into public.reminder_worker_state(last_run_at,result) values(clock_timestamp(),result)
    on conflict(singleton) do update set last_run_at=excluded.last_run_at,result=excluded.result;
  return result;
end $$;
