-- Follow-up dates become actionable tasks when a plan is published. Drafts do
-- not create tasks. Private outcomes live only in staff-readable history.
create table public.care_follow_ups (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique,
  dog_id uuid not null references public.dogs,
  practice_id uuid not null references public.care_practices,
  due_on date not null check(isfinite(due_on)),
  status text not null default 'open' check(status in ('open','done','cancelled','superseded')),
  version integer not null default 1 check(version>0),
  updated_by uuid not null references public.profiles,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key(plan_id,dog_id,practice_id) references public.care_plan_versions(id,dog_id,practice_id),
  check((status='open')=(closed_at is null))
);
create unique index care_follow_up_one_open_dog on public.care_follow_ups(dog_id) where status='open';
create index care_follow_up_due on public.care_follow_ups(due_on,id) where status='open';
create table public.care_follow_up_history (
  follow_up_id uuid not null references public.care_follow_ups,
  version integer not null,
  action text not null check(action in ('scheduled','rescheduled','completed','cancelled','reopened','superseded')),
  due_on date not null,
  note text not null default '' check(length(note)<=2000),
  author_id uuid not null references public.profiles,
  created_at timestamptz not null default now(),
  primary key(follow_up_id,version)
);
alter table public.care_follow_ups enable row level security;
alter table public.care_follow_up_history enable row level security;
create policy follow_ups_read on public.care_follow_ups for select to authenticated using(public.is_admin() or public.owns_dog(dog_id));
create policy follow_up_history_staff on public.care_follow_up_history for select to authenticated using(public.is_admin());
revoke all on public.care_follow_ups,public.care_follow_up_history from anon,authenticated;
grant select on public.care_follow_ups,public.care_follow_up_history to authenticated;

-- Import only the latest publication for each dog, preserving its original date.
insert into public.care_follow_ups(plan_id,dog_id,practice_id,due_on,updated_by,created_at)
  select id,dog_id,practice_id,follow_up_on,published_by,published_at from
    (select distinct on(dog_id) * from public.care_plan_versions order by dog_id,revision desc) p
  where follow_up_on is not null;
insert into public.care_follow_up_history(follow_up_id,version,action,due_on,author_id)
  select id,version,'scheduled',due_on,updated_by from public.care_follow_ups;

create function public.plan_follow_up_task() returns trigger language plpgsql security definer set search_path='' as $$
declare f public.care_follow_ups;
begin
  -- save_care_plan already locks this parent; repeat for other trusted writers.
  perform 1 from public.dogs where id=new.dog_id for update;
  for f in update public.care_follow_ups set status='superseded',closed_at=clock_timestamp(),version=version+1,
    updated_by=new.published_by,updated_at=clock_timestamp() where dog_id=new.dog_id and status='open' returning *
  loop
    insert into public.care_follow_up_history(follow_up_id,version,action,due_on,author_id)
      values(f.id,f.version,'superseded',f.due_on,new.published_by);
  end loop;
  if new.follow_up_on is not null then
    insert into public.care_follow_ups(plan_id,dog_id,practice_id,due_on,updated_by)
      values(new.id,new.dog_id,new.practice_id,new.follow_up_on,new.published_by) returning * into f;
    insert into public.care_follow_up_history(follow_up_id,version,action,due_on,author_id)
      values(f.id,f.version,'scheduled',f.due_on,new.published_by);
  end if;
  return new;
end $$;
revoke all on function public.plan_follow_up_task() from public,anon,authenticated;
create trigger care_plan_follow_up after insert on public.care_plan_versions for each row execute function public.plan_follow_up_task();

create function public.change_care_follow_up(p_id uuid,p_expected_version integer,p_action text,p_due_on date,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare f public.care_follow_ups; h public.care_follow_up_history; owner_dog uuid; today date:=(now() at time zone 'Europe/Warsaw')::date;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_expected_version is null or p_expected_version<1 or p_expected_version>=2147483647 or
    p_action is null or p_action not in ('rescheduled','completed','cancelled','reopened') or
    p_note is null or length(trim(p_note)) not between 3 and 2000 then raise exception 'Wybierz działanie i dodaj krótką notatkę.'; end if;
  if p_action in ('rescheduled','reopened') and (p_due_on is null or not isfinite(p_due_on)) then raise exception 'Podaj nową datę kontaktu.'; end if;
  if p_action in ('completed','cancelled') and p_due_on is not null then raise exception 'To działanie nie zmienia terminu.'; end if;
  select dog_id into owner_dog from public.care_follow_ups where id=p_id;
  if not found then raise exception 'Nie znaleziono kontaktu kontrolnego.'; end if;
  perform 1 from public.dogs where id=owner_dog for update;
  select * into f from public.care_follow_ups where id=p_id for update;
  if f.version=p_expected_version+1 then
    select * into h from public.care_follow_up_history where follow_up_id=f.id and version=f.version;
    if h.author_id=auth.uid() and h.action=p_action and h.note=trim(p_note) and
       (p_action in ('completed','cancelled') or h.due_on=p_due_on) then return f.version; end if;
  end if;
  if f.version<>p_expected_version then raise exception 'Kontakt zmienił się. Odśwież widok przed zapisem.'; end if;
  if f.status='superseded' or f.plan_id is distinct from (select id from public.care_plan_versions where dog_id=f.dog_id order by revision desc limit 1) then
    raise exception 'Ten kontakt dotyczy wcześniejszego planu. Otwórz aktualny plan psa.';
  end if;
  if (p_action='reopened' and f.status not in ('done','cancelled')) or (p_action<>'reopened' and f.status<>'open') then raise exception 'Nie można wykonać tego działania w aktualnym stanie.'; end if;
  if p_action in ('rescheduled','reopened') and p_due_on<today then raise exception 'Wybierz dzisiejszą lub przyszłą datę kontaktu.'; end if;
  if p_action='rescheduled' and p_due_on=f.due_on then raise exception 'Wybierz inną datę kontaktu.'; end if;
  update public.care_follow_ups set due_on=coalesce(p_due_on,due_on),
    status=case p_action when 'completed' then 'done' when 'cancelled' then 'cancelled' else 'open' end,
    closed_at=case when p_action in ('completed','cancelled') then clock_timestamp() else null end,
    version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=p_id returning * into f;
  insert into public.care_follow_up_history(follow_up_id,version,action,due_on,note,author_id)
    values(f.id,f.version,p_action,f.due_on,trim(p_note),auth.uid());
  insert into public.audit_events(actor_id,event,entity_id,details)
    values(auth.uid(),'care_follow_up_changed',f.id,jsonb_build_object('version',f.version,'action',p_action));
  return f.version;
end $$;
revoke all on function public.change_care_follow_up(uuid,integer,text,date,text) from public,anon,authenticated;
grant execute on function public.change_care_follow_up(uuid,integer,text,date,text) to authenticated;

-- Read-only staff queue. Source state is authoritative: resolving a request in
-- its own module automatically removes it here; no duplicated completion flag.
create function public.staff_work_items()
returns table(kind text,id uuid,dog_id uuid,dog_name text,title text,due_on date,created_at timestamptz,priority integer,source_id uuid)
language plpgsql stable security invoker set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  return query
  select 'followups'::text,f.id,f.dog_id,d.name,'Kontakt kontrolny'::text,f.due_on,f.created_at,
    case when f.due_on<(now() at time zone 'Europe/Warsaw')::date then 0 when f.due_on=(now() at time zone 'Europe/Warsaw')::date then 1 else 6 end,f.plan_id
    from public.care_follow_ups f join public.dogs d on d.id=f.dog_id where f.status='open'
  union all
  select 'consultations',c.id,c.dog_id,d.name,coalesce(c.service_name,'Konsultacja do ustalenia'),null::date,c.created_at,2,c.id
    from public.consultations c join public.dogs d on d.id=c.dog_id where c.status='requested'
  union all
  select 'progress',p.id,p.dog_id,d.name,'Odpowiedź o postępach',null::date,p.created_at,3,p.plan_id
    from public.care_progress p join public.dogs d on d.id=p.dog_id where p.reviewed_at is null
  union all
  select 'profiles',d.id,d.id,d.name,case when d.status='new' then 'Nowy profil do oceny' else 'Profil do ponownej oceny' end,null::date,d.created_at,4,d.id
    from public.dogs d where d.status in ('new','needs_review')
  union all
  select 'walks',r.id,r.dog_id,d.name,'Zgłoszenie na spacer', (w.starts_at at time zone 'Europe/Warsaw')::date,r.created_at,5,w.id
    from public.walk_registrations r join public.walks w on w.id=r.walk_id join public.dogs d on d.id=r.dog_id
    where r.status='pending' and w.starts_at>now() and w.status not in ('draft','cancelled','completed');
end $$;
create function public.staff_work_queue(p_filter text default 'all',p_offset integer default 0)
returns table(kind text,id uuid,dog_id uuid,dog_name text,title text,due_on date,created_at timestamptz,priority integer,source_id uuid)
language plpgsql stable security invoker set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_filter is null or p_filter not in ('all','followups','consultations','progress','profiles','walks') or p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Nieprawidłowy filtr listy.'; end if;
  return query select * from public.staff_work_items() w where p_filter='all' or w.kind=p_filter
    order by w.priority,w.due_on nulls last,w.created_at,w.kind,w.id limit 21 offset p_offset;
end $$;
create function public.staff_work_counts()
returns table(kind text,total bigint,overdue bigint)
language sql stable security invoker set search_path='' as $$
  select w.kind,count(*),count(*) filter(where w.kind='followups' and w.due_on<(now() at time zone 'Europe/Warsaw')::date)
    from public.staff_work_items() w group by w.kind order by w.kind
$$;
revoke all on function public.staff_work_items(),public.staff_work_queue(text,integer),public.staff_work_counts() from public,anon,authenticated;
grant execute on function public.staff_work_items(),public.staff_work_queue(text,integer),public.staff_work_counts() to authenticated;

-- Overview shows the current open contact date; the original immutable plan
-- continues to preserve the date announced at publication.
create or replace function public.care_plan_summaries(p_offset integer default 0)
returns table(id uuid,dog_id uuid,dog_name text,title text,revision integer,
  follow_up_on date,published_at timestamptz,unread_count bigint)
language sql stable security invoker set search_path='' as $$
  select p.id,p.dog_id,d.name,p.title,p.revision,f.due_on,p.published_at,
    (select count(*) from public.care_progress r where r.dog_id=p.dog_id and r.reviewed_at is null)
  from (select distinct on (v.dog_id) v.* from public.care_plan_versions v order by v.dog_id,v.revision desc) p
  join public.dogs d on d.id=p.dog_id
  left join public.care_follow_ups f on f.plan_id=p.id and f.status='open'
  order by p.published_at desc,p.id
  limit 21 offset greatest(coalesce(p_offset,0),0)
$$;
