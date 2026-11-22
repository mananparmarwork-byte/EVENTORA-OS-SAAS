-- =====================================================================================
-- 14 - CUSTOM PLANS: the software owner can create, edit, switch off and delete plans
--      from the app (All businesses -> Plans & prices). Run this ONCE in Supabase -> SQL Editor,
--      AFTER 13-purchase-onboarding.sql. Safe to run again.
-- =====================================================================================

-- 1) plans are no longer limited to monthly / quarterly / yearly
do $$
declare r record;
begin
  for r in
    select c.conname, cl.relname
      from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname = 'public' and cl.relname in ('plans', 'subscriptions', 'purchases') and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%monthly%'
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
  end loop;
end $$;

alter table public.plans add column if not exists name text;
alter table public.plans add column if not exists months integer not null default 1;
alter table public.plans add column if not exists description text not null default '';
alter table public.plans add column if not exists features text[] not null default '{}';
alter table public.plans add column if not exists popular boolean not null default false;
alter table public.plans add column if not exists sort_order integer not null default 100;

update public.plans set
  name = coalesce(name, initcap(period)),
  months = case period when 'quarterly' then 3 when 'yearly' then 12 else months end,
  sort_order = case period when 'monthly' then 1 when 'quarterly' then 2 when 'yearly' then 3 else sort_order end,
  popular = case when period = 'quarterly' and not exists (select 1 from public.plans where popular) then true else popular end
where name is null;
alter table public.plans alter column name set not null;
alter table public.plans alter column name set default 'Plan';   -- lets the older setup files be re-run safely

alter table public.plans drop constraint if exists plans_key_format;
alter table public.plans add constraint plans_key_format check (period ~ '^[a-z0-9][a-z0-9-]{1,29}$');
alter table public.plans drop constraint if exists plans_months_range;
alter table public.plans add constraint plans_months_range check (months between 1 and 36);

-- 2) how long one payment lasts now comes from the plan itself
create or replace function public._months(p text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select months from public.plans where period = p), case p when 'yearly' then 12 when 'quarterly' then 3 else 1 end);
$$;
revoke all on function public._months(text) from public, anon, authenticated;

-- 3) what the website / Billing page show
create or replace function public.get_plans()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'period', period, 'name', name, 'months', months, 'price', price_paise / 100.0, 'active', active,
           'popular', popular, 'description', description, 'features', to_jsonb(features), 'sort', sort_order)
         order by sort_order, months, price_paise), '[]'::jsonb) from public.plans;
$$;
revoke all on function public.get_plans() from public;
grant execute on function public.get_plans() to anon, authenticated;

-- 4) software owner: create or change a plan
create or replace function public.platform_upsert_plan(
  p_key text, p_name text, p_months integer, p_price_paise integer, p_description text,
  p_features text[], p_popular boolean, p_active boolean, p_sort integer)
returns void language plpgsql security definer set search_path = public as $$
declare k text := lower(btrim(coalesce(p_key, ''))); old public.plans; feats text[];
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if k !~ '^[a-z0-9][a-z0-9-]{1,29}$' then raise exception 'The plan code must be 2 to 30 letters, numbers or dashes.'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 or length(p_name) > 40 then raise exception 'Give the plan a name (2 to 40 characters).'; end if;
  if p_months is null or p_months < 1 or p_months > 36 then raise exception 'Duration must be between 1 and 36 months.'; end if;
  if p_price_paise is null or p_price_paise < 100 then raise exception 'The price must be at least Rs 1.'; end if;
  select coalesce(array_agg(left(btrim(f), 120)) filter (where btrim(f) <> ''), '{}') into feats from unnest(coalesce(p_features, '{}')) f;
  if coalesce(array_length(feats, 1), 0) > 12 then raise exception 'Use at most 12 feature lines.'; end if;

  select * into old from public.plans where period = k;
  if found and old.months <> p_months and (
       exists (select 1 from public.subscriptions where period = k)
    or exists (select 1 from public.purchases where period = k)
    or exists (select 1 from public.razorpay_plan_variants where period = k)) then
    raise exception 'The duration cannot be changed after this plan has been used. Create a new plan instead.';
  end if;
  if not coalesce(p_active, true) and not exists (select 1 from public.plans where active and period <> k) then
    raise exception 'Keep at least one plan switched on, or nobody can buy.';
  end if;

  if coalesce(p_popular, false) then update public.plans set popular = false where period <> k; end if;
  insert into public.plans (period, name, months, price_paise, description, features, popular, active, sort_order, updated_at)
  values (k, btrim(p_name), p_months, p_price_paise, left(coalesce(p_description, ''), 200), feats, coalesce(p_popular, false), coalesce(p_active, true), coalesce(p_sort, 100), now())
  on conflict (period) do update set name = excluded.name, months = excluded.months, price_paise = excluded.price_paise,
    description = excluded.description, features = excluded.features, popular = excluded.popular, active = excluded.active,
    sort_order = excluded.sort_order, updated_at = now();
end $$;

-- 5) software owner: delete a plan nobody has used (otherwise switch it off)
create or replace function public.platform_delete_plan(p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare k text := lower(btrim(coalesce(p_key, '')));
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if not exists (select 1 from public.plans where period = k) then raise exception 'Unknown plan.'; end if;
  if (select count(*) from public.plans) <= 1 then raise exception 'You cannot delete your only plan.'; end if;
  if exists (select 1 from public.subscriptions where period = k)
     or exists (select 1 from public.purchases where period = k)
     or exists (select 1 from public.subscription_payments where period = k)
     or exists (select 1 from public.razorpay_plan_variants where period = k) then
    raise exception 'This plan has already been used, so it cannot be deleted. Switch it off instead.';
  end if;
  if not exists (select 1 from public.plans where active and period <> k) then raise exception 'Keep at least one plan switched on.'; end if;
  delete from public.plans where period = k;
end $$;

revoke all on function public.platform_upsert_plan(text, text, integer, integer, text, text[], boolean, boolean, integer) from public, anon;
revoke all on function public.platform_delete_plan(text) from public, anon;
grant execute on function public.platform_upsert_plan(text, text, integer, integer, text, text[], boolean, boolean, integer) to authenticated;
grant execute on function public.platform_delete_plan(text) to authenticated;

-- 6) the payment-event function now accepts any existing plan code (it only knew the three built-in ones)
create or replace function public.purchase_event(p_sub text, p_email text, p_period text, p_event text, p_end timestamptz, p_payment text, p_amount integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare pr public.purchases; tid uuid; em text := lower(btrim(coalesce(p_email, ''))); first_paid boolean := false;
begin
  select * into pr from public.purchases where provider_subscription_id = p_sub for update;
  if not found then
    if em = '' then return null; end if;
    insert into public.purchases (email, period, provider_subscription_id, status)
    values (em, case when exists (select 1 from public.plans where period = p_period) then p_period else 'monthly' end, p_sub, 'pending') returning * into pr;
  end if;
  tid := coalesce(pr.tenant_id, (select id from public.tenants where owner_email = pr.email));

  if p_event in ('subscription.activated', 'subscription.charged') then
    first_paid := pr.status in ('pending', 'failed');
    update public.purchases set
        status = case when status = 'claimed' or tid is not null then 'claimed' else 'paid' end,
        tenant_id = tid,
        claimed_at = case when tid is not null then coalesce(claimed_at, now()) else claimed_at end,
        paid_at = coalesce(paid_at, now()),
        period_end = coalesce(p_end, period_end),
        payment_id = coalesce(p_payment, payment_id),
        amount_paise = coalesce(p_amount, amount_paise)
      where id = pr.id returning * into pr;
    if first_paid and pr.coupon_code is not null then
      update public.coupons set used_count = used_count + 1 where code = pr.coupon_code;
    end if;
    if tid is not null then
      perform public._apply_purchase(pr, tid);
      if p_payment is not null and p_amount is not null then
        insert into public.subscription_payments (id, tenant_id, amount_paise, period, paid_at)
        values (p_payment, tid, p_amount, pr.period, now()) on conflict (id) do nothing;
      end if;
    end if;
  elsif tid is not null then
    -- other events only matter when this is the subscription the business is currently on
    if p_event in ('subscription.pending', 'subscription.halted') then
      update public.subscriptions set status = 'past_due', updated_at = now() where tenant_id = tid and provider_subscription_id = p_sub;
    elsif p_event = 'subscription.cancelled' then
      update public.subscriptions set status = 'cancelled', autopay = false, current_period_end = coalesce(p_end, current_period_end), updated_at = now()
        where tenant_id = tid and provider_subscription_id = p_sub;
    elsif p_event = 'subscription.completed' then
      update public.subscriptions set status = 'expired', autopay = false, updated_at = now() where tenant_id = tid and provider_subscription_id = p_sub;
    end if;
  end if;
  return tid;
end $$;

revoke all on function public.purchase_event(text, text, text, text, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.purchase_event(text, text, text, text, timestamptz, text, integer) to service_role;

notify pgrst, 'reload schema';

-- check: every line must say OK
select 'plans table has new columns' as check, case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'plans' and column_name in ('name','months','features','popular','sort_order','description')) = 6 then 'OK' else 'MISSING' end
union all select 'platform_upsert_plan exists', case when to_regprocedure('public.platform_upsert_plan(text,text,integer,integer,text,text[],boolean,boolean,integer)') is not null then 'OK' else 'MISSING' end
union all select 'platform_delete_plan exists', case when to_regprocedure('public.platform_delete_plan(text)') is not null then 'OK' else 'MISSING' end
union all select 'at least one active plan', case when exists (select 1 from public.plans where active) then 'OK' else 'NO ACTIVE PLAN' end;
