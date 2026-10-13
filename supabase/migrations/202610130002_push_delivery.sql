-- Push is a separate delivery channel. No trigger can roll back an inbox insert.
-- Subscriptions and encryption keys are never exposed through a table grant.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null,
  endpoint text not null unique check(length(endpoint) <= 2048),
  p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth text not null check(auth ~ '^[A-Za-z0-9_-]{22}$'),
  enabled_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  disabled_at timestamptz,
  disabled_reason text check(disabled_reason in ('user','logout','expired'))
);
create index push_active_user on public.push_subscriptions(user_id,enabled_at) where disabled_at is null;
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public,anon,authenticated;

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','sending','retry','accepted','failed','expired','cancelled')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  next_attempt_at timestamptz not null default clock_timestamp(),
  claim_token uuid,
  claimed_at timestamptz,
  accepted_at timestamptz,
  last_status integer,
  created_at timestamptz not null default clock_timestamp(),
  unique(notification_id,subscription_id)
);
create index push_delivery_due on public.push_deliveries(next_attempt_at,id) where status in ('pending','retry','sending');
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public,anon,authenticated;

create function public.push_session_id() returns uuid language plpgsql stable set search_path='' as $$
declare raw text;
begin
  raw:=nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id';
  if raw is null or raw !~ '^[0-9a-fA-F-]{36}$' then return null; end if;
  return raw::uuid;
exception when invalid_text_representation then return null;
end $$;

create function public.save_push_subscription(p_endpoint text,p_p256dh text,p_auth text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_session uuid:=public.push_session_id(); v_id uuid;
begin
  if v_user is null or v_session is null or not exists(select 1 from public.user_roles where user_id=v_user) then
    raise exception 'Zaloguj się ponownie, aby włączyć powiadomienia.';
  end if;
  if p_endpoint is null or length(p_endpoint)>2048 or
    p_endpoint !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com)/[A-Za-z0-9_~.!$&()*+,;=:@%/-]+$' or
    p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$' or
    p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'Nieprawidłowa subskrypcja urządzenia.';
  end if;
  -- Serialize claims of one endpoint, including when two accounts use one browser.
  perform pg_advisory_xact_lock(hashtextextended(p_endpoint,731));
  delete from public.push_subscriptions where endpoint=p_endpoint and (user_id<>v_user or session_id<>v_session);
  if (select count(*) from public.push_subscriptions where user_id=v_user and disabled_at is null and endpoint<>p_endpoint)>=12 then
    raise exception 'Osiągnięto limit urządzeń. Wyłącz powiadomienia na nieużywanym urządzeniu.';
  end if;
  insert into public.push_subscriptions(user_id,session_id,endpoint,p256dh,auth)
    values(v_user,v_session,p_endpoint,p_p256dh,p_auth)
  on conflict(endpoint) do update set
    p256dh=excluded.p256dh,auth=excluded.auth,updated_at=clock_timestamp(),
    enabled_at=case when public.push_subscriptions.disabled_at is not null then clock_timestamp() else public.push_subscriptions.enabled_at end,
    disabled_at=null,disabled_reason=null
  returning id into v_id;
  return v_id;
end $$;

create function public.push_subscription_status(p_endpoint text) returns text
language sql stable security definer set search_path='' as $$
  select coalesce((select case when disabled_at is null then 'enabled' when disabled_reason='expired' then 'expired' else 'disabled' end
    from public.push_subscriptions where user_id=auth.uid() and session_id=public.push_session_id() and endpoint=p_endpoint),'disabled');
$$;

create function public.disable_push_subscription(p_endpoint text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.push_subscriptions set disabled_at=coalesce(disabled_at,clock_timestamp()),disabled_reason='user',updated_at=clock_timestamp()
    where user_id=auth.uid() and session_id=public.push_session_id() and endpoint=p_endpoint;
  update public.push_deliveries d set status='cancelled',claim_token=null
    from public.push_subscriptions s where d.subscription_id=s.id and s.user_id=auth.uid() and s.session_id=public.push_session_id()
      and s.endpoint=p_endpoint and d.status in ('pending','retry','sending');
  return true;
end $$;

create function public.disable_session_push_subscriptions() returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.push_subscriptions set disabled_at=coalesce(disabled_at,clock_timestamp()),disabled_reason='logout',updated_at=clock_timestamp()
    where user_id=auth.uid() and session_id=public.push_session_id();
  update public.push_deliveries d set status='cancelled',claim_token=null
    from public.push_subscriptions s where d.subscription_id=s.id and s.user_id=auth.uid() and s.session_id=public.push_session_id()
      and d.status in ('pending','retry','sending');
end $$;

-- Called by the trusted worker only. All historic inbox rows pre-dating opt-in
-- stay in the inbox. A 24-hour maximum age bounds late delivery and queue scans.
create function public.worker_claim_push_deliveries(p_limit integer default 5)
returns table(id uuid,claim_token uuid,notification_id uuid,recipient_role public.app_role,endpoint text,p256dh text,auth text)
language plpgsql security definer set search_path='' as $$
declare t timestamptz:=clock_timestamp();
begin
  if p_limit<1 or p_limit>20 or p_limit is null then raise exception 'Invalid push batch'; end if;
  -- Auth removes sessions when signing out (including global sign-out).
  -- A failed best-effort UI cleanup must never keep a logged-out device active.
  update public.push_subscriptions s set disabled_at=t,disabled_reason='logout',updated_at=t
    where s.disabled_at is null and not exists(select 1 from auth.sessions a
      where a.id=s.session_id and a.user_id=s.user_id and (a.not_after is null or a.not_after>t));
  update public.push_deliveries d set status='cancelled',claim_token=null
    from public.push_subscriptions s,public.notifications n
    where s.id=d.subscription_id and n.id=d.notification_id and d.status in ('pending','retry','sending') and
      (s.disabled_at is not null or n.created_at<t-interval '24 hours' or n.read_at is not null or s.user_id<>n.recipient_id or
       not exists(select 1 from public.user_roles r where r.user_id=n.recipient_id and r.role=n.recipient_role) or
       (n.recipient_role='client' and not exists(select 1 from public.dogs dog where dog.id=n.dog_id and dog.guardian_id=n.recipient_id)));
  update public.push_deliveries set status='failed',claim_token=null where status='sending' and claimed_at<t-interval '2 minutes' and attempts>=5;
  insert into public.push_deliveries(notification_id,subscription_id,next_attempt_at)
    select n.id,s.id,t from public.notifications n join public.push_subscriptions s on s.user_id=n.recipient_id
      join public.user_roles r on r.user_id=n.recipient_id and r.role=n.recipient_role
    where s.disabled_at is null and n.created_at>=s.enabled_at and n.created_at>=t-interval '24 hours' and n.read_at is null
      and (n.recipient_role='admin' or exists(select 1 from public.dogs dog where dog.id=n.dog_id and dog.guardian_id=n.recipient_id))
      and not exists(select 1 from public.push_deliveries d where d.notification_id=n.id and d.subscription_id=s.id)
    order by n.created_at,n.id,s.id limit 500
    on conflict on constraint push_deliveries_notification_id_subscription_id_key do nothing;
  return query
    with candidates as (
      select d.id from public.push_deliveries d
      where d.attempts<5 and ((d.status in ('pending','retry') and d.next_attempt_at<=t) or (d.status='sending' and d.claimed_at<t-interval '2 minutes'))
      order by d.next_attempt_at,d.id for update skip locked limit p_limit
    ), claimed as (
      update public.push_deliveries d set status='sending',attempts=d.attempts+1,claimed_at=t,claim_token=gen_random_uuid()
      from candidates c where d.id=c.id returning d.*
    ) select d.id,d.claim_token,n.id,n.recipient_role,s.endpoint,s.p256dh,s.auth
      from claimed d join public.push_subscriptions s on s.id=d.subscription_id join public.notifications n on n.id=d.notification_id;
end $$;

create function public.worker_finish_push_delivery(p_id uuid,p_claim uuid,p_outcome text,p_status integer default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare d public.push_deliveries; t timestamptz:=clock_timestamp();
begin
  if p_outcome is null or p_outcome not in ('accepted','retry','failed','expired') or (p_status is not null and p_status not between 100 and 599) then
    raise exception 'Invalid push result';
  end if;
  select * into d from public.push_deliveries where id=p_id and claim_token=p_claim and status='sending' for update;
  if not found then return false; end if;
  update public.push_deliveries set
    status=case when p_outcome='retry' and d.attempts>=5 then 'failed' else p_outcome end,
    last_status=p_status,claim_token=null,
    accepted_at=case when p_outcome='accepted' then t else null end,
    next_attempt_at=t+make_interval(secs=>least(3600,30*power(2,d.attempts-1)::integer))
    where id=d.id;
  if p_outcome='expired' then
    update public.push_subscriptions set disabled_at=t,disabled_reason='expired',updated_at=t where id=d.subscription_id;
    update public.push_deliveries set status='cancelled',claim_token=null where subscription_id=d.subscription_id and status in ('pending','retry','sending');
  end if;
  return true;
end $$;

revoke all on function public.push_session_id(),public.save_push_subscription(text,text,text),public.push_subscription_status(text),
  public.disable_push_subscription(text),public.disable_session_push_subscriptions(),
  public.worker_claim_push_deliveries(integer),public.worker_finish_push_delivery(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.save_push_subscription(text,text,text),public.push_subscription_status(text),
  public.disable_push_subscription(text),public.disable_session_push_subscriptions() to authenticated;
grant execute on function public.worker_claim_push_deliveries(integer),public.worker_finish_push_delivery(uuid,uuid,text,integer) to service_role;
