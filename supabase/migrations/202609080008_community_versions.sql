-- Optimistic concurrency needs a new version on EVERY write. now() is fixed
-- for the whole transaction and may also collide across fast transactions.
-- Keep this correction local to the two community records that compare versions.
create function public.touch_community_updated_at()
returns trigger language plpgsql set search_path='' as $$
begin
  new.updated_at=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  return new;
end $$;

drop trigger psiutki_profile_updated on public.psiutki_profiles;
create trigger psiutki_profile_updated before update on public.psiutki_profiles
  for each row execute function public.touch_community_updated_at();

drop trigger psiutki_interest_updated on public.psiutki_interests;
create trigger psiutki_interest_updated before update on public.psiutki_interests
  for each row execute function public.touch_community_updated_at();

revoke execute on function public.touch_community_updated_at() from public,anon,authenticated;
