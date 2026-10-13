-- Available offer, separate from private appointments. Only aggregate capacity
-- and the caller's eligibility leave this function; no roster or private place.
-- The visibility predicates intentionally match walks_read / courses_read.
-- Closed or cancelled items stay visible only to their existing guardians.
create function public.calendar_offer(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid, source_id uuid, kind text, category text, title text,
  starts_at timestamptz, ends_at timestamptz, public_location text,
  availability text, booking_mode text, eligibility text,
  session_ordinal integer, sessions_count integer
) language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_to<=p_from or p_to-p_from>interval '62 days' then
    raise exception 'Wybierz poprawny miesiąc oferty.';
  end if;
  return query
  with own_dogs as materialized (
    select d.id,d.status from public.dogs d where d.guardian_id=auth.uid()
  ), own_walks as materialized (
    select r.walk_id,r.dog_id from public.walk_registrations r
      join own_dogs d on d.id=r.dog_id
  ), own_courses as materialized (
    select e.course_id,e.dog_id from public.course_enrollments e
      where e.guardian_id=auth.uid()
  )
  select w.id,w.id,'walk'::text,'group'::text,w.type,
    w.starts_at,w.starts_at+make_interval(mins=>w.duration_minutes),w.public_location,
    case when w.status='cancelled' then 'cancelled'
      when w.status='completed' or w.starts_at<=now() then 'past'
      when w.status='closed' then 'closed'
      when w.status='full' or (select count(*) from public.walk_registrations r
        where r.walk_id=w.id and r.status='accepted')>=w.capacity then 'full'
      else 'available' end,
    w.booking_mode::text,
    case when w.booking_mode='invite' then 'invitation_only'
      when not exists(select 1 from own_dogs) then 'needs_dog'
      when exists(select 1 from own_dogs d where
        not exists(select 1 from own_walks r where r.walk_id=w.id and r.dog_id=d.id)
        and (case when w.booking_mode='automatic' then d.status in ('approved','approved_conditional')
          else d.status not in ('suspended','not_eligible','consultation_required') end)) then 'eligible'
      when exists(select 1 from own_walks r where r.walk_id=w.id) then 'registered'
      else 'qualification_required' end,
    null::integer,null::integer
  from public.walks w
  where w.starts_at>=p_from and w.starts_at<p_to and w.status<>'draft'
    and ((w.status in ('open','full') and w.booking_mode<>'invite')
      or exists(select 1 from own_walks r where r.walk_id=w.id))
  union all
  select s.id,c.id,'course'::text,c.course_format,c.title,
    s.starts_at,s.starts_at+make_interval(mins=>s.duration_minutes),s.public_location,
    case when c.status='cancelled' or s.status='cancelled' then 'cancelled'
      when c.status='completed' or s.status='completed' or s.starts_at<=now() then 'past'
      when c.status='closed' or exists(select 1 from public.course_sessions prior
        where prior.course_id=c.id and prior.starts_at<=now()) then 'closed'
      when (select count(*) from public.course_enrollments e
        where e.course_id=c.id and e.status='accepted')>=c.capacity then 'full'
      else 'available' end,
    'approval'::text,
    case when not exists(select 1 from own_dogs) then 'needs_dog'
      when exists(select 1 from own_dogs d where not exists(
        select 1 from public.course_enrollments e where e.course_id=c.id and e.dog_id=d.id)) then 'eligible'
      else 'registered' end,
    s.ordinal,c.sessions_count
  from public.courses c join public.course_sessions s on s.course_id=c.id
  where s.starts_at>=p_from and s.starts_at<p_to and c.status<>'draft'
    and (c.status='open' or exists(select 1 from own_courses e where e.course_id=c.id));
end $$;
revoke all on function public.calendar_offer(timestamptz,timestamptz) from public,anon;
grant execute on function public.calendar_offer(timestamptz,timestamptz) to authenticated;
