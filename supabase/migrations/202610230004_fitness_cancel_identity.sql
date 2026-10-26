-- A cancellation is identified by its immutable domain history event, not by
-- a package version that also advances for settlements and recorded payments.
create or replace function public.business_email_notification_token(p_id uuid) returns text
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
  elsif n.kind='fitness_cancelled' then
    -- Package commands append their resulting version to history. It orders
    -- cancellation generations even when timestamps tie, without depending on
    -- the mutable current package version or unrelated financial/care content.
    select jsonb_build_array(p.status,cancellation.id)::text into token
      from public.fitness_packages p join lateral (
        select h.id from public.fitness_history h
          where h.package_id=p.id and h.session_id is null and h.action='cancel'
          order by (h.details->>'version')::integer desc nulls last,h.id desc limit 1
      ) cancellation on true
      where p.id=n.entity_id and p.id=n.fitness_package_id and n.fitness_session_id is null
        and p.status='cancelled' and n.source_key='fitness:'||cancellation.id::text;
  elsif n.kind in ('fitness_session_scheduled','fitness_session_rescheduled','fitness_session_cancelled') then
    select jsonb_build_array(p.status,s.status,s.starts_at,s.duration_minutes,s.version)::text into token
      from public.fitness_packages p join public.fitness_sessions s on s.package_id=p.id
      where p.id=n.entity_id and p.id=n.fitness_package_id and s.id=n.fitness_session_id and case
        when n.kind='fitness_session_cancelled' then s.status in ('pending','cancelled')
        else p.status='active' and s.status='scheduled' and s.starts_at>now() end;
  end if;
  return case when token is not null then md5(token) end;
end $$;
revoke all on function public.business_email_notification_token(uuid) from public,anon,authenticated;

-- Adapt only already queued, still-current cancellations produced under the
-- previous token format. No insertion, backfill, terminal-state revival or
-- change to transport claims/leases/attempts; sending messages stay untouched.
with current_sources as (
  select o.id,public.business_email_notification_token(n.id) token
    from public.business_email_outbox o join public.notifications n on n.id=o.notification_id
    where o.kind='fitness_cancelled' and n.kind='fitness_cancelled'
      and o.status in ('pending','retry','claimed')
      and o.recipient_id=n.recipient_id and o.recipient_role=n.recipient_role
      and public.notification_delivery_current(n.id)
)
update public.business_email_outbox o set source_token=s.token from current_sources s
  where o.id=s.id and o.status in ('pending','retry','claimed')
    and s.token is not null and o.source_token is distinct from s.token;
