-- Opt-in conversations; no historic interests or matches are imported.
create table public.community_chats (
  id uuid primary key default gen_random_uuid(),
  dog_a uuid not null references public.dogs on delete cascade,
  dog_b uuid not null references public.dogs on delete cascade,
  guardian_a uuid not null references public.profiles on delete cascade,
  guardian_b uuid not null references public.profiles on delete cascade,
  consent_a_at timestamptz, consent_b_at timestamptz,
  closed_at timestamptz,
  closed_reason text check(closed_reason in ('withdrawn','blocked','access_lost')),
  blocked_by uuid references public.profiles on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(dog_a<dog_b and guardian_a<>guardian_b),
  check(blocked_by is null or blocked_by in (guardian_a,guardian_b))
);
create unique index community_chat_open_pair on public.community_chats(dog_a,dog_b,guardian_a,guardian_b) where closed_at is null;
create index community_chat_guardian_a on public.community_chats(guardian_a,updated_at desc);
create index community_chat_guardian_b on public.community_chats(guardian_b,updated_at desc);
create table public.community_chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.community_chats on delete cascade,
  sender_id uuid not null references public.profiles on delete cascade,
  request_id uuid not null,
  body text not null check(length(trim(body)) between 1 and 2000 and octet_length(body)<=8000),
  created_at timestamptz not null default clock_timestamp(),
  unique(chat_id,sender_id,request_id)
);
create index community_chat_message_page on public.community_chat_messages(chat_id,created_at desc,id desc);
create index community_chat_message_rate on public.community_chat_messages(sender_id,created_at desc);
alter table public.community_chats enable row level security;
alter table public.community_chat_messages enable row level security;
revoke all on public.community_chats,public.community_chat_messages from public,anon,authenticated;

create function public.community_chat_pair_available(p_a uuid,p_b uuid,p_owner_a uuid,p_owner_b uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_owner_a<>p_owner_b
   and exists(select 1 from public.dogs where id=p_a and guardian_id=p_owner_a)
   and exists(select 1 from public.dogs where id=p_b and guardian_id=p_owner_b)
   and (select count(*) from public.psiutki_profiles p join public.psiutki_profile_reviews r on r.dog_id=p.dog_id
     where p.dog_id in (p_a,p_b) and p.published and p.moderation_status='approved' and r.consented_at is not null
       and r.consented_by=case when p.dog_id=p_a then p_owner_a else p_owner_b end)=2
   and (select count(*) from public.psiutki_interests i where
     ((i.from_dog_id=p_a and i.to_dog_id=p_b) or (i.from_dog_id=p_b and i.to_dog_id=p_a))
     and i.status in ('matched','reviewed') and i.confirmed_at is not null and not i.rejection_active)=2;
$$;
create function public.can_access_community_chat(p_chat uuid,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.community_chats c where c.id=p_chat and p_user in (c.guardian_a,c.guardian_b)
   and c.closed_at is null and c.blocked_by is null and c.consent_a_at is not null and c.consent_b_at is not null
   and public.community_chat_pair_available(c.dog_a,c.dog_b,c.guardian_a,c.guardian_b));
$$;
create function public.my_community_chat_access(p_chat uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.can_access_community_chat(p_chat,auth.uid());
$$;
create policy community_chat_read on public.community_chats for select to authenticated using(public.my_community_chat_access(id));
create policy community_message_read on public.community_chat_messages for select to authenticated using(public.my_community_chat_access(chat_id));
grant select on public.community_chats,public.community_chat_messages to authenticated;

-- Metadata for original participants only; closed conversations expose no body,
-- new guardian's profile or contact details. Admin has no special privilege.
create function public.community_chat_state(p_chat uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.community_chats; available boolean; own_a boolean; state text;
begin
 select * into c from public.community_chats where id=p_chat and auth.uid() in (guardian_a,guardian_b);
 if not found then return jsonb_build_object('id',p_chat,'state','unavailable'); end if;
 own_a:=auth.uid()=c.guardian_a;
 available:=public.community_chat_pair_available(c.dog_a,c.dog_b,c.guardian_a,c.guardian_b);
 state:=case when c.blocked_by is not null then 'blocked'
   when c.closed_at is not null then coalesce(c.closed_reason,'access_lost')
   when not available then 'access_lost'
   when (own_a and c.consent_a_at is null) or (not own_a and c.consent_b_at is null) then 'waiting_me'
   when c.consent_a_at is null or c.consent_b_at is null then 'waiting_other' else 'active' end;
 return jsonb_build_object('id',c.id,'state',state,'ownDog',case when own_a then c.dog_a else c.dog_b end,
   'otherDog',case when own_a then c.dog_b else c.dog_a end,'canUnblock',c.blocked_by=auth.uid(),
   'canStart',available and c.blocked_by is null and c.closed_at is not null);
end $$;
create function public.community_chat_links() returns setof jsonb
language sql stable security definer set search_path='' as $$
 select public.community_chat_state(c.id) from public.community_chats c where auth.uid() in(c.guardian_a,c.guardian_b)
 order by c.updated_at desc,c.id desc limit 100;
$$;

create function public.join_community_chat(p_from_dog uuid,p_to_dog uuid,p_consent boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare a uuid:=least(p_from_dog,p_to_dog); b uuid:=greatest(p_from_dog,p_to_dog);
  owner_a uuid; owner_b uuid; c public.community_chats;
begin
 if auth.uid() is null or p_consent is not true or p_from_dog is null or p_to_dog is null or p_from_dog=p_to_dog then
   raise exception 'Potwierdź dobrowolny udział w rozmowie.';
 end if;
 perform id from public.dogs where id in(a,b) order by id for update;
 select guardian_id into owner_a from public.dogs where id=a;
 select guardian_id into owner_b from public.dogs where id=b;
 if not exists(select 1 from public.dogs where id=p_from_dog and guardian_id=auth.uid())
   or not coalesce(public.community_chat_pair_available(a,b,owner_a,owner_b),false) then
   raise exception 'Rozmowa wymaga aktualnych wizytówek i wzajemnego zainteresowania.';
 end if;
 if exists(select 1 from public.community_chats where dog_a=a and dog_b=b and guardian_a=owner_a and guardian_b=owner_b and blocked_by is not null) then
   raise exception 'Rozmowa dla tej pary jest zablokowana.';
 end if;
 select * into c from public.community_chats where dog_a=a and dog_b=b and guardian_a=owner_a and guardian_b=owner_b and closed_at is null for update;
 if not found then
   insert into public.community_chats(dog_a,dog_b,guardian_a,guardian_b) values(a,b,owner_a,owner_b) returning * into c;
 end if;
 update public.community_chats set
   consent_a_at=case when auth.uid()=guardian_a then coalesce(consent_a_at,clock_timestamp()) else consent_a_at end,
   consent_b_at=case when auth.uid()=guardian_b then coalesce(consent_b_at,clock_timestamp()) else consent_b_at end,
   updated_at=clock_timestamp() where id=c.id;
 return c.id;
end $$;

create function public.change_community_chat(p_chat uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.community_chats;
begin
 select * into c from public.community_chats where id=p_chat and auth.uid() in(guardian_a,guardian_b);
 if not found then raise exception 'Rozmowa jest niedostępna.'; end if;
 perform id from public.dogs where id in(c.dog_a,c.dog_b) order by id for update;
 select * into c from public.community_chats where id=p_chat for update;
 if p_action='unblock' then
   if c.blocked_by is distinct from auth.uid() then raise exception 'Możesz cofnąć tylko własną blokadę.'; end if;
   update public.community_chats set blocked_by=null,updated_at=clock_timestamp() where id=c.id;
 elsif p_action in ('withdraw','block') then
   if c.closed_at is not null and p_action='withdraw' then return; end if;
   if c.blocked_by is not null and c.blocked_by<>auth.uid() then raise exception 'Rozmowa jest zablokowana.'; end if;
   update public.community_chats set closed_at=coalesce(closed_at,clock_timestamp()),
     closed_reason=case when p_action='block' then 'blocked' else 'withdrawn' end,
     consent_a_at=null,consent_b_at=null,blocked_by=case when p_action='block' then auth.uid() else blocked_by end,
     updated_at=clock_timestamp() where id=c.id;
 else raise exception 'Wybierz zmianę rozmowy.'; end if;
end $$;

create function public.close_invalid_community_chats() returns trigger
language plpgsql security definer set search_path='' as $$
declare affected uuid[];
begin
 if tg_table_name='dogs' then affected:=array[coalesce(new.id,old.id)];
 elsif tg_table_name='psiutki_interests' then affected:=array[coalesce(new.from_dog_id,old.from_dog_id),coalesce(new.to_dog_id,old.to_dog_id)];
 else affected:=array[coalesce(new.dog_id,old.dog_id)]; end if;
 update public.community_chats c set closed_at=clock_timestamp(),closed_reason='access_lost',consent_a_at=null,consent_b_at=null,updated_at=clock_timestamp()
 where c.closed_at is null and (c.dog_a=any(affected) or c.dog_b=any(affected))
   and not public.community_chat_pair_available(c.dog_a,c.dog_b,c.guardian_a,c.guardian_b);
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger community_chat_owner_changed after update of guardian_id on public.dogs for each row execute function public.close_invalid_community_chats();
create trigger community_chat_profile_changed after update or delete on public.psiutki_profiles for each row execute function public.close_invalid_community_chats();
create trigger community_chat_consent_changed after update or delete on public.psiutki_profile_reviews for each row execute function public.close_invalid_community_chats();
create trigger community_chat_interest_changed after update or delete on public.psiutki_interests for each row execute function public.close_invalid_community_chats();

create function public.send_community_chat_message(p_chat uuid,p_request uuid,p_body text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.community_chats; m public.community_chat_messages; recipient uuid; recipient_dog uuid;
begin
 if p_request is null or p_body is null or length(trim(p_body)) not between 1 and 2000 or octet_length(p_body)>8000 then
   raise exception 'Wiadomość powinna mieć od 1 do 2000 znaków.';
 end if;
 select * into c from public.community_chats where id=p_chat and auth.uid() in(guardian_a,guardian_b);
 if not found then raise exception 'Rozmowa jest niedostępna.'; end if;
 perform id from public.dogs where id in(c.dog_a,c.dog_b) order by id for update;
 select * into c from public.community_chats where id=p_chat for update;
 if not public.can_access_community_chat(c.id,auth.uid()) then raise exception 'Zgoda lub dostęp do rozmowy wygasły.'; end if;
 select * into m from public.community_chat_messages where chat_id=p_chat and sender_id=auth.uid() and request_id=p_request;
 if found then
   if m.body<>trim(p_body) then raise exception 'Ponowienie wiadomości ma inną treść.'; end if;
   return m.id;
 end if;
 -- All chats by one sender share a short bounded rate limit.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,736));
 if (select count(*) from public.community_chat_messages where sender_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=20 then
   raise exception 'Zaczekaj chwilę przed wysłaniem kolejnej wiadomości.';
 end if;
 insert into public.community_chat_messages(chat_id,sender_id,request_id,body) values(c.id,auth.uid(),p_request,trim(p_body)) returning * into m;
 update public.community_chats set updated_at=m.created_at where id=c.id;
 recipient:=case when auth.uid()=c.guardian_a then c.guardian_b else c.guardian_a end;
 recipient_dog:=case when auth.uid()=c.guardian_a then c.dog_b else c.dog_a end;
 -- Coalesce while a chat notice remains unread. No typing/presence events.
 if not exists(select 1 from public.notifications n where n.kind='community_chat_message' and n.entity_id=c.id and n.recipient_id=recipient and n.read_at is null) then
   perform public.add_in_app_notification(recipient,auth.uid(),recipient_dog,c.id,'community_chat_message','community-chat:'||m.id);
 end if;
 return m.id;
end $$;

create function public.community_chat_messages_page(p_chat uuid,p_before uuid default null)
returns table(id uuid,body text,own boolean,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare boundary timestamptz;
begin
 if not public.can_access_community_chat(p_chat,auth.uid()) then raise exception 'Rozmowa jest niedostępna.'; end if;
 if p_before is not null then
   select m.created_at into boundary from public.community_chat_messages m where m.id=p_before and m.chat_id=p_chat;
   if not found then raise exception 'Wróć do najnowszych wiadomości.'; end if;
 end if;
 return query select m.id,m.body,m.sender_id=auth.uid(),m.created_at from public.community_chat_messages m where m.chat_id=p_chat
   and (p_before is null or (m.created_at,m.id)<(boundary,p_before)) order by m.created_at desc,m.id desc limit 31;
 if p_before is null then
   update public.notifications set read_at=clock_timestamp() where recipient_id=auth.uid() and kind='community_chat_message' and entity_id=p_chat and read_at is null;
 end if;
end $$;
revoke all on function public.community_chat_pair_available(uuid,uuid,uuid,uuid),public.can_access_community_chat(uuid,uuid),
 public.my_community_chat_access(uuid),public.community_chat_state(uuid),public.community_chat_links(),
 public.join_community_chat(uuid,uuid,boolean),public.change_community_chat(uuid,text),public.close_invalid_community_chats(),
 public.send_community_chat_message(uuid,uuid,text),public.community_chat_messages_page(uuid,uuid) from public,anon,authenticated;
grant execute on function public.my_community_chat_access(uuid),public.community_chat_state(uuid),public.community_chat_links(),
 public.join_community_chat(uuid,uuid,boolean),public.change_community_chat(uuid,text),
 public.send_community_chat_message(uuid,uuid,text),public.community_chat_messages_page(uuid,uuid) to authenticated;
