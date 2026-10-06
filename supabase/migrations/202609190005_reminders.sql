-- Timed, transactional IN-APP delivery. No network calls or email provider.
create table public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('consultation','walk','follow_up')),
  source_id uuid not null,
  dog_id uuid not null references public.dogs on delete cascade,
  entity_id uuid not null,
  generation integer not null check(generation>0),
  source_token text not null,
  target_at timestamptz not null check(isfinite(target_at)),
  due_at timestamptz not null check(isfinite(due_at)),
  next_attempt_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','retry','sent','failed','cancelled')),
  attempts integer not null default 0 check(attempts>=0),
  cycle_attempts integer not null default 0 check(cycle_attempts between 0 and 5),
  last_error_code text check(last_error_code in ('delivery_failed','source_changed')),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique(kind,source_id,generation)
);
create unique index reminder_one_waiting on public.reminder_jobs(kind,source_id) where status in ('pending','retry','failed');
create index reminder_due on public.reminder_jobs(next_attempt_at,id) where status in ('pending','retry');
create index reminder_history on public.reminder_jobs(created_at desc,id desc);
create table public.reminder_attempts (
  job_id uuid not null references public.reminder_jobs on delete cascade,
  attempt integer not null,
  outcome text not null check(outcome in ('sent','failed','cancelled')),
  error_code text check(error_code in ('delivery_failed','source_changed')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(job_id,attempt)
);
create table public.reminder_worker_state (
  singleton boolean primary key default true check(singleton),
  last_run_at timestamptz not null,
  result jsonb not null
);
alter table public.reminder_jobs enable row level security;
alter table public.reminder_attempts enable row level security;
alter table public.reminder_worker_state enable row level security;
create policy reminder_jobs_staff on public.reminder_jobs for select to authenticated using(public.is_admin());
create policy reminder_attempts_staff on public.reminder_attempts for select to authenticated using(public.is_admin());
create policy reminder_worker_staff on public.reminder_worker_state for select to authenticated using(public.is_admin());
revoke all on public.reminder_jobs,public.reminder_attempts,public.reminder_worker_state from public,anon,authenticated;
grant select on public.reminder_jobs,public.reminder_attempts,public.reminder_worker_state to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
  'plan_published','progress_submitted','progress_reviewed',
  'consultation_requested','consultation_scheduled','consultation_rescheduled','consultation_cancelled','consultation_completed',
  'walk_changed','walk_cancelled','registration_created','registration_changed','registration_cancelled','walk_invitation',
  'payment_recorded','payment_refunded','follow_up_changed',
  'consultation_reminder','walk_reminder','follow_up_reminder'
));

-- Derive eligibility from the current source; never trust a stale queue payload.
create function public.reminder_source(p_kind text,p_source uuid)
returns table(dog_id uuid,entity_id uuid,source_token text,target_at timestamptz,due_at timestamptz)
language sql stable security definer set search_path='' as $$
  select c.dog_id,c.id,extract(epoch from c.starts_at)::text,c.starts_at,c.starts_at-interval '24 hours'
    from public.consultations c where p_kind='consultation' and c.id=p_source and c.status='scheduled' and c.starts_at>now()
  union all
  select r.dog_id,w.id,extract(epoch from w.starts_at)::text||':'||coalesce(extract(epoch from r.decided_at)::text,''),w.starts_at,w.starts_at-interval '24 hours'
    from public.walk_registrations r join public.walks w on w.id=r.walk_id
    where p_kind='walk' and r.id=p_source and r.status='accepted' and w.status in ('open','full','closed') and w.starts_at>now()
  union all
  select f.dog_id,f.id,f.version::text,(f.due_on+time '09:00') at time zone 'Europe/Warsaw',(f.due_on+time '09:00') at time zone 'Europe/Warsaw'
    from public.care_follow_ups f where p_kind='follow_up' and f.id=p_source and f.status='open';
$$;
create function public.sync_reminder(p_kind text,p_source uuid) returns void
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
create function public.sync_source_reminders() returns trigger
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
  if tg_table_name='walks' then
    for rid in select id from public.walk_registrations where walk_id=new.id order by id loop
      perform public.sync_reminder('walk',rid);
    end loop;
  else
    perform public.sync_reminder(case tg_table_name when 'consultations' then 'consultation' when 'walk_registrations' then 'walk' else 'follow_up' end,new.id);
  end if;
  return new;
end $$;
create trigger consultation_reminder_sync after insert or update of status,starts_at on public.consultations for each row execute function public.sync_source_reminders();
create trigger registration_reminder_sync after insert or update of status,decided_at on public.walk_registrations for each row execute function public.sync_source_reminders();
create trigger walk_reminder_sync after update of status,starts_at on public.walks for each row execute function public.sync_source_reminders();
create trigger follow_up_reminder_sync after insert or update of status,due_on,version on public.care_follow_ups for each row execute function public.sync_source_reminders();

-- Bootstrap only upcoming appointments and still-open contact tasks. A worker
-- must run separately; installing the migration never delivers a notification.
do $$ declare s record; begin
  for s in select 'consultation'::text kind,id from public.consultations where status='scheduled' and starts_at>now()
    union all select 'walk',r.id from public.walk_registrations r join public.walks w on w.id=r.walk_id where r.status='accepted' and w.starts_at>now()
    union all select 'follow_up',id from public.care_follow_ups where status='open'
  loop perform public.sync_reminder(s.kind,s.id); end loop;
end $$;

-- Match source-operation lock order BEFORE locking a job. SKIP LOCKED lets an
-- active edit finish; the next run sees its committed result. No external I/O
-- occurs while holding these locks. Delivery and job success commit together.
create function public.lock_reminder_source(p_kind text,p_source uuid,p_dog uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare parent uuid;
begin
  if p_kind='consultation' then
    perform 1 from public.consultations where id=p_source for update skip locked;
    return found or not exists(select 1 from public.consultations where id=p_source);
  elsif p_kind='walk' then
    select walk_id into parent from public.walk_registrations where id=p_source;
    if parent is null then return true; end if;
    perform 1 from public.walks where id=parent for update skip locked;
    if not found and exists(select 1 from public.walks where id=parent) then return false; end if;
    perform 1 from public.walk_registrations where id=p_source for update skip locked;
    return found or not exists(select 1 from public.walk_registrations where id=p_source);
  else
    perform 1 from public.dogs where id=p_dog for update skip locked;
    if not found and exists(select 1 from public.dogs where id=p_dog) then return false; end if;
    perform 1 from public.care_follow_ups where id=p_source for update skip locked;
    return found or not exists(select 1 from public.care_follow_ups where id=p_source);
  end if;
end $$;
create function public.dispatch_due_reminders(p_limit integer) returns jsonb
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
create function public.process_due_reminders(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  return public.dispatch_due_reminders(p_limit);
end $$;
-- Separate worker entry point: user-facing RPCs never use a service key.
create function public.worker_process_due_reminders(p_limit integer default 50) returns jsonb
language sql security definer set search_path='' as $$ select public.dispatch_due_reminders(p_limit) $$;
create function public.retry_reminder(p_id uuid,p_expected_attempts integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.reminder_jobs;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  select * into j from public.reminder_jobs where id=p_id for update;
  if not found or p_expected_attempts is null or p_expected_attempts<1 or j.attempts<>p_expected_attempts then raise exception 'Odśwież kolejkę przed ponowieniem.'; end if;
  if j.status='retry' and j.cycle_attempts=0 then return false; end if;
  if j.status<>'failed' then raise exception 'Odśwież kolejkę przed ponowieniem.'; end if;
  update public.reminder_jobs set status='retry',cycle_attempts=0,next_attempt_at=clock_timestamp(),finished_at=null where id=p_id;
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'reminder_retried',p_id);
  return true;
end $$;
create function public.reminder_counts() returns table(status text,total bigint,due bigint)
language sql stable security invoker set search_path='' as $$
  select j.status,count(*),count(*) filter(where j.status in ('pending','retry') and j.next_attempt_at<=now())
    from public.reminder_jobs j group by j.status;
$$;
revoke all on function public.reminder_source(text,uuid),public.sync_reminder(text,uuid),public.sync_source_reminders(),
  public.lock_reminder_source(text,uuid,uuid),public.dispatch_due_reminders(integer),public.process_due_reminders(integer),
  public.worker_process_due_reminders(integer),public.retry_reminder(uuid,integer),public.reminder_counts() from public,anon,authenticated;
grant execute on function public.process_due_reminders(integer),public.retry_reminder(uuid,integer),public.reminder_counts() to authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.worker_process_due_reminders(integer) to service_role;
  end if;
end $$;
