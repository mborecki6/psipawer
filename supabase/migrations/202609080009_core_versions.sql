-- now() is the transaction start time, so repeated writes could keep a stale
-- version valid. Existing profiles/dogs/walks/behavior triggers and privileges
-- are preserved; every row update receives a strictly increasing timestamp.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path='' as $$
begin
  new.updated_at=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  return new;
end $$;
