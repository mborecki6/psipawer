-- A lost response can be retried safely, without changing existing advice.
-- A retry must match the last committed change AND its original author.
-- Keep the existing RPC signature/return type and update existing rows only
-- through explicit saves; this migration does not rewrite library contents.
create or replace function public.save_care_template(
  p_id uuid,p_expected_version integer,p_title text,p_body text
)
returns void language plpgsql security definer set search_path='' as $$
declare t public.care_templates;
begin
  if not public.is_admin() then raise exception 'Brak uprawnień.'; end if;
  if p_id is null or p_expected_version is null or
     p_expected_version<0 or p_expected_version>=2147483647 then
    raise exception 'Nieprawidłowa wersja materiału.';
  end if;
  if p_title is null or length(trim(p_title)) not between 3 and 160 or
     p_body is null or length(trim(p_body)) not between 3 and 20000 then
    raise exception 'Podaj tytuł i treść materiału.';
  end if;

  if p_expected_version=0 then
    insert into public.care_templates(id,practice_id,title,body,updated_by)
      values(p_id,'00000000-0000-4000-8000-000000000001',trim(p_title),trim(p_body),auth.uid())
      on conflict(id) do nothing;
    if not found then
      select * into t from public.care_templates where id=p_id for update;
      if found and t.version=1 and t.updated_by=auth.uid() and
         t.title=trim(p_title) and t.body=trim(p_body) then
        return;
      end if;
      raise exception 'Materiał zmienił się. Odśwież widok przed edycją.';
    end if;
  else
    select * into t from public.care_templates where id=p_id for update;
    if not found then
      raise exception 'Materiał zmienił się. Odśwież widok przed edycją.';
    end if;
    if t.version=p_expected_version+1 and t.updated_by=auth.uid() and
       t.title=trim(p_title) and t.body=trim(p_body) then
      return;
    end if;
    if t.version<>p_expected_version then
      raise exception 'Materiał zmienił się. Odśwież widok przed edycją.';
    end if;
    update public.care_templates set title=trim(p_title),body=trim(p_body),
      version=version+1,updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=p_id;
  end if;
  insert into public.audit_events(actor_id,event,entity_id)
    values(auth.uid(),'care_template_saved',p_id);
end $$;

revoke all on function public.save_care_template(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.save_care_template(uuid,integer,text,text) to authenticated;
