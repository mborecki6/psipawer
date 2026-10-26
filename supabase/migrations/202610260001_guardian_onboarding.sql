-- The absence of a row is the grandfathered cohort. Do not backfill: every
-- account existing at this migration, including an unfinished profile, skips.
create table public.guardian_onboarding (
  guardian_id uuid primary key references public.profiles(id) on delete cascade,
  answers jsonb not null default '{"dogName":"","age":null,"goal":null,"format":null,"note":"","collaboration":"unknown","rhythm":"unknown"}'::jsonb,
  current_step text not null default 'welcome'
    check(current_step in ('welcome','dog','goal','style','plan')),
  paused boolean not null default false,
  completed_at timestamptz,
  revision integer not null default 0 check(revision>=0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guardian_onboarding_answers_check check(coalesce(
    jsonb_typeof(answers)='object'
    and answers ?& array['dogName','age','goal','format','note','collaboration','rhythm']
    and answers-array['dogName','age','goal','format','note','collaboration','rhythm']='{}'::jsonb
    and jsonb_typeof(answers->'dogName')='string'
    and length(trim(answers->>'dogName'))<=40
    and jsonb_typeof(answers->'note')='string'
    and length(trim(answers->>'note'))<=240
    and jsonb_typeof(answers->'age') in ('string','null')
    and (answers->>'age' is null or answers->>'age' in ('puppy','adult','senior','unknown'))
    and jsonb_typeof(answers->'goal') in ('string','null')
    and (answers->>'goal' is null or answers->>'goal' in ('walks','home','puppy','activity','relationship','unknown'))
    and jsonb_typeof(answers->'format') in ('string','null')
    and (answers->>'format' is null or answers->>'format' in ('individual','group','unknown'))
    and jsonb_typeof(answers->'collaboration')='string'
    and answers->>'collaboration' in ('unknown','new','after')
    and jsonb_typeof(answers->'rhythm')='string'
    and answers->>'rhythm' in ('unknown','short','more'),false)),
  constraint guardian_onboarding_completion_check check(completed_at is null or
    (answers->>'age' is not null and answers->>'goal' is not null and answers->>'format' is not null))
);

alter table public.guardian_onboarding enable row level security;
revoke all on public.guardian_onboarding from public,anon,authenticated;
grant select on public.guardian_onboarding to authenticated;
create policy guardian_onboarding_read on public.guardian_onboarding
  for select to authenticated using(
    guardian_id=(select auth.uid()) and exists(
      select 1 from public.user_roles where user_id=(select auth.uid()) and role='client'
    )
  );

-- profiles is created inside the existing Auth transaction. A separate trigger
-- preserves bootstrap_user and also works if its implementation changes later.
create function public.create_guardian_onboarding() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.guardian_onboarding(guardian_id) values(new.id);
  return new;
end $$;
revoke all on function public.create_guardian_onboarding() from public,anon,authenticated;
create trigger guardian_onboarding_created after insert on public.profiles
  for each row execute function public.create_guardian_onboarding();

create function public.save_guardian_onboarding(
  p_revision integer,p_answers jsonb,p_step text,p_paused boolean,p_complete boolean
) returns public.guardian_onboarding
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  saved public.guardian_onboarding;
  payload jsonb;
begin
  if actor is null or not exists(
    select 1 from public.user_roles where user_id=actor and role='client'
  ) then raise exception 'Brak uprawnień.'; end if;

  if p_revision is null or p_revision<0 or p_revision>2147483646
    or p_step is null or p_step not in ('welcome','dog','goal','style','plan')
    or p_paused is null or p_complete is null
    or p_answers is null or jsonb_typeof(p_answers)<>'object' then
    raise exception 'Sprawdź odpowiedzi wprowadzenia.';
  end if;
  if not (p_answers ?& array['dogName','age','goal','format','note','collaboration','rhythm'])
    or p_answers-array['dogName','age','goal','format','note','collaboration','rhythm']<>'{}'::jsonb
    or jsonb_typeof(p_answers->'dogName')<>'string'
    or length(trim(p_answers->>'dogName'))>40
    or jsonb_typeof(p_answers->'note')<>'string'
    or length(trim(p_answers->>'note'))>240
    or jsonb_typeof(p_answers->'age') not in ('string','null')
    or (p_answers->>'age' is not null and p_answers->>'age' not in ('puppy','adult','senior','unknown'))
    or jsonb_typeof(p_answers->'goal') not in ('string','null')
    or (p_answers->>'goal' is not null and p_answers->>'goal' not in ('walks','home','puppy','activity','relationship','unknown'))
    or jsonb_typeof(p_answers->'format') not in ('string','null')
    or (p_answers->>'format' is not null and p_answers->>'format' not in ('individual','group','unknown'))
    or jsonb_typeof(p_answers->'collaboration')<>'string'
    or p_answers->>'collaboration' not in ('unknown','new','after')
    or jsonb_typeof(p_answers->'rhythm')<>'string'
    or p_answers->>'rhythm' not in ('unknown','short','more') then
    raise exception 'Sprawdź odpowiedzi wprowadzenia.';
  end if;

  payload:=jsonb_build_object(
    'dogName',trim(p_answers->>'dogName'),
    'age',p_answers->'age',
    'goal',p_answers->'goal',
    'format',p_answers->'format',
    'note',trim(p_answers->>'note'),
    'collaboration',p_answers->>'collaboration',
    'rhythm',p_answers->>'rhythm'
  );
  select * into saved from public.guardian_onboarding where guardian_id=actor for update;
  if not found then raise exception 'To konto nie wymaga wprowadzenia.'; end if;

  -- Completed remains completed during all later edits. Even a direct RPC
  -- cannot leave a previously completed record with missing required answers.
  if (p_complete or saved.completed_at is not null) and
    (payload->>'age' is null or payload->>'goal' is null or payload->>'format' is null)
    or p_complete and (p_step<>'plan' or p_paused) then
    raise exception 'Sprawdź odpowiedzi wprowadzenia.';
  end if;

  if saved.revision<>p_revision then
    -- Only a semantically identical replay of the preceding write is harmless.
    -- It never changes the row, timestamps or completion history.
    if saved.revision=p_revision+1 and saved.answers=payload
      and saved.current_step=p_step and saved.paused=p_paused
      and (not p_complete or saved.completed_at is not null) then
      return saved;
    end if;
    raise exception 'Odpowiedzi zmieniły się w innym oknie. Odśwież wprowadzenie przed kolejnym zapisem.';
  end if;

  update public.guardian_onboarding set
    answers=payload,current_step=p_step,paused=p_paused,
    completed_at=case when p_complete then coalesce(completed_at,now()) else completed_at end,
    revision=revision+1,updated_at=now()
    where guardian_id=actor returning * into saved;
  return saved;
end $$;
revoke all on function public.save_guardian_onboarding(integer,jsonb,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.save_guardian_onboarding(integer,jsonb,text,boolean,boolean) to authenticated;
