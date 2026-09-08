-- Public content stays separate from consent and private moderator feedback.
alter table public.psiutki_profiles add column created_at timestamptz not null default now();
alter table public.psiutki_profiles add column updated_at timestamptz not null default now();
create trigger psiutki_profile_updated before update on public.psiutki_profiles
  for each row execute function public.touch_updated_at();
create table public.psiutki_profile_reviews(
  dog_id uuid primary key references public.psiutki_profiles(dog_id) on delete cascade,
  consented_at timestamptz,consented_by uuid references public.profiles,
  moderation_note text not null default '',reviewed_at timestamptz,reviewed_by uuid references public.profiles
);
alter table public.psiutki_profile_reviews enable row level security;
create policy community_reviews_read on public.psiutki_profile_reviews for select to authenticated
  using(public.is_admin() or public.owns_dog(dog_id));
revoke all on public.psiutki_profile_reviews from anon,authenticated;
grant select on public.psiutki_profile_reviews to authenticated;
drop policy psiutki_read on public.psiutki_profiles;
create policy psiutki_read on public.psiutki_profiles for select to authenticated
  using(public.is_admin() or public.owns_dog(dog_id) or (published and moderation_status='approved'));

alter table public.psiutki_interests drop constraint psiutki_interests_status_check;
alter table public.psiutki_interests add constraint psiutki_interests_status_check
  check(status in ('open','matched','reviewed','rejected','withdrawn'));
alter table public.psiutki_interests add column updated_at timestamptz not null default now();
alter table public.psiutki_interests add column confirmed_at timestamptz;
alter table public.psiutki_interests add column review_note text not null default '';
alter table public.psiutki_interests add column reviewed_at timestamptz;
alter table public.psiutki_interests add column reviewed_by uuid references public.profiles;
-- Kept across withdrawal so a client cannot evade rejection by toggling interest.
alter table public.psiutki_interests add column rejection_active boolean not null default false;
create trigger psiutki_interest_updated before update on public.psiutki_interests
  for each row execute function public.touch_updated_at();

-- Older rows have no documented publication consent. Require an owner submission.
insert into public.psiutki_profile_reviews(dog_id) select dog_id from public.psiutki_profiles;
update public.psiutki_profiles set published=false,moderation_status='pending',avatar_path=null;
update public.psiutki_interests set status='open';

create function public.invalidate_community_interests(p_dog uuid,p_new_content boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  -- Global row order also makes two simultaneous profile edits compatible.
  perform id from public.psiutki_interests where from_dog_id=p_dog or to_dog_id=p_dog order by id for update;
  update public.psiutki_interests set
    status=case when status='withdrawn' then status else 'open' end,
    confirmed_at=null,review_note='',reviewed_at=null,reviewed_by=null,
    rejection_active=case when p_new_content then false else rejection_active end
    where from_dog_id=p_dog or to_dog_id=p_dog;
end $$;

create function public.save_community_profile(
  p_dog uuid,p_expected_updated_at timestamptz,payload jsonb,p_consent boolean
) returns void language plpgsql security definer set search_path='' as $$
declare dog public.dogs; profile public.psiutki_profiles; photo text; public_traits text[];
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  select * into dog from public.dogs where id=p_dog for update;
  if dog.id is null or dog.guardian_id<>auth.uid() then raise exception 'Możesz zgłosić wyłącznie własnego psa.'; end if;
  if p_consent is not true then raise exception 'Potwierdź zgodę na publikację wybranych danych psa.'; end if;
  select * into profile from public.psiutki_profiles where dog_id=p_dog for update;
  if (profile.dog_id is null and p_expected_updated_at is not null) or
     (profile.dog_id is not null and (p_expected_updated_at is null or profile.updated_at<>p_expected_updated_at)) then
    raise exception 'Profil Psiutka zmienił się w międzyczasie. Odśwież formularz.';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' or
     not(payload ?& array['display_name','area','headline','seeking','traits','likes','dislikes']) or
     exists(select 1 from jsonb_object_keys(payload) k where k not in ('display_name','area','headline','seeking','traits','likes','dislikes','avatar_path')) then
    raise exception 'Podaj wyłącznie publiczne pola profilu Psiutka.';
  end if;
  if exists(select 1 from jsonb_each(payload) e where e.key not in ('traits','avatar_path') and jsonb_typeof(e.value)<>'string') or
     jsonb_typeof(payload->'traits') is distinct from 'array' then
    raise exception 'Sprawdź publiczny opis i cechy psa.';
  end if;
  if length(trim(payload->>'display_name')) not between 1 and 80 or
     length(trim(payload->>'area'))>120 or length(trim(payload->>'headline')) not between 3 and 280 or
     length(trim(payload->>'seeking')) not between 3 and 500 or
     length(trim(payload->>'likes'))>500 or length(trim(payload->>'dislikes'))>500 or
     jsonb_array_length(payload->'traits')>8 or
     exists(select 1 from jsonb_array_elements(payload->'traits') v where jsonb_typeof(v)<>'string' or length(trim(v#>>'{}')) not between 1 and 40) then
    raise exception 'Sprawdź długość opisu i cech psa.';
  end if;
  select array(select trim(v) from jsonb_array_elements_text(payload->'traits') v) into public_traits;
  photo=case when payload ? 'avatar_path' then payload->>'avatar_path' else profile.avatar_path end;
  if payload ? 'avatar_path' and jsonb_typeof(payload->'avatar_path') not in ('string','null') then
    raise exception 'Wybierz poprawne zdjęcie Psiutka.';
  end if;
  if photo is not null and (length(photo)>500 or
     split_part(photo,'/',1)<>auth.uid()::text or split_part(photo,'/',2)<>p_dog::text or
     array_length(string_to_array(photo,'/'),1)<>3 or
     split_part(photo,'/',3)!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$' or
     not exists(select 1 from storage.objects where bucket_id='community-avatars' and name=photo)) then
    raise exception 'Wybierz zdjęcie przesłane do profilu tego Psiutka.';
  end if;
  insert into public.psiutki_profiles(dog_id,display_name,area,headline,seeking,traits,likes,dislikes,avatar_path,moderation_status,published)
    values(p_dog,trim(payload->>'display_name'),trim(payload->>'area'),trim(payload->>'headline'),trim(payload->>'seeking'),public_traits,
      trim(payload->>'likes'),trim(payload->>'dislikes'),photo,'pending',false)
    on conflict(dog_id) do update set display_name=excluded.display_name,area=excluded.area,headline=excluded.headline,
      seeking=excluded.seeking,traits=excluded.traits,likes=excluded.likes,dislikes=excluded.dislikes,avatar_path=excluded.avatar_path,
      moderation_status='pending',published=false;
  insert into public.psiutki_profile_reviews(dog_id,consented_at,consented_by)
    values(p_dog,now(),auth.uid()) on conflict(dog_id) do update set
      consented_at=excluded.consented_at,consented_by=excluded.consented_by,
      moderation_note='',reviewed_at=null,reviewed_by=null;
  perform public.invalidate_community_interests(p_dog,true);
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'community_profile_submitted',p_dog,jsonb_build_object(
      'publication_consent',true,'previous_status',profile.moderation_status,'previously_published',profile.published));
end $$;

create function public.hide_community_profile(p_dog uuid)
returns void language plpgsql security definer set search_path='' as $$
declare dog public.dogs; profile public.psiutki_profiles; consent_at timestamptz;
begin
  select * into dog from public.dogs where id=p_dog for update;
  if auth.uid() is null or dog.id is null or (dog.guardian_id<>auth.uid() and not public.is_admin()) then
    raise exception 'Brak dostępu do profilu Psiutka.';
  end if;
  select * into profile from public.psiutki_profiles where dog_id=p_dog for update;
  if profile.dog_id is null then raise exception 'Nie znaleziono profilu Psiutka.'; end if;
  select consented_at into consent_at from public.psiutki_profile_reviews where dog_id=p_dog;
  if not profile.published and (dog.guardian_id<>auth.uid() or consent_at is null) then return; end if;
  update public.psiutki_profiles set published=false where dog_id=p_dog;
  if dog.guardian_id=auth.uid() then
    update public.psiutki_profile_reviews set consented_at=null,consented_by=null where dog_id=p_dog;
  end if;
  perform public.invalidate_community_interests(p_dog,false);
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'community_profile_hidden',p_dog,jsonb_build_object(
      'consent_withdrawn',dog.guardian_id=auth.uid(),'previous_consented_at',consent_at));
end $$;

create function public.moderate_community_profile(
  p_dog uuid,p_expected_updated_at timestamptz,p_decision text,p_note text
) returns void language plpgsql security definer set search_path='' as $$
declare profile public.psiutki_profiles; review public.psiutki_profile_reviews;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') or p_note is null or length(trim(p_note)) not between 3 and 2000 then
    raise exception 'Wybierz decyzję i podaj wiadomość dla opiekuna (3–2000 znaków).';
  end if;
  perform 1 from public.dogs where id=p_dog for update;
  select * into profile from public.psiutki_profiles where dog_id=p_dog for update;
  if profile.dog_id is null then raise exception 'Nie znaleziono profilu Psiutka.'; end if;
  if p_expected_updated_at is null or profile.updated_at<>p_expected_updated_at then
    raise exception 'Profil Psiutka zmienił się w międzyczasie. Odśwież formularz.';
  end if;
  select * into review from public.psiutki_profile_reviews where dog_id=p_dog for update;
  if p_decision='approved' and (review.consented_at is null or review.consented_by is null) then
    raise exception 'Opiekun musi ponownie wyrazić zgodę na publikację.';
  end if;
  update public.psiutki_profiles set moderation_status=p_decision,published=(p_decision='approved') where dog_id=p_dog;
  update public.psiutki_profile_reviews set moderation_note=trim(p_note),reviewed_at=now(),reviewed_by=auth.uid() where dog_id=p_dog;
  if p_decision='rejected' then perform public.invalidate_community_interests(p_dog,false); end if;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'community_profile_moderated',p_dog,jsonb_build_object('decision',p_decision,'note',trim(p_note),'previous_status',profile.moderation_status));
end $$;

create function public.express_community_interest(p_from_dog uuid,p_to_dog uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare from_owner uuid; to_owner uuid; own_interest public.psiutki_interests; reverse_interest public.psiutki_interests; interest_id uuid;
begin
  if auth.uid() is null then raise exception 'Zaloguj się.'; end if;
  if p_from_dog is null or p_to_dog is null or p_from_dog=p_to_dog then raise exception 'Wybierz dwa różne profile psów.'; end if;
  -- Lock both dogs in canonical order; profile edits/hides take the same locks.
  perform id from public.dogs where id in (p_from_dog,p_to_dog) order by id for update;
  select guardian_id into from_owner from public.dogs where id=p_from_dog;
  select guardian_id into to_owner from public.dogs where id=p_to_dog;
  if from_owner is null or from_owner<>auth.uid() then raise exception 'Wybierz własnego psa.'; end if;
  if to_owner is null or to_owner=from_owner then raise exception 'Wybierz psa innego opiekuna.'; end if;
  if (select count(*) from public.psiutki_profiles where dog_id in (p_from_dog,p_to_dog) and published and moderation_status='approved')<>2 then
    raise exception 'Oba profile muszą być opublikowane i zatwierdzone.';
  end if;
  select * into own_interest from public.psiutki_interests where from_dog_id=p_from_dog and to_dog_id=p_to_dog;
  select * into reverse_interest from public.psiutki_interests where from_dog_id=p_to_dog and to_dog_id=p_from_dog;
  if own_interest.id is not null and own_interest.status<>'withdrawn' and own_interest.confirmed_at is not null then return own_interest.id; end if;
  if coalesce(own_interest.rejection_active,false) or coalesce(reverse_interest.rejection_active,false) then
    raise exception 'Ta para wymaga zmiany profilu i ponownej oceny behawiorysty.';
  end if;
  insert into public.psiutki_interests(from_dog_id,to_dog_id,status,confirmed_at)
    values(p_from_dog,p_to_dog,'open',now()) on conflict(from_dog_id,to_dog_id) do update set
      status='open',confirmed_at=now(),review_note='',reviewed_at=null,reviewed_by=null
    returning id into interest_id;
  if reverse_interest.id is not null and reverse_interest.status<>'withdrawn' and reverse_interest.confirmed_at is not null then
    update public.psiutki_interests set status='matched',review_note='',reviewed_at=null,reviewed_by=null
      where id in (interest_id,reverse_interest.id);
  end if;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'community_interest_expressed',interest_id,jsonb_build_object('from_dog_id',p_from_dog,'to_dog_id',p_to_dog));
  return interest_id;
end $$;

create function public.withdraw_community_interest(p_interest uuid)
returns void language plpgsql security definer set search_path='' as $$
declare interest public.psiutki_interests;
begin
  select * into interest from public.psiutki_interests where id=p_interest;
  if interest.id is null or auth.uid() is null or not public.owns_dog(interest.from_dog_id) then raise exception 'Brak dostępu do zainteresowania.'; end if;
  perform id from public.dogs where id in (interest.from_dog_id,interest.to_dog_id) order by id for update;
  select * into interest from public.psiutki_interests where id=p_interest for update;
  if interest.status='withdrawn' then return; end if;
  update public.psiutki_interests set
    status=case when id=p_interest then 'withdrawn' when status='withdrawn' then status else 'open' end,
    confirmed_at=case when id=p_interest then null else confirmed_at end,
    review_note='',reviewed_at=null,reviewed_by=null
    where (from_dog_id=interest.from_dog_id and to_dog_id=interest.to_dog_id) or
      (from_dog_id=interest.to_dog_id and to_dog_id=interest.from_dog_id);
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'community_interest_withdrawn',p_interest,jsonb_build_object('previous_status',interest.status));
end $$;

create function public.review_community_interest(
  p_interest uuid,p_expected_updated_at timestamptz,p_decision text,p_note text
) returns void language plpgsql security definer set search_path='' as $$
declare interest public.psiutki_interests; reverse_interest public.psiutki_interests;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_decision is null or p_decision not in ('reviewed','rejected') or p_note is null or length(trim(p_note)) not between 3 and 2000 then
    raise exception 'Wybierz decyzję i podaj wiadomość dla opiekunów (3–2000 znaków).';
  end if;
  select * into interest from public.psiutki_interests where id=p_interest;
  if interest.id is null then raise exception 'Nie znaleziono zainteresowania.'; end if;
  perform id from public.dogs where id in (interest.from_dog_id,interest.to_dog_id) order by id for update;
  select * into interest from public.psiutki_interests where id=p_interest for update;
  if p_expected_updated_at is null or interest.updated_at<>p_expected_updated_at then
    raise exception 'Zainteresowanie zmieniło się w międzyczasie. Odśwież widok.';
  end if;
  select * into reverse_interest from public.psiutki_interests where from_dog_id=interest.to_dog_id and to_dog_id=interest.from_dog_id for update;
  if reverse_interest.id is null or interest.status='withdrawn' or reverse_interest.status='withdrawn' or
     interest.confirmed_at is null or reverse_interest.confirmed_at is null then
    raise exception 'Do oceny potrzebne jest aktualne zainteresowanie obu opiekunów.';
  end if;
  if (select count(*) from public.psiutki_profiles where dog_id in (interest.from_dog_id,interest.to_dog_id) and published and moderation_status='approved')<>2 then
    raise exception 'Oba profile muszą być opublikowane i zatwierdzone.';
  end if;
  update public.psiutki_interests set status=p_decision,review_note=trim(p_note),reviewed_at=now(),reviewed_by=auth.uid(),
    rejection_active=(p_decision='rejected') where id in (interest.id,reverse_interest.id);
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'community_interest_reviewed',p_interest,jsonb_build_object('reverse_interest_id',reverse_interest.id,
      'decision',p_decision,'previous_status',interest.status,'note',trim(p_note)));
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('community-avatars','community-avatars',false,1500000,array['image/jpeg','image/png','image/webp'])
  on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy community_avatars_read on storage.objects for select to authenticated using(
  bucket_id='community-avatars' and (public.is_admin() or (storage.foldername(name))[1]=auth.uid()::text or
    exists(select 1 from public.psiutki_profiles p where p.published and p.moderation_status='approved' and p.avatar_path=storage.objects.name)));
create policy community_avatars_create on storage.objects for insert to authenticated with check(
  bucket_id='community-avatars' and (storage.foldername(name))[1]=auth.uid()::text and
  exists(select 1 from public.dogs d where d.id::text=(storage.foldername(storage.objects.name))[2] and d.guardian_id=auth.uid()) and
  -- Even deleting then re-uploading the same key must not replace approved
  -- content without another submission and moderation.
  not exists(select 1 from public.psiutki_profiles p where p.avatar_path=storage.objects.name));
create policy community_avatars_delete on storage.objects for delete to authenticated using(
  bucket_id='community-avatars' and (public.is_admin() or (storage.foldername(name))[1]=auth.uid()::text));

-- Qualify the outer object path: inside the dogs subquery, bare `name` refers
-- to dogs.name and would reject a legitimate owner's private photo upload.
drop policy dog_avatars_create on storage.objects;
create policy dog_avatars_create on storage.objects for insert to authenticated with check(
  bucket_id='dog-avatars' and (public.is_admin() or
    ((storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.dogs d
      where d.id::text=(storage.foldername(storage.objects.name))[2] and d.guardian_id=auth.uid()))));

revoke execute on function public.invalidate_community_interests(uuid,boolean),
  public.save_community_profile(uuid,timestamptz,jsonb,boolean),public.hide_community_profile(uuid),
  public.moderate_community_profile(uuid,timestamptz,text,text),public.express_community_interest(uuid,uuid),
  public.withdraw_community_interest(uuid),public.review_community_interest(uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.save_community_profile(uuid,timestamptz,jsonb,boolean),public.hide_community_profile(uuid),
  public.moderate_community_profile(uuid,timestamptz,text,text),public.express_community_interest(uuid,uuid),
  public.withdraw_community_interest(uuid),public.review_community_interest(uuid,timestamptz,text,text) to authenticated;
