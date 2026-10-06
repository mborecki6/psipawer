-- Same single-practice authorization, evaluated as per-statement sets. Avoid
-- re-querying the role and owned dog for every row in a large history. These
-- policies change SELECT only; mutation grants/RPCs and private locations stay
-- unchanged. The nested dog/registration/package reads retain their own RLS.
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using(id=(select auth.uid()) or (select public.is_admin()));
drop policy roles_read on public.user_roles;
create policy roles_read on public.user_roles for select to authenticated
  using(user_id=(select auth.uid()) or (select public.is_admin()));
drop policy dogs_read on public.dogs;
create policy dogs_read on public.dogs for select to authenticated
  using(guardian_id=(select auth.uid()) or (select public.is_admin()));
drop policy registration_read on public.walk_registrations;
create policy registration_read on public.walk_registrations for select to authenticated
  using((select public.is_admin()) or dog_id in
    (select d.id from public.dogs d where d.guardian_id=(select auth.uid())));
drop policy walks_read on public.walks;
create policy walks_read on public.walks for select to authenticated
  using((select public.is_admin()) or
    (status in ('open','full') and booking_mode<>'invite') or
    id in (select r.walk_id from public.walk_registrations r));
create index registration_dog_walk on public.walk_registrations(dog_id,walk_id);

drop policy notes_read on public.dog_notes;
create policy notes_read on public.dog_notes for select to authenticated
  using((select public.is_admin()) or (visibility='client_visible' and dog_id in
    (select d.id from public.dogs d where d.guardian_id=(select auth.uid()))));
drop policy packages_read on public.packages;
create policy packages_read on public.packages for select to authenticated
  using((select public.is_admin()) or dog_id in
    (select d.id from public.dogs d where d.guardian_id=(select auth.uid())));
drop policy transactions_read on public.package_transactions;
create policy transactions_read on public.package_transactions for select to authenticated
  using((select public.is_admin()) or package_id in
    (select p.id from public.packages p where p.dog_id in
      (select d.id from public.dogs d where d.guardian_id=(select auth.uid()))));
drop policy payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using((select public.is_admin()) or guardian_id=(select auth.uid()));

drop policy consultations_read on public.consultations;
create policy consultations_read on public.consultations for select to authenticated
  using((select public.is_admin()) or dog_id in
    (select d.id from public.dogs d where d.guardian_id=(select auth.uid())));
drop policy care_plan_read on public.care_plan_versions;
create policy care_plan_read on public.care_plan_versions for select to authenticated
  using((select public.is_admin()) or dog_id in
    (select d.id from public.dogs d where d.guardian_id=(select auth.uid())));
drop policy care_progress_read on public.care_progress;
create policy care_progress_read on public.care_progress for select to authenticated
  using((select public.is_admin()) or (author_id=(select auth.uid()) and dog_id in
    (select d.id from public.dogs d where d.guardian_id=(select auth.uid()))));
drop policy follow_ups_read on public.care_follow_ups;
create policy follow_ups_read on public.care_follow_ups for select to authenticated
  using((select public.is_admin()) or dog_id in
    (select d.id from public.dogs d where d.guardian_id=(select auth.uid())));
