-- Internal assessments belong to the behaviorist. Owners cannot read or edit
-- pairings, even when one or both dogs belong to them.
create or replace function public.save_dog_relation(
  p_dog_a uuid,
  p_dog_b uuid,
  p_level text,
  p_note text,
  p_last_met_at timestamptz,
  p_expected_updated_at timestamptz default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  first_dog uuid;
  second_dog uuid;
  previous public.dog_relations;
  saved public.dog_relations;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_dog_a is null or p_dog_b is null or p_dog_a=p_dog_b then
    raise exception 'Wybierz dwa różne psy.';
  end if;
  if p_level is null or p_level not in ('unknown','good','neutral','caution','block','possible_duet') then
    raise exception 'Wybierz poprawną ocenę relacji.';
  end if;
  if p_note is null or length(trim(p_note)) not between 3 and 2000 then
    raise exception 'Podaj prywatną notatkę (3–2000 znaków).';
  end if;
  if p_last_met_at is not null and (not isfinite(p_last_met_at) or p_last_met_at>now()) then
    raise exception 'Ostatnie spotkanie nie może być w przyszłości.';
  end if;
  first_dog=least(p_dog_a,p_dog_b);
  second_dog=greatest(p_dog_a,p_dog_b);
  perform id from public.dogs where id in (first_dog,second_dog) order by id for key share;
  if not exists(select 1 from public.dogs where id=first_dog) or
     not exists(select 1 from public.dogs where id=second_dog) then
    raise exception 'Nie znaleziono wybranych psów.';
  end if;
  select * into previous from public.dog_relations
    where dog_a=first_dog and dog_b=second_dog for update;
  if previous.id is not null then
    if p_expected_updated_at is null or previous.updated_at is distinct from p_expected_updated_at then
      raise exception 'Ocena relacji już istnieje lub zmieniła się. Odśwież widok i otwórz jej edycję.';
    end if;
    update public.dog_relations set
      level=p_level,note=trim(p_note),last_met_at=p_last_met_at,author_id=auth.uid(),
      updated_at=greatest(clock_timestamp(),previous.updated_at+interval '1 microsecond')
      where id=previous.id returning * into saved;
  else
    if p_expected_updated_at is not null then
      raise exception 'Ocena relacji już istnieje lub zmieniła się. Odśwież widok i otwórz jej edycję.';
    end if;
    -- The unique pair also serializes concurrent first saves. A second form
    -- must load the newly created assessment rather than silently overwrite it.
    insert into public.dog_relations(dog_a,dog_b,level,note,last_met_at,author_id)
      values(first_dog,second_dog,p_level,trim(p_note),p_last_met_at,auth.uid())
      on conflict(dog_a,dog_b) do nothing returning * into saved;
    if saved.id is null then
      raise exception 'Ocena relacji już istnieje lub zmieniła się. Odśwież widok i otwórz jej edycję.';
    end if;
  end if;
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'dog_relation_saved',saved.id,jsonb_build_object(
      'dog_a',first_dog,'dog_b',second_dog,
      'from',case when previous.id is null then null else jsonb_build_object(
        'level',previous.level,'note',previous.note,'last_met_at',previous.last_met_at,
        'author_id',previous.author_id,'updated_at',previous.updated_at) end,
      'to',jsonb_build_object('level',saved.level,'note',saved.note,'last_met_at',saved.last_met_at,
        'author_id',saved.author_id,'updated_at',saved.updated_at)
    ));
  return saved.id;
end $$;

revoke execute on function public.save_dog_relation(uuid,uuid,text,text,timestamptz,timestamptz)
  from public,anon;
grant execute on function public.save_dog_relation(uuid,uuid,text,text,timestamptz,timestamptz)
  to authenticated;
