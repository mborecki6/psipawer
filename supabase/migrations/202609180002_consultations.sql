-- Individual consultations in the single-practice pilot. All content in these
-- tables is shared with the dog's guardian; private notes remain in dog_notes.
create table public.consultations (
  id uuid primary key,
  practice_id uuid not null references public.care_practices,
  dog_id uuid not null references public.dogs,
  requested_by uuid not null references public.profiles,
  topic text not null check(length(trim(topic)) between 3 and 3000),
  availability text not null default '' check(length(availability)<=1000),
  status text not null default 'requested' check(status in ('requested','scheduled','completed','cancelled')),
  starts_at timestamptz,
  duration_minutes integer check(duration_minutes between 15 and 240),
  meeting_mode text check(meeting_mode in ('in_person','online')),
  location text not null default '' check(length(location)<=1000),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(starts_at is null or isfinite(starts_at)),
  check(status not in ('scheduled','completed') or
    (starts_at is not null and duration_minutes is not null and meeting_mode is not null and length(trim(location))>=3))
);
create unique index consultation_one_active_dog on public.consultations(dog_id) where status in ('requested','scheduled');
create index consultation_queue on public.consultations(status,starts_at,created_at,id);
create index consultation_dog_history on public.consultations(dog_id,created_at desc,id);

create table public.consultation_history (
  id uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations,
  version integer not null,
  action text not null check(action in ('requested','scheduled','rescheduled','cancelled','completed')),
  starts_at timestamptz,
  duration_minutes integer,
  meeting_mode text,
  location text not null default '',
  note text not null default '' check(length(note)<=3000),
  author_id uuid not null references public.profiles,
  created_at timestamptz not null default now(),
  unique(consultation_id,version)
);
-- Durable events for a future worker. No message delivery is enabled.
create table public.consultation_events (
  history_id uuid primary key references public.consultation_history,
  created_at timestamptz not null default now()
);
alter table public.consultations enable row level security;
alter table public.consultation_history enable row level security;
alter table public.consultation_events enable row level security;
create policy consultations_read on public.consultations for select to authenticated
  using(public.is_admin() or public.owns_dog(dog_id));
create policy consultation_history_read on public.consultation_history for select to authenticated
  using(exists(select 1 from public.consultations c where c.id=consultation_id));
revoke all on public.consultations,public.consultation_history,public.consultation_events from anon,authenticated;
grant select on public.consultations,public.consultation_history to authenticated;

create function public.request_consultation(p_id uuid,p_dog uuid,p_topic text,p_availability text)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.consultations; event_id uuid;
begin
  if auth.uid() is null or not public.owns_dog(p_dog) then raise exception 'Nie znaleziono Twojego psa.'; end if;
  if p_id is null or p_topic is null or length(trim(p_topic)) not between 3 and 3000
     or p_availability is null or length(trim(p_availability))>1000 then raise exception 'Sprawdź treść zgłoszenia.'; end if;
  perform 1 from public.dogs where id=p_dog for update;
  select * into existing from public.consultations where id=p_id;
  if found then
    if existing.dog_id=p_dog and existing.requested_by=auth.uid() and existing.topic=trim(p_topic) and existing.availability=trim(p_availability) then return existing.id; end if;
    raise exception 'To zgłoszenie zostało już zapisane. Odśwież widok.';
  end if;
  if exists(select 1 from public.consultations where dog_id=p_dog and status in ('requested','scheduled')) then
    raise exception 'Ten pies ma już otwarte zgłoszenie lub umówioną konsultację.';
  end if;
  insert into public.consultations(id,practice_id,dog_id,requested_by,topic,availability)
    values(p_id,'00000000-0000-4000-8000-000000000001',p_dog,auth.uid(),trim(p_topic),trim(p_availability));
  insert into public.consultation_history(consultation_id,version,action,author_id)
    values(p_id,1,'requested',auth.uid()) returning id into event_id;
  insert into public.consultation_events(history_id) values(event_id);
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'consultation_requested',p_id);
  return p_id;
end $$;

create function public.change_consultation(
  p_id uuid,p_expected_version integer,p_action text,p_starts_at timestamptz,
  p_duration integer,p_mode text,p_location text,p_note text
) returns integer language plpgsql security definer set search_path='' as $$
declare c public.consultations; h public.consultation_history; event_id uuid; kind text; staff boolean;
begin
  staff:=public.is_admin();
  if auth.uid() is null or (not staff and p_action is distinct from 'cancel') then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version<1 or p_expected_version>=2147483647 or
     p_action is null or p_action not in ('schedule','cancel','complete') or
     p_note is null or length(trim(p_note))>3000 then raise exception 'Sprawdź dane konsultacji.'; end if;
  -- Serialize scheduling across the one practice before checking overlaps.
  -- Existing walk booking rules are unchanged; this guards consultation slots.
  if p_action='schedule' then
    perform 1 from public.care_practices where id='00000000-0000-4000-8000-000000000001' for update;
    if p_starts_at is null or not isfinite(p_starts_at) or p_duration is null or p_duration not between 15 and 240
       or p_mode is null or p_mode not in ('in_person','online') or p_location is null or length(trim(p_location)) not between 3 and 1000 then
      raise exception 'Sprawdź termin i miejsce spotkania.';
    end if;
  end if;
  select * into c from public.consultations where id=p_id for update;
  if not found or (not staff and not public.owns_dog(c.dog_id)) then raise exception 'Nie znaleziono konsultacji.'; end if;
  -- Exact retry of the immediately preceding operation is a no-op. A stale
  -- form with different values is rejected instead of overwriting a change.
  if c.version=p_expected_version+1 then
    select * into h from public.consultation_history where consultation_id=p_id and version=c.version;
    if h.author_id=auth.uid() and h.note=trim(p_note) and (
      (p_action='schedule' and h.action in ('scheduled','rescheduled') and h.starts_at=p_starts_at and h.duration_minutes=p_duration and h.meeting_mode=p_mode and h.location=trim(p_location)) or
      (p_action='cancel' and h.action='cancelled') or (p_action='complete' and h.action='completed')
    ) then return c.version; end if;
  end if;
  if c.version<>p_expected_version then raise exception 'Konsultacja zmieniła się. Odśwież widok przed zapisem.'; end if;
  if c.status in ('cancelled','completed') then raise exception 'Ta konsultacja jest już zamknięta.'; end if;
  if p_action='schedule' then
    if p_starts_at<=now() then raise exception 'Wybierz przyszły termin.'; end if;
    if c.status='scheduled' and length(trim(p_note))<3 then raise exception 'Podaj powód zmiany terminu.'; end if;
    if exists(select 1 from public.consultations x where x.id<>p_id and x.status='scheduled'
      and x.practice_id=c.practice_id and x.starts_at<p_starts_at+make_interval(mins=>p_duration)
      and x.starts_at+make_interval(mins=>x.duration_minutes)>p_starts_at) then
      raise exception 'Ten termin koliduje z inną konsultacją.';
    end if;
    kind:=case when c.status='requested' then 'scheduled' else 'rescheduled' end;
    update public.consultations set status='scheduled',starts_at=p_starts_at,duration_minutes=p_duration,
      meeting_mode=p_mode,location=trim(p_location),version=version+1,updated_at=clock_timestamp() where id=p_id returning * into c;
  elsif p_action='cancel' then
    if length(trim(p_note))<3 then raise exception 'Podaj powód odwołania.'; end if;
    if not staff and c.status='scheduled' and c.starts_at<=now() then raise exception 'Termin już się rozpoczął. Skontaktuj się z prowadzącą.'; end if;
    kind:='cancelled';
    update public.consultations set status='cancelled',version=version+1,updated_at=clock_timestamp() where id=p_id returning * into c;
  else
    if c.status<>'scheduled' or c.starts_at+make_interval(mins=>c.duration_minutes)>now() then
      raise exception 'Możesz zakończyć konsultację dopiero po jej terminie.';
    end if;
    kind:='completed';
    update public.consultations set status='completed',version=version+1,updated_at=clock_timestamp() where id=p_id returning * into c;
  end if;
  insert into public.consultation_history(consultation_id,version,action,starts_at,duration_minutes,meeting_mode,location,note,author_id)
    values(c.id,c.version,kind,c.starts_at,c.duration_minutes,c.meeting_mode,c.location,trim(p_note),auth.uid()) returning id into event_id;
  insert into public.consultation_events(history_id) values(event_id);
  insert into public.audit_events(actor_id,event,entity_id,details) values(auth.uid(),'consultation_'||kind,p_id,jsonb_build_object('version',c.version));
  return c.version;
end $$;
revoke all on function public.request_consultation(uuid,uuid,text,text),public.change_consultation(uuid,integer,text,timestamptz,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.request_consultation(uuid,uuid,text,text),public.change_consultation(uuid,integer,text,timestamptz,integer,text,text,text) to authenticated;
