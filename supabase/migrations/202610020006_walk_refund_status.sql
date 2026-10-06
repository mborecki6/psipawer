-- Preserve a recorded refund when a later attendance/booking correction releases
-- the charge. Receipt history determines settlement regardless of lock order.
create or replace function public.reconcile_registration_cash() returns trigger
language plpgsql security definer set search_path='' as $$
declare walk public.walks; received bigint; has_refund boolean;
  chargeable boolean; desired public.payment_status;
begin
  if new.package_id is not null then return new; end if;
  select * into walk from public.walks where id=new.walk_id;
  select coalesce(sum(amount_cents) filter(where status='paid'),0),
    coalesce(bool_or(status='refunded'),false) into received,has_refund
    from public.payments where registration_id=new.id;
  chargeable=walk.status<>'cancelled' and
    (new.status='cancelled_late' or (new.status='accepted' and new.attendance<>'absent'));
  if received>0 then
    desired=case when not chargeable or received>=walk.price_cents
      then 'paid'::public.payment_status else 'due'::public.payment_status end;
  elsif chargeable then
    -- Legacy receipts without ledger rows still need separate review. A modern
    -- refunded receipt never pays a reinstated charge.
    desired=case when new.payment_status='paid' then 'paid'::public.payment_status
      else 'due'::public.payment_status end;
  else
    desired=case when has_refund then 'refunded'::public.payment_status
      when new.payment_status in ('paid','refunded') then new.payment_status
      else 'none'::public.payment_status end;
  end if;
  update public.walk_registrations set payment_status=desired
    where id=new.id and payment_status is distinct from desired;
  return new;
end $$;

-- Normalize only released cash charges backed by actual refund records and no
-- retained paid receipt. Do not rewrite receipts, amounts, history or packages.
update public.walk_registrations r set payment_status='refunded'
from public.walks w
where r.walk_id=w.id and r.package_id is null and r.payment_status<>'refunded'
  and (w.status='cancelled' or r.status not in ('accepted','cancelled_late') or
    (r.status='accepted' and r.attendance='absent'))
  and exists(select 1 from public.payments p where p.registration_id=r.id and p.status='refunded')
  and not exists(select 1 from public.payments p where p.registration_id=r.id and p.status='paid');
