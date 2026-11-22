-- =====================================================================================
-- 15 - SUPER ADMIN DASHBOARD: analytics, renewals (who renews / who does not), and giving access.
--      Run ONCE in Supabase -> SQL Editor, AFTER 14-custom-plans.sql. Safe to run again.
-- =====================================================================================

alter table public.subscriptions add column if not exists manual_access boolean not null default false;   -- access given by you (free / paid offline)
alter table public.subscriptions add column if not exists access_note text not null default '';           -- your private note about this customer
alter table public.subscriptions add column if not exists access_granted_at timestamptz;

-- when a real payment arrives (Razorpay), the business is no longer "free access"
create or replace function public._clear_manual_access()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.subscriptions set manual_access = false where tenant_id = new.tenant_id and manual_access;
  return new;
end $$;
revoke all on function public._clear_manual_access() from public, anon, authenticated;
drop trigger if exists clear_manual_access_trg on public.subscription_payments;
create trigger clear_manual_access_trg after insert on public.subscription_payments
  for each row execute function public._clear_manual_access();

-- ---------------------------------------------------------------- one row per business ----
-- state: trial | trial_ended | renewing (autopay on) | manual_renew (must pay again) | cancelling (stopped autopay, still running)
--        | past_due (payment failed) | lapsed (paid before, did not renew) | free_access (given by you) | no_plan
create or replace function public.platform_subscription_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((
    with pay as (
      select tenant_id, count(*) as n, sum(amount_paise) as total, max(paid_at) as last_at, min(paid_at) as first_at
        from public.subscription_payments group by tenant_id),
    base as (
      select t.id, t.name, t.slug, t.created_at, s.status, s.period, s.trial_ends_at, s.current_period_end,
             coalesce(s.autopay, false) as autopay, coalesce(s.manual_access, false) as manual, coalesce(s.access_note, '') as note,
             s.coupon_code, coalesce(p.n, 0) as n, coalesce(p.total, 0) as total, p.last_at, p.first_at,
             (select m.email from public.members m where m.tenant_id = t.id and m.role = 'owner' limit 1) as owner_email,
             (select count(*) from public.members m where m.tenant_id = t.id) as members,
             (select count(*) from public.quotes q where q.tenant_id = t.id) as bills,
             case when s.status = 'trialing' then s.trial_ends_at else s.current_period_end end as ends_at
        from public.tenants t left join public.subscriptions s on s.tenant_id = t.id left join pay p on p.tenant_id = t.id),
    st as (
      select b.*, case
          when b.status is null then 'no_plan'
          when b.status = 'trialing' and b.trial_ends_at > now() then 'trial'
          when b.status = 'trialing' then 'trial_ended'
          when b.status = 'active' and (b.current_period_end is null or b.current_period_end > now()) and (b.manual or (b.n = 0 and not b.autopay)) then 'free_access'
          when b.status = 'active' and (b.current_period_end is null or b.current_period_end > now()) and b.autopay then 'renewing'
          when b.status = 'active' and (b.current_period_end is null or b.current_period_end > now()) then 'manual_renew'
          when b.status = 'cancelled' and b.current_period_end > now() then 'cancelling'
          when b.status = 'past_due' and b.current_period_end > now() - interval '3 days' then 'past_due'
          when b.n = 0 then 'trial_ended'
          else 'lapsed' end as state
        from base b)
    select jsonb_agg(jsonb_build_object(
        'id', st.id, 'name', st.name, 'slug', st.slug, 'createdAt', st.created_at, 'ownerEmail', st.owner_email,
        'status', st.status, 'state', st.state, 'period', st.period, 'planName', coalesce(pl.name, st.period),
        'trialEndsAt', st.trial_ends_at, 'currentPeriodEnd', st.current_period_end, 'endsAt', st.ends_at,
        'daysLeft', case when st.ends_at is null then null else floor(extract(epoch from (st.ends_at - now())) / 86400)::int end,
        'autopay', st.autopay, 'manualAccess', st.manual, 'note', st.note, 'couponCode', st.coupon_code,
        'paymentsCount', st.n, 'renewals', greatest(st.n - 1, 0), 'paid', st.total / 100.0,
        'lastPaymentAt', st.last_at, 'firstPaymentAt', st.first_at, 'members', st.members, 'bills', st.bills)
      order by case st.state when 'past_due' then 0 when 'lapsed' then 1 when 'cancelling' then 2 when 'manual_renew' then 3 else 4 end,
               st.ends_at nulls last)
    from st left join public.plans pl on pl.period = st.period), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- the analytics dashboard ----
create or replace function public.platform_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rows jsonb; res jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  rows := public.platform_subscription_overview();
  with r as (
    select * from jsonb_to_recordset(rows) as x(id uuid, name text, state text, "planName" text, "daysLeft" int, autopay boolean,
      "ownerEmail" text, "endsAt" timestamptz, "currentPeriodEnd" timestamptz, "createdAt" timestamptz)),
  months as (select date_trunc('month', now()) - make_interval(months => g) as m from generate_series(11, 0, -1) g),
  mrr as (
    select coalesce(sum(coalesce((select p.amount_paise from public.subscription_payments p where p.tenant_id = s.tenant_id order by p.paid_at desc limit 1), pl.price_paise)
                        / greatest(coalesce(pl.months, 1), 1)::numeric), 0) / 100.0 as v
      from public.subscriptions s left join public.plans pl on pl.period = s.period
     where s.status = 'active' and not s.manual_access and (s.current_period_end is null or s.current_period_end > now())
       and exists (select 1 from public.subscription_payments p where p.tenant_id = s.tenant_id)),
  renewed as (
    select count(distinct p.tenant_id) as n from public.subscription_payments p
     where p.paid_at > now() - interval '90 days'
       and p.paid_at > (select min(q.paid_at) from public.subscription_payments q where q.tenant_id = p.tenant_id)),
  lapsed90 as (select count(*) as n from r where state = 'lapsed' and "currentPeriodEnd" >= now() - interval '90 days')
  select jsonb_build_object(
    'counts', coalesce((select jsonb_object_agg(state, c) from (select state, count(*) c from r group by state) z), '{}'::jsonb),
    'total', (select count(*) from r),
    'mrr', (select v from mrr),
    'revenue', jsonb_build_object(
      'thisMonth', coalesce((select sum(amount_paise) from public.subscription_payments where paid_at >= date_trunc('month', now())), 0) / 100.0,
      'lastMonth', coalesce((select sum(amount_paise) from public.subscription_payments where paid_at >= date_trunc('month', now()) - interval '1 month' and paid_at < date_trunc('month', now())), 0) / 100.0,
      'last30', coalesce((select sum(amount_paise) from public.subscription_payments where paid_at > now() - interval '30 days'), 0) / 100.0,
      'allTime', coalesce((select sum(amount_paise) from public.subscription_payments), 0) / 100.0),
    'renewal', jsonb_build_object('renewed90', (select n from renewed), 'lapsed90', (select n from lapsed90),
      'rate', (select case when (select n from renewed) + (select n from lapsed90) = 0 then null
                           else round(100.0 * (select n from renewed) / ((select n from renewed) + (select n from lapsed90))) end)),
    'series', coalesce((select jsonb_agg(jsonb_build_object(
        'month', to_char(m.m, 'Mon YY'),
        'revenue', coalesce((select sum(amount_paise) from public.subscription_payments p where p.paid_at >= m.m and p.paid_at < m.m + interval '1 month'), 0) / 100.0,
        'signups', (select count(*) from public.tenants t where t.created_at >= m.m and t.created_at < m.m + interval '1 month'),
        'newPaying', (select count(*) from (select tenant_id from public.subscription_payments group by tenant_id having min(paid_at) >= m.m and min(paid_at) < m.m + interval '1 month') f))
      order by m.m) from months m), '[]'::jsonb),
    'planMix', coalesce((select jsonb_agg(jsonb_build_object('name', "planName", 'count', c) order by c desc)
                           from (select "planName", count(*) c from r where state in ('renewing', 'manual_renew', 'past_due', 'cancelling') group by "planName") z), '[]'::jsonb),
    'expiring', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'ownerEmail', "ownerEmail", 'state', state, 'planName', "planName", 'endsAt', "endsAt", 'daysLeft', "daysLeft", 'autopay', autopay) order by "endsAt")
                            from (select * from r where "daysLeft" between 0 and 14 and state in ('renewing', 'manual_renew', 'cancelling', 'trial', 'free_access') order by "endsAt" limit 10) e), '[]'::jsonb),
    'lapsed', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'ownerEmail', "ownerEmail", 'state', state, 'planName', "planName", 'endsAt', "endsAt", 'daysLeft', "daysLeft") order by "endsAt" desc)
                          from (select * from r where state in ('lapsed', 'past_due') order by "endsAt" desc limit 10) l), '[]'::jsonb),
    'recentPayments', coalesce((select jsonb_agg(jsonb_build_object('tenant', name, 'amount', amount_paise / 100.0, 'planName', pname, 'paidAt', paid_at, 'renewal', is_renewal, 'offline', offline) order by paid_at desc)
                          from (select t.name, p.amount_paise, coalesce(pl.name, p.period) as pname, p.paid_at, p.id like 'manual-%' as offline,
                                       p.paid_at > (select min(q.paid_at) from public.subscription_payments q where q.tenant_id = p.tenant_id) as is_renewal
                                  from public.subscription_payments p join public.tenants t on t.id = p.tenant_id left join public.plans pl on pl.period = p.period
                                 order by p.paid_at desc limit 8) rp), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- ---------------------------------------------------------------- giving access / notes / history ----
-- Give a business access until a date. Free (amount 0), or "paid outside Razorpay" (amount > 0, counted in your revenue).
create or replace function public.platform_grant_access(p_tenant uuid, p_period text, p_until timestamptz, p_note text, p_amount_paise integer default 0)
returns void language plpgsql security definer set search_path = public as $$
declare per text;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'Unknown business.'; end if;
  if p_until is null or p_until <= now() then raise exception 'Choose an end date in the future.'; end if;
  if p_until > now() + interval '50 years' then raise exception 'That end date is too far away.'; end if;
  if coalesce(p_amount_paise, 0) < 0 then raise exception 'Amount cannot be negative.'; end if;
  if p_period is not null and p_period <> '' and not exists (select 1 from public.plans where period = p_period) then raise exception 'Unknown plan.'; end if;
  insert into public.subscriptions (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  update public.subscriptions set status = 'active', period = coalesce(nullif(p_period, ''), period), current_period_end = p_until,
         manual_access = true, access_note = left(coalesce(p_note, ''), 300), access_granted_at = now(), updated_at = now()
   where tenant_id = p_tenant returning period into per;
  if coalesce(p_amount_paise, 0) > 0 then
    -- the trigger on this table switches "free access" off, because it is now a paying customer
    insert into public.subscription_payments (id, tenant_id, amount_paise, period) values ('manual-' || gen_random_uuid()::text, p_tenant, p_amount_paise, per);
  end if;
end $$;

create or replace function public.platform_set_note(p_tenant uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  insert into public.subscriptions (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  update public.subscriptions set access_note = left(coalesce(p_note, ''), 300), updated_at = now() where tenant_id = p_tenant;
end $$;

create or replace function public.platform_tenant_payments(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount_paise / 100.0, 'planName', coalesce(pl.name, p.period), 'paidAt', p.paid_at, 'offline', p.id like 'manual-%') order by p.paid_at desc)
                     from public.subscription_payments p left join public.plans pl on pl.period = p.period where p.tenant_id = p_tenant), '[]'::jsonb);
end $$;

revoke all on function public.platform_subscription_overview() from public, anon;
revoke all on function public.platform_dashboard() from public, anon;
revoke all on function public.platform_grant_access(uuid, text, timestamptz, text, integer) from public, anon;
revoke all on function public.platform_set_note(uuid, text) from public, anon;
revoke all on function public.platform_tenant_payments(uuid) from public, anon;
grant execute on function public.platform_subscription_overview() to authenticated;
grant execute on function public.platform_dashboard() to authenticated;
grant execute on function public.platform_grant_access(uuid, text, timestamptz, text, integer) to authenticated;
grant execute on function public.platform_set_note(uuid, text) to authenticated;
grant execute on function public.platform_tenant_payments(uuid) to authenticated;

notify pgrst, 'reload schema';

-- check: every line must say OK
select 'dashboard function exists' as check, case when to_regprocedure('public.platform_dashboard()') is not null then 'OK' else 'MISSING' end
union all select 'subscription overview exists', case when to_regprocedure('public.platform_subscription_overview()') is not null then 'OK' else 'MISSING' end
union all select 'grant access exists', case when to_regprocedure('public.platform_grant_access(uuid,text,timestamptz,text,integer)') is not null then 'OK' else 'MISSING' end
union all select 'new columns exist', case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'subscriptions' and column_name in ('manual_access', 'access_note', 'access_granted_at')) = 3 then 'OK' else 'MISSING' end;
