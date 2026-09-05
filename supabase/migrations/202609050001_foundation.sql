-- Psi Pawer: all personal data is authenticated, ownership enforced in PostgreSQL.
create type public.app_role as enum ('admin','client');
create type public.dog_sex as enum ('female','male','unknown');
create type public.dog_status as enum ('new','needs_review','consultation_required','approved','approved_conditional','suspended','not_eligible');
create type public.booking_mode as enum ('automatic','approval','invite');
create type public.walk_status as enum ('draft','open','full','closed','completed','cancelled');
create type public.registration_status as enum ('pending','accepted','waitlisted','rejected','withdrawn','cancelled_on_time','cancelled_late');
create type public.attendance_status as enum ('pending','present','absent','no_show');
create type public.payment_status as enum ('none','due','paid','refunded');
create type public.note_visibility as enum ('admin_only','client_visible');
create table public.profiles(id uuid primary key references auth.users on delete cascade,full_name text,phone text,area text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.user_roles(user_id uuid primary key references auth.users on delete cascade,role public.app_role not null default 'client');
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.user_roles where user_id=auth.uid() and role='admin')$$;
create function public.bootstrap_user() returns trigger language plpgsql security definer set search_path='' as $$begin insert into public.profiles(id) values(new.id);insert into public.user_roles(user_id,role) values(new.id,'client');return new;end$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.bootstrap_user();
create table public.dogs(id uuid primary key default gen_random_uuid(),guardian_id uuid not null references public.profiles on delete cascade,name text not null check(length(trim(name)) between 1 and 80),birth_date date,approximate_age text,breed text,sex public.dog_sex not null default 'unknown',weight_kg numeric check(weight_kg>0 and weight_kg<=150),color text,status public.dog_status not null default 'new',avatar_path text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index dogs_guardian_id_idx on public.dogs(guardian_id);
create function public.owns_dog(d uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.dogs where id=d and guardian_id=auth.uid())$$;
create table public.dog_behavior_profiles(dog_id uuid primary key references public.dogs on delete cascade,comfort_distance text not null default '',reactions text not null default '',triggers text not null default '',helps text not null default '',health text not null default '',medications text not null default '',allergies text not null default '',muzzle text not null default '',bite_history text not null default '',goals text not null default '',updated_at timestamptz not null default now());
create table public.dog_notes(id uuid primary key default gen_random_uuid(),dog_id uuid not null references public.dogs on delete cascade,author_id uuid not null references public.profiles,body text not null check(length(trim(body)) between 1 and 8000),visibility public.note_visibility not null default 'admin_only',created_at timestamptz not null default now());
create index dog_notes_dog_id_idx on public.dog_notes(dog_id);
create table public.walks(id uuid primary key default gen_random_uuid(),starts_at timestamptz not null,duration_minutes integer not null default 60 check(duration_minutes between 15 and 480),public_location text not null,type text not null,price_cents integer not null check(price_cents>0),capacity integer not null check(capacity between 1 and 50),booking_mode public.booking_mode not null default 'approval',info text not null default '',tags text[] not null default '{}',status public.walk_status not null default 'open',leader_id uuid references public.profiles,cancellation_deadline_hours integer not null default 24 check(cancellation_deadline_hours between 0 and 168),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index walks_starts_at_idx on public.walks(starts_at);
create table public.walk_private_details(walk_id uuid primary key references public.walks on delete cascade,exact_location text not null,map_url text not null default '' check(map_url='' or map_url ~ '^https://'),instructions text not null default '');
create table public.walk_registrations(id uuid primary key default gen_random_uuid(),walk_id uuid not null references public.walks on delete cascade,dog_id uuid not null references public.dogs on delete cascade,status public.registration_status not null default 'pending',payment_status public.payment_status not null default 'none',package_id uuid,created_at timestamptz not null default now(),decided_at timestamptz,decided_by uuid references public.profiles,decision_note text,cancelled_at timestamptz,attendance public.attendance_status not null default 'pending',unique(walk_id,dog_id));
create index registrations_walk_idx on public.walk_registrations(walk_id,status);
create index registrations_dog_idx on public.walk_registrations(dog_id);
create function public.has_registration(w uuid,accepted_only boolean default false) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.walk_registrations r join public.dogs d on d.id=r.dog_id where r.walk_id=w and d.guardian_id=auth.uid() and (not accepted_only or r.status='accepted'))$$;
create table public.audit_events(id uuid primary key default gen_random_uuid(),actor_id uuid references public.profiles,event text not null,entity_id uuid not null,details jsonb not null default '{}',created_at timestamptz not null default now());
create index audit_entity_idx on public.audit_events(entity_id,created_at);
create function public.touch_updated_at() returns trigger language plpgsql set search_path='' as $$begin new.updated_at=now();return new;end$$;
create trigger profiles_updated before update on public.profiles for each row execute function public.touch_updated_at();
create trigger dogs_updated before update on public.dogs for each row execute function public.touch_updated_at();
create trigger walks_updated before update on public.walks for each row execute function public.touch_updated_at();
create trigger behavior_updated before update on public.dog_behavior_profiles for each row execute function public.touch_updated_at();
-- Ownership and qualification are immutable through the owner-edit path.
create function public.guard_dog_insert() returns trigger language plpgsql set search_path='' as $$begin if not public.is_admin() then new.status='new';end if;return new;end$$;
create trigger dog_insert_guard before insert on public.dogs for each row execute function public.guard_dog_insert();
create function public.behavior_changed() returns trigger language plpgsql security definer set search_path='' as $$begin
 if not public.is_admin() and (TG_OP='INSERT' or new.reactions is distinct from old.reactions or new.bite_history is distinct from old.bite_history) then
  update public.dogs set status='needs_review' where id=new.dog_id and status not in ('suspended','not_eligible','consultation_required');
  insert into public.audit_events(actor_id,event,entity_id) values(auth.uid(),'behavior_review_required',new.dog_id);
 end if;return new;end$$;
create trigger behavior_review after insert or update on public.dog_behavior_profiles for each row execute function public.behavior_changed();
-- Lock the parent for every acceptance, including privileged SQL/API writes.
create function public.enforce_capacity() returns trigger language plpgsql security definer set search_path='' as $$declare lim integer;begin
 if new.status='accepted' then
  select capacity into lim from public.walks where id=new.walk_id for update;
  if (select count(*) from public.walk_registrations where walk_id=new.walk_id and status='accepted' and id<>new.id)>=lim then raise exception 'Brak wolnych miejsc.';end if;
 end if;return new;end$$;
create trigger registration_capacity before insert or update on public.walk_registrations for each row execute function public.enforce_capacity();
create function public.guard_capacity_change() returns trigger language plpgsql security definer set search_path='' as $$begin if new.capacity<(select count(*) from public.walk_registrations where walk_id=new.id and status='accepted') then raise exception 'Limit nie może być mniejszy od zaakceptowanego składu.';end if;return new;end$$;
create trigger walk_capacity_change before update on public.walks for each row execute function public.guard_capacity_change();
-- Explicit operation policies. API grants below constrain column writes as well.
alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy profiles_edit on public.profiles for update to authenticated using(id=auth.uid() or public.is_admin()) with check(id=auth.uid() or public.is_admin());
alter table public.user_roles enable row level security;
create policy roles_read on public.user_roles for select to authenticated using(user_id=auth.uid() or public.is_admin());
alter table public.dogs enable row level security;
create policy dogs_read on public.dogs for select to authenticated using(guardian_id=auth.uid() or public.is_admin());
create policy dogs_create on public.dogs for insert to authenticated with check(guardian_id=auth.uid() or public.is_admin());
create policy dogs_edit on public.dogs for update to authenticated using(guardian_id=auth.uid() or public.is_admin()) with check(guardian_id=auth.uid() or public.is_admin());
create policy dogs_delete on public.dogs for delete to authenticated using(public.is_admin());
alter table public.dog_behavior_profiles enable row level security;
create policy behavior_read on public.dog_behavior_profiles for select to authenticated using(public.owns_dog(dog_id) or public.is_admin());
create policy behavior_create on public.dog_behavior_profiles for insert to authenticated with check(public.owns_dog(dog_id) or public.is_admin());
create policy behavior_edit on public.dog_behavior_profiles for update to authenticated using(public.owns_dog(dog_id) or public.is_admin()) with check(public.owns_dog(dog_id) or public.is_admin());
create policy behavior_delete on public.dog_behavior_profiles for delete to authenticated using(public.is_admin());
alter table public.dog_notes enable row level security;
create policy notes_read on public.dog_notes for select to authenticated using(public.is_admin() or (visibility='client_visible' and public.owns_dog(dog_id)));
create policy notes_create on public.dog_notes for insert to authenticated with check(public.is_admin() and author_id=auth.uid());
create policy notes_edit on public.dog_notes for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy notes_delete on public.dog_notes for delete to authenticated using(public.is_admin());
alter table public.walks enable row level security;
create policy walks_read on public.walks for select to authenticated using(public.is_admin() or (status in ('open','full') and booking_mode<>'invite') or public.has_registration(id));
create policy walks_create on public.walks for insert to authenticated with check(public.is_admin());
create policy walks_edit on public.walks for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy walks_delete on public.walks for delete to authenticated using(public.is_admin());
alter table public.walk_private_details enable row level security;
create policy location_read on public.walk_private_details for select to authenticated using(public.is_admin() or public.has_registration(walk_id,true));
create policy location_create on public.walk_private_details for insert to authenticated with check(public.is_admin());
create policy location_edit on public.walk_private_details for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy location_delete on public.walk_private_details for delete to authenticated using(public.is_admin());
alter table public.walk_registrations enable row level security;
create policy registration_read on public.walk_registrations for select to authenticated using(public.is_admin() or public.owns_dog(dog_id));
-- All registration writes use narrowly authorized transactional RPCs, no direct API DML.
alter table public.audit_events enable row level security;
create policy audit_read on public.audit_events for select to authenticated using(public.is_admin());
revoke all on all tables in schema public from anon,authenticated;
grant select on public.profiles,public.user_roles,public.dogs,public.dog_behavior_profiles,public.dog_notes,public.walks,public.walk_private_details,public.walk_registrations,public.audit_events to authenticated;
grant update(full_name,phone,area) on public.profiles to authenticated;
grant insert(guardian_id,name,birth_date,approximate_age,breed,sex,weight_kg,color,avatar_path) on public.dogs to authenticated;
grant update(name,birth_date,approximate_age,breed,sex,weight_kg,color,avatar_path) on public.dogs to authenticated;
grant insert,update on public.dog_behavior_profiles to authenticated;
grant insert on public.dog_notes to authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.is_admin(), public.owns_dog(uuid),public.has_registration(uuid,boolean) to authenticated;
