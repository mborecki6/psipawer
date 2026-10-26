-- Business email is an independent, opt-in channel. No SMTP happens inside a
-- domain transaction. No historic notifications or payments are backfilled.
create table public.business_email_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  changed_at timestamptz not null default clock_timestamp()
);
insert into public.business_email_settings(singleton) values(true);
alter table public.business_email_settings enable row level security;
revoke all on public.business_email_settings from public,anon,authenticated;
grant select,update on public.business_email_settings to service_role;

create table public.business_email_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid unique references public.notifications on delete cascade,
  payment_id uuid unique references public.payments on delete cascade,
  recipient_id uuid not null references public.profiles on delete cascade,
  recipient_role public.app_role not null,
  kind text not null,
  source_token text not null,
  status text not null default 'pending' check(status in ('pending','claimed','sending','retry','accepted','failed','uncertain','cancelled')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  next_attempt_at timestamptz not null default clock_timestamp(),
  claim_token uuid,
  claimed_at timestamptz,
  accepted_at timestamptz,
  finished_at timestamptz,
  last_error_code text check(last_error_code in ('disabled','stale_source','recipient_unavailable','lease_expired','smtp_retry','smtp_failed','smtp_uncertain')),
  created_at timestamptz not null default clock_timestamp(),
  check((notification_id is null)<>(payment_id is null)),
  check((status in ('claimed','sending'))=(claim_token is not null)),
  check((status='accepted')=(accepted_at is not null))
);
create index business_email_due on public.business_email_outbox(next_attempt_at,id) where status in ('pending','retry');
create index business_email_claim on public.business_email_outbox(claimed_at,id) where status in ('claimed','sending');
alter table public.business_email_outbox enable row level security;
revoke all on public.business_email_outbox from public,anon,authenticated;
grant select on public.business_email_outbox to service_role;

-- Only public identifiers and schedule/participation state contribute to this
-- private token. Notes, advice, health data and chat content are never copied.
create function public.business_email_notification_token(p_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare n public.notifications; token text; j public.reminder_jobs; source record;
begin
  select * into n from public.notifications where id=p_id;
  if not found or not public.notification_delivery_current(n.id) then return null; end if;
  if n.kind in ('consultation_reminder','walk_reminder','course_reminder','fitness_reminder') then
    if n.source_key !~ '^reminder:[0-9a-fA-F-]{36}$' then return null; end if;
    select * into j from public.reminder_jobs where id=substr(n.source_key,10)::uuid;
    if not found or j.status not in ('pending','retry','sent') or j.kind<>replace(n.kind,'_reminder','') then return null; end if;
    select * into source from public.reminder_source(j.kind,j.source_id);
    if not found or source.source_token<>j.source_token or source.target_at<>j.target_at then return null; end if;
    return md5(j.id::text||':'||j.source_token||':'||source.target_at::text);
  elsif n.kind in ('consultation_scheduled','consultation_rescheduled','consultation_cancelled') then
    select jsonb_build_array(c.status,c.starts_at,c.duration_minutes,c.meeting_mode)::text into token
      from public.consultations c where c.id=n.entity_id and c.dog_id=n.dog_id and
      case when n.kind='consultation_cancelled' then c.status='cancelled' else c.status='scheduled' and c.starts_at>now() end;
  elsif n.kind in ('registration_changed','registration_cancelled','walk_changed','walk_cancelled') then
    select jsonb_build_array(w.status,w.starts_at,w.duration_minutes,w.updated_at,r.status,r.decided_at,r.cancelled_at)::text into token
      from public.walks w join public.walk_registrations r on r.walk_id=w.id and r.dog_id=n.dog_id
      where w.id=n.entity_id and case
        when n.kind='walk_cancelled' then w.status='cancelled'
        when n.kind='registration_cancelled' then r.status in ('cancelled_on_time','cancelled_late')
        else w.status in ('open','closed','full') and w.starts_at>now() and r.status='accepted' end;
  elsif n.kind in ('course_enrollment_accepted','course_session_rescheduled','course_session_cancelled','course_cancelled') then
    select jsonb_build_array(c.status,e.status,e.reminder_generation,
      (select jsonb_agg(jsonb_build_array(s.id,s.status,s.starts_at,s.duration_minutes,s.version) order by s.id)
        from public.course_sessions s where s.course_id=c.id and (n.course_session_id is null or s.id=n.course_session_id)))::text into token
      from public.courses c join public.course_enrollments e on e.course_id=c.id
      where c.id=n.entity_id and e.id=n.course_enrollment_id and case
        when n.kind='course_cancelled' then c.status='cancelled'
        when n.kind='course_session_cancelled' then exists(select 1 from public.course_sessions s where s.id=n.course_session_id and s.course_id=c.id and s.status='cancelled')
        else c.status in ('open','closed') and e.status='accepted' and exists(select 1 from public.course_sessions s
          where s.course_id=c.id and (n.course_session_id is null or s.id=n.course_session_id) and s.status='scheduled' and s.starts_at>now()) end;
  elsif n.kind in ('fitness_session_scheduled','fitness_session_rescheduled','fitness_session_cancelled') then
    select jsonb_build_array(p.status,s.status,s.starts_at,s.duration_minutes,s.version)::text into token
      from public.fitness_packages p join public.fitness_sessions s on s.package_id=p.id
      where p.id=n.entity_id and p.id=n.fitness_package_id and s.id=n.fitness_session_id and case
        when n.kind='fitness_session_cancelled' then s.status in ('pending','cancelled')
        else p.status='active' and s.status='scheduled' and s.starts_at>now() end;
  end if;
  return case when token is not null then md5(token) end;
end $$;

create function public.enqueue_business_email() returns trigger
language plpgsql security definer set search_path='' as $$
declare token text; role public.app_role;
begin
  if not exists(select 1 from public.business_email_settings where singleton and enabled) then return new; end if;
  if tg_table_name='notifications' then
    token:=public.business_email_notification_token(new.id);
    if token is not null then
      insert into public.business_email_outbox(notification_id,recipient_id,recipient_role,kind,source_token)
        values(new.id,new.recipient_id,new.recipient_role,new.kind,token) on conflict(notification_id) do nothing;
    end if;
  elsif new.status='paid' and (tg_op='INSERT' or old.status is distinct from new.status) then
    select r.role into role from public.user_roles r where r.user_id=new.guardian_id and r.role='client';
    if role is not null then
      insert into public.business_email_outbox(payment_id,recipient_id,recipient_role,kind,source_token)
        values(new.id,new.guardian_id,role,'payment_confirmed',md5(new.id::text||':'||new.amount_cents::text))
        on conflict(payment_id) do nothing;
    end if;
  end if;
  return new;
end $$;
create trigger business_email_notification after insert on public.notifications for each row execute function public.enqueue_business_email();
create trigger business_email_payment after insert or update of status on public.payments for each row execute function public.enqueue_business_email();

create function public.business_email_settings_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.enabled is distinct from old.enabled then
    new.changed_at:=clock_timestamp();
    if not new.enabled then
      update public.business_email_outbox set status='cancelled',claim_token=null,finished_at=clock_timestamp(),last_error_code='disabled'
        where status in ('pending','retry','claimed');
      -- A transport already started cannot be recalled or safely repeated.
      update public.business_email_outbox set status='uncertain',claim_token=null,finished_at=clock_timestamp(),last_error_code='smtp_uncertain'
        where status='sending';
    end if;
  end if;
  return new;
end $$;
create trigger business_email_settings_changed before update on public.business_email_settings
  for each row execute function public.business_email_settings_changed();

create function public.business_email_source_current(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.business_email_outbox o join public.user_roles r on r.user_id=o.recipient_id and r.role=o.recipient_role
    join auth.users u on u.id=o.recipient_id
    where o.id=p_id and coalesce(to_jsonb(u)->>'email','')<>'' and
      coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity'::timestamptz)<=now() and
      (to_jsonb(u)->>'deleted_at') is null and case when o.notification_id is not null then
        o.created_at>now()-interval '24 hours' and o.source_token=public.business_email_notification_token(o.notification_id)
      else exists(select 1 from public.payments p where p.id=o.payment_id and p.guardian_id=o.recipient_id and p.status='paid'
        and o.source_token=md5(p.id::text||':'||p.amount_cents::text)) end);
$$;

create function public.worker_claim_business_email(p_limit integer default 1)
returns table(id uuid,claim_token uuid)
language plpgsql security definer set search_path='' as $$
declare t timestamptz:=clock_timestamp();
begin
  if p_limit is null or p_limit not between 1 and 2 then raise exception 'Invalid email batch'; end if;
  -- A crash after SMTP started is uncertain, never automatically re-sent.
  update public.business_email_outbox o set status='uncertain',claim_token=null,finished_at=t,last_error_code='lease_expired'
    where o.status='sending' and o.claimed_at<t-interval '90 seconds';
  update public.business_email_outbox o set status=case when o.attempts>=5 then 'failed' else 'retry' end,
    claim_token=null,next_attempt_at=t+interval '1 minute',last_error_code='lease_expired',
    finished_at=case when o.attempts>=5 then t end
    where o.status='claimed' and o.claimed_at<t-interval '90 seconds';
  if not exists(select 1 from public.business_email_settings where singleton and enabled) then return; end if;
  -- Current source and role are checked again by prepare immediately before SMTP.
  update public.business_email_outbox o set status='cancelled',claim_token=null,finished_at=t,last_error_code='stale_source'
    where o.status in ('pending','retry') and not public.business_email_source_current(o.id);
  return query with candidates as (
    select o.id from public.business_email_outbox o where o.status in ('pending','retry') and o.next_attempt_at<=t and o.attempts<5
      order by o.next_attempt_at,o.id for update skip locked limit p_limit
  ), claimed as (
    update public.business_email_outbox o set status='claimed',attempts=o.attempts+1,claimed_at=t,claim_token=gen_random_uuid()
      from candidates c where o.id=c.id returning o.id,o.claim_token
  ) select c.id,c.claim_token from claimed c;
end $$;

create function public.worker_prepare_business_email(p_id uuid,p_token uuid)
returns table(recipient text,recipient_role public.app_role,kind text,entity_id uuid,enrollment_id uuid,session_id uuid)
language plpgsql security definer set search_path='' as $$
declare o public.business_email_outbox; n public.notifications; mailbox text;
begin
  select * into o from public.business_email_outbox where id=p_id and claim_token=p_token and status='claimed'
    and claimed_at>clock_timestamp()-interval '90 seconds' for update;
  if not found then return; end if;
  if not exists(select 1 from public.business_email_settings where singleton and enabled) or not public.business_email_source_current(o.id) then
    update public.business_email_outbox set status='cancelled',claim_token=null,finished_at=clock_timestamp(),last_error_code='stale_source' where id=o.id;
    return;
  end if;
  select to_jsonb(u)->>'email' into mailbox from auth.users u where u.id=o.recipient_id;
  if mailbox is null or length(mailbox)>254 or mailbox ~ '[[:space:],<>;]' or mailbox !~ '^[^@]+@[^@]+$' then
    update public.business_email_outbox set status='failed',claim_token=null,finished_at=clock_timestamp(),last_error_code='recipient_unavailable' where id=o.id;
    return;
  end if;
  update public.business_email_outbox set status='sending',claimed_at=clock_timestamp() where id=o.id;
  if o.notification_id is not null then
    select * into n from public.notifications where id=o.notification_id;
    return query select mailbox,o.recipient_role,o.kind,n.entity_id,n.course_enrollment_id,coalesce(n.course_session_id,n.fitness_session_id);
  else
    return query select mailbox,o.recipient_role,o.kind,o.payment_id,null::uuid,null::uuid;
  end if;
end $$;

create function public.worker_finish_business_email(p_id uuid,p_token uuid,p_outcome text) returns boolean
language plpgsql security definer set search_path='' as $$
declare o public.business_email_outbox; t timestamptz:=clock_timestamp(); outcome text;
begin
  if p_outcome is null or p_outcome not in ('accepted','retry','failed','uncertain') then raise exception 'Invalid email outcome'; end if;
  select * into o from public.business_email_outbox where id=p_id and claim_token=p_token and status='sending'
    and claimed_at>t-interval '90 seconds' for update;
  if not found then return false; end if;
  outcome:=case when p_outcome='retry' and o.attempts>=5 then 'failed' else p_outcome end;
  update public.business_email_outbox set status=outcome,claim_token=null,
    accepted_at=case when outcome='accepted' then t end,
    finished_at=case when outcome<>'retry' then t end,
    next_attempt_at=case when outcome='retry' then t+make_interval(secs=>least(3600,60*power(2,o.attempts-1)::integer)) else next_attempt_at end,
    last_error_code=case when outcome='accepted' then null else 'smtp_'||outcome end where id=o.id;
  return true;
end $$;

-- Admin diagnostics expose statuses/counts, never addresses, hashes, payloads
-- or SMTP responses. There is no client or browser delivery API.
create function public.business_email_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  return jsonb_build_object('enabled',(select enabled from public.business_email_settings where singleton),
    'counts',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from public.business_email_outbox group by status) s),'{}'::jsonb));
end $$;

revoke all on function public.business_email_notification_token(uuid),public.enqueue_business_email(),public.business_email_settings_changed(),
  public.business_email_source_current(uuid),public.worker_claim_business_email(integer),public.worker_prepare_business_email(uuid,uuid),
  public.worker_finish_business_email(uuid,uuid,text),public.business_email_status() from public,anon,authenticated;
grant execute on function public.worker_claim_business_email(integer),public.worker_prepare_business_email(uuid,uuid),
  public.worker_finish_business_email(uuid,uuid,text) to service_role;
grant execute on function public.business_email_status() to authenticated;
