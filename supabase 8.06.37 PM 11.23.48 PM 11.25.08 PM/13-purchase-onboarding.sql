-- ============================================================================
-- Eventora OS — SQL file 13: BUY FIRST, then the admin + business are created automatically at the first login.
-- Run AFTER 05, 06, 08 and 11. Safe to run again. Nothing is deleted or reset.
--
--  1. A person pays on the website (no account needed yet). The payment is remembered against their EMAIL.
--  2. At their first sign-in (after they confirmed that email) the database automatically creates
--     their business and makes them its owner (admin). No form to fill in at that moment.
--  3. Renewing later with the SAME admin email never creates a new business: the old business is
--     found by that email, the plan is extended and the person is attached to it again.
--     Bills, catalog, settings, employees and activity are all still there.
--  4. One admin email = one business, forever (unique index on tenants.owner_email).
-- ============================================================================

do $$
begin
  if to_regprocedure('public.my_tenant()') is null or to_regclass('public.subscriptions') is null
     or to_regprocedure('public.get_plans()') is null or to_regprocedure('public._aal_ok()') is null then
    raise exception 'Run 05, 06, 08 and 11 first. Nothing was changed.';
  end if;
end $$;

-- ---- 1) every business remembers its admin email (this is how a renewal finds the old data again) ----
alter table public.tenants add column if not exists owner_email text;
update public.tenants t set owner_email = lower(m.email)
  from public.members m
  where m.tenant_id = t.id and m.role = 'owner' and m.email <> '' and t.owner_email is null;
create unique index if not exists tenants_owner_email_uq on public.tenants (owner_email) where owner_email is not null;

-- ---- 2) purchases: "this email paid for this plan" (written by the payment webhook, never by the browser) ----
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),     -- the secret link of the "thank you" page
  email text not null,                               -- lower case; the admin email
  period text not null check (period in ('monthly', 'quarterly', 'yearly')),
  amount_paise integer,
  coupon_code text,
  business_name text,                                -- typed on the thank-you page, used when the business is created
  provider_subscription_id text unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'claimed', 'failed')),
                                                     -- pending = not paid yet · paid = paid, nobody signed in yet · claimed = attached to a business
  period_end timestamptz,
  payment_id text,
  paid_at timestamptz,
  tenant_id uuid references public.tenants(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists purchases_email_idx on public.purchases (email, created_at desc);
alter table public.purchases enable row level security;
revoke all on public.purchases from anon, authenticated;

create or replace function public._months(p text)
returns integer language sql immutable as $$ select case p when 'yearly' then 12 when 'quarterly' then 3 else 1 end; $$;
revoke all on function public._months(text) from public, anon, authenticated;

-- ---- 3) put one purchase onto a business (internal helper) ----
create or replace function public._apply_purchase(pr public.purchases, tid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.subscriptions set
      status = 'active', autopay = true, provider = 'razorpay',
      provider_subscription_id = coalesce(pr.provider_subscription_id, provider_subscription_id),
      period = pr.period,
      current_period_end = coalesce(pr.period_end, now() + make_interval(months => public._months(pr.period))),
      coupon_code = coalesce(pr.coupon_code, coupon_code),
      updated_at = now()
    where tenant_id = tid;
  if not found then
    insert into public.subscriptions (tenant_id, status, period, autopay, provider, provider_subscription_id, current_period_end, coupon_code)
    values (tid, 'active', pr.period, true, 'razorpay', pr.provider_subscription_id,
            coalesce(pr.period_end, now() + make_interval(months => public._months(pr.period))), pr.coupon_code);
  end if;
  if pr.payment_id is not null and coalesce(pr.amount_paise, 0) > 0 then
    insert into public.subscription_payments (id, tenant_id, amount_paise, period, paid_at)
    values (pr.payment_id, tid, pr.amount_paise, pr.period, coalesce(pr.paid_at, now())) on conflict (id) do nothing;
  end if;
  if pr.coupon_code is not null then
    insert into public.coupon_redemptions (coupon_code, tenant_id) values (pr.coupon_code, tid) on conflict do nothing;
  end if;
  update public.purchases set status = 'claimed', tenant_id = tid, claimed_at = coalesce(claimed_at, now()) where id = pr.id;
end $$;
revoke all on function public._apply_purchase(public.purchases, uuid) from public, anon, authenticated;

-- ---- 4) payment events from Razorpay (called by the webhook with the server key only) ----
-- If the business already exists (a RENEWAL with the same admin email) it is updated straight away, even before anybody signs in.
create or replace function public.purchase_event(p_sub text, p_email text, p_period text, p_event text, p_end timestamptz, p_payment text, p_amount integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare pr public.purchases; tid uuid; em text := lower(btrim(coalesce(p_email, ''))); first_paid boolean := false;
begin
  select * into pr from public.purchases where provider_subscription_id = p_sub for update;
  if not found then
    if em = '' then return null; end if;
    insert into public.purchases (email, period, provider_subscription_id, status)
    values (em, case when p_period in ('monthly', 'quarterly', 'yearly') then p_period else 'monthly' end, p_sub, 'pending') returning * into pr;
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

-- ---- 5) may this email buy right now? (stops double charging and losing days by renewing too early) ----
create or replace function public.purchase_precheck(p_email text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.subscriptions; em text := lower(btrim(coalesce(p_email, '')));
begin
  select s2.* into s from public.subscriptions s2 join public.tenants t on t.id = s2.tenant_id where t.owner_email = em;
  if not found then return jsonb_build_object('blocked', false); end if;
  if s.status = 'active' and s.autopay and coalesce(s.current_period_end, now()) > now() then
    return jsonb_build_object('blocked', true, 'reason', 'This email already has a plan with autopay switched on. Sign in: it renews by itself, and Billing lets you change it.');
  end if;
  if s.status in ('active', 'cancelled') and s.current_period_end > now() + interval '3 days' then
    return jsonb_build_object('blocked', true, 'reason', 'Your plan is already paid until ' || to_char(s.current_period_end at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '. You can renew in the last 3 days, or sign in and use Billing.');
  end if;
  if s.status = 'trialing' and s.trial_ends_at > now() + interval '3 days' then
    return jsonb_build_object('blocked', true, 'reason', 'Your free trial runs until ' || to_char(s.trial_ends_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '. Sign in and subscribe from Billing: you are not charged until the trial ends.');
  end if;
  return jsonb_build_object('blocked', false);
end $$;
revoke all on function public.purchase_precheck(text) from public, anon, authenticated;
grant execute on function public.purchase_precheck(text) to service_role;

-- ---- 6) the price for a visitor who is not signed in (the amount never comes from the browser) ----
create or replace function public.purchase_price(p_email text, p_period text, p_code text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare base integer; c public.coupons; amt integer; v_code text := upper(btrim(coalesce(p_code, ''))); em text := lower(btrim(coalesce(p_email, '')));
begin
  select price_paise into base from public.plans where period = p_period and active;
  if base is null then raise exception 'That plan is not available.'; end if;
  if v_code = '' then return jsonb_build_object('basePaise', base, 'amountPaise', base, 'code', null); end if;
  select * into c from public.coupons where code = v_code;
  if not found or not c.active or (c.valid_until is not null and c.valid_until < now()) or (c.max_uses is not null and c.used_count >= c.max_uses) then
    raise exception 'This coupon is not valid.';
  end if;
  if c.periods is not null and not (p_period = any (c.periods)) then raise exception 'This coupon does not apply to the % plan.', p_period; end if;
  if c.kind = 'free_days' then raise exception 'This coupon gives free days. Use it after you sign in (Billing).'; end if;
  if exists (select 1 from public.purchases where email = em and coupon_code = v_code and status in ('paid', 'claimed'))
     or exists (select 1 from public.coupon_redemptions r join public.tenants t on t.id = r.tenant_id where t.owner_email = em and r.coupon_code = v_code) then
    raise exception 'You have already used this coupon.';
  end if;
  amt := case when c.kind = 'percent' then greatest(100, (base * (100 - least(c.value, 100))) / 100) else greatest(100, base - c.value) end;
  return jsonb_build_object('basePaise', base, 'amountPaise', amt, 'code', v_code);
end $$;
revoke all on function public.purchase_price(text, text, text) from public, anon, authenticated;
grant execute on function public.purchase_price(text, text, text) to service_role;

-- ---- 7) the "thank you" page asks: has this payment arrived? (the purchase id in the link is the secret) ----
create or replace function public.purchase_status(p_id uuid default null, p_email text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare pr public.purchases; t public.tenants; em text;
begin
  if p_id is not null then
    select * into pr from public.purchases where id = p_id;
  elsif p_email is not null and btrim(p_email) <> '' then
    select * into pr from public.purchases where email = lower(btrim(p_email)) and status in ('paid', 'claimed') order by paid_at desc nulls last limit 1;
  end if;
  if pr.id is null then return jsonb_build_object('found', false); end if;
  em := pr.email;
  select * into t from public.tenants where owner_email = em;
  return jsonb_build_object('found', true, 'status', pr.status, 'period', pr.period,
    'email', case when p_id is not null then em end,
    'amountPaise', case when p_id is not null then pr.amount_paise end,
    'periodEnd', pr.period_end,
    'hasAccount', exists (select 1 from auth.users u where lower(u.email) = em),
    'hasWorkspace', t.id is not null,
    'workspaceName', case when p_id is not null then t.name end,
    'businessName', case when p_id is not null then pr.business_name end);
end $$;
revoke all on function public.purchase_status(uuid, text) from public;
grant execute on function public.purchase_status(uuid, text) to anon, authenticated;

-- the business name typed on the thank-you page (only while the purchase is not attached to a business yet)
create or replace function public.save_purchase_profile(p_id uuid, p_business_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.purchases set business_name = nullif(left(btrim(coalesce(p_business_name, '')), 80), '')
    where id = p_id and status in ('pending', 'paid');
end $$;
revoke all on function public.save_purchase_profile(uuid, text) from public;
grant execute on function public.save_purchase_profile(uuid, text) to anon, authenticated;

-- ---- 8) THE AUTO-ADMIN STEP: runs by itself at the first sign-in ----
-- Same admin email already has a business  -> attach the person to it again (all old data is untouched) and extend the plan.
-- No business yet                            -> create it, make the person its owner, start the plan.
create or replace function public.claim_purchase()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); em text; confirmed boolean; mt uuid; mr text; tid uuid; t public.tenants; pr public.purchases;
        nm text; base text; s text; tries integer := 0; reconnected boolean := false;
begin
  if uid is null then raise exception 'Please sign in first.'; end if;
  select lower(u.email), (u.email_confirmed_at is not null) into em, confirmed from auth.users u where u.id = uid;
  if not coalesce(confirmed, false) then raise exception 'Please confirm your email first (open the link we sent you), then sign in again.'; end if;

  select tenant_id, role into mt, mr from public.members where user_id = uid;
  if found then
    if mr <> 'owner' then return jsonb_build_object('ok', true, 'already', true); end if;
    tid := mt;
  else
    select * into pr from public.purchases where email = em and status in ('paid', 'claimed') order by paid_at desc nulls last limit 1;
    if not found then raise exception 'No paid plan was found for % . Use the email you paid with.', em; end if;
    select * into t from public.tenants where owner_email = em;
    if found then
      tid := t.id; reconnected := true;
      insert into public.members (user_id, tenant_id, role, email, active) values (uid, tid, 'owner', em, true)
        on conflict (user_id) do update set tenant_id = excluded.tenant_id, role = 'owner', active = true, email = excluded.email;
    else
      nm := btrim(coalesce(nullif(pr.business_name, ''), initcap(split_part(em, '@', 1))));
      base := left(trim(both '-' from regexp_replace(lower(nm), '[^a-z0-9]+', '-', 'g')), 30);
      base := trim(both '-' from base);
      if length(base) < 3 or base in ('admin', 'login', 'signup', 'api', 'www', 'app', 't', 'billing', 'platform', 'support', 'help', 'static', 'assets', 'buy', 'welcome') then base := 'business'; end if;
      s := base;
      while exists (select 1 from public.tenants where slug = s) loop
        tries := tries + 1;
        s := base || '-' || (1000 + floor(random() * 9000))::integer;
        exit when tries > 30;
      end loop;
      insert into public.tenants (name, slug, owner_email) values (nm, s, em) returning id into tid;
      insert into public.members (user_id, tenant_id, role, email, active) values (uid, tid, 'owner', em, true);
      insert into public.app_settings (tenant_id, id, data) values (tid, 'business', jsonb_build_object('name', nm)) on conflict do nothing;
    end if;
  end if;

  -- put every paid, not-yet-attached purchase of this email onto the business
  for pr in select * from public.purchases where email = em and status = 'paid' order by paid_at nulls last loop
    perform public._apply_purchase(pr, tid);
  end loop;

  select * into t from public.tenants where id = tid;
  return jsonb_build_object('ok', true, 'reconnected', reconnected, 'slug', t.slug, 'name', t.name);
end $$;
revoke all on function public.claim_purchase() from public, anon;
grant execute on function public.claim_purchase() to authenticated;

-- ---- 9) the old "free trial" signup now follows the same rule: same admin email = same business ----
create or replace function public.create_tenant(p_name text, p_slug text)
returns text language plpgsql security definer set search_path = public as $$
declare tid uuid; prev public.tenants; s text := lower(btrim(coalesce(p_slug, ''))); em text := lower(auth.jwt() ->> 'email');
        days integer := coalesce((select (data ->> 'trial_days')::integer from public.platform_settings where key = 'general'), 14);
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then raise exception 'This login already belongs to a business.'; end if;
  select * into prev from public.tenants where owner_email = em;
  if found then
    if not exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null) then
      raise exception 'Please confirm your email first, then sign in again.';
    end if;
    insert into public.members (user_id, tenant_id, role, email, active) values (auth.uid(), prev.id, 'owner', em, true)
      on conflict (user_id) do update set tenant_id = excluded.tenant_id, role = 'owner', active = true;
    return prev.slug;
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Enter your business name.'; end if;
  if s !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then raise exception 'The web address must be 3 to 40 letters, numbers or hyphens.'; end if;
  if s in ('admin', 'login', 'signup', 'api', 'www', 'app', 't', 'billing', 'platform', 'support', 'help', 'static', 'assets', 'buy', 'welcome') then raise exception 'That web address is reserved.'; end if;
  if exists (select 1 from public.tenants where slug = s) then raise exception 'That web address is already taken.'; end if;
  insert into public.tenants (name, slug, owner_email) values (btrim(p_name), s, nullif(em, '')) returning id into tid;
  insert into public.members (user_id, tenant_id, role, email) values (auth.uid(), tid, 'owner', coalesce(em, ''));
  insert into public.subscriptions (tenant_id, status, trial_ends_at) values (tid, 'trialing', now() + make_interval(days => greatest(days, 0)));
  insert into public.app_settings (tenant_id, id, data) values (tid, 'business', jsonb_build_object('name', btrim(p_name)));
  return s;
end $$;

notify pgrst, 'reload schema';
