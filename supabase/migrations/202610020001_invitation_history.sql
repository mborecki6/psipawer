-- Staff-only, bounded projections. Auth tokens and password hashes never leave
-- the existing account-stage helper; reading an overdue attempt changes no data.
create function public.client_invitation_detail(p_id uuid)
returns table(id uuid,email text,display_name text,version integer,delivery_status text,last_attempt_at timestamptz,last_sent_at timestamptz,last_error_code text,created_at timestamptz,account_stage text,can_send boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null then raise exception 'Sprawdź zaproszenie.'; end if;
  return query select * from public.client_invitation_rows() i where i.id=p_id;
end $$;

create function public.client_invitation_attempt_feed(p_id uuid,p_offset integer default 0)
returns table(id uuid,started_at timestamptz,finished_at timestamptz,outcome text,error_code text,author_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_offset is null or p_offset not between 0 and 1000000 then raise exception 'Sprawdź stronę historii zaproszenia.'; end if;
  return query select a.id,a.started_at,a.finished_at,
    case when a.outcome='sending' and a.started_at<=now()-interval '2 minutes' then 'uncertain' else a.outcome end,
    case when a.outcome='sending' and a.started_at<=now()-interval '2 minutes' then 'unknown_result' else a.error_code end,
    coalesce(nullif(trim(p.full_name),''),'Zespół Psi Pawer')
    from public.invitation_attempts a left join public.profiles p on p.id=a.author_id
    where a.invitation_id=p_id
    order by a.started_at desc,a.id desc limit 21 offset p_offset;
end $$;
revoke all on function public.client_invitation_detail(uuid),public.client_invitation_attempt_feed(uuid,integer) from public,anon,authenticated;
grant execute on function public.client_invitation_detail(uuid),public.client_invitation_attempt_feed(uuid,integer) to authenticated;
