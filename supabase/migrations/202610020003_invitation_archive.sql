-- Archiving only unused drafts is reversible and never revokes an Auth link.
alter table public.client_invitations add column archived_at timestamptz;
alter table public.client_invitations add column archive_changed_by uuid references public.profiles;
alter table public.client_invitations add constraint archived_invitation_is_unsent check(
  archived_at is null or (delivery_status='draft' and last_attempt_id is null and last_attempt_at is null and last_sent_at is null));
create index client_invitation_archive_feed on public.client_invitations((archived_at is not null),created_at desc,id desc);

create function public.set_client_invitation_archived(p_id uuid,p_expected_version integer,p_archived boolean) returns integer
language plpgsql security definer set search_path='' as $$
declare i public.client_invitations;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_archived is null or p_expected_version is null or p_expected_version not between 1 and 2147483646 then
    raise exception 'Odśwież zaproszenie przed zmianą.';
  end if;
  select * into i from public.client_invitations where id=p_id for update;
  if not found then raise exception 'Nie znaleziono zaproszenia.'; end if;
  if i.delivery_status<>'draft' or i.last_attempt_at is not null or exists(select 1 from public.invitation_attempts a where a.invitation_id=i.id) then
    raise exception 'Można archiwizować tylko zaproszenia, których wysyłka jeszcze się nie rozpoczęła.';
  end if;
  -- A retry of the same transition must not add another version or audit entry.
  if i.version=p_expected_version+1 and i.archive_changed_by=auth.uid() and (i.archived_at is not null)=p_archived then return i.version; end if;
  if i.version<>p_expected_version then raise exception 'Zaproszenie zmieniło się. Odśwież widok przed zmianą.'; end if;
  if (i.archived_at is not null)=p_archived then return i.version; end if;
  update public.client_invitations set archived_at=case when p_archived then clock_timestamp() else null end,
    archive_changed_by=auth.uid(),version=version+1 where id=i.id returning version into i.version;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),case when p_archived then 'client_invitation_archived' else 'client_invitation_restored' end,i.id,jsonb_build_object('version',i.version));
  return i.version;
end $$;
revoke all on function public.set_client_invitation_archived(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.set_client_invitation_archived(uuid,integer,boolean) to authenticated;

create or replace function public.prepare_client_invitation(p_id uuid,p_email text,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare i public.client_invitations; normalized_email text:=lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or normalized_email is null or length(normalized_email) not between 3 and 254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_name is null or length(trim(p_name)) not between 2 and 120 then raise exception 'Sprawdź nazwę i adres e-mail.'; end if;
  select * into i from public.client_invitations where id=p_id;
  if found then
    if i.archived_at is not null then raise exception 'Adres znajduje się już w archiwum. Otwórz archiwum i przywróć zaproszenie.'; end if;
    if i.email=normalized_email and i.display_name=trim(p_name) and i.created_by=auth.uid() then return i.id; end if;
    raise exception 'Ten formularz został już zapisany. Odśwież widok.';
  end if;
  if exists(select 1 from auth.users u left join public.user_roles r on r.user_id=u.id where lower(u.email)=normalized_email and (u.email_confirmed_at is not null or r.role='admin')) then
    raise exception 'Ten adres ma już aktywne konto. W razie potrzeby opiekun może odzyskać hasło.';
  end if;
  insert into public.client_invitations(id,email,display_name,created_by) values(p_id,normalized_email,trim(p_name),auth.uid());
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'client_invitation_prepared',p_id);
  return p_id;
exception when unique_violation then
  if exists(select 1 from public.client_invitations where email=normalized_email and archived_at is not null) then
    raise exception 'Adres znajduje się już w archiwum. Otwórz archiwum i przywróć zaproszenie.';
  end if;
  raise exception 'Zaproszenie dla tego adresu jest już na liście.';
end $$;
create or replace function public.claim_client_invitation(p_id uuid,p_expected_version integer,p_attempt uuid) returns text
language plpgsql security definer set search_path='' as $$
declare i public.client_invitations;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  select * into i from public.client_invitations where id=p_id for update;
  if not found or p_expected_version is null or i.version<>p_expected_version or p_attempt is null then raise exception 'Odśwież zaproszenie przed wysłaniem.'; end if;
  if i.archived_at is not null then raise exception 'To zaproszenie jest w archiwum. Przywróć je przed wysłaniem.'; end if;
  if i.last_attempt_at>clock_timestamp()-interval '2 minutes' then raise exception 'Poczekaj dwie minuty od poprzedniej próby.'; end if;
  if exists(select 1 from auth.users u left join public.user_roles r on r.user_id=u.id where lower(u.email)=i.email and (u.email_confirmed_at is not null or r.role='admin')) then
    raise exception 'Konto zostało już aktywowane. Nie wysyłaj nowego zaproszenia.';
  end if;
  -- A timed-out request may have reached Auth. Do not label it as a failure.
  update public.invitation_attempts set outcome='uncertain',error_code='unknown_result',finished_at=clock_timestamp() where id=i.last_attempt_id and outcome='sending';
  insert into public.invitation_attempts(id,invitation_id,author_id) values(p_attempt,i.id,auth.uid());
  update public.client_invitations set version=version+1,delivery_status='sending',last_attempt_id=p_attempt,last_attempt_at=clock_timestamp(),last_error_code=null where id=i.id;
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'client_invitation_requested',i.id);
  return i.email;
end $$;
create or replace function public.client_invitation_rows()
returns table(id uuid,email text,display_name text,version integer,delivery_status text,last_attempt_at timestamptz,last_sent_at timestamptz,last_error_code text,created_at timestamptz,account_stage text,can_send boolean)
language sql stable security definer set search_path='' as $$
  select i.id,i.email,i.display_name,i.version,
    case when i.delivery_status='sending' and i.last_attempt_at<=now()-interval '2 minutes' then 'uncertain' else i.delivery_status end,
    i.last_attempt_at,i.last_sent_at,i.last_error_code,i.created_at,
    case when r.role='admin' then 'staff_account'
      when u.email_confirmed_at is null then 'not_activated'
      when coalesce(length(u.encrypted_password),0)=0 then 'password_required'
      when i.password_set_at is null and not i.password_setup_tracked then 'password_unverified'
      when i.password_set_at is null then 'password_required'
      when coalesce(length(trim(p.full_name)),0)=0 or coalesce(length(trim(p.phone)),0)=0 or coalesce(length(trim(p.area)),0)=0 then 'profile_required'
      else 'ready' end,
    (i.archived_at is null and u.email_confirmed_at is null and r.role is distinct from 'admin' and (i.last_attempt_at is null or i.last_attempt_at<=now()-interval '2 minutes'))
    from public.client_invitations i left join auth.users u on lower(u.email)=i.email
      left join public.profiles p on p.id=u.id left join public.user_roles r on r.user_id=u.id
    where public.is_admin();
$$;
revoke all on function public.client_invitation_rows() from public,anon,authenticated;

drop function public.client_invitation_feed(integer);
drop function public.client_invitation_detail(uuid);
create function public.client_invitation_feed(p_offset integer default 0,p_archived boolean default false,p_search text default '')
returns table(id uuid,email text,display_name text,version integer,delivery_status text,last_attempt_at timestamptz,last_sent_at timestamptz,last_error_code text,created_at timestamptz,account_stage text,can_send boolean,archived_at timestamptz,can_archive boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_offset is null or p_offset not between 0 and 1000000 or p_archived is null or p_search is null or length(p_search)>254 then raise exception 'Sprawdź stronę zaproszeń.'; end if;
  return query select r.*,i.archived_at,
    (i.archived_at is null and i.delivery_status='draft' and i.last_attempt_at is null and not exists(select 1 from public.invitation_attempts a where a.invitation_id=i.id))
    from public.client_invitation_rows() r join public.client_invitations i on i.id=r.id
    where (i.archived_at is not null)=p_archived and (trim(p_search)='' or strpos(lower(i.email||' '||i.display_name),lower(trim(p_search)))>0)
    order by i.created_at desc,i.id desc limit 21 offset p_offset;
end $$;
create function public.client_invitation_detail(p_id uuid)
returns table(id uuid,email text,display_name text,version integer,delivery_status text,last_attempt_at timestamptz,last_sent_at timestamptz,last_error_code text,created_at timestamptz,account_stage text,can_send boolean,archived_at timestamptz,can_archive boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null then raise exception 'Sprawdź zaproszenie.'; end if;
  return query select r.*,i.archived_at,
    (i.archived_at is null and i.delivery_status='draft' and i.last_attempt_at is null and not exists(select 1 from public.invitation_attempts a where a.invitation_id=i.id))
    from public.client_invitation_rows() r join public.client_invitations i on i.id=r.id where i.id=p_id;
end $$;
revoke all on function public.client_invitation_feed(integer,boolean,text),public.client_invitation_detail(uuid) from public,anon,authenticated;
grant execute on function public.client_invitation_feed(integer,boolean,text),public.client_invitation_detail(uuid) to authenticated;
