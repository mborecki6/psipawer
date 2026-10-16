-- Keep an immutable acknowledgement independently of the editable dog profile.
-- Deliberately no dog FK: deleting a dog must not make its request reusable.
create table public.dog_creation_receipts (
  request_id uuid primary key,
  result_id uuid not null,
  guardian_id uuid not null references public.profiles on delete cascade,
  payload jsonb not null
);
alter table public.dog_creation_receipts enable row level security;
revoke all on public.dog_creation_receipts from public,anon,authenticated;

create function public.create_dog_profile(p_request_id uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  receipt public.dog_creation_receipts;
  payload jsonb;
  dog_id uuid;
  weight numeric;
begin
  if actor is null or not exists(
    select 1 from public.user_roles where user_id=actor and role in ('client','admin')
  ) then raise exception 'Brak uprawnień.'; end if;
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception 'Sprawdź dane psa.';
  end if;
  -- All six fields are required, including explicit null for an empty weight.
  -- Additional keys cannot select an owner, status or an existing dog.
  if not (p_payload ?& array['name','breed','approximate_age','sex','weight_kg','color'])
    or p_payload-array['name','breed','approximate_age','sex','weight_kg','color']<>'{}'::jsonb
    or jsonb_typeof(p_payload->'name')<>'string'
    or jsonb_typeof(p_payload->'breed')<>'string'
    or jsonb_typeof(p_payload->'approximate_age')<>'string'
    or jsonb_typeof(p_payload->'sex')<>'string'
    or jsonb_typeof(p_payload->'color')<>'string'
    or jsonb_typeof(p_payload->'weight_kg') not in ('number','null') then
    raise exception 'Sprawdź dane psa.';
  end if;
  weight:=(p_payload->>'weight_kg')::numeric;
  if length(trim(p_payload->>'name')) not between 1 and 80
    or length(trim(p_payload->>'breed'))>120
    or length(trim(p_payload->>'approximate_age'))>80
    or p_payload->>'sex' not in ('female','male','unknown')
    or length(trim(p_payload->>'color'))>120
    or (weight is not null and (weight<=0 or weight>150)) then
    raise exception 'Sprawdź dane psa.';
  end if;
  payload:=jsonb_build_object(
    'name',trim(p_payload->>'name'),
    'breed',trim(p_payload->>'breed'),
    'approximate_age',trim(p_payload->>'approximate_age'),
    'sex',p_payload->>'sex',
    'weight_kg',weight,
    'color',trim(p_payload->>'color')
  );
  perform pg_advisory_xact_lock(hashtextextended('dog-creation:'||p_request_id::text,0));
  select * into receipt from public.dog_creation_receipts where request_id=p_request_id;
  if receipt.request_id is not null then
    if receipt.guardian_id<>actor then
      raise exception 'Nie można ponowić zapisu tego formularza. Sprawdź listę psów i swój dostęp.';
    end if;
    -- Lock the current owner until the retry finishes. No replay changes a dog.
    perform 1 from public.dogs where id=receipt.result_id and guardian_id=actor for share;
    if not found then
      raise exception 'Nie można ponowić zapisu tego formularza. Sprawdź listę psów i swój dostęp.';
    end if;
    if receipt.payload<>payload then
      raise exception 'Ten formularz został już zapisany z innymi danymi. Sprawdź profil psa na liście przed dodaniem nowego.';
    end if;
    return receipt.result_id;
  end if;
  insert into public.dogs(guardian_id,name,breed,approximate_age,sex,weight_kg,color)
    values(actor,payload->>'name',payload->>'breed',payload->>'approximate_age',
      (payload->>'sex')::public.dog_sex,weight,payload->>'color')
    returning id into dog_id;
  insert into public.dog_creation_receipts(request_id,result_id,guardian_id,payload)
    values(p_request_id,dog_id,actor,payload);
  return dog_id;
end $$;
revoke all on function public.create_dog_profile(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_dog_profile(uuid,jsonb) to authenticated;
