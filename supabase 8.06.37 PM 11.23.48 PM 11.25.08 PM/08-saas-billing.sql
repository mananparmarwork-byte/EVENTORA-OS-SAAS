-- ============================================================================
-- Eventora OS — SQL file 8: plans, coupons, free trial length, autopay, reminders, payment history.
-- Run AFTER 05 and 06. Safe to run again.
-- ============================================================================

create table if not exists public.platform_settings (key text primary key, data jsonb not null default '{}'::jsonb);
insert into public.platform_settings (key, data) values ('general', '{"trial_days": 14}') on conflict (key) do nothing;

-- One product, three billing periods. Prices live here (in paise: 149900 = Rs 1,499). You change them in the "All businesses" panel.
create table if not exists public.plans (
  period text primary key check (period in ('monthly', 'quarterly', 'yearly')),
  price_paise integer not null check (price_paise >= 100),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.plans (period, price_paise) values ('monthly', 149900), ('quarterly', 399900), ('yearly', 1499900) on conflict (period) do nothing;

-- Razorpay plans are created automatically the first time a price is used and remembered here.
create table if not exists public.razorpay_plan_variants (
  period text not null, amount_paise integer not null, razorpay_plan_id text not null,
  primary key (period, amount_paise)
);

create table if not exists public.coupons (
  code text primary key check (code = upper(code) and length(code) between 3 and 30),
  kind text not null check (kind in ('percent', 'amount', 'free_days')),
  value integer not null check (value > 0),          -- percent (1-100), paise off, or number of free days
  periods text[],                                    -- null = every plan
  max_uses integer,                                  -- null = unlimited
  used_count integer not null default 0,
  valid_until timestamptz,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.coupon_redemptions (
  coupon_code text not null references public.coupons(code) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (coupon_code, tenant_id)
);

create table if not exists public.subscription_payments (
  id text primary key,                               -- Razorpay payment id
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  amount_paise integer not null, period text, paid_at timestamptz not null default now()
);
create index if not exists subscription_payments_tenant_idx on public.subscription_payments (tenant_id, paid_at desc);

create table if not exists public.reminder_log (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null, ref date not null, sent_at timestamptz not null default now(),
  primary key (tenant_id, kind, ref)
);

alter table public.subscriptions add column if not exists autopay boolean not null default false;
alter table public.subscriptions add column if not exists coupon_code text;

alter table public.platform_settings enable row level security;
alter table public.plans enable row level security;
alter table public.razorpay_plan_variants enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.reminder_log enable row level security;
revoke all on public.platform_settings, public.plans, public.razorpay_plan_variants, public.coupons, public.coupon_redemptions, public.subscription_payments, public.reminder_log from anon, authenticated;

-- ---- access rules: trial / plan running? Autopay gets one extra day while the first charge goes through ----
create or replace function public.tenant_writable(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select
      (s.status = 'trialing' and s.trial_ends_at + (case when s.autopay then interval '1 day' else interval '0' end) > now())
      or (s.status = 'active' and (s.current_period_end is null or s.current_period_end > now() - interval '2 days'))
      or (s.status = 'past_due' and s.current_period_end > now() - interval '3 days')
      or (s.status = 'cancelled' and s.current_period_end > now())
    from public.subscriptions s where s.tenant_id = t), false);
$$;

-- ---- signup uses the trial length YOU set ----
create or replace function public.create_tenant(p_name text, p_slug text)
returns text language plpgsql security definer set search_path = public as $$
declare tid uuid; s text := lower(btrim(coalesce(p_slug, ''))); em text := auth.jwt() ->> 'email';
        days integer := coalesce((select (data ->> 'trial_days')::integer from public.platform_settings where key = 'general'), 14);
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then raise exception 'This login already belongs to a business.'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Enter your business name.'; end if;
  if s !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then raise exception 'The web address must be 3 to 40 letters, numbers or hyphens.'; end if;
  if s in ('admin', 'login', 'signup', 'api', 'www', 'app', 't', 'billing', 'platform', 'support', 'help', 'static', 'assets') then raise exception 'That web address is reserved.'; end if;
  if exists (select 1 from public.tenants where slug = s) then raise exception 'That web address is already taken.'; end if;
  insert into public.tenants (name, slug) values (btrim(p_name), s) returning id into tid;
  insert into public.members (user_id, tenant_id, role, email) values (auth.uid(), tid, 'owner', coalesce(em, ''));
  insert into public.subscriptions (tenant_id, status, trial_ends_at) values (tid, 'trialing', now() + make_interval(days => greatest(days, 0)));
  insert into public.app_settings (tenant_id, id, data) values (tid, 'business', jsonb_build_object('name', btrim(p_name)));
  return s;
end $$;

create or replace function public.get_subscription()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', s.status, 'plan', s.plan, 'period', s.period, 'trialEndsAt', s.trial_ends_at,
                            'currentPeriodEnd', s.current_period_end, 'writable', public.tenant_writable(s.tenant_id),
                            'autopay', s.autopay, 'couponCode', s.coupon_code)
  from public.subscriptions s where s.tenant_id = public.my_tenant();
$$;

create or replace function public.public_tenant(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', t.name, 'slug', t.slug, 'active', public.tenant_writable(t.id)) from public.tenants t where t.slug = lower(btrim(coalesce(p_slug, '')));
$$;

-- ---- public: the prices shown on the website ----
create or replace function public.get_plans()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('period', period, 'price', price_paise / 100.0, 'active', active)
         order by case period when 'monthly' then 1 when 'quarterly' then 2 else 3 end), '[]'::jsonb) from public.plans;
$$;
revoke all on function public.get_plans() from public;
grant execute on function public.get_plans() to anon, authenticated;

-- ---- coupons ----
-- Checks a coupon for the signed-in owner. p_period null = do not check the plan (used for free-day coupons).
create or replace function public.check_coupon(p_code text, p_period text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); c public.coupons; base integer; amt integer;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'error', 'Only the owner can use coupons.'); end if;
  select * into c from public.coupons where code = v_code;
  if not found or not c.active or (c.valid_until is not null and c.valid_until < now()) or (c.max_uses is not null and c.used_count >= c.max_uses) then
    return jsonb_build_object('ok', false, 'error', 'This coupon is not valid.');
  end if;
  if exists (select 1 from public.coupon_redemptions r where r.coupon_code = v_code and r.tenant_id = public.my_tenant()) then
    return jsonb_build_object('ok', false, 'error', 'You have already used this coupon.');
  end if;
  if p_period is not null and c.periods is not null and not (p_period = any (c.periods)) then
    return jsonb_build_object('ok', false, 'error', 'This coupon does not apply to the ' || p_period || ' plan.');
  end if;
  if c.kind = 'free_days' then return jsonb_build_object('ok', true, 'kind', c.kind, 'code', v_code, 'days', c.value); end if;
  if p_period is null then return jsonb_build_object('ok', true, 'kind', c.kind, 'code', v_code, 'value', c.value); end if;
  select price_paise into base from public.plans where period = p_period and active;
  if base is null then return jsonb_build_object('ok', false, 'error', 'That plan is not available.'); end if;
  amt := case when c.kind = 'percent' then greatest(100, (base * (100 - least(c.value, 100))) / 100) else greatest(100, base - c.value) end;
  return jsonb_build_object('ok', true, 'kind', c.kind, 'code', v_code, 'value', c.value, 'basePaise', base, 'amountPaise', amt);
end $$;
revoke all on function public.check_coupon(text, text) from public;
grant execute on function public.check_coupon(text, text) to authenticated;

-- What the owner will really pay (used by the checkout function; the amount never comes from the browser).
create or replace function public.checkout_price(p_period text, p_code text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare base integer; r jsonb;
begin
  if not public.is_admin() then raise exception 'Only the owner can manage billing.'; end if;
  if coalesce(btrim(p_code), '') = '' then
    select price_paise into base from public.plans where period = p_period and active;
    if base is null then raise exception 'That plan is not available.'; end if;
    return jsonb_build_object('basePaise', base, 'amountPaise', base);
  end if;
  r := public.check_coupon(p_code, p_period);
  if not (r ->> 'ok')::boolean then raise exception '%', r ->> 'error'; end if;
  if r ->> 'kind' = 'free_days' then raise exception 'This coupon gives free days: use "Redeem" instead.'; end if;
  return r;
end $$;
revoke all on function public.checkout_price(text, text) from public;
grant execute on function public.checkout_price(text, text) to authenticated;

-- Free-day coupon: extends the trial / plan straight away.
create or replace function public.redeem_free_days(p_code text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p_code, ''))); r jsonb; d integer; t uuid := public.my_tenant();
begin
  r := public.check_coupon(v_code, null);
  if not (r ->> 'ok')::boolean then raise exception '%', r ->> 'error'; end if;
  if r ->> 'kind' <> 'free_days' then raise exception 'This coupon is a discount: enter it when you subscribe.'; end if;
  if exists (select 1 from public.subscriptions where tenant_id = t and autopay and status = 'active') then raise exception 'Autopay is on for your plan, so free days cannot be added. Contact support.'; end if;
  d := (r ->> 'days')::integer;
  if (select status from public.subscriptions where tenant_id = t) = 'trialing' then
    update public.subscriptions set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => d), updated_at = now() where tenant_id = t;
  else
    update public.subscriptions set current_period_end = greatest(coalesce(current_period_end, now()), now()) + make_interval(days => d),
      status = case when status in ('expired', 'past_due', 'cancelled') then 'active' else status end, updated_at = now() where tenant_id = t;
  end if;
  insert into public.coupon_redemptions (coupon_code, tenant_id) values (v_code, t);
  update public.coupons set used_count = used_count + 1 where code = v_code;
  return d;
end $$;
revoke all on function public.redeem_free_days(text) from public;
grant execute on function public.redeem_free_days(text) to authenticated;

-- called by the checkout function (server only) once a discounted subscription was created
create or replace function public.apply_coupon_usage(p_tenant uuid, p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_code = '' then return; end if;
  insert into public.coupon_redemptions (coupon_code, tenant_id) values (v_code, p_tenant) on conflict do nothing;
  if found then update public.coupons set used_count = used_count + 1 where code = v_code; end if;
  update public.subscriptions set coupon_code = v_code where tenant_id = p_tenant;
end $$;
revoke all on function public.apply_coupon_usage(uuid, text) from public;
grant execute on function public.apply_coupon_usage(uuid, text) to service_role;

-- ---- reminders (read and marked by the send-reminders function, server only) ----
create or replace function public.due_reminders()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object('tenantId', t.id, 'tenantName', t.name, 'email', o.email, 'status', s.status, 'autopay', s.autopay,
               'endAt', e.end_at, 'days', e.days, 'kind', e.kind, 'ref', e.end_at::date) x
      from public.tenants t
      join public.subscriptions s on s.tenant_id = t.id
      join lateral (select m.email from public.members m where m.tenant_id = t.id and m.role = 'owner' and m.active order by m.created_at limit 1) o on true
      cross join lateral (select case when s.status = 'trialing' then s.trial_ends_at else s.current_period_end end as end_at) ee
      cross join lateral (
        select ee.end_at,
               ceil(extract(epoch from (ee.end_at - now())) / 86400)::integer as days,
               (case when s.status = 'trialing' then 'trial' else 'plan' end) ||
               (case when ee.end_at <= now() then '_ended' else '_' || ceil(extract(epoch from (ee.end_at - now())) / 86400)::integer end) as kind
      ) e
      where ee.end_at is not null and o.email <> ''
        and not (s.status = 'active' and s.autopay and ee.end_at > now())                    -- autopay renews by itself (Razorpay sends its own notice)
        and (ee.end_at between now() - interval '1 day' and now() + interval '7 days')
        and (ee.end_at <= now() or ceil(extract(epoch from (ee.end_at - now())) / 86400)::integer in (7, 3, 1))
        and not exists (select 1 from public.reminder_log r where r.tenant_id = t.id and r.kind = e.kind and r.ref = e.end_at::date)
    ) q), '[]'::jsonb);
end $$;
revoke all on function public.due_reminders() from public;
grant execute on function public.due_reminders() to service_role;

create or replace function public.mark_reminder_sent(p_tenant uuid, p_kind text, p_ref date)
returns void language sql security definer set search_path = public as $$
  insert into public.reminder_log (tenant_id, kind, ref) values (p_tenant, p_kind, p_ref) on conflict do nothing;
$$;
revoke all on function public.mark_reminder_sent(uuid, text, date) from public;
grant execute on function public.mark_reminder_sent(uuid, text, date) to service_role;

-- ---------------------------------------------------- software-owner panel ----
create or replace function public.platform_list_tenants()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'createdAt', t.created_at,
      'ownerEmail', (select m.email from public.members m where m.tenant_id = t.id and m.role = 'owner' limit 1),
      'status', s.status, 'period', s.period, 'trialEndsAt', s.trial_ends_at, 'currentPeriodEnd', s.current_period_end,
      'autopay', coalesce(s.autopay, false), 'couponCode', s.coupon_code,
      'paid', coalesce((select sum(p.amount_paise) from public.subscription_payments p where p.tenant_id = t.id), 0) / 100.0,
      'members', (select count(*) from public.members m where m.tenant_id = t.id),
      'bills', (select count(*) from public.quotes q where q.tenant_id = t.id)) order by t.created_at desc)
    from public.tenants t left join public.subscriptions s on s.tenant_id = t.id), '[]'::jsonb);
end $$;

create or replace function public.platform_get_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object('trialDays', coalesce((select (data ->> 'trial_days')::integer from public.platform_settings where key = 'general'), 14));
end $$;
create or replace function public.platform_save_settings(p_trial_days integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_trial_days < 0 or p_trial_days > 365 then raise exception 'Trial days must be between 0 and 365.'; end if;
  insert into public.platform_settings (key, data) values ('general', jsonb_build_object('trial_days', p_trial_days))
  on conflict (key) do update set data = public.platform_settings.data || jsonb_build_object('trial_days', p_trial_days);
end $$;

create or replace function public.platform_save_plan(p_period text, p_price_paise integer, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_price_paise < 100 then raise exception 'The price must be at least Rs 1.'; end if;
  update public.plans set price_paise = p_price_paise, active = p_active, updated_at = now() where period = p_period;
  if not found then raise exception 'Unknown plan period.'; end if;
end $$;

create or replace function public.platform_list_coupons()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', code, 'kind', kind, 'value', value, 'periods', periods, 'maxUses', max_uses,
    'usedCount', used_count, 'validUntil', valid_until, 'active', active, 'note', note) order by created_at desc) from public.coupons), '[]'::jsonb);
end $$;
create or replace function public.platform_save_coupon(p_code text, p_kind text, p_value integer, p_periods text[], p_max_uses integer, p_valid_until timestamptz, p_active boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if length(v_code) < 3 or v_code !~ '^[A-Z0-9_-]+$' then raise exception 'The code must be 3 to 30 letters or numbers.'; end if;
  if p_kind = 'percent' and (p_value < 1 or p_value > 100) then raise exception 'Percent must be between 1 and 100.'; end if;
  insert into public.coupons (code, kind, value, periods, max_uses, valid_until, active, note)
  values (v_code, p_kind, p_value, nullif(p_periods, '{}'), p_max_uses, p_valid_until, coalesce(p_active, true), coalesce(p_note, ''))
  on conflict (code) do update set kind = excluded.kind, value = excluded.value, periods = excluded.periods, max_uses = excluded.max_uses,
    valid_until = excluded.valid_until, active = excluded.active, note = excluded.note;
end $$;

revoke all on function public.platform_get_settings() from public;
revoke all on function public.platform_save_settings(integer) from public;
revoke all on function public.platform_save_plan(text, integer, boolean) from public;
revoke all on function public.platform_list_coupons() from public;
revoke all on function public.platform_save_coupon(text, text, integer, text[], integer, timestamptz, boolean, text) from public;
grant execute on function public.platform_list_tenants() to authenticated;
grant execute on function public.platform_get_settings() to authenticated;
grant execute on function public.platform_save_settings(integer) to authenticated;
grant execute on function public.platform_save_plan(text, integer, boolean) to authenticated;
grant execute on function public.platform_list_coupons() to authenticated;
grant execute on function public.platform_save_coupon(text, text, integer, text[], integer, timestamptz, boolean, text) to authenticated;

notify pgrst, 'reload schema';
