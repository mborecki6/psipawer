-- Keep the existing read API and its invoker privileges. A course appointment
-- links to the cycle; starts_at distinguishes its multiple meetings in the UI.
create or replace function public.calendar_appointments(p_from timestamptz,p_to timestamptz)
returns table(id uuid,kind text,title text,starts_at timestamptz,ends_at timestamptz,status text,location text,version integer)
language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<=p_from or p_to-p_from>interval '32 days' then raise exception 'Nieprawidłowy zakres kalendarza.'; end if;
  return query
    select w.id,'walk'::text,w.type,w.starts_at,w.starts_at+make_interval(mins=>w.duration_minutes),w.status::text,w.public_location,null::integer
      from public.walks w
      where w.status not in ('draft','cancelled') and w.starts_at<p_to and w.starts_at+make_interval(mins=>w.duration_minutes)>p_from
        and (public.is_admin() or exists(select 1 from public.walk_registrations r where r.walk_id=w.id and r.status='accepted' and public.owns_dog(r.dog_id)))
    union all
    select c.id,'consultation'::text,coalesce(c.service_name,'Konsultacja')||' · '||d.name,c.starts_at,c.starts_at+make_interval(mins=>c.duration_minutes),c.status,c.location,c.version
      from public.consultations c join public.dogs d on d.id=c.dog_id
      where c.status in ('scheduled','completed') and c.starts_at<p_to and c.starts_at+make_interval(mins=>c.duration_minutes)>p_from
    union all
    select b.id,'block'::text,b.title,b.starts_at,b.ends_at,'blocked'::text,''::text,b.version
      from public.calendar_blocks b where b.cancelled_at is null and b.starts_at<p_to and b.ends_at>p_from
    union all
    select c.id,'course'::text,c.title||' · spotkanie '||s.ordinal::text||'/'||c.sessions_count::text,
      s.starts_at,s.starts_at+make_interval(mins=>s.duration_minutes),s.status,
      coalesce(p.exact_location,s.public_location),s.version
      from public.courses c join public.course_sessions s on s.course_id=c.id
        left join public.course_session_private_details p on p.session_id=s.id
      where c.status in ('open','closed','completed') and s.status in ('scheduled','completed')
        and s.starts_at<p_to and s.starts_at+make_interval(mins=>s.duration_minutes)>p_from
        and (public.is_admin() or exists(select 1 from public.course_enrollments e
          where e.course_id=c.id and e.status='accepted' and e.guardian_id=auth.uid()))
    order by 4,2,1;
end $$;
