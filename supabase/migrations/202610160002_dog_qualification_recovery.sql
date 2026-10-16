-- A status may return to the same value, or a decision may keep its status.
-- Count every status write so neither case can reuse an outdated decision form.
alter table public.dogs add column qualification_version integer not null default 0
  check(qualification_version>=0);
create function public.advance_dog_qualification_version()
returns trigger language plpgsql set search_path='' as $$
begin
  new.qualification_version:=old.qualification_version+1;
  return new;
end $$;
create trigger dogs_qualification_version before update of status on public.dogs
  for each row execute function public.advance_dog_qualification_version();
revoke all on function public.advance_dog_qualification_version() from public,anon,authenticated;

-- Preserve used request keys even if their dog is deleted. Only this RPC reads
-- or writes receipts, and the immutable payload includes the initial state.
create table public.dog_qualification_receipts (
  request_id uuid primary key,
  dog_id uuid not null,
  actor_id uuid not null references public.profiles on delete cascade,
  payload jsonb not null,
  result_version integer not null check(result_version>0)
);
alter table public.dog_qualification_receipts enable row level security;
revoke all on public.dog_qualification_receipts from public,anon,authenticated;

create function public.qualify_dog(p_request_id uuid,p_dog uuid,
  p_expected_status public.dog_status,p_expected_version integer,
  p_status public.dog_status,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  dog public.dogs;
  receipt public.dog_qualification_receipts;
  payload jsonb;
  result_version integer;
begin
  -- Lock the current role for this transaction, including acknowledgement replay.
  perform 1 from public.user_roles where user_id=actor and role='admin' for share;
  if actor is null or not found then
    raise exception 'Brak uprawnień do zmiany kwalifikacji psa.';
  end if;
  if p_request_id is null or p_dog is null or p_expected_status is null
    or p_expected_version is null or p_expected_version not between 0 and 2147483646
    or p_status is null or p_note is null or length(trim(p_note)) not between 3 and 8000 then
    raise exception 'Wybierz status i podaj powód zmiany.';
  end if;
  payload:=jsonb_build_object('dog_id',p_dog,'expected_status',p_expected_status,
    'expected_version',p_expected_version,'status',p_status,'note',trim(p_note));
  perform pg_advisory_xact_lock(hashtextextended('dog-qualification:'||p_request_id::text,0));
  select * into receipt from public.dog_qualification_receipts where request_id=p_request_id;
  if receipt.request_id is not null and (receipt.actor_id<>actor or receipt.payload<>payload) then
    raise exception 'Ten formularz kwalifikacji został już użyty do innej decyzji. Sprawdź profil psa i odśwież formularz.';
  end if;
  select * into dog from public.dogs where id=p_dog for update;
  if dog.id is null then raise exception 'Nie znaleziono psa. Odśwież listę psów.'; end if;
  -- A retry only acknowledges the first decision. A later decision stays intact.
  if receipt.request_id is not null then return receipt.result_version; end if;
  if dog.status<>p_expected_status or dog.qualification_version<>p_expected_version then
    raise exception 'Kwalifikacja psa zmieniła się w międzyczasie. Sprawdź aktualny status i odśwież formularz.';
  end if;
  update public.dogs set status=p_status where id=p_dog
    returning qualification_version into result_version;
  insert into public.dog_notes(dog_id,author_id,body)
    values(p_dog,actor,trim(p_note));
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(actor,'dog_status_changed',p_dog,jsonb_build_object('status',p_status));
  insert into public.dog_qualification_receipts(request_id,dog_id,actor_id,payload,result_version)
    values(p_request_id,p_dog,actor,payload,result_version);
  return result_version;
end $$;
revoke all on function public.qualify_dog(uuid,uuid,public.dog_status,integer,public.dog_status,text)
  from public,anon,authenticated;
grant execute on function public.qualify_dog(uuid,uuid,public.dog_status,integer,public.dog_status,text)
  to authenticated;
-- Old clients must refresh rather than bypass the initial-state precondition.
revoke all on function public.set_dog_status(uuid,public.dog_status,text)
  from public,anon,authenticated;
