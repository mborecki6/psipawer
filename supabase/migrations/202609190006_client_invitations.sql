-- Invitation delivery is explicit, never automatic. Roles remain client-only;
-- this module does not grant staff access or revoke existing sessions.
create table public.client_invitations (
  id uuid primary key,
  email text not null unique check(email=lower(trim(email)) and length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  display_name text not null check(length(trim(display_name)) between 2 and 120),
  created_by uuid not null references public.profiles,
  created_at timestamptz not null default clock_timestamp(),
  version integer not null default 1 check(version>0),
  delivery_status text not null default 'draft' check(delivery_status in ('draft','sending','sent','failed','uncertain')),
  last_attempt_id uuid,
  last_attempt_at timestamptz,
  last_sent_at timestamptz,
  last_error_code text check(last_error_code in ('rejected','rate_limited','unknown_result'))
);
create table public.invitation_attempts (
  id uuid primary key,
  invitation_id uuid not null references public.client_invitations,
  author_id uuid not null references public.profiles,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  outcome text not null default 'sending' check(outcome in ('sending','sent','failed','uncertain')),
  error_code text check(error_code in ('rejected','rate_limited','unknown_result'))
);
create index invitation_attempt_history on public.invitation_attempts(invitation_id,started_at desc,id desc);
alter table public.client_invitations enable row level security;
alter table public.invitation_attempts enable row level security;
create policy client_invitation_staff on public.client_invitations for select to authenticated using(public.is_admin());
create policy invitation_attempts_staff on public.invitation_attempts for select to authenticated using(public.is_admin());
revoke all on public.client_invitations,public.invitation_attempts from public,anon,authenticated;
grant select on public.client_invitations,public.invitation_attempts to authenticated;

-- Reuse the name already entered by the behaviourist for a newly invited
-- account. Never trust user metadata for roles, and never overwrite an existing
-- profile when sending another invitation to the same unconfirmed account.
create or replace function public.bootstrap_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,full_name) values(new.id,(select display_name from public.client_invitations where email=lower(new.email)));
  insert into public.user_roles(user_id,role) values(new.id,'client');
  return new;
end $$;
revoke all on function public.bootstrap_user() from public,anon,authenticated;

create function public.prepare_client_invitation(p_id uuid,p_email text,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare i public.client_invitations; normalized_email text:=lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or normalized_email is null or length(normalized_email) not between 3 and 254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_name is null or length(trim(p_name)) not between 2 and 120 then raise exception 'Sprawdź nazwę i adres e-mail.'; end if;
  select * into i from public.client_invitations where id=p_id;
  if found then
    if i.email=normalized_email and i.display_name=trim(p_name) and i.created_by=auth.uid() then return i.id; end if;
    raise exception 'Ten formularz został już zapisany. Odśwież widok.';
  end if;
  if exists(select 1 from auth.users u left join public.user_roles r on r.user_id=u.id where lower(u.email)=normalized_email and (u.email_confirmed_at is not null or r.role='admin')) then
    raise exception 'Ten adres ma już aktywne konto. W razie potrzeby opiekun może odzyskać hasło.';
  end if;
  insert into public.client_invitations(id,email,display_name,created_by) values(p_id,normalized_email,trim(p_name),auth.uid());
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'client_invitation_prepared',p_id);
  return p_id;
exception when unique_violation then raise exception 'Zaproszenie dla tego adresu jest już na liście.';
end $$;
create function public.claim_client_invitation(p_id uuid,p_expected_version integer,p_attempt uuid) returns text
language plpgsql security definer set search_path='' as $$
declare i public.client_invitations;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  select * into i from public.client_invitations where id=p_id for update;
  if not found or p_expected_version is null or i.version<>p_expected_version or p_attempt is null then raise exception 'Odśwież zaproszenie przed wysłaniem.'; end if;
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
-- Only the server's Auth adapter reports delivery. User sessions cannot forge
-- a successful provider result or write any of these tables directly.
create function public.finish_client_invitation(p_id uuid,p_attempt uuid,p_outcome text,p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
declare i public.client_invitations; a public.invitation_attempts;
begin
  if p_outcome is null or p_outcome not in ('sent','failed','uncertain') or
    (p_outcome='sent' and p_error is not null) or
    (p_outcome<>'sent' and (p_error is null or p_error not in ('rejected','rate_limited','unknown_result'))) then raise exception 'Nieprawidłowy wynik wysyłki.'; end if;
  select * into i from public.client_invitations where id=p_id for update;
  if not found or i.last_attempt_id is distinct from p_attempt then return false; end if;
  select * into a from public.invitation_attempts where id=p_attempt;
  if i.delivery_status<>'sending' then return a.outcome=p_outcome and a.error_code is not distinct from p_error; end if;
  update public.invitation_attempts set outcome=p_outcome,error_code=p_error,finished_at=clock_timestamp() where id=p_attempt;
  update public.client_invitations set delivery_status=p_outcome,last_error_code=p_error,version=version+1,
    last_sent_at=case when p_outcome='sent' then clock_timestamp() else last_sent_at end where id=p_id;
  insert into public.audit_events(actor_id,event,entity_id,details) values(a.author_id,'client_invitation_result',p_id,jsonb_build_object('outcome',p_outcome));
  return true;
end $$;

-- Explicit safe projection from Auth. No password hashes, tokens or metadata
-- leave this function. Auth confirmation alone does not mean onboarding ended.
create function public.client_invitation_rows()
returns table(id uuid,email text,display_name text,version integer,delivery_status text,last_attempt_at timestamptz,last_sent_at timestamptz,last_error_code text,created_at timestamptz,account_stage text,can_send boolean)
language sql stable security definer set search_path='' as $$
  select i.id,i.email,i.display_name,i.version,
    case when i.delivery_status='sending' and i.last_attempt_at<=now()-interval '2 minutes' then 'uncertain' else i.delivery_status end,
    i.last_attempt_at,i.last_sent_at,i.last_error_code,i.created_at,
    case when r.role='admin' then 'staff_account'
      when u.email_confirmed_at is null then 'not_activated'
      when coalesce(length(u.encrypted_password),0)=0 then 'password_required'
      when coalesce(length(trim(p.full_name)),0)=0 or coalesce(length(trim(p.phone)),0)=0 or coalesce(length(trim(p.area)),0)=0 then 'profile_required'
      else 'ready' end,
    (u.email_confirmed_at is null and r.role is distinct from 'admin' and (i.last_attempt_at is null or i.last_attempt_at<=now()-interval '2 minutes'))
    from public.client_invitations i left join auth.users u on lower(u.email)=i.email
      left join public.profiles p on p.id=u.id left join public.user_roles r on r.user_id=u.id
    where public.is_admin();
$$;
create function public.client_invitation_feed(p_offset integer default 0)
returns table(id uuid,email text,display_name text,version integer,delivery_status text,last_attempt_at timestamptz,last_sent_at timestamptz,last_error_code text,created_at timestamptz,account_stage text,can_send boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_offset is null or p_offset not between 0 and 1000000 then raise exception 'Sprawdź stronę zaproszeń.'; end if;
  return query select * from public.client_invitation_rows() i order by i.created_at desc,i.id desc limit 21 offset p_offset;
end $$;
revoke all on function public.prepare_client_invitation(uuid,text,text),public.claim_client_invitation(uuid,integer,uuid),
  public.finish_client_invitation(uuid,uuid,text,text),public.client_invitation_rows(),public.client_invitation_feed(integer) from public,anon,authenticated;
grant execute on function public.prepare_client_invitation(uuid,text,text),public.claim_client_invitation(uuid,integer,uuid),public.client_invitation_feed(integer) to authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.finish_client_invitation(uuid,uuid,text,text) to service_role;
  end if;
end $$;
