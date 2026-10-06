-- Auth assigns a random temporary password while accepting an invite. A
-- nonempty encrypted_password therefore does not prove personal password setup.
alter table public.client_invitations add column password_set_at timestamptz;
alter table public.client_invitations add column password_setup_tracked boolean not null default true;
-- Never guess whether an already-confirmed account's existing hash is personal.
update public.client_invitations i set password_setup_tracked=false
  where exists(select 1 from auth.users u where lower(u.email)=i.email and u.email_confirmed_at is not null);

create function public.record_invited_password_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Supabase Auth 2.196 creates the temporary hash BEFORE confirming the user.
  -- Subsequent password changes (including recovery) are recorded atomically
  -- with Auth's update, even if its HTTP response is later lost.
  if old.email_confirmed_at is not null and new.email_confirmed_at is not null
    and new.encrypted_password is distinct from old.encrypted_password
    and coalesce(length(new.encrypted_password),0)>0 then
    update public.client_invitations set password_set_at=clock_timestamp(),password_setup_tracked=true
      where email=lower(new.email);
  end if;
  return new;
end $$;
revoke all on function public.record_invited_password_change() from public,anon,authenticated;
create trigger psi_record_invited_password_change after update of encrypted_password on auth.users
  for each row execute function public.record_invited_password_change();

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
    (u.email_confirmed_at is null and r.role is distinct from 'admin' and (i.last_attempt_at is null or i.last_attempt_at<=now()-interval '2 minutes'))
    from public.client_invitations i left join auth.users u on lower(u.email)=i.email
      left join public.profiles p on p.id=u.id left join public.user_roles r on r.user_id=u.id
    where public.is_admin();
$$;
revoke all on function public.client_invitation_rows() from public,anon,authenticated;
