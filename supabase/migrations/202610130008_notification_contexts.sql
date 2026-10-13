-- Shared notification context for control invitations and private community chat.
alter table public.notifications
  add column invitation_id uuid references public.care_control_invitations on delete cascade,
  add column chat_id uuid references public.community_chats on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
  'plan_published','progress_submitted','progress_reviewed',
  'consultation_requested','consultation_scheduled','consultation_rescheduled','consultation_cancelled','consultation_completed','consultation_price_agreed',
  'walk_changed','walk_cancelled','registration_created','registration_changed','registration_cancelled','walk_invitation',
  'payment_recorded','payment_refunded','follow_up_changed','consultation_reminder','walk_reminder','follow_up_reminder',
  'course_enrollment_requested','course_enrollment_accepted','course_enrollment_waitlisted','course_enrollment_rejected','course_enrollment_cancelled','course_enrollment_reopened',
  'course_cancelled','course_completed','course_session_rescheduled','course_session_cancelled','course_session_completed',
  'course_attendance_recorded','course_settled','course_payment_recorded','course_payment_refunded','course_reminder','course_updated',
  'fitness_requested','fitness_accepted','fitness_rejected','fitness_cancelled','fitness_completed','fitness_reopened',
  'fitness_session_scheduled','fitness_session_rescheduled','fitness_session_cancelled','fitness_session_completed','fitness_session_reopened',
  'fitness_attendance_corrected','fitness_settled','fitness_payment_recorded','fitness_payment_refunded','fitness_reminder','control_invitation_due','community_chat_message'
));

create function public.notification_new_context() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.invitation_id:=case when new.kind='control_invitation_due' then new.entity_id else null end;
  new.chat_id:=case when new.kind='community_chat_message' then new.entity_id else null end;
  return new;
end $$;
create trigger notification_new_context before insert on public.notifications for each row execute function public.notification_new_context();
alter table public.notifications add constraint notification_invitation_context check(
 (kind='control_invitation_due' and invitation_id is not null and invitation_id=entity_id) or (kind<>'control_invitation_due' and invitation_id is null));
alter table public.notifications add constraint notification_chat_context check(
 (kind='community_chat_message' and chat_id is not null and chat_id=entity_id) or (kind<>'community_chat_message' and chat_id is null));
create index notification_chat on public.notifications(chat_id,recipient_id) where chat_id is not null;

-- Shared current authorization for RLS, read acknowledgement and push. Private;
-- authenticated users only get the wrapper bound to their verified identity.
create function public.notification_delivery_current(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.notifications n join public.user_roles r on r.user_id=n.recipient_id and r.role=n.recipient_role
   where n.id=p_id and case
     when n.kind='community_chat_message' then public.can_access_community_chat(n.chat_id,n.recipient_id)
     when n.kind='control_invitation_due' then public.can_deliver_control_invitation(n.invitation_id,n.source_key,n.recipient_id)
     when n.recipient_role='admin' then true
     when n.course_enrollment_id is not null then exists(select 1 from public.course_enrollments e where e.id=n.course_enrollment_id and e.course_id=n.entity_id and e.guardian_id=n.recipient_id)
     when n.fitness_package_id is not null then exists(select 1 from public.fitness_packages p where p.id=n.fitness_package_id and p.id=n.entity_id and p.guardian_id=n.recipient_id)
     else exists(select 1 from public.dogs d where d.id=n.dog_id and d.guardian_id=n.recipient_id)
   end);
$$;
create function public.can_read_notification(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.notifications n where n.id=p_id and n.recipient_id=auth.uid()) and public.notification_delivery_current(p_id);
$$;
drop policy notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using(public.can_read_notification(id));
drop function public.notification_feed(text,uuid);
create function public.notification_feed(p_filter text default 'unread',p_before uuid default null)
returns table(id uuid,kind text,dog_id uuid,dog_name text,entity_id uuid,created_at timestamptz,read_at timestamptz,
 course_enrollment_id uuid,course_session_id uuid,fitness_package_id uuid,fitness_session_id uuid,invitation_id uuid,chat_id uuid)
language plpgsql stable security invoker set search_path='' as $$
declare boundary timestamptz;
begin
 if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
 if p_filter is null or p_filter not in ('unread','all') then raise exception 'Nieprawidłowy filtr.'; end if;
 if p_before is not null then
   select n.created_at into boundary from public.notifications n where n.id=p_before;
   if not found then raise exception 'Wróć do początku listy powiadomień.'; end if;
 end if;
 return query select n.id,n.kind,n.dog_id,coalesce(d.name,'Pies zgłoszenia'),n.entity_id,n.created_at,n.read_at,
   n.course_enrollment_id,n.course_session_id,n.fitness_package_id,n.fitness_session_id,n.invitation_id,n.chat_id
   from public.notifications n left join public.dogs d on d.id=n.dog_id
   where (p_filter='all' or n.read_at is null) and (p_before is null or (n.created_at,n.id)<(boundary,p_before))
   order by n.created_at desc,n.id desc limit 21;
end $$;
create or replace function public.read_notifications(p_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare visible_count integer; updated_count integer;
begin
 if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
 if p_ids is null or cardinality(p_ids) not between 1 and 20 or array_position(p_ids,null) is not null or
    (select count(distinct x) from unnest(p_ids) x)<>cardinality(p_ids) then raise exception 'Wybierz od 1 do 20 różnych powiadomień.'; end if;
 perform n.id from public.notifications n where n.id=any(p_ids) and public.can_read_notification(n.id) order by n.id for update;
 get diagnostics visible_count=row_count;
 if visible_count<>cardinality(p_ids) then raise exception 'Nie znaleziono Twoich powiadomień.'; end if;
 update public.notifications set read_at=clock_timestamp() where id=any(p_ids) and read_at is null;
 get diagnostics updated_count=row_count;
 return updated_count;
end $$;
revoke all on function public.notification_new_context(),public.notification_delivery_current(uuid),public.can_read_notification(uuid),public.notification_feed(text,uuid) from public,anon,authenticated;
grant execute on function public.can_read_notification(uuid),public.notification_feed(text,uuid) to authenticated;

create or replace function public.worker_claim_push_deliveries(p_limit integer default 5)
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
       not public.notification_delivery_current(n.id));
  update public.push_deliveries set status='failed',claim_token=null where status='sending' and claimed_at<t-interval '2 minutes' and attempts>=5;
  insert into public.push_deliveries(notification_id,subscription_id,next_attempt_at)
    select n.id,s.id,t from public.notifications n join public.push_subscriptions s on s.user_id=n.recipient_id
      join public.user_roles r on r.user_id=n.recipient_id and r.role=n.recipient_role
    where s.disabled_at is null and n.created_at>=s.enabled_at and n.created_at>=t-interval '24 hours' and n.read_at is null
      and public.notification_delivery_current(n.id)
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

