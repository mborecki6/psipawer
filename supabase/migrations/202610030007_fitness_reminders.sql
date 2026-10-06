-- One reminder per individually scheduled fitness meeting. The source is the
-- immutable session ID; money, package versions and notes never become its token.
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
  'fitness_attendance_corrected','fitness_settled','fitness_payment_recorded','fitness_payment_refunded','fitness_reminder'
));
alter table public.reminder_jobs drop constraint reminder_jobs_kind_check;
alter table public.reminder_jobs add constraint reminder_jobs_kind_check check(kind in ('consultation','walk','follow_up','course','fitness'));
alter table public.reminder_jobs
  add column fitness_package_id uuid references public.fitness_packages on delete cascade,
  add column fitness_session_id uuid,
  add constraint reminder_fitness_session foreign key(fitness_session_id,fitness_package_id)
    references public.fitness_sessions(id,package_id) on delete cascade,
  add constraint reminder_fitness_context check(
    (kind='fitness' and fitness_package_id is not null and fitness_session_id is not null
      and entity_id=fitness_package_id and source_id=fitness_session_id) or
    (kind<>'fitness' and fitness_package_id is null and fitness_session_id is null)
  );
create index reminder_fitness_package on public.reminder_jobs(fitness_package_id) where fitness_package_id is not null;
create index reminder_fitness_session on public.reminder_jobs(fitness_session_id) where fitness_session_id is not null;

alter function public.reminder_source(text,uuid) rename to reminder_source_before_fitness;
create function public.reminder_source(p_kind text,p_source uuid)
returns table(dog_id uuid,entity_id uuid,source_token text,target_at timestamptz,due_at timestamptz)
language sql stable security definer set search_path='' as $$
  select * from public.reminder_source_before_fitness(p_kind,p_source) where p_kind<>'fitness'
  union all
  select p.dog_id,p.id,s.version::text||':'||extract(epoch from s.starts_at)::text,s.starts_at,s.starts_at-interval '24 hours'
    from public.fitness_sessions s join public.fitness_packages p on p.id=s.package_id
    join public.dogs d on d.id=p.dog_id and d.guardian_id=p.guardian_id
    join public.user_roles r on r.user_id=p.guardian_id and r.role='client'
    where p_kind='fitness' and s.id=p_source and p.status='active'
      and s.status='scheduled' and s.starts_at>now();
$$;
create function public.fitness_reminder_context() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.kind='fitness' then
    select s.package_id,s.id into new.fitness_package_id,new.fitness_session_id
      from public.fitness_sessions s where s.id=new.source_id;
    if new.fitness_package_id is null then raise exception 'Nie znaleziono źródła przypomnienia fitness.'; end if;
  end if;
  return new;
end $$;
create trigger fitness_job_context before insert on public.reminder_jobs
  for each row execute function public.fitness_reminder_context();

create function public.sync_fitness_reminders(p_package uuid) returns void
language plpgsql security definer set search_path='' as $$
declare meeting uuid;
begin
  for meeting in select id from public.fitness_sessions where package_id=p_package order by id loop
    perform public.sync_reminder('fitness',meeting);
  end loop;
end $$;
create function public.sync_fitness_reminders_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare entitlement uuid;
begin
  if tg_table_name='fitness_sessions' then
    perform public.sync_reminder('fitness',new.id);
  elsif tg_table_name='fitness_packages' then
    if new.status is distinct from old.status then perform public.sync_fitness_reminders(new.id); end if;
  elsif new.guardian_id is distinct from old.guardian_id then
    -- A transfer withdraws future reminders immediately. Earlier delivered
    -- messages remain the frozen guardian's history, never the new owner's.
    for entitlement in select id from public.fitness_packages where dog_id=new.id order by id loop
      perform public.sync_fitness_reminders(entitlement);
    end loop;
  end if;
  return null;
end $$;
create trigger fitness_session_reminders_changed after insert or update of starts_at,status,version on public.fitness_sessions
  for each row execute function public.sync_fitness_reminders_changed();
create trigger fitness_package_reminders_changed after update of status on public.fitness_packages
  for each row execute function public.sync_fitness_reminders_changed();
create trigger fitness_guardian_reminders_changed after update of guardian_id on public.dogs
  for each row execute function public.sync_fitness_reminders_changed();

alter function public.lock_reminder_source(text,uuid,uuid) rename to lock_reminder_source_before_fitness;
create function public.lock_reminder_source(p_kind text,p_source uuid,p_dog uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare parent uuid; dog uuid;
begin
  if p_kind<>'fitness' then return public.lock_reminder_source_before_fitness(p_kind,p_source,p_dog); end if;
  select s.package_id,p.dog_id into parent,dog from public.fitness_sessions s
    join public.fitness_packages p on p.id=s.package_id where s.id=p_source;
  if parent is null then return true; end if;
  -- Same order as commands: dog (share) -> package -> session -> job.
  perform 1 from public.dogs where id=dog for share skip locked;
  if not found and exists(select 1 from public.dogs where id=dog) then return false; end if;
  perform 1 from public.fitness_packages where id=parent for update skip locked;
  if not found and exists(select 1 from public.fitness_packages where id=parent) then return false; end if;
  perform 1 from public.fitness_sessions where id=p_source for update skip locked;
  return found or not exists(select 1 from public.fitness_sessions where id=p_source);
end $$;

-- Bootstrap only eligible future meetings. No inbox messages are delivered by
-- installation, and previous reminders in other modules retain their state.
do $$ declare meeting uuid; begin
  for meeting in select s.id from public.fitness_sessions s
    join public.fitness_packages p on p.id=s.package_id where p.status='active' and s.status='scheduled' order by s.id loop
    perform public.sync_reminder('fitness',meeting);
  end loop;
end $$;
revoke all on function public.reminder_source(text,uuid),public.lock_reminder_source(text,uuid,uuid),
  public.fitness_reminder_context(),public.sync_fitness_reminders(uuid),public.sync_fitness_reminders_changed()
  from public,anon,authenticated;

-- Keep the existing batch limits, retry/history rules and atomic local delivery.
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
      elsif j.kind='fitness' then
        -- Role changes do not lock jobs. Hold the recipient role through commit
        -- so a concurrent promotion cannot turn a client reminder into staff mail.
        select r.user_id into recipient from public.user_roles r
          join public.fitness_packages p on p.guardian_id=r.user_id
          where p.id=j.fitness_package_id and r.role='client' for share of r;
        if recipient is null then raise exception 'No recipient'; end if;
        perform public.add_fitness_notification(recipient,null,j.fitness_package_id,j.fitness_session_id,'fitness_reminder','reminder:'||j.id);
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
