-- =====================================================================================
-- EVENTORA: ALL SaaS + PLANS + SUPER ADMIN DASHBOARD SETUP IN ONE FILE
-- Paste this WHOLE file into Supabase -> SQL Editor -> New query, then click Run (once).
-- It runs 05, 06, 08, 11, 13, 14 and 15 (and the later files, up to 23: enquiry link + drafts) in the right order. The last result must show only OK.
-- If anything fails, NOTHING is changed: send me the red error text.
-- Already ran an older version of this file? Run it again, it is safe.
-- =====================================================================================


-- ------------------------------ 05-saas-tables ------------------------------
-- ============================================================================
-- Eventora OS — SQL file 5: multi-tenant (SaaS) tables.
-- Run AFTER 01-04. Safe to run again. Your existing bills/settings become the FIRST business ("eventora").
-- ============================================================================

-- A business that uses the software (a venue / banquet).
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  created_at timestamptz not null default now()
);

-- Who belongs to which business (owner or employee). One login = one business.
create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists members_tenant_idx on public.members (tenant_id);

-- The plan each business pays for.
create table if not exists public.subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan text not null default 'pro',
  period text not null default 'monthly' check (period in ('monthly', 'quarterly', 'yearly')),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  provider text,
  provider_subscription_id text,
  updated_at timestamptz not null default now()
);

-- You (the software owner): can see and manage every business.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ---- move the existing single-business data into the first business ---------
do $$
declare tid uuid;
begin
  if not exists (select 1 from public.tenants) and exists (select 1 from public.admin_users) then
    insert into public.tenants (name, slug)
    values (coalesce((select data ->> 'name' from public.app_settings where id = 'business'), 'Eventora'), 'eventora')
    returning id into tid;
    insert into public.members (user_id, tenant_id, role, email)
      select a.user_id, tid, 'owner', u.email from public.admin_users a join auth.users u on u.id = a.user_id on conflict do nothing;
    insert into public.members (user_id, tenant_id, role, email, active)
      select s.user_id, tid, 'staff', s.email, s.active from public.staff_users s on conflict do nothing;
    insert into public.subscriptions (tenant_id, status, period, current_period_end)
      values (tid, 'active', 'yearly', now() + interval '100 years');
    insert into public.platform_admins (user_id) select user_id from public.admin_users on conflict do nothing;
  end if;
end $$;

-- ---- every business table now carries its business id -----------------------
alter table public.quotes        add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.catalog       add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.app_settings  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.activity_log  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.bill_counters add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

update public.quotes        set tenant_id = (select id from public.tenants order by created_at limit 1) where tenant_id is null;
update public.catalog       set tenant_id = (select id from public.tenants order by created_at limit 1) where tenant_id is null;
update public.app_settings  set tenant_id = (select id from public.tenants order by created_at limit 1) where tenant_id is null;
update public.activity_log  set tenant_id = (select id from public.tenants order by created_at limit 1) where tenant_id is null;
update public.bill_counters set tenant_id = (select id from public.tenants order by created_at limit 1) where tenant_id is null;

alter table public.quotes        alter column tenant_id set not null;
alter table public.catalog       alter column tenant_id set not null;
alter table public.app_settings  alter column tenant_id set not null;
alter table public.bill_counters alter column tenant_id set not null;

-- bill numbers only have to be unique inside one business
alter table public.quotes drop constraint if exists quotes_reference_key;
create unique index if not exists quotes_tenant_reference_uq on public.quotes (tenant_id, reference);
create index if not exists quotes_tenant_idx on public.quotes (tenant_id, created_at desc);
create index if not exists activity_tenant_idx on public.activity_log (tenant_id, at desc);

-- primary keys that include the business
do $$ begin
  if not exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
                 where i.indrelid = 'public.catalog'::regclass and i.indisprimary and a.attname = 'tenant_id') then
    alter table public.catalog drop constraint catalog_pkey;
    alter table public.catalog add primary key (tenant_id, id);
  end if;
  if not exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
                 where i.indrelid = 'public.app_settings'::regclass and i.indisprimary and a.attname = 'tenant_id') then
    alter table public.app_settings drop constraint app_settings_pkey;
    alter table public.app_settings add primary key (tenant_id, id);
  end if;
  if not exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
                 where i.indrelid = 'public.bill_counters'::regclass and i.indisprimary and a.attname = 'tenant_id') then
    alter table public.bill_counters drop constraint bill_counters_pkey;
    alter table public.bill_counters add primary key (tenant_id, day);
  end if;
end $$;

alter table public.tenants enable row level security;
alter table public.members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.platform_admins enable row level security;

-- ------------------------------ 06-saas-functions-security ------------------------------
-- ============================================================================
-- Eventora OS — SQL file 6: multi-tenant functions + security rules.
-- Run AFTER 05. Safe to run again. Replaces the single-business rules from files 02/03.
-- ============================================================================

-- ------------------------------------------------------------ who is calling --
create or replace function public.my_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.members where user_id = auth.uid() and active limit 1;
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and role = 'owner');
$$;
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and role = 'staff');
$$;
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then 'admin' when public.is_staff() then 'staff' else 'none' end;
$$;

-- Can this business create / change things? (trial running, or paid and not overdue). Otherwise it is read-only.
create or replace function public.tenant_writable(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select
      (s.status = 'trialing' and s.trial_ends_at > now())
      or (s.status = 'active' and (s.current_period_end is null or s.current_period_end > now() - interval '2 days'))
      or (s.status = 'past_due' and s.current_period_end > now() - interval '3 days')
      or (s.status = 'cancelled' and s.current_period_end > now())
    from public.subscriptions s where s.tenant_id = t), false);
$$;
create or replace function public.my_tenant_writable()
returns boolean language sql stable security definer set search_path = public as $$
  select public.tenant_writable(public.my_tenant());
$$;

create or replace function public.staff_can(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (data ->> perm)::boolean from public.app_settings where tenant_id = public.my_tenant() and id = 'permissions'), true);
$$;

-- used inside other functions only
create or replace function public.tenant_by_slug(p_slug text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.tenants where slug = lower(btrim(coalesce(p_slug, '')));
$$;
revoke all on function public.tenant_by_slug(text) from public;

revoke all on function public.my_tenant() from public;
revoke all on function public.is_platform_admin() from public;
revoke all on function public.tenant_writable(uuid) from public;
revoke all on function public.my_tenant_writable() from public;
grant execute on function public.my_tenant() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_platform_admin() to anon, authenticated;
grant execute on function public.my_role() to anon, authenticated;
grant execute on function public.tenant_writable(uuid) to anon, authenticated;
grant execute on function public.my_tenant_writable() to anon, authenticated;
grant execute on function public.staff_can(text) to authenticated;

-- everything the app needs to know about the signed-in person, in one call
create or replace function public.my_context()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('role', public.my_role(), 'tenantId', public.my_tenant(), 'tenantName', t.name, 'slug', t.slug, 'platform', public.is_platform_admin())
  from (select 1) x left join public.tenants t on t.id = public.my_tenant();
$$;
revoke all on function public.my_context() from public;
grant execute on function public.my_context() to authenticated;

-- ------------------------------------------------------------ privileges -----
revoke all on public.catalog, public.app_settings, public.bill_counters, public.subscriptions, public.tenants, public.platform_admins from anon, authenticated;
revoke all on public.quotes, public.activity_log, public.members from anon;
revoke insert on public.quotes from authenticated;
grant select, update, delete on public.quotes to authenticated;
grant select, insert, delete on public.activity_log to authenticated;
revoke all on public.members from authenticated;
grant select on public.members to authenticated;
grant update (active) on public.members to authenticated;

-- ------------------------------------------------------------ policies -------
drop policy if exists "catalog readable" on public.catalog;
drop policy if exists "catalog admin write" on public.catalog;
drop policy if exists "settings readable" on public.app_settings;
drop policy if exists "settings admin insert" on public.app_settings;
drop policy if exists "settings admin update" on public.app_settings;
drop policy if exists "admins manage admin list" on public.admin_users;
drop policy if exists "admins read staff" on public.staff_users;
drop policy if exists "admins update staff" on public.staff_users;

drop policy if exists "team read quotes" on public.quotes;
create policy "team read quotes" on public.quotes for select to authenticated using (tenant_id = public.my_tenant());
drop policy if exists "team update quotes" on public.quotes;
create policy "team update quotes" on public.quotes for update to authenticated
  using (tenant_id = public.my_tenant() and public.tenant_writable(tenant_id))
  with check (tenant_id = public.my_tenant() and public.tenant_writable(tenant_id));
drop policy if exists "team delete quotes" on public.quotes;
create policy "team delete quotes" on public.quotes for delete to authenticated
  using (tenant_id = public.my_tenant() and public.tenant_writable(tenant_id) and (public.is_admin() or public.staff_can('deleteBills')));

drop policy if exists "team add activity" on public.activity_log;
create policy "team add activity" on public.activity_log for insert to authenticated
  with check ((public.is_admin() or public.is_staff()) and public.my_tenant_writable());
drop policy if exists "admins read activity" on public.activity_log;
create policy "admins read activity" on public.activity_log for select to authenticated using (tenant_id = public.my_tenant() and public.is_admin());
drop policy if exists "admins delete activity" on public.activity_log;
create policy "admins delete activity" on public.activity_log for delete to authenticated using (tenant_id = public.my_tenant() and public.is_admin());

drop policy if exists "read own membership" on public.members;
create policy "read own membership" on public.members for select to authenticated
  using (user_id = auth.uid() or (tenant_id = public.my_tenant() and public.is_admin()));
drop policy if exists "owner switches employees" on public.members;
create policy "owner switches employees" on public.members for update to authenticated
  using (tenant_id = public.my_tenant() and public.is_admin() and role = 'staff')
  with check (tenant_id = public.my_tenant() and public.is_admin() and role = 'staff');

-- who did it / when / which business: always filled in by the database
create or replace function public.activity_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.at := now();
  if auth.uid() is null then new.actor_email := null; new.actor_role := 'public';
  else new.actor_email := auth.jwt() ->> 'email'; new.actor_role := public.my_role(); new.tenant_id := public.my_tenant(); end if;
  return new;
end $$;

create or replace function public.enforce_staff_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare keep text[] := array['payments', 'advancePaid', 'advanceAmount', 'balanceDue'];
begin
  if new.tenant_id is distinct from old.tenant_id then raise exception 'A bill cannot move to another business.'; end if;
  if public.is_admin() then return new; end if;
  if not public.is_staff() then raise exception 'You do not have access.'; end if;
  if new.reference is distinct from old.reference then raise exception 'The bill number cannot be changed.'; end if;
  if new.status is distinct from old.status and not public.staff_can('markBooked') then
    raise exception 'Employees are not allowed to mark bills as booked or release them.';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(old.pricing -> 'payments', '[]'::jsonb)) o
             where not exists (select 1 from jsonb_array_elements(coalesce(new.pricing -> 'payments', '[]'::jsonb)) n where n ->> 'id' = o ->> 'id'))
     and not public.staff_can('removePayments') then
    raise exception 'Employees are not allowed to remove payments.';
  end if;
  if (new.customer_name, new.mobile, new.event_type, new.event_date, new.guests, new.customer_gst_number, new.hall, new.services, new.pricing - keep)
     is distinct from
     (old.customer_name, old.mobile, old.event_type, old.event_date, old.guests, old.customer_gst_number, old.hall, old.services, old.pricing - keep)
     and not public.staff_can('editBills') then
    raise exception 'Employees are not allowed to edit bills.';
  end if;
  return new;
end $$;

-- ------------------------------------------- catalog & settings (via functions) --
-- The app never touches these tables directly; these functions pick the right business.
create or replace function public.get_catalog(p_slug text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select categories from public.catalog where id = 'default' and tenant_id = coalesce(public.my_tenant(), public.tenant_by_slug(p_slug));
$$;
create or replace function public.save_catalog(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the owner can change the catalog.'; end if;
  if not public.my_tenant_writable() then raise exception 'Your subscription has ended. Renew it in Billing to make changes.'; end if;
  insert into public.catalog (tenant_id, id, categories, updated_at) values (public.my_tenant(), 'default', p, now())
  on conflict (tenant_id, id) do update set categories = excluded.categories, updated_at = now();
end $$;

create or replace function public.get_setting(p_key text, p_slug text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.my_tenant(); r text := public.my_role();
begin
  if t is null then
    if p_key <> 'business' then return null; end if;
    t := public.tenant_by_slug(p_slug);
  elsif p_key = 'business' then null;
  elsif p_key in ('payment', 'permissions', 'numbering') and r in ('admin', 'staff') then null;
  elsif r = 'admin' then null;
  else return null; end if;
  return (select data from public.app_settings where tenant_id = t and id = p_key);
end $$;
create or replace function public.save_setting(p_key text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the owner can change settings.'; end if;
  if p_key not in ('business', 'payment', 'permissions', 'numbering', 'activity') then raise exception 'Unknown settings key.'; end if;
  if not public.my_tenant_writable() then raise exception 'Your subscription has ended. Renew it in Billing to make changes.'; end if;
  insert into public.app_settings (tenant_id, id, data, updated_at) values (public.my_tenant(), p_key, p_data, now())
  on conflict (tenant_id, id) do update set data = excluded.data, updated_at = now();
end $$;

-- ------------------------------------------------------------ calendar -------
drop function if exists public.booked_times();
create or replace function public.booked_times(p_slug text default null)
returns table (booked_date date, start_time text, end_time text)
language sql stable security definer set search_path = public as $$
  select d.key::date, d.value ->> 'start', d.value ->> 'end'
  from public.quotes q, lateral jsonb_each(coalesce(q.pricing -> 'eventSlots', '{}'::jsonb)) d
  where q.tenant_id = coalesce(public.my_tenant(), public.tenant_by_slug(p_slug))
    and q.status = 'confirmed'
    and jsonb_typeof(d.value) = 'object'
    and coalesce(d.value ->> 'start', '') ~ '^[0-9]{1,2}:[0-9]{2}$'
    and coalesce(d.value ->> 'end', '') ~ '^[0-9]{1,2}:[0-9]{2}$'
  union all
  select ed::date, '00:00', '24:00'
  from public.quotes q, lateral jsonb_array_elements_text(coalesce(q.pricing -> 'eventDates', to_jsonb(array[q.event_date::text]))) ed
  where q.tenant_id = coalesce(public.my_tenant(), public.tenant_by_slug(p_slug))
    and q.status = 'confirmed'
    and not coalesce(
      jsonb_typeof(q.pricing -> 'eventSlots' -> ed) = 'object'
      and coalesce(q.pricing -> 'eventSlots' -> ed ->> 'start', '') ~ '^[0-9]{1,2}:[0-9]{2}$'
      and coalesce(q.pricing -> 'eventSlots' -> ed ->> 'end', '') ~ '^[0-9]{1,2}:[0-9]{2}$', false)
$$;
revoke all on function public.booked_times(text) from public;
grant execute on function public.booked_times(text) to anon, authenticated;

-- ------------------------------------------------------------ bill numbers ----
drop function if exists public._next_number(boolean);
create or replace function public._next_number(consume boolean, t uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Asia/Kolkata')::date;
  cfg jsonb; pfx text; st integer; seq integer; ref text;
begin
  select data into cfg from public.app_settings where tenant_id = t and id = 'numbering';
  pfx := coalesce(nullif(regexp_replace(coalesce(cfg ->> 'prefix', ''), '[^A-Za-z0-9]', '', 'g'), ''), 'EV');
  st := coalesce(nullif(cfg ->> 'start', '')::integer, 1001);
  if consume then
    insert into public.bill_counters (tenant_id, day, last_seq) values (t, d, st - 1) on conflict (tenant_id, day) do nothing;
    select last_seq into seq from public.bill_counters where tenant_id = t and day = d for update;
  else
    select coalesce((select last_seq from public.bill_counters where tenant_id = t and day = d), st - 1) into seq;
  end if;
  loop
    seq := seq + 1;
    ref := pfx || '-' || to_char(d, 'DDMMYY') || '-' || seq;
    exit when not exists (select 1 from public.quotes where tenant_id = t and reference = ref);
  end loop;
  if consume then update public.bill_counters set last_seq = seq where tenant_id = t and day = d; end if;
  return ref;
end $$;
revoke all on function public._next_number(boolean, uuid) from public;

create or replace function public.peek_bill_number()
returns text language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_tenant();
begin
  if t is null then return null; end if;
  return public._next_number(false, t);
end $$;

create or replace function public.set_next_bill_number(n integer)
returns void language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.is_admin() then raise exception 'Only the owner can change the bill number.'; end if;
  if not public.my_tenant_writable() then raise exception 'Your subscription has ended. Renew it in Billing to make changes.'; end if;
  if n < 1 then raise exception 'The number must be 1 or more.'; end if;
  insert into public.bill_counters (tenant_id, day, last_seq) values (public.my_tenant(), d, n - 1)
  on conflict (tenant_id, day) do update set last_seq = excluded.last_seq;
end $$;

drop function if exists public.create_quote(jsonb, text);
create or replace function public.create_quote(p jsonb, p_reference text default null, p_slug text default null)
returns text language plpgsql security definer set search_path = public as $$
declare t uuid := coalesce(public.my_tenant(), public.tenant_by_slug(p_slug)); ref text; caller_role text := public.my_role();
begin
  if t is null then raise exception 'This business was not found.'; end if;
  if not public.tenant_writable(t) then raise exception 'This business is not taking new bills right now.'; end if;
  if p_reference is not null and btrim(p_reference) <> '' and caller_role = 'admin' then ref := btrim(p_reference);
  else ref := public._next_number(true, t); end if;

  insert into public.quotes (tenant_id, reference, customer_name, mobile, event_type, event_date, guests, customer_gst_number, hall, services, pricing, status)
  values (t, ref, p ->> 'customer_name', p ->> 'mobile', p ->> 'event_type', (p ->> 'event_date')::date, (p ->> 'guests')::integer,
          coalesce(p ->> 'customer_gst_number', ''), coalesce(p ->> 'hall', 'Eventora'), coalesce(p -> 'services', '[]'::jsonb), p -> 'pricing', 'new');

  insert into public.activity_log (tenant_id, action, reference, title, detail, data)
  values (t, 'bill.created', ref, 'Bill ' || ref || ' created',
          (p ->> 'customer_name') || ' · ' || (p ->> 'event_type') || ' · total ₹' || to_char(round(coalesce((p -> 'pricing' ->> 'grandTotal')::numeric, 0)), 'FM99,99,99,990'),
          jsonb_build_object('customer', p ->> 'customer_name', 'mobile', p ->> 'mobile', 'eventType', p ->> 'event_type',
            'guests', (p ->> 'guests')::integer, 'total', coalesce((p -> 'pricing' ->> 'grandTotal')::numeric, 0),
            'dates', (select string_agg(x, ', ' order by x) from jsonb_array_elements_text(coalesce(p -> 'pricing' -> 'eventDates', jsonb_build_array(p ->> 'event_date'))) x)));
  return ref;
end $$;
revoke all on function public.create_quote(jsonb, text, text) from public;
grant execute on function public.create_quote(jsonb, text, text) to anon, authenticated;
grant execute on function public.get_catalog(text) to anon, authenticated;
grant execute on function public.get_setting(text, text) to anon, authenticated;
grant execute on function public.save_catalog(jsonb) to authenticated;
grant execute on function public.save_setting(text, jsonb) to authenticated;
grant execute on function public.peek_bill_number() to authenticated;
grant execute on function public.set_next_bill_number(integer) to authenticated;

-- ------------------------------------------------- signup, public page, billing --
-- Anyone signed in who is not yet part of a business can create one. It starts with a 14-day free trial.
create or replace function public.create_tenant(p_name text, p_slug text)
returns text language plpgsql security definer set search_path = public as $$
declare tid uuid; s text := lower(btrim(coalesce(p_slug, ''))); em text := auth.jwt() ->> 'email';
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then raise exception 'This login already belongs to a business.'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Enter your business name.'; end if;
  if s !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then raise exception 'The web address must be 3 to 40 letters, numbers or hyphens.'; end if;
  if s in ('admin', 'login', 'signup', 'api', 'www', 'app', 't', 'billing', 'platform', 'support', 'help', 'static', 'assets') then raise exception 'That web address is reserved.'; end if;
  if exists (select 1 from public.tenants where slug = s) then raise exception 'That web address is already taken.'; end if;
  insert into public.tenants (name, slug) values (btrim(p_name), s) returning id into tid;
  insert into public.members (user_id, tenant_id, role, email) values (auth.uid(), tid, 'owner', coalesce(em, ''));
  insert into public.subscriptions (tenant_id, status, trial_ends_at) values (tid, 'trialing', now() + interval '14 days');
  insert into public.app_settings (tenant_id, id, data) values (tid, 'business', jsonb_build_object('name', btrim(p_name)));
  return s;
end $$;
revoke all on function public.create_tenant(text, text) from public;
grant execute on function public.create_tenant(text, text) to authenticated;

-- the public estimator page of a business: /#/t/<slug>
create or replace function public.public_tenant(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', t.name, 'slug', t.slug) from public.tenants t where t.slug = lower(btrim(coalesce(p_slug, '')));
$$;
revoke all on function public.public_tenant(text) from public;
grant execute on function public.public_tenant(text) to anon, authenticated;

create or replace function public.get_subscription()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', s.status, 'plan', s.plan, 'period', s.period, 'trialEndsAt', s.trial_ends_at,
                            'currentPeriodEnd', s.current_period_end, 'writable', public.tenant_writable(s.tenant_id))
  from public.subscriptions s where s.tenant_id = public.my_tenant();
$$;
revoke all on function public.get_subscription() from public;
grant execute on function public.get_subscription() to authenticated;

-- ------------------------------------------------------ software-owner panel --
create or replace function public.platform_list_tenants()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'createdAt', t.created_at,
      'ownerEmail', (select m.email from public.members m where m.tenant_id = t.id and m.role = 'owner' limit 1),
      'status', s.status, 'period', s.period, 'trialEndsAt', s.trial_ends_at, 'currentPeriodEnd', s.current_period_end,
      'members', (select count(*) from public.members m where m.tenant_id = t.id),
      'bills', (select count(*) from public.quotes q where q.tenant_id = t.id)) order by t.created_at desc)
    from public.tenants t left join public.subscriptions s on s.tenant_id = t.id), '[]'::jsonb);
end $$;
revoke all on function public.platform_list_tenants() from public;
grant execute on function public.platform_list_tenants() to authenticated;

create or replace function public.platform_set_subscription(p_tenant uuid, p_status text, p_extend_days integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_status is not null and p_status not in ('trialing', 'active', 'past_due', 'cancelled', 'expired') then raise exception 'Invalid status.'; end if;
  insert into public.subscriptions (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  if p_status is not null then update public.subscriptions set status = p_status, updated_at = now() where tenant_id = p_tenant; end if;
  if coalesce(p_extend_days, 0) > 0 then
    if (select status from public.subscriptions where tenant_id = p_tenant) = 'trialing' then
      update public.subscriptions set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => p_extend_days), updated_at = now() where tenant_id = p_tenant;
    else
      update public.subscriptions set current_period_end = greatest(coalesce(current_period_end, now()), now()) + make_interval(days => p_extend_days),
        status = case when status in ('expired', 'past_due', 'cancelled') then 'active' else status end, updated_at = now() where tenant_id = p_tenant;
    end if;
  end if;
end $$;
revoke all on function public.platform_set_subscription(uuid, text, integer) from public;
grant execute on function public.platform_set_subscription(uuid, text, integer) to authenticated;

notify pgrst, 'reload schema';

-- ------------------------------ 08-saas-billing ------------------------------
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

-- ------------------------------ 11-saas-security-team ------------------------------
-- ============================================================================
-- Eventora OS — SQL file 11: SECURITY & TEAM rules for the multi-business (SaaS) version.
-- Run AFTER 05, 06 and 08. Safe to run again. ALWAYS run this one LAST: if you ever re-run 06, run 11 again afterwards.
-- Nothing is deleted or reset.
--
--  1. The app is login-only: visitors (not signed in) can read NOTHING and save NOTHING of any business.
--  2. Employees can NEVER delete bills. Only the owner can (enforced by the database, not just hidden buttons).
--  3. Every new bill remembers who created it (created_by). Employee switch "See bills made by others":
--     when off, an employee sees (and can change) only the bills they made themselves.
--  4. Two-step verification (authenticator app / TOTP): once a person turns it on, the database refuses their access
--     until the code has been entered in that session.
--  5. An employee cannot re-assign a bill to themselves (created_by is locked) or move it to another business.
--  6. create_quote() checks its input and only accepts a signed-in owner / employee of an active business.
-- ============================================================================

do $$
begin
  if to_regprocedure('public.my_tenant()') is null or to_regclass('public.subscriptions') is null or to_regprocedure('public.get_plans()') is null then
    raise exception 'Run 05, 06 and 08 first. Nothing was changed.';
  end if;
end $$;

-- 1) columns the app writes / reads
alter table public.quotes add column if not exists customer_gst_number text;
alter table public.quotes add column if not exists created_by uuid;
alter table public.quotes add column if not exists created_by_email text;
create index if not exists quotes_created_by_idx on public.quotes (tenant_id, created_by);

-- 2) two-step verification gate: TRUE when the person has no verified authenticator, or already entered the code in this session
create or replace function public._aal_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified');
$$;
revoke all on function public._aal_ok() from public;

-- every "who is this person / which business" answer is gated, so every policy that uses them is gated too
create or replace function public.my_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.members where user_id = auth.uid() and active and public._aal_ok() limit 1;
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and role = 'owner') and public._aal_ok();
$$;
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and active and role = 'staff') and public._aal_ok();
$$;
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid()) and public._aal_ok();
$$;

-- 3) bills: employees read all bills of their business or only their own (owner's switch); only the OWNER deletes
drop policy if exists "team read quotes" on public.quotes;
create policy "team read quotes" on public.quotes for select to authenticated
  using (tenant_id = public.my_tenant() and (public.is_admin() or (public.is_staff() and (public.staff_can('viewAllBills') or created_by = auth.uid()))));

drop policy if exists "team update quotes" on public.quotes;
create policy "team update quotes" on public.quotes for update to authenticated
  using (tenant_id = public.my_tenant() and public.tenant_writable(tenant_id)
         and (public.is_admin() or (public.is_staff() and (public.staff_can('viewAllBills') or created_by = auth.uid()))))
  with check (tenant_id = public.my_tenant() and public.tenant_writable(tenant_id));

drop policy if exists "team delete quotes" on public.quotes;
drop policy if exists "owner delete quotes" on public.quotes;
create policy "owner delete quotes" on public.quotes for delete to authenticated
  using (tenant_id = public.my_tenant() and public.tenant_writable(tenant_id) and public.is_admin());

-- 4) employee limits (same as before + the creator of a bill can never be changed by an employee)
create or replace function public.enforce_staff_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare keep text[] := array['payments', 'advancePaid', 'advanceAmount', 'balanceDue'];
begin
  if new.tenant_id is distinct from old.tenant_id then raise exception 'A bill cannot move to another business.'; end if;
  if public.is_admin() then return new; end if;
  if not public.is_staff() then raise exception 'You do not have access.'; end if;
  if new.reference is distinct from old.reference then raise exception 'The bill number cannot be changed.'; end if;
  if new.created_by is distinct from old.created_by or new.created_by_email is distinct from old.created_by_email then
    raise exception 'Who created the bill cannot be changed.';
  end if;
  if new.status is distinct from old.status and not public.staff_can('markBooked') then
    raise exception 'Employees are not allowed to mark bills as booked or release them.';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(old.pricing -> 'payments', '[]'::jsonb)) o
             where not exists (select 1 from jsonb_array_elements(coalesce(new.pricing -> 'payments', '[]'::jsonb)) n where n ->> 'id' = o ->> 'id'))
     and not public.staff_can('removePayments') then
    raise exception 'Employees are not allowed to remove payments.';
  end if;
  if (new.customer_name, new.mobile, new.event_type, new.event_date, new.guests, new.customer_gst_number, new.hall, new.services, new.pricing - keep)
     is distinct from
     (old.customer_name, old.mobile, old.event_type, old.event_date, old.guests, old.customer_gst_number, old.hall, old.services, old.pricing - keep)
     and not public.staff_can('editBills') then
    raise exception 'Employees are not allowed to edit bills.';
  end if;
  return new;
end $$;
drop trigger if exists enforce_staff_rules_trg on public.quotes;
create trigger enforce_staff_rules_trg before update on public.quotes for each row execute function public.enforce_staff_rules();

-- 5) visitors see nothing: catalog, settings and booked times are for a signed-in owner / employee of their own business only
drop function if exists public.get_catalog(text);
drop function if exists public.get_setting(text, text);
drop function if exists public.booked_times(text);
drop function if exists public.create_quote(jsonb, text, text);
drop function if exists public.public_tenant(text);

create or replace function public.get_catalog()
returns jsonb language sql stable security definer set search_path = public as $$
  select categories from public.catalog where id = 'default' and tenant_id = public.my_tenant() and public.my_role() in ('admin', 'staff');
$$;

create or replace function public.get_setting(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.my_tenant(); r text := public.my_role();
begin
  if t is null or r not in ('admin', 'staff') then return null; end if;
  if p_key in ('business', 'payment', 'permissions', 'numbering') then null;
  elsif r = 'admin' then null;
  else return null; end if;
  return (select data from public.app_settings where tenant_id = t and id = p_key);
end $$;

create or replace function public.booked_times()
returns table (booked_date date, start_time text, end_time text)
language sql stable security definer set search_path = public as $$
  select d.key::date, d.value ->> 'start', d.value ->> 'end'
  from public.quotes q, lateral jsonb_each(coalesce(q.pricing -> 'eventSlots', '{}'::jsonb)) d
  where public.my_role() in ('admin', 'staff') and q.tenant_id = public.my_tenant()
    and q.status = 'confirmed'
    and jsonb_typeof(d.value) = 'object'
    and coalesce(d.value ->> 'start', '') ~ '^[0-9]{1,2}:[0-9]{2}$'
    and coalesce(d.value ->> 'end', '') ~ '^[0-9]{1,2}:[0-9]{2}$'
  union all
  select ed::date, '00:00', '24:00'
  from public.quotes q, lateral jsonb_array_elements_text(coalesce(q.pricing -> 'eventDates', to_jsonb(array[q.event_date::text]))) ed
  where public.my_role() in ('admin', 'staff') and q.tenant_id = public.my_tenant()
    and q.status = 'confirmed'
    and not coalesce(
      jsonb_typeof(q.pricing -> 'eventSlots' -> ed) = 'object'
      and coalesce(q.pricing -> 'eventSlots' -> ed ->> 'start', '') ~ '^[0-9]{1,2}:[0-9]{2}$'
      and coalesce(q.pricing -> 'eventSlots' -> ed ->> 'end', '') ~ '^[0-9]{1,2}:[0-9]{2}$', false)
$$;

-- 6) create_quote: only a signed-in owner / employee of an active business; input is checked; records who made the bill.
create or replace function public.create_quote(p jsonb, p_reference text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.my_tenant();
  ref text;
  caller_role text := public.my_role();
  v_guests integer;
  v_date date;
  v_total numeric;
begin
  if caller_role not in ('admin', 'staff') or t is null then raise exception 'Please sign in as the owner or an employee to save a quotation.' using errcode = '42501'; end if;
  if not public.tenant_writable(t) then raise exception 'Your subscription has ended. Renew it in Billing to make bills.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Quotation details are missing.'; end if;
  if coalesce(btrim(p ->> 'customer_name'), '') = '' then raise exception 'Customer name is required.'; end if;
  if coalesce(btrim(p ->> 'mobile'), '') = '' then raise exception 'Mobile number is required.'; end if;
  if coalesce(btrim(p ->> 'event_type'), '') = '' then raise exception 'Event type is required.'; end if;
  if jsonb_typeof(p -> 'pricing') is distinct from 'object' then raise exception 'Pricing details are missing.'; end if;
  if p ? 'services' and jsonb_typeof(p -> 'services') <> 'array' then raise exception 'Services must be a list.'; end if;
  begin
    v_date := (p ->> 'event_date')::date;
    v_guests := (p ->> 'guests')::integer;
    v_total := coalesce((p -> 'pricing' ->> 'grandTotal')::numeric, 0);
  exception when others then
    raise exception 'Event date, guest count or total is not valid.';
  end;
  if v_date is null then raise exception 'Event date is required.'; end if;
  if v_guests is null or v_guests <= 0 then raise exception 'Guests must be more than zero.'; end if;

  if p_reference is not null and btrim(p_reference) <> '' and caller_role = 'admin' then ref := btrim(p_reference);
  else ref := public._next_number(true, t); end if;

  insert into public.quotes (tenant_id, reference, customer_name, mobile, event_type, event_date, guests, customer_gst_number, hall, services, pricing, status, created_by, created_by_email)
  values (t, ref, btrim(p ->> 'customer_name'), btrim(p ->> 'mobile'), btrim(p ->> 'event_type'), v_date, v_guests,
          coalesce(p ->> 'customer_gst_number', ''), coalesce(nullif(btrim(p ->> 'hall'), ''), 'Eventora'),
          coalesce(p -> 'services', '[]'::jsonb), p -> 'pricing', 'new', auth.uid(), auth.jwt() ->> 'email');

  insert into public.activity_log (tenant_id, action, reference, title, detail, data)
  values (t, 'bill.created', ref, 'Bill ' || ref || ' created',
          (p ->> 'customer_name') || ' · ' || (p ->> 'event_type') || ' · total ₹' || to_char(round(v_total), 'FM99,99,99,99,99,990'),
          jsonb_build_object('customer', p ->> 'customer_name', 'mobile', p ->> 'mobile', 'eventType', p ->> 'event_type',
            'guests', v_guests, 'total', v_total,
            'dates', (select string_agg(x, ', ' order by x) from jsonb_array_elements_text(
                       case when jsonb_typeof(p -> 'pricing' -> 'eventDates') = 'array' then p -> 'pricing' -> 'eventDates'
                            else jsonb_build_array(p ->> 'event_date') end) x)));
  return ref;
end $$;

-- execution rights: signed-in people only; nobody can insert into quotes directly
revoke all on function public.get_catalog() from public;
revoke all on function public.get_setting(text) from public;
revoke all on function public.booked_times() from public;
revoke all on function public.create_quote(jsonb, text) from public;
revoke all on function public.get_catalog() from anon;
revoke all on function public.get_setting(text) from anon;
revoke all on function public.booked_times() from anon;
revoke all on function public.create_quote(jsonb, text) from anon;
grant execute on function public.get_catalog() to authenticated;
grant execute on function public.get_setting(text) to authenticated;
grant execute on function public.booked_times() to authenticated;
grant execute on function public.create_quote(jsonb, text) to authenticated;
revoke insert on public.quotes from anon, authenticated;
revoke all on public.quotes from anon;

notify pgrst, 'reload schema';

-- ------------------------------ 13-purchase-onboarding ------------------------------
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

-- ------------------------------ 14-custom-plans ------------------------------
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

-- ------------------------------ 15-super-admin-dashboard ------------------------------
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

-- =====================================================================================
-- (file 16 is included below: manual access, messages & automation, multi-branch, saved custom items)
-- =====================================================================================
-- =====================================================================================
-- 16 - MANUAL ACCESS + MESSAGES & AUTOMATION + MULTI-BRANCH + SAVED CUSTOM ITEMS
--
--  1. Manual access: you add each owner yourself (Super admin -> Add owner). Self sign-up is switched off.
--     Payment details / contact shown to owners come from Super admin -> Settings.
--  2. Messages: send notifications to all / selected / filtered businesses, templates, automatic reminders
--     (plan ending, plan ended, trial ending, welcome, auto-replies), owners' request inbox.
--  3. Multi-branch: every business has a "Main branch". Extra branches are requested by the owner and
--     approved by you. Employees belong to ONE branch and only see that branch's data (enforced by the database).
--     The owner can switch between branches or see everything combined.
--  4. Saved custom items for quotations (name + default cost, saved per business).
--
-- Run ONCE in Supabase -> SQL Editor, AFTER 15-super-admin-dashboard.sql (and after 11 / 13 / 14).
-- Safe to run again. If you ever re-run 06, 08 or 11, run this file again afterwards.
-- Nothing is deleted. Existing bills and employees are moved into each business's "Main branch".
-- =====================================================================================

do $$
begin
  if to_regprocedure('public.platform_grant_access(uuid,text,timestamptz,text,integer)') is null
     or to_regprocedure('public._aal_ok()') is null then
    raise exception 'Run files 01-15 first (especially 11 and 15). Nothing was changed.';
  end if;
end $$;

-- ===================================================================== 0) platform config ==
-- one settings row for you: contact + how owners should pay you + price of an extra branch + self sign-up switch
insert into public.platform_settings (key, data) values ('config', jsonb_build_object(
  'whatsapp', '', 'phone', '', 'email', '', 'upi', '', 'payee', '', 'bankText', '', 'instructions',
  'Pay by UPI or bank transfer, then press "Request renewal" in Billing and enter the payment reference. We will switch your access on.',
  'branchPrice', 0, 'allowSelfSignup', false)) on conflict (key) do nothing;

create or replace function public.platform_get_config()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select data from public.platform_settings where key = 'config'), '{}'::jsonb);
end $$;

create or replace function public.platform_save_config(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text; clean jsonb := '{}'::jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Settings are missing.'; end if;
  foreach k in array array['whatsapp', 'phone', 'email', 'upi', 'payee', 'bankText', 'instructions'] loop
    clean := clean || jsonb_build_object(k, left(btrim(coalesce(p ->> k, '')), 600));
  end loop;
  clean := clean || jsonb_build_object('branchPrice', greatest(coalesce(nullif(p ->> 'branchPrice', '')::numeric, 0), 0),
                                       'allowSelfSignup', coalesce((p ->> 'allowSelfSignup')::boolean, false));
  insert into public.platform_settings (key, data) values ('config', clean)
  on conflict (key) do update set data = public.platform_settings.data || excluded.data;
end $$;

-- shown on the public page (Request access): only contact details, nothing else
create or replace function public.public_contact()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('whatsapp', coalesce(data ->> 'whatsapp', ''), 'phone', coalesce(data ->> 'phone', ''), 'email', coalesce(data ->> 'email', ''))
    from (select coalesce((select data from public.platform_settings where key = 'config'), '{}'::jsonb) as data) x;
$$;

-- shown to a signed-in owner on the Billing page: how to pay you
create or replace function public.get_payment_info()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb;
begin
  if not (public.is_admin() or public.is_platform_admin()) then return '{}'::jsonb; end if;
  d := coalesce((select data from public.platform_settings where key = 'config'), '{}'::jsonb);
  return d - 'allowSelfSignup';
end $$;

-- ===================================================================== 1) tenant columns ===
alter table public.tenants add column if not exists business_type text not null default 'Banquet hall';
alter table public.tenants add column if not exists phone text not null default '';
alter table public.tenants add column if not exists branch_limit integer not null default 1 check (branch_limit between 1 and 200);

-- ===================================================================== 2) branches =========
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  address text not null default '',
  phone text not null default '',
  is_main boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists branches_one_main_uq on public.branches (tenant_id) where is_main;
create unique index if not exists branches_name_uq on public.branches (tenant_id, lower(btrim(name)));
create index if not exists branches_tenant_idx on public.branches (tenant_id);
alter table public.branches enable row level security;
revoke all on public.branches from anon, authenticated;

-- every new business automatically gets its Main branch
create or replace function public._tenant_main_branch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.branches (tenant_id, name, is_main) values (new.id, 'Main branch', true) on conflict do nothing;
  return new;
end $$;
revoke all on function public._tenant_main_branch() from public, anon, authenticated;
drop trigger if exists tenants_main_branch_trg on public.tenants;
create trigger tenants_main_branch_trg after insert on public.tenants for each row execute function public._tenant_main_branch();

-- existing businesses get one now
insert into public.branches (tenant_id, name, is_main)
  select t.id, 'Main branch', true from public.tenants t
  where not exists (select 1 from public.branches b where b.tenant_id = t.id and b.is_main);

alter table public.quotes       add column if not exists branch_id uuid references public.branches(id);
alter table public.activity_log add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.members      add column if not exists branch_id uuid references public.branches(id) on delete set null;

update public.quotes q set branch_id = (select b.id from public.branches b where b.tenant_id = q.tenant_id and b.is_main) where q.branch_id is null;
update public.members m set branch_id = (select b.id from public.branches b where b.tenant_id = m.tenant_id and b.is_main) where m.role = 'staff' and m.branch_id is null;
update public.activity_log a set branch_id = coalesce(
    (select q.branch_id from public.quotes q where q.tenant_id = a.tenant_id and q.reference = a.reference limit 1),
    (select b.id from public.branches b where b.tenant_id = a.tenant_id and b.is_main))
  where a.branch_id is null and a.tenant_id is not null;

create index if not exists quotes_branch_idx on public.quotes (tenant_id, branch_id, created_at desc);
create index if not exists activity_branch_idx on public.activity_log (tenant_id, branch_id, at desc);

-- ---- who is this person's branch? Owner: null = every branch. Employee: their own branch (Main branch if none was set).
create or replace function public.my_branch()
returns uuid language sql stable security definer set search_path = public as $$
  select case when m.role = 'staff'
              then coalesce(m.branch_id, (select b.id from public.branches b where b.tenant_id = m.tenant_id and b.is_main limit 1))
              else null end
    from public.members m
   where m.user_id = auth.uid() and m.active and public._aal_ok()
   limit 1;
$$;
revoke all on function public.my_branch() from public, anon;
grant execute on function public.my_branch() to authenticated;

-- any bill saved without a branch (for example by an older function) lands in the employee's branch, or the Main branch
create or replace function public._quote_branch_default()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is null then
    new.branch_id := coalesce(public.my_branch(), (select b.id from public.branches b where b.tenant_id = new.tenant_id and b.is_main limit 1));
  end if;
  return new;
end $$;
revoke all on function public._quote_branch_default() from public, anon, authenticated;
drop trigger if exists quotes_branch_default_trg on public.quotes;
create trigger quotes_branch_default_trg before insert on public.quotes for each row execute function public._quote_branch_default();
alter table public.quotes alter column branch_id set not null;

-- ---- employees only ever see / change bills of THEIR branch (owner: all branches)
drop policy if exists "team read quotes" on public.quotes;
create policy "team read quotes" on public.quotes for select to authenticated
  using (tenant_id = public.my_tenant() and (public.is_admin()
         or (public.is_staff() and branch_id = public.my_branch() and (public.staff_can('viewAllBills') or created_by = auth.uid()))));

drop policy if exists "team update quotes" on public.quotes;
create policy "team update quotes" on public.quotes for update to authenticated
  using (tenant_id = public.my_tenant() and public.tenant_writable(tenant_id)
         and (public.is_admin() or (public.is_staff() and branch_id = public.my_branch() and (public.staff_can('viewAllBills') or created_by = auth.uid()))))
  with check (tenant_id = public.my_tenant() and public.tenant_writable(tenant_id));

-- same employee limits as file 11, plus: an employee can never move a bill to another branch
create or replace function public.enforce_staff_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare keep text[] := array['payments', 'advancePaid', 'advanceAmount', 'balanceDue'];
begin
  if new.tenant_id is distinct from old.tenant_id then raise exception 'A bill cannot move to another business.'; end if;
  if public.is_admin() then return new; end if;
  if not public.is_staff() then raise exception 'You do not have access.'; end if;
  if new.branch_id is distinct from old.branch_id then raise exception 'Only the owner can move a bill to another branch.'; end if;
  if new.reference is distinct from old.reference then raise exception 'The bill number cannot be changed.'; end if;
  if new.created_by is distinct from old.created_by or new.created_by_email is distinct from old.created_by_email then
    raise exception 'Who created the bill cannot be changed.';
  end if;
  if new.status is distinct from old.status and not public.staff_can('markBooked') then
    raise exception 'Employees are not allowed to mark bills as booked or release them.';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(old.pricing -> 'payments', '[]'::jsonb)) o
             where not exists (select 1 from jsonb_array_elements(coalesce(new.pricing -> 'payments', '[]'::jsonb)) n where n ->> 'id' = o ->> 'id'))
     and not public.staff_can('removePayments') then
    raise exception 'Employees are not allowed to remove payments.';
  end if;
  if (new.customer_name, new.mobile, new.event_type, new.event_date, new.guests, new.customer_gst_number, new.hall, new.services, new.pricing - keep)
     is distinct from
     (old.customer_name, old.mobile, old.event_type, old.event_date, old.guests, old.customer_gst_number, old.hall, old.services, old.pricing - keep)
     and not public.staff_can('editBills') then
    raise exception 'Employees are not allowed to edit bills.';
  end if;
  return new;
end $$;
drop trigger if exists enforce_staff_rules_trg on public.quotes;
create trigger enforce_staff_rules_trg before update on public.quotes for each row execute function public.enforce_staff_rules();

-- the activity log remembers the branch of the bill it is about
create or replace function public.activity_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.at := now();
  if auth.uid() is null then new.actor_email := null; new.actor_role := 'public';
  else new.actor_email := auth.jwt() ->> 'email'; new.actor_role := public.my_role(); new.tenant_id := public.my_tenant(); end if;
  if new.branch_id is null then
    new.branch_id := coalesce(
      (select q.branch_id from public.quotes q where q.tenant_id = new.tenant_id and q.reference = new.reference limit 1),
      public.my_branch());
  end if;
  return new;
end $$;

-- ---- calendar: booked times of ONE branch (an employee always gets their own branch; owner passes the branch of the bill)
drop function if exists public.booked_times();
drop function if exists public.booked_times(uuid);
create or replace function public.booked_times(p_branch uuid default null)
returns table (booked_date date, start_time text, end_time text)
language sql stable security definer set search_path = public as $$
  select d.key::date, d.value ->> 'start', d.value ->> 'end'
  from public.quotes q, lateral jsonb_each(coalesce(q.pricing -> 'eventSlots', '{}'::jsonb)) d
  where public.my_role() in ('admin', 'staff') and q.tenant_id = public.my_tenant()
    and (case when public.is_staff() then q.branch_id = public.my_branch() else (p_branch is null or q.branch_id = p_branch) end)
    and q.status = 'confirmed'
    and jsonb_typeof(d.value) = 'object'
    and coalesce(d.value ->> 'start', '') ~ '^[0-9]{1,2}:[0-9]{2}$'
    and coalesce(d.value ->> 'end', '') ~ '^[0-9]{1,2}:[0-9]{2}$'
  union all
  select ed::date, '00:00', '24:00'
  from public.quotes q, lateral jsonb_array_elements_text(coalesce(q.pricing -> 'eventDates', to_jsonb(array[q.event_date::text]))) ed
  where public.my_role() in ('admin', 'staff') and q.tenant_id = public.my_tenant()
    and (case when public.is_staff() then q.branch_id = public.my_branch() else (p_branch is null or q.branch_id = p_branch) end)
    and q.status = 'confirmed'
    and not coalesce(
      jsonb_typeof(q.pricing -> 'eventSlots' -> ed) = 'object'
      and coalesce(q.pricing -> 'eventSlots' -> ed ->> 'start', '') ~ '^[0-9]{1,2}:[0-9]{2}$'
      and coalesce(q.pricing -> 'eventSlots' -> ed ->> 'end', '') ~ '^[0-9]{1,2}:[0-9]{2}$', false)
$$;
revoke all on function public.booked_times(uuid) from public, anon;
grant execute on function public.booked_times(uuid) to authenticated;

-- ---- create_quote: same checks as file 11, plus the branch (employee: forced to their own; owner: chosen, default Main)
create or replace function public.create_quote(p jsonb, p_reference text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.my_tenant();
  ref text;
  caller_role text := public.my_role();
  v_guests integer;
  v_date date;
  v_total numeric;
  v_branch uuid;
begin
  if caller_role not in ('admin', 'staff') or t is null then raise exception 'Please sign in as the owner or an employee to save a quotation.' using errcode = '42501'; end if;
  if not public.tenant_writable(t) then raise exception 'Your access has ended. Contact Eventora to renew it.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Quotation details are missing.'; end if;
  if coalesce(btrim(p ->> 'customer_name'), '') = '' then raise exception 'Customer name is required.'; end if;
  if coalesce(btrim(p ->> 'mobile'), '') = '' then raise exception 'Mobile number is required.'; end if;
  if coalesce(btrim(p ->> 'event_type'), '') = '' then raise exception 'Event type is required.'; end if;
  if jsonb_typeof(p -> 'pricing') is distinct from 'object' then raise exception 'Pricing details are missing.'; end if;
  if p ? 'services' and jsonb_typeof(p -> 'services') <> 'array' then raise exception 'Services must be a list.'; end if;
  begin
    v_date := (p ->> 'event_date')::date;
    v_guests := (p ->> 'guests')::integer;
    v_total := coalesce((p -> 'pricing' ->> 'grandTotal')::numeric, 0);
  exception when others then
    raise exception 'Event date, guest count or total is not valid.';
  end;
  if v_date is null then raise exception 'Event date is required.'; end if;
  if v_guests is null or v_guests <= 0 then raise exception 'Guests must be more than zero.'; end if;

  -- which branch does this bill belong to?
  if caller_role = 'staff' then
    v_branch := public.my_branch();
  else
    begin v_branch := nullif(btrim(coalesce(p ->> 'branch_id', '')), '')::uuid;
    exception when others then raise exception 'That branch is not valid.'; end;
    if v_branch is null then v_branch := (select b.id from public.branches b where b.tenant_id = t and b.is_main limit 1); end if;
  end if;
  if v_branch is null or not exists (select 1 from public.branches b where b.id = v_branch and b.tenant_id = t and b.active) then
    raise exception 'This branch is switched off or does not exist. %', case when caller_role = 'staff' then 'Ask the owner to move you to an active branch.' else 'Choose another branch.' end;
  end if;

  if p_reference is not null and btrim(p_reference) <> '' and caller_role = 'admin' then ref := btrim(p_reference);
  else ref := public._next_number(true, t); end if;

  insert into public.quotes (tenant_id, branch_id, reference, customer_name, mobile, event_type, event_date, guests, customer_gst_number, hall, services, pricing, status, created_by, created_by_email)
  values (t, v_branch, ref, btrim(p ->> 'customer_name'), btrim(p ->> 'mobile'), btrim(p ->> 'event_type'), v_date, v_guests,
          coalesce(p ->> 'customer_gst_number', ''), coalesce(nullif(btrim(p ->> 'hall'), ''), 'Eventora'),
          coalesce(p -> 'services', '[]'::jsonb), p -> 'pricing', 'new', auth.uid(), auth.jwt() ->> 'email');

  insert into public.activity_log (tenant_id, branch_id, action, reference, title, detail, data)
  values (t, v_branch, 'bill.created', ref, 'Bill ' || ref || ' created',
          (p ->> 'customer_name') || ' · ' || (p ->> 'event_type') || ' · total ₹' || to_char(round(v_total), 'FM99,99,99,99,99,990'),
          jsonb_build_object('customer', p ->> 'customer_name', 'mobile', p ->> 'mobile', 'eventType', p ->> 'event_type',
            'guests', v_guests, 'total', v_total,
            'dates', (select string_agg(x, ', ' order by x) from jsonb_array_elements_text(
                       case when jsonb_typeof(p -> 'pricing' -> 'eventDates') = 'array' then p -> 'pricing' -> 'eventDates'
                            else jsonb_build_array(p ->> 'event_date') end) x)));
  return ref;
end $$;
revoke all on function public.create_quote(jsonb, text) from public, anon;
grant execute on function public.create_quote(jsonb, text) to authenticated;

-- ---- branch management (owner) ------------------------------------------------------
-- Everybody signed in gets their business's branch list (an employee only gets their own branch).
create or replace function public.list_branches()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.my_tenant(); r text := public.my_role();
begin
  if t is null or r not in ('admin', 'staff') then return jsonb_build_object('branches', '[]'::jsonb, 'limit', 1, 'activeCount', 0, 'myBranchId', null); end if;
  return jsonb_build_object(
    'limit', (select tn.branch_limit from public.tenants tn where tn.id = t),
    'activeCount', (select count(*) from public.branches b where b.tenant_id = t and b.active),
    'myBranchId', public.my_branch(),
    'branches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'phone', b.phone, 'isMain', b.is_main, 'active', b.active,
                'createdAt', b.created_at, 'staff', (select count(*) from public.members m where m.tenant_id = t and m.role = 'staff' and coalesce(m.branch_id, (select x.id from public.branches x where x.tenant_id = t and x.is_main)) = b.id))
                order by b.is_main desc, b.created_at)
              from public.branches b where b.tenant_id = t and (r = 'admin' or b.id = public.my_branch())), '[]'::jsonb));
end $$;

create or replace function public.save_branch(p_id uuid, p_name text, p_address text, p_phone text, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_tenant(); lim integer; used integer; cur public.branches; nm text := btrim(coalesce(p_name, '')); nid uuid;
begin
  if not public.is_admin() then raise exception 'Only the owner can manage branches.'; end if;
  if not public.my_tenant_writable() then raise exception 'Your access has ended. Contact Eventora to renew it.'; end if;
  if char_length(nm) < 2 or char_length(nm) > 60 then raise exception 'Enter a branch name (2 to 60 letters).'; end if;
  select branch_limit into lim from public.tenants where id = t;
  if p_id is null then
    select count(*) into used from public.branches where tenant_id = t and active;
    if used >= lim then
      raise exception 'BRANCH_LIMIT: Your plan includes % branch%. Send a request for one more branch and we will approve it.', lim, case when lim = 1 then '' else 'es' end;
    end if;
    insert into public.branches (tenant_id, name, address, phone) values (t, nm, left(btrim(coalesce(p_address, '')), 200), left(btrim(coalesce(p_phone, '')), 20)) returning id into nid;
    return nid;
  end if;
  select * into cur from public.branches where id = p_id and tenant_id = t;
  if not found then raise exception 'That branch was not found.'; end if;
  if cur.is_main and not coalesce(p_active, true) then raise exception 'The Main branch cannot be switched off.'; end if;
  if coalesce(p_active, true) and not cur.active then
    select count(*) into used from public.branches where tenant_id = t and active;
    if used >= lim then raise exception 'BRANCH_LIMIT: All % branch slot% in use. Send a request for one more branch.', lim, case when lim = 1 then ' is' else 's are' end; end if;
  end if;
  update public.branches set name = nm, address = left(btrim(coalesce(p_address, '')), 200), phone = left(btrim(coalesce(p_phone, '')), 20), active = coalesce(p_active, true) where id = p_id;
  return p_id;
exception when unique_violation then
  raise exception 'You already have a branch with that name.';
end $$;

create or replace function public.set_staff_branch(p_user uuid, p_branch uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_tenant();
begin
  if not public.is_admin() then raise exception 'Only the owner can move employees.'; end if;
  if not exists (select 1 from public.branches where id = p_branch and tenant_id = t and active) then raise exception 'Choose an active branch.'; end if;
  update public.members set branch_id = p_branch where user_id = p_user and tenant_id = t and role = 'staff';
  if not found then raise exception 'That employee was not found.'; end if;
end $$;

revoke all on function public.list_branches() from public, anon;
revoke all on function public.save_branch(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.set_staff_branch(uuid, uuid) from public, anon;
grant execute on function public.list_branches() to authenticated;
grant execute on function public.save_branch(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.set_staff_branch(uuid, uuid) to authenticated;

-- ===================================================================== 3) notifications ====
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null default 'info' check (kind in ('info', 'reminder', 'warning', 'payment', 'plan', 'branch', 'reply', 'success')),
  title text not null,
  body text not null default '',
  action_url text,
  source text not null default 'manual' check (source in ('manual', 'auto')),
  campaign_id uuid,
  rule_key text,
  ref text,
  email_wanted boolean not null default false,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_tenant_idx on public.notifications (tenant_id, created_at desc);
-- an automatic message is sent once per business per "reference" (for a plan reminder: the plan's end date)
create unique index if not exists notifications_rule_uq on public.notifications (tenant_id, rule_key, ref) where rule_key is not null;
create index if not exists notifications_email_idx on public.notifications (created_at) where email_wanted and email_sent_at is null;

create table if not exists public.message_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  title text not null,
  body text not null,
  kind text not null default 'info',
  channels text[] not null default '{app}',
  audience jsonb not null default '{}'::jsonb,
  audience_label text not null default '',
  recipient_count integer not null default 0
);

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text not null,
  title text not null,
  body text not null,
  kind text not null default 'info',
  builtin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.message_rules (
  key text primary key,
  label text not null,
  description text not null default '',
  trigger text not null check (trigger in ('before_end', 'after_end', 'event')),
  applies_to text not null default 'any' check (applies_to in ('any', 'trial', 'paid')),
  days integer not null default 0 check (days between 0 and 365),
  enabled boolean not null default true,
  title text not null,
  body text not null,
  kind text not null default 'info',
  action_url text not null default '/admin/messages',
  channels text[] not null default '{app}',
  sort integer not null default 100,
  updated_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.message_campaigns enable row level security;
alter table public.message_templates enable row level security;
alter table public.message_rules enable row level security;
revoke all on public.notifications, public.message_campaigns, public.message_templates, public.message_rules from anon, authenticated;

-- ---- the automatic messages you can switch on / off and rewrite (Super admin -> Automation) ----
-- Words in {curly brackets} are filled in for every business: {business} {plan} {end_date} {days_left} {days_ago} {amount}
-- {upi} {payee} {whatsapp} {branch} {note} {until} {subject} {branch_price}
insert into public.message_rules (key, label, description, trigger, applies_to, days, enabled, title, body, kind, action_url, sort) values
 ('trial_ending_3', 'Free trial ending soon', 'Sent when 3 days or less are left of a free trial.', 'before_end', 'trial', 3, true,
  'Your free trial ends in {days_left} day(s)', 'Hello {business}, your free trial ends on {end_date}. To keep using Eventora, please arrange your plan with us. WhatsApp: {whatsapp}.', 'plan', '/admin/billing', 10),
 ('trial_ended', 'Free trial ended', 'Sent after a free trial ended.', 'after_end', 'trial', 1, true,
  'Your free trial has ended', 'Your free trial ended on {end_date}, so Eventora is locked for now. Your data is safe. Open Billing and send a renewal request, or WhatsApp us on {whatsapp}.', 'warning', '/admin/billing', 11),
 ('plan_ending_7', 'Plan ending in 7 days', 'Sent when 7 days or less are left (until the 3-day message takes over).', 'before_end', 'paid', 7, true,
  'Your plan ends in {days_left} days', 'Hello {business}, your {plan} plan ends on {end_date}. Please renew before then so your team is not locked out. Amount: ₹{amount}. Pay by UPI {upi}, then press "Request renewal" in Billing.', 'reminder', '/admin/billing', 20),
 ('plan_ending_3', 'Plan ending in 3 days', 'Sent when 3 days or less are left.', 'before_end', 'paid', 3, true,
  'Your plan ends in {days_left} day(s)', 'Reminder: your {plan} plan ends on {end_date}. Renewal amount ₹{amount}. UPI: {upi}. After paying, press "Request renewal" in Billing.', 'reminder', '/admin/billing', 21),
 ('plan_ends_today', 'Plan ends today', 'Sent on the last day.', 'before_end', 'paid', 0, true,
  'Your plan ends today', 'Your {plan} plan ends today ({end_date}). Renew now to avoid a lock. Amount ₹{amount}, UPI {upi}.', 'warning', '/admin/billing', 22),
 ('plan_ended', 'Plan ended', 'Sent the day after a paid plan ended.', 'after_end', 'paid', 1, true,
  'Your plan has ended', 'Your plan ended on {end_date} and Eventora is locked. Your data is safe. Pay ₹{amount} (UPI {upi}) and press "Request renewal" in Billing: we switch it on again quickly.', 'warning', '/admin/billing', 23),
 ('plan_expired_7', 'Still not renewed (7 days)', 'A last reminder 7 days after the plan ended.', 'after_end', 'paid', 7, true,
  'Your account is still locked', 'It has been {days_ago} days since your plan ended. Renew with ₹{amount} (UPI {upi}) to continue. Need help? WhatsApp {whatsapp}.', 'warning', '/admin/billing', 24),
 ('welcome', 'Welcome (new owner added)', 'Sent when you add a new owner.', 'event', 'any', 0, true,
  'Welcome to Eventora OS', 'Hello {business}, your workspace is ready. Start with Settings (business details), Catalog (your services) and then make your first quotation. Questions? Use Messages → Contact us.', 'success', '/admin', 30),
 ('access_granted', 'Access given / extended', 'Sent when you give access or extend a plan from the Manage window.', 'event', 'any', 0, true,
  'Your access is active until {end_date}', 'Thank you. Your {plan} access is active until {end_date}.', 'success', '/admin/billing', 31),
 ('renewal_received', 'Auto-reply: renewal request received', 'Instant reply when an owner sends a renewal request.', 'event', 'any', 0, true,
  'We received your renewal request', 'Thank you {business}. We will check your payment and switch your access on shortly.', 'reply', '/admin/messages', 40),
 ('renewal_approved', 'Renewal approved', 'Sent when you approve a renewal request.', 'event', 'any', 0, true,
  'Renewal done: active until {until}', 'Your payment is confirmed. Your access is now active until {until}. {note}', 'success', '/admin/billing', 41),
 ('renewal_rejected', 'Renewal request declined', 'Sent when you decline a renewal request.', 'event', 'any', 0, true,
  'About your renewal request', 'We could not confirm your renewal. {note}', 'warning', '/admin/messages', 42),
 ('branch_received', 'Auto-reply: branch request received', 'Instant reply when an owner asks for an extra branch.', 'event', 'any', 0, true,
  'We received your branch request', 'Thank you {business}. Your request for the branch "{branch}" is with us. Extra branch fee: ₹{branch_price}. We will confirm soon.', 'reply', '/admin/branches', 50),
 ('branch_approved', 'Branch approved', 'Sent when you approve an extra branch.', 'event', 'any', 0, true,
  'Your new branch is ready', 'Your branch "{branch}" is approved and ready. Open Branches to add employees to it. {note}', 'success', '/admin/branches', 51),
 ('branch_rejected', 'Branch request declined', 'Sent when you decline an extra branch.', 'event', 'any', 0, true,
  'About your branch request', 'We could not approve the branch "{branch}" yet. {note}', 'warning', '/admin/branches', 52),
 ('support_received', 'Auto-reply: message received', 'Instant reply when an owner writes to you.', 'event', 'any', 0, true,
  'We got your message', 'Thanks for writing to us. We will reply as soon as we can. For urgent help WhatsApp {whatsapp}.', 'reply', '/admin/messages', 60),
 ('support_replied', 'Reply to a message', 'Sent when you reply to an owner''s message.', 'event', 'any', 0, true,
  'Reply to: {subject}', '{note}', 'reply', '/admin/messages', 61)
on conflict (key) do nothing;

insert into public.message_templates (key, name, title, body, kind, builtin) values
 ('payment_reminder', 'Payment reminder (collect money)', 'Payment reminder', 'Hello {business}, this is a friendly reminder for your Eventora plan payment of ₹{amount}. Please pay by UPI {upi} ({payee}) and send us the payment details from Billing → Request renewal. Thank you!', 'payment', true),
 ('plan_ending', 'Plan ending soon', 'Your plan ends on {end_date}', 'Hello {business}, your {plan} plan ends on {end_date} ({days_left} days left). Renew early so your team is never locked out. Amount: ₹{amount}.', 'reminder', true),
 ('plan_expired', 'Plan expired', 'Your plan has ended', 'Hello {business}, your plan ended on {end_date} and the software is locked. Your data is safe. Renew for ₹{amount} to continue.', 'warning', true),
 ('renewal_thanks', 'Thanks for renewing', 'Thank you for renewing', 'Thank you {business}! Your {plan} plan is active until {end_date}.', 'success', true),
 ('new_feature', 'New feature announcement', 'New in Eventora', 'Hello {business}, we added a new feature to Eventora OS. Open the app to try it. Tell us what you think!', 'info', true),
 ('maintenance', 'Maintenance notice', 'Short maintenance tonight', 'Hello {business}, Eventora will be updated tonight for a few minutes. Please save your work before 10 PM.', 'warning', true),
 ('festival', 'Festival greeting', 'Warm wishes from Eventora', 'Wishing you and your team a very happy festival season, {business}! May your halls stay fully booked.', 'success', true)
on conflict (key) do nothing;

-- ---- fill the {words} ----
create or replace function public._render(t text, v jsonb)
returns text language plpgsql immutable as $$
declare k text; val text; res text := coalesce(t, '');
begin
  for k, val in select key, value from jsonb_each_text(coalesce(v, '{}'::jsonb)) loop
    res := replace(res, '{' || k || '}', coalesce(val, ''));
  end loop;
  return res;
end $$;

-- everything we know about one business, as {words}
create or replace function public._tenant_vars(t uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tn public.tenants; s public.subscriptions; pl public.plans; cfg jsonb; eff timestamptz; dl integer; own text;
begin
  select * into tn from public.tenants where id = t;
  if not found then return '{}'::jsonb; end if;
  select * into s from public.subscriptions where tenant_id = t;
  select * into pl from public.plans where period = s.period;
  cfg := coalesce((select data from public.platform_settings where key = 'config'), '{}'::jsonb);
  eff := case when s.status = 'trialing' then s.trial_ends_at else s.current_period_end end;
  dl := case when eff is null then null else (eff at time zone 'Asia/Kolkata')::date - (now() at time zone 'Asia/Kolkata')::date end;
  own := coalesce(tn.owner_email, (select m.email from public.members m where m.tenant_id = t and m.role = 'owner' order by m.created_at limit 1), '');
  return jsonb_build_object(
    'business', tn.name, 'owner_email', own, 'phone', tn.phone,
    'plan', case when s.status = 'trialing' then 'free trial' else coalesce(pl.name, s.period, 'plan') end,
    'end_date', case when eff is null or eff > now() + interval '5 years' then '' else to_char(eff at time zone 'Asia/Kolkata', 'DD Mon YYYY') end,
    'days_left', coalesce(greatest(dl, 0)::text, ''), 'days_ago', coalesce(greatest(-dl, 0)::text, ''),
    'amount', coalesce(to_char(round(pl.price_paise / 100.0), 'FM999,999,990'), ''),
    'upi', coalesce(cfg ->> 'upi', ''), 'payee', coalesce(cfg ->> 'payee', ''), 'whatsapp', coalesce(cfg ->> 'whatsapp', ''),
    'branch_price', coalesce(to_char(round(coalesce(nullif(cfg ->> 'branchPrice', '')::numeric, 0)), 'FM999,999,990'), '0'));
end $$;
revoke all on function public._render(text, jsonb) from public, anon, authenticated;
revoke all on function public._tenant_vars(uuid) from public, anon, authenticated;

-- put one message into a business's inbox (returns null if this automatic message was already sent)
create or replace function public._notify(t uuid, p_kind text, p_title text, p_body text, p_url text default null, p_source text default 'manual',
                                          p_campaign uuid default null, p_rule text default null, p_ref text default null, p_email boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  insert into public.notifications (tenant_id, kind, title, body, action_url, source, campaign_id, rule_key, ref, email_wanted)
  values (t, case when p_kind in ('info', 'reminder', 'warning', 'payment', 'plan', 'branch', 'reply', 'success') then p_kind else 'info' end,
          left(p_title, 160), left(p_body, 2000), p_url, p_source, p_campaign, p_rule, p_ref, coalesce(p_email, false))
  on conflict (tenant_id, rule_key, ref) where rule_key is not null do nothing
  returning id into nid;
  return nid;
end $$;
revoke all on function public._notify(uuid, text, text, text, text, text, uuid, text, text, boolean) from public, anon, authenticated;

-- fire an automatic EVENT message (welcome, auto-replies, approvals) if its rule is switched on
create or replace function public._fire_event(p_rule text, t uuid, extra jsonb default '{}'::jsonb, p_ref text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.message_rules; v jsonb;
begin
  select * into r from public.message_rules where key = p_rule;
  if not found or not r.enabled then return null; end if;
  v := public._tenant_vars(t) || coalesce(extra, '{}'::jsonb);
  return public._notify(t, r.kind, public._render(r.title, v), btrim(public._render(r.body, v)), r.action_url, 'auto', null, r.key,
                        coalesce(p_ref, gen_random_uuid()::text), r.channels @> array['email']);
end $$;
revoke all on function public._fire_event(text, uuid, jsonb, text) from public, anon, authenticated;

-- the clock-based automatic reminders for ONE business. At most one "before the end" and one "after the end" message at a time
-- (the closest one that applies), and each is sent only once per plan end date.
create or replace function public._auto_for_tenant(t uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare s public.subscriptions; r public.message_rules; eff timestamptz; dl integer; is_trial boolean; v jsonb; n integer := 0; nid uuid;
begin
  select * into s from public.subscriptions where tenant_id = t;
  if not found then return 0; end if;
  is_trial := (s.status = 'trialing');
  eff := case when is_trial then s.trial_ends_at else s.current_period_end end;
  if eff is null or eff > now() + interval '5 years' then return 0; end if;
  dl := (eff at time zone 'Asia/Kolkata')::date - (now() at time zone 'Asia/Kolkata')::date;
  v := public._tenant_vars(t);

  select * into r from public.message_rules
   where enabled and trigger = 'before_end' and dl between 0 and days and (applies_to = 'any' or (applies_to = 'trial') = is_trial)
   order by days asc limit 1;
  if found then
    nid := public._notify(t, r.kind, public._render(r.title, v), btrim(public._render(r.body, v)), r.action_url, 'auto', null, r.key,
                          to_char(eff at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), r.channels @> array['email']);
    if nid is not null then n := n + 1; end if;
  end if;

  select * into r from public.message_rules
   where enabled and trigger = 'after_end' and -dl >= days and -dl <= 45 and (applies_to = 'any' or (applies_to = 'trial') = is_trial)
   order by days desc limit 1;
  if found then
    nid := public._notify(t, r.kind, public._render(r.title, v), btrim(public._render(r.body, v)), r.action_url, 'auto', null, r.key,
                          to_char(eff at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), r.channels @> array['email']);
    if nid is not null then n := n + 1; end if;
  end if;
  return n;
end $$;
revoke all on function public._auto_for_tenant(uuid) from public, anon, authenticated;

-- every business (used by the optional daily schedule in file 17, and by the "Run now" button)
create or replace function public._run_auto_messages()
returns integer language plpgsql security definer set search_path = public as $$
declare t uuid; n integer := 0;
begin
  for t in select tenant_id from public.subscriptions loop n := n + public._auto_for_tenant(t); end loop;
  return n;
end $$;
revoke all on function public._run_auto_messages() from public, anon, authenticated;

-- ---- the owner's inbox ----
-- Opening the inbox also checks the clock-based reminders for that business, so reminders work even without a daily schedule.
create or replace function public.my_notifications()
returns jsonb language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_tenant();
begin
  if t is null or not public.is_admin() then return jsonb_build_object('unread', 0, 'items', '[]'::jsonb); end if;
  perform public._auto_for_tenant(t);
  return jsonb_build_object(
    'unread', (select count(*) from public.notifications n where n.tenant_id = t and n.read_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'body', x.body, 'actionUrl', x.action_url,
                'createdAt', x.created_at, 'readAt', x.read_at, 'source', x.source) order by x.created_at desc)
              from (select * from public.notifications n where n.tenant_id = t order by n.created_at desc limit 60) x), '[]'::jsonb));
end $$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  update public.notifications set read_at = now()
   where tenant_id = public.my_tenant() and read_at is null and (p_ids is null or id = any (p_ids));
end $$;
revoke all on function public.my_notifications() from public, anon;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.my_notifications() to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ===================================================================== 4) requests ==========
-- Owners send you: an extra-branch request, a renewal request (with their payment reference), or a plain message.
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('branch', 'renewal', 'support')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'closed')),
  subject text not null default '',
  message text not null default '',
  payload jsonb not null default '{}'::jsonb,
  decided_at timestamptz,
  decided_by uuid,
  decision_note text not null default '',
  amount_paise integer not null default 0
);
create index if not exists requests_tenant_idx on public.requests (tenant_id, created_at desc);
create index if not exists requests_status_idx on public.requests (status, created_at desc);
alter table public.requests enable row level security;
revoke all on public.requests from anon, authenticated;

create or replace function public.create_request(p_kind text, p_subject text, p_message text, p_payload jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_tenant(); rid uuid; pl jsonb := coalesce(p_payload, '{}'::jsonb); nm text; subj text := left(btrim(coalesce(p_subject, '')), 120); msg text := left(btrim(coalesce(p_message, '')), 1500);
begin
  if t is null or not public.is_admin() then raise exception 'Only the owner can send requests.'; end if;
  if p_kind not in ('branch', 'renewal', 'support') then raise exception 'Unknown request type.'; end if;
  if jsonb_typeof(pl) <> 'object' then raise exception 'Request details are not valid.'; end if;
  if (select count(*) from public.requests where tenant_id = t and status = 'pending') >= 10 then
    raise exception 'You already have 10 requests waiting. Please wait for our reply.';
  end if;
  if p_kind = 'branch' then
    nm := left(btrim(coalesce(pl ->> 'name', '')), 60);
    if char_length(nm) < 2 then raise exception 'Enter the name of the new branch.'; end if;
    if exists (select 1 from public.requests where tenant_id = t and kind = 'branch' and status = 'pending' and lower(payload ->> 'name') = lower(nm)) then
      raise exception 'You already asked for a branch with that name. Please wait for our reply.';
    end if;
    pl := jsonb_build_object('name', nm, 'address', left(btrim(coalesce(pl ->> 'address', '')), 200), 'phone', left(btrim(coalesce(pl ->> 'phone', '')), 20));
    subj := 'Extra branch: ' || nm;
  elsif p_kind = 'renewal' then
    pl := jsonb_build_object('period', left(coalesce(pl ->> 'period', ''), 40), 'reference', left(btrim(coalesce(pl ->> 'reference', '')), 80),
                             'amount', left(btrim(coalesce(pl ->> 'amount', '')), 20), 'paidOn', left(btrim(coalesce(pl ->> 'paidOn', '')), 20));
    subj := 'Renewal request';
  else
    if subj = '' then raise exception 'Write a short subject.'; end if;
    if msg = '' then raise exception 'Write your message.'; end if;
    pl := '{}'::jsonb;
  end if;
  insert into public.requests (tenant_id, created_by, created_by_email, kind, subject, message, payload)
  values (t, auth.uid(), auth.jwt() ->> 'email', p_kind, subj, msg, pl) returning id into rid;
  -- the automatic reply (editable in Super admin -> Automation)
  perform public._fire_event(p_kind || '_received', t, jsonb_build_object('branch', coalesce(pl ->> 'name', ''), 'subject', subj), rid::text);
  return rid;
end $$;

create or replace function public.my_requests()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.my_tenant();
begin
  if t is null or not public.is_admin() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'subject', r.subject, 'message', r.message, 'payload', r.payload,
              'createdAt', r.created_at, 'decidedAt', r.decided_at, 'note', r.decision_note) order by r.created_at desc)
            from (select * from public.requests where tenant_id = t order by created_at desc limit 40) r), '[]'::jsonb);
end $$;
revoke all on function public.create_request(text, text, text, jsonb) from public, anon;
revoke all on function public.my_requests() from public, anon;
grant execute on function public.create_request(text, text, text, jsonb) to authenticated;
grant execute on function public.my_requests() to authenticated;

-- ---- for you (Super admin -> Requests) ----
create or replace function public.platform_list_requests(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'tenantId', r.tenant_id, 'business', t.name, 'ownerEmail', coalesce(t.owner_email, r.created_by_email), 'phone', t.phone,
              'kind', r.kind, 'status', r.status, 'subject', r.subject, 'message', r.message, 'payload', r.payload, 'createdAt', r.created_at,
              'decidedAt', r.decided_at, 'note', r.decision_note, 'amount', r.amount_paise / 100.0,
              'branchLimit', t.branch_limit, 'branchesUsed', (select count(*) from public.branches b where b.tenant_id = t.id and b.active))
              order by (r.status = 'pending') desc, r.created_at desc)
            from (select * from public.requests where p_status is null or status = p_status order by created_at desc limit 200) r
            join public.tenants t on t.id = r.tenant_id), '[]'::jsonb);
end $$;

-- the grant-access logic without notifications, used by platform_grant_access and by approving a renewal
create or replace function public._grant_access_core(p_tenant uuid, p_period text, p_until timestamptz, p_note text, p_amount_paise integer)
returns void language plpgsql security definer set search_path = public as $$
declare per text;
begin
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
    insert into public.subscription_payments (id, tenant_id, amount_paise, period) values ('manual-' || gen_random_uuid()::text, p_tenant, p_amount_paise, per);
  end if;
end $$;
revoke all on function public._grant_access_core(uuid, text, timestamptz, text, integer) from public, anon, authenticated;

-- same name and inputs as file 15; now it also tells the owner (automatic message "Access given / extended")
create or replace function public.platform_grant_access(p_tenant uuid, p_period text, p_until timestamptz, p_note text, p_amount_paise integer default 0)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  perform public._grant_access_core(p_tenant, p_period, p_until, p_note, p_amount_paise);
  perform public._fire_event('access_granted', p_tenant, '{}'::jsonb, to_char(p_until, 'YYYY-MM-DD"T"HH24:MI:SS') || '-' || gen_random_uuid()::text);
end $$;
revoke all on function public.platform_grant_access(uuid, text, timestamptz, text, integer) from public, anon;
grant execute on function public.platform_grant_access(uuid, text, timestamptz, text, integer) to authenticated;

-- approve / decline / close a request
create or replace function public.platform_decide_request(p_id uuid, p_status text, p_note text default '', p_amount_paise integer default 0,
                                                          p_until timestamptz default null, p_period text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests; note text := left(btrim(coalesce(p_note, '')), 600); bn text; per text; nid uuid;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_status not in ('approved', 'rejected', 'closed') then raise exception 'Unknown decision.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found then raise exception 'That request was not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already answered.'; end if;
  if coalesce(p_amount_paise, 0) < 0 then raise exception 'Amount cannot be negative.'; end if;

  if r.kind = 'branch' then
    bn := r.payload ->> 'name';
    if p_status = 'approved' then
      update public.tenants set branch_limit = least(branch_limit + 1, 200) where id = r.tenant_id;
      if coalesce(bn, '') <> '' and not exists (select 1 from public.branches b where b.tenant_id = r.tenant_id and lower(btrim(b.name)) = lower(btrim(bn))) then
        insert into public.branches (tenant_id, name, address, phone) values (r.tenant_id, bn, coalesce(r.payload ->> 'address', ''), coalesce(r.payload ->> 'phone', ''));
      end if;
      if coalesce(p_amount_paise, 0) > 0 then
        insert into public.subscription_payments (id, tenant_id, amount_paise, period) values ('manual-branch-' || gen_random_uuid()::text, r.tenant_id, p_amount_paise, 'extra-branch');
      end if;
      perform public._fire_event('branch_approved', r.tenant_id, jsonb_build_object('branch', coalesce(bn, ''), 'note', note), r.id::text);
    else
      perform public._fire_event('branch_rejected', r.tenant_id, jsonb_build_object('branch', coalesce(bn, ''), 'note', note), r.id::text);
    end if;
  elsif r.kind = 'renewal' then
    if p_status = 'approved' then
      if p_until is null then raise exception 'Choose the date until which access should run.'; end if;
      per := coalesce(nullif(p_period, ''), nullif(r.payload ->> 'period', ''));
      if per is not null and not exists (select 1 from public.plans where period = per) then per := null; end if;
      perform public._grant_access_core(r.tenant_id, per, p_until, 'Renewal request approved', p_amount_paise);
      perform public._fire_event('renewal_approved', r.tenant_id, jsonb_build_object('until', to_char(p_until at time zone 'Asia/Kolkata', 'DD Mon YYYY'), 'note', note), r.id::text);
    else
      perform public._fire_event('renewal_rejected', r.tenant_id, jsonb_build_object('note', note), r.id::text);
    end if;
  else
    -- a plain message: "closing" it sends your reply
    if note = '' then raise exception 'Write your reply.'; end if;
    perform public._fire_event('support_replied', r.tenant_id, jsonb_build_object('note', note, 'subject', r.subject), r.id::text);
  end if;

  update public.requests set status = p_status, decided_at = now(), decided_by = auth.uid(), decision_note = note, amount_paise = coalesce(p_amount_paise, 0) where id = p_id;
end $$;

create or replace function public.platform_set_branch_limit(p_tenant uuid, p_limit integer)
returns void language plpgsql security definer set search_path = public as $$
declare used integer;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'Branches must be between 1 and 200.'; end if;
  select count(*) into used from public.branches where tenant_id = p_tenant and active;
  if p_limit < used then raise exception 'This business already uses % active branches. Ask them to switch some off first.', used; end if;
  update public.tenants set branch_limit = p_limit where id = p_tenant;
end $$;

-- extra facts about each business for the Manage window (type, phone, branch slots)
create or replace function public.platform_tenant_meta()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'businessType', t.business_type, 'phone', t.phone, 'branchLimit', t.branch_limit,
            'branches', (select count(*) from public.branches b where b.tenant_id = t.id and b.active),
            'owners', (select count(*) from public.members m where m.tenant_id = t.id and m.role = 'owner'),
            'unread', (select count(*) from public.notifications n where n.tenant_id = t.id and n.read_at is null)))
            from public.tenants t), '[]'::jsonb);
end $$;

create or replace function public.platform_update_tenant(p_tenant uuid, p_name text, p_type text, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Enter the business name.'; end if;
  update public.tenants set name = left(btrim(p_name), 80), business_type = left(btrim(coalesce(nullif(p_type, ''), business_type)), 40), phone = left(btrim(coalesce(p_phone, '')), 20) where id = p_tenant;
  if not found then raise exception 'Unknown business.'; end if;
end $$;

create or replace function public.platform_inbox_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return jsonb_build_object('requests', (select count(*) from public.requests where status = 'pending'),
                            'leads', (select count(*) from public.access_leads where status = 'new'));
end $$;

-- ===================================================================== 5) access leads ======
-- People who press "Request access" on the public page leave their details here.
create table if not exists public.access_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null, business text not null default '', phone text not null default '', email text not null default '', message text not null default '',
  status text not null default 'new' check (status in ('new', 'contacted', 'done'))
);
alter table public.access_leads enable row level security;
revoke all on public.access_leads from anon, authenticated;

create or replace function public.submit_access_lead(p_name text, p_business text, p_phone text, p_email text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text := left(btrim(coalesce(p_name, '')), 80); ph text := left(btrim(coalesce(p_phone, '')), 20); em text := lower(left(btrim(coalesce(p_email, '')), 120));
begin
  if char_length(nm) < 2 then raise exception 'Please enter your name.'; end if;
  if char_length(regexp_replace(ph, '[^0-9]', '', 'g')) < 8 and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then raise exception 'Please enter a phone number or email so we can reach you.'; end if;
  if (select count(*) from public.access_leads where created_at > now() - interval '1 hour') > 100 then raise exception 'Too many requests right now. Please WhatsApp us instead.'; end if;
  if exists (select 1 from public.access_leads where created_at > now() - interval '10 minutes' and ((ph <> '' and phone = ph) or (em <> '' and email = em))) then return; end if;
  insert into public.access_leads (name, business, phone, email, message)
  values (nm, left(btrim(coalesce(p_business, '')), 80), ph, em, left(btrim(coalesce(p_message, '')), 600));
end $$;

create or replace function public.platform_list_leads()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'createdAt', l.created_at, 'name', l.name, 'business', l.business, 'phone', l.phone, 'email', l.email, 'message', l.message, 'status', l.status)
            order by (l.status = 'new') desc, l.created_at desc) from (select * from public.access_leads order by created_at desc limit 200) l), '[]'::jsonb);
end $$;

create or replace function public.platform_set_lead(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_status = 'delete' then delete from public.access_leads where id = p_id; return; end if;
  if p_status not in ('new', 'contacted', 'done') then raise exception 'Unknown status.'; end if;
  update public.access_leads set status = p_status where id = p_id;
end $$;

revoke all on function public.platform_list_requests(text) from public, anon;
revoke all on function public.platform_decide_request(uuid, text, text, integer, timestamptz, text) from public, anon;
revoke all on function public.platform_set_branch_limit(uuid, integer) from public, anon;
revoke all on function public.platform_tenant_meta() from public, anon;
revoke all on function public.platform_update_tenant(uuid, text, text, text) from public, anon;
revoke all on function public.platform_inbox_counts() from public, anon;
revoke all on function public.platform_list_leads() from public, anon;
revoke all on function public.platform_set_lead(uuid, text) from public, anon;
revoke all on function public.platform_get_config() from public, anon;
revoke all on function public.platform_save_config(jsonb) from public, anon;
revoke all on function public.get_payment_info() from public, anon;
grant execute on function public.platform_list_requests(text) to authenticated;
grant execute on function public.platform_decide_request(uuid, text, text, integer, timestamptz, text) to authenticated;
grant execute on function public.platform_set_branch_limit(uuid, integer) to authenticated;
grant execute on function public.platform_tenant_meta() to authenticated;
grant execute on function public.platform_update_tenant(uuid, text, text, text) to authenticated;
grant execute on function public.platform_inbox_counts() to authenticated;
grant execute on function public.platform_list_leads() to authenticated;
grant execute on function public.platform_set_lead(uuid, text) to authenticated;
grant execute on function public.platform_get_config() to authenticated;
grant execute on function public.platform_save_config(jsonb) to authenticated;
grant execute on function public.get_payment_info() to authenticated;
revoke all on function public.submit_access_lead(text, text, text, text, text) from public;
grant execute on function public.submit_access_lead(text, text, text, text, text) to anon, authenticated;
revoke all on function public.public_contact() from public;
grant execute on function public.public_contact() to anon, authenticated;

-- ===================================================================== 6) sending messages ===
-- audience = {"mode":"all"} | {"mode":"selected","ids":[uuid,...]} | {"mode":"segment","segment":"expiring_7"}
-- segments: expiring_7, expiring_30, expired, due (expired or payment failed), trial, paid, multi_branch
create or replace function public._audience(p jsonb)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare mode text := coalesce(p ->> 'mode', 'all'); seg text := coalesce(p ->> 'segment', '');
begin
  if mode = 'selected' then
    return query select t.id from public.tenants t
                  where t.id in (select x::uuid from jsonb_array_elements_text(coalesce(p -> 'ids', '[]'::jsonb)) x);
  elsif mode = 'segment' then
    return query
      select t.id from public.tenants t
        left join public.subscriptions s on s.tenant_id = t.id
        cross join lateral (select case when s.status = 'trialing' then s.trial_ends_at else s.current_period_end end as eff) e
       where (seg = 'expiring_7'  and s.status in ('trialing', 'active', 'cancelled', 'past_due') and e.eff between now() and now() + interval '7 days')
          or (seg = 'expiring_30' and s.status in ('trialing', 'active', 'cancelled', 'past_due') and e.eff between now() and now() + interval '30 days')
          or (seg = 'expired'     and s.tenant_id is not null and not public.tenant_writable(t.id))
          or (seg = 'due'         and s.tenant_id is not null and (not public.tenant_writable(t.id) or s.status = 'past_due'))
          or (seg = 'trial'       and s.status = 'trialing' and public.tenant_writable(t.id))
          or (seg = 'paid'        and s.status = 'active' and public.tenant_writable(t.id))
          or (seg = 'multi_branch' and (select count(*) from public.branches b where b.tenant_id = t.id and b.active) > 1);
  else
    return query select t.id from public.tenants t;
  end if;
end $$;
revoke all on function public._audience(jsonb) from public, anon, authenticated;

-- who would get it, with the message already filled in for each (for the preview and the WhatsApp buttons)
create or replace function public.platform_preview_message(p_title text, p_body text, p_audience jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'business', t.name, 'ownerEmail', v ->> 'owner_email', 'phone', t.phone,
              'title', public._render(p_title, v), 'body', btrim(public._render(p_body, v)), 'endDate', v ->> 'end_date', 'plan', v ->> 'plan') order by t.name)
            from public.tenants t cross join lateral (select public._tenant_vars(t.id) as v) x
            where t.id in (select public._audience(p_audience))), '[]'::jsonb);
end $$;

create or replace function public.platform_send_message(p_title text, p_body text, p_kind text, p_channels text[], p_audience jsonb, p_url text default null, p_label text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid; t record; v jsonb; n integer := 0; ch text[]; outp jsonb := '[]'::jsonb; ttl text; bdy text; want_email boolean;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 1 or char_length(p_title) > 160 then raise exception 'Write a short title (up to 160 letters).'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 1 or char_length(p_body) > 1500 then raise exception 'Write the message (up to 1500 letters).'; end if;
  ch := array(select distinct c from unnest(coalesce(p_channels, array['app'])) c where c in ('app', 'whatsapp', 'email'));
  if not ('app' = any (ch)) then ch := ch || array['app']; end if;   -- the in-app inbox is always the record of the message
  want_email := 'email' = any (ch);
  insert into public.message_campaigns (created_by, title, body, kind, channels, audience, audience_label)
  values (auth.uid(), btrim(p_title), btrim(p_body), coalesce(nullif(p_kind, ''), 'info'), ch, coalesce(p_audience, '{}'::jsonb), left(coalesce(p_label, ''), 120)) returning id into cid;
  for t in select tn.id, tn.name, tn.phone from public.tenants tn where tn.id in (select public._audience(p_audience)) loop
    v := public._tenant_vars(t.id);
    ttl := public._render(btrim(p_title), v);
    bdy := btrim(public._render(btrim(p_body), v));
    perform public._notify(t.id, coalesce(nullif(p_kind, ''), 'info'), ttl, bdy, nullif(btrim(coalesce(p_url, '')), ''), 'manual', cid, null, null, want_email);
    n := n + 1;
    outp := outp || jsonb_build_array(jsonb_build_object('id', t.id, 'business', t.name, 'phone', t.phone, 'ownerEmail', v ->> 'owner_email', 'title', ttl, 'body', bdy));
  end loop;
  update public.message_campaigns set recipient_count = n where id = cid;
  return jsonb_build_object('campaignId', cid, 'count', n, 'recipients', outp, 'email', want_email);
end $$;

create or replace function public.platform_list_campaigns()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'createdAt', c.created_at, 'title', c.title, 'body', c.body, 'kind', c.kind, 'channels', c.channels,
              'audienceLabel', c.audience_label, 'count', c.recipient_count,
              'read', (select count(*) from public.notifications n where n.campaign_id = c.id and n.read_at is not null)) order by c.created_at desc)
            from (select * from public.message_campaigns order by created_at desc limit 60) c), '[]'::jsonb);
end $$;

-- templates
create or replace function public.platform_list_templates()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'title', title, 'body', body, 'kind', kind, 'builtin', builtin) order by builtin desc, name) from public.message_templates), '[]'::jsonb);
end $$;
create or replace function public.platform_save_template(p_id uuid, p_name text, p_title text, p_body text, p_kind text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Give the template a name.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 1 or char_length(btrim(coalesce(p_body, ''))) < 1 then raise exception 'Write the title and the message.'; end if;
  if p_id is null then
    insert into public.message_templates (name, title, body, kind) values (left(btrim(p_name), 60), left(btrim(p_title), 160), left(btrim(p_body), 1500), coalesce(nullif(p_kind, ''), 'info')) returning id into nid;
    return nid;
  end if;
  update public.message_templates set name = left(btrim(p_name), 60), title = left(btrim(p_title), 160), body = left(btrim(p_body), 1500), kind = coalesce(nullif(p_kind, ''), 'info') where id = p_id;
  return p_id;
end $$;
create or replace function public.platform_delete_template(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  delete from public.message_templates where id = p_id and not builtin;
end $$;

-- automatic rules
create or replace function public.platform_list_rules()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'description', description, 'trigger', trigger, 'appliesTo', applies_to, 'days', days, 'enabled', enabled,
            'title', title, 'body', body, 'kind', kind, 'channels', channels,
            'sent', (select count(*) from public.notifications n where n.rule_key = m.key)) order by sort, key) from public.message_rules m), '[]'::jsonb);
end $$;
create or replace function public.platform_save_rule(p_key text, p_enabled boolean, p_days integer, p_title text, p_body text, p_kind text, p_channels text[])
returns void language plpgsql security definer set search_path = public as $$
declare ch text[];
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 1 or char_length(btrim(coalesce(p_body, ''))) < 1 then raise exception 'Write the title and the message.'; end if;
  if p_days is null or p_days < 0 or p_days > 365 then raise exception 'Days must be between 0 and 365.'; end if;
  ch := array(select distinct c from unnest(coalesce(p_channels, array['app'])) c where c in ('app', 'email'));
  if not ('app' = any (ch)) then ch := ch || array['app']; end if;
  update public.message_rules set enabled = coalesce(p_enabled, true),
         days = case when trigger = 'event' then days else p_days end,
         title = left(btrim(p_title), 160), body = left(btrim(p_body), 1500),
         kind = case when p_kind in ('info', 'reminder', 'warning', 'payment', 'plan', 'branch', 'reply', 'success') then p_kind else kind end,
         channels = ch, updated_at = now()
   where key = p_key;
  if not found then raise exception 'Unknown rule.'; end if;
end $$;
create or replace function public.platform_run_auto_messages()
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return public._run_auto_messages();
end $$;

revoke all on function public.platform_preview_message(text, text, jsonb) from public, anon;
revoke all on function public.platform_send_message(text, text, text, text[], jsonb, text, text) from public, anon;
revoke all on function public.platform_list_campaigns() from public, anon;
revoke all on function public.platform_list_templates() from public, anon;
revoke all on function public.platform_save_template(uuid, text, text, text, text) from public, anon;
revoke all on function public.platform_delete_template(uuid) from public, anon;
revoke all on function public.platform_list_rules() from public, anon;
revoke all on function public.platform_save_rule(text, boolean, integer, text, text, text, text[]) from public, anon;
revoke all on function public.platform_run_auto_messages() from public, anon;
grant execute on function public.platform_preview_message(text, text, jsonb) to authenticated;
grant execute on function public.platform_send_message(text, text, text, text[], jsonb, text, text) to authenticated;
grant execute on function public.platform_list_campaigns() to authenticated;
grant execute on function public.platform_list_templates() to authenticated;
grant execute on function public.platform_save_template(uuid, text, text, text, text) to authenticated;
grant execute on function public.platform_delete_template(uuid) to authenticated;
grant execute on function public.platform_list_rules() to authenticated;
grant execute on function public.platform_save_rule(text, boolean, integer, text, text, text, text[]) to authenticated;
grant execute on function public.platform_run_auto_messages() to authenticated;

-- ===================================================================== 7) adding owners =====
-- Used by the "platform-owners" Edge Function (it creates the login; these functions create / attach the business).
create or replace function public.platform_find_user(p_email text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid; m public.members;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  select id into uid from auth.users where lower(email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if uid is null then return jsonb_build_object('found', false); end if;
  select * into m from public.members where user_id = uid;
  return jsonb_build_object('found', true, 'id', uid, 'hasBusiness', m.user_id is not null,
    'businessName', (select name from public.tenants where id = m.tenant_id), 'role', m.role);
end $$;

create or replace function public.platform_tenant_owner(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m public.members;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  select * into m from public.members where tenant_id = p_tenant and role = 'owner' order by created_at limit 1;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'userId', m.user_id, 'email', m.email);
end $$;

-- Creates the business (or, with p_tenant, adds one more owner login to an existing business) and starts access.
-- p_until null = free trial (length from Settings); a date = access until that date (free, or paid outside: amount).
create or replace function public.platform_create_owner(p_user uuid, p_email text, p_name text, p_type text, p_phone text, p_period text,
                                                        p_until timestamptz, p_amount_paise integer, p_note text, p_tenant uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare em text := lower(btrim(coalesce(p_email, ''))); nm text := btrim(coalesce(p_name, '')); tid uuid := p_tenant; base text; s text; tries integer := 0; days integer; slug_out text;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then raise exception 'The login was not created.'; end if;
  if exists (select 1 from public.members where user_id = p_user) then raise exception 'That login already belongs to a business.'; end if;

  if tid is not null then
    select slug into slug_out from public.tenants where id = tid;
    if not found then raise exception 'Unknown business.'; end if;
    insert into public.members (user_id, tenant_id, role, email, active) values (p_user, tid, 'owner', em, true);
    return jsonb_build_object('tenantId', tid, 'slug', slug_out, 'name', (select name from public.tenants where id = tid), 'existing', true);
  end if;

  if char_length(nm) < 2 then raise exception 'Enter the business name.'; end if;
  if exists (select 1 from public.tenants where owner_email = em) then raise exception 'That email already owns a business.'; end if;
  base := trim(both '-' from left(trim(both '-' from regexp_replace(lower(nm), '[^a-z0-9]+', '-', 'g')), 30));
  if length(base) < 3 or base in ('admin', 'login', 'signup', 'api', 'www', 'app', 't', 'billing', 'platform', 'support', 'help', 'static', 'assets', 'buy', 'welcome') then base := 'business'; end if;
  s := base;
  while exists (select 1 from public.tenants where slug = s) loop
    tries := tries + 1;
    s := base || '-' || (1000 + floor(random() * 9000))::integer;
    exit when tries > 30;
  end loop;
  insert into public.tenants (name, slug, owner_email, business_type, phone)
  values (left(nm, 80), s, em, left(btrim(coalesce(nullif(p_type, ''), 'Banquet hall')), 40), left(btrim(coalesce(p_phone, '')), 20)) returning id into tid;
  insert into public.members (user_id, tenant_id, role, email, active) values (p_user, tid, 'owner', em, true);
  insert into public.app_settings (tenant_id, id, data) values (tid, 'business', jsonb_build_object('name', left(nm, 80), 'phone', left(btrim(coalesce(p_phone, '')), 20), 'email', em)) on conflict do nothing;

  if p_until is not null then
    perform public._grant_access_core(tid, p_period, p_until, left(coalesce(p_note, ''), 300), coalesce(p_amount_paise, 0));
  else
    days := coalesce((select (data ->> 'trial_days')::integer from public.platform_settings where key = 'general'), 14);
    insert into public.subscriptions (tenant_id, status, trial_ends_at, access_note) values (tid, 'trialing', now() + make_interval(days => greatest(days, 0)), left(coalesce(p_note, ''), 300))
    on conflict (tenant_id) do update set status = 'trialing', trial_ends_at = excluded.trial_ends_at;
  end if;
  perform public._fire_event('welcome', tid, '{}'::jsonb, 'welcome');
  return jsonb_build_object('tenantId', tid, 'slug', s, 'name', left(nm, 80), 'existing', false);
end $$;

revoke all on function public.platform_find_user(text) from public, anon;
revoke all on function public.platform_tenant_owner(uuid) from public, anon;
revoke all on function public.platform_create_owner(uuid, text, text, text, text, text, timestamptz, integer, text, uuid) from public, anon;
grant execute on function public.platform_find_user(text) to authenticated;
grant execute on function public.platform_tenant_owner(uuid) to authenticated;
grant execute on function public.platform_create_owner(uuid, text, text, text, text, text, timestamptz, integer, text, uuid) to authenticated;

-- ---- manual access: nobody can create a business on their own any more (unless you switch it on in Settings)
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
  if not coalesce((select (data ->> 'allowSelfSignup')::boolean from public.platform_settings where key = 'config'), false) then
    raise exception 'New businesses are added by the Eventora team. Please contact us to get access.';
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

-- ===================================================================== 8) saved custom items ==
-- Owners AND employees can save "custom items" (name + default cost) to reuse in quotations.
create or replace function public.get_presets()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.my_tenant();
begin
  if t is null or public.my_role() not in ('admin', 'staff') then return '[]'::jsonb; end if;
  return coalesce((select data -> 'items' from public.app_settings where tenant_id = t and id = 'presets'), '[]'::jsonb);
end $$;

create or replace function public.save_presets(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_tenant(); it jsonb;
begin
  if t is null or public.my_role() not in ('admin', 'staff') then raise exception 'Please sign in.'; end if;
  if not public.my_tenant_writable() then raise exception 'Your access has ended. Contact Eventora to renew it.'; end if;
  if p is null or jsonb_typeof(p) <> 'array' then raise exception 'Saved items must be a list.'; end if;
  if jsonb_array_length(p) > 300 then raise exception 'You can save up to 300 items.'; end if;
  for it in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(it) <> 'object' or char_length(btrim(coalesce(it ->> 'name', ''))) not between 1 and 80
       or coalesce(it ->> 'price', '') !~ '^[0-9]+(\.[0-9]+)?$' or (it ->> 'price')::numeric > 100000000 then
      raise exception 'One of the saved items is not valid (name 1-80 letters, cost 0 or more).';
    end if;
  end loop;
  insert into public.app_settings (tenant_id, id, data, updated_at) values (t, 'presets', jsonb_build_object('items', p), now())
  on conflict (tenant_id, id) do update set data = excluded.data, updated_at = now();
end $$;
revoke all on function public.get_presets() from public, anon;
revoke all on function public.save_presets(jsonb) from public, anon;
grant execute on function public.get_presets() to authenticated;
grant execute on function public.save_presets(jsonb) to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================================
-- (file 18 is included below: UPI QR billing, monthly extra-branch fee, invoices)
-- =====================================================================================
-- =====================================================================================
-- 18 - BILLING: UPI QR with the exact amount, monthly extra-branch fee, one request for
--      "renew plan + add branches", and an automatic invoice when you approve.
--
--  * Extra branch = a MONTHLY fee per branch (Super admin -> Settings -> "Extra branch fee per month").
--  * Owner on an active plan adds a branch  -> pays  fee x months left in the plan.
--  * Owner renews                            -> pays  plan price + fee x plan months for every extra branch kept
--                                               (+ fee x (months left + plan months) for each NEW branch).
--  * Extra branches that are NOT paid again at renewal are switched off (their data is kept).
--  * When you approve, an invoice is created automatically (GST optional, everything editable by you).
--
-- Run ONCE in Supabase -> SQL Editor, AFTER file 16. Safe to run again.
-- =====================================================================================

do $$
begin
  if to_regclass('public.branches') is null or to_regprocedure('public.create_request(text,text,text,jsonb)') is null then
    raise exception 'Run file 16-manual-access-messages-branches.sql first. Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------- invoice settings ----
insert into public.platform_settings (key, data) values ('invoice', jsonb_build_object(
  'prefix', 'INV', 'next', 1, 'name', '', 'address', '', 'gstin', '', 'pan', '', 'phone', '', 'email', '',
  'terms', 'Software subscription. Access is activated after payment is confirmed.', 'footer', 'Thank you for choosing Eventora OS.',
  'gstEnabled', false, 'gstRate', 18)) on conflict (key) do nothing;

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid,
  number text not null unique,
  issued_at timestamptz not null default now(),
  bill_to jsonb not null default '{}'::jsonb,
  seller jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,          -- [{description, amount (rupees)}]
  gst_enabled boolean not null default false,
  gst_rate numeric not null default 0,
  subtotal_paise integer not null default 0,
  gst_paise integer not null default 0,
  total_paise integer not null default 0,
  paid_paise integer not null default 0,
  payment_ref text not null default '',
  paid_on date,
  period_from timestamptz,
  period_to timestamptz,
  plan_name text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscription_invoices_tenant_idx on public.subscription_invoices (tenant_id, issued_at desc);
alter table public.subscription_invoices enable row level security;
revoke all on public.subscription_invoices from anon, authenticated;

-- GST on an invoice is OPTIONAL and always "included in the price" (the amount the owner paid does not change):
-- with GST on, the total is split into taxable value + GST.
create or replace function public._invoice_totals(p_items jsonb, p_gst boolean, p_rate numeric)
returns jsonb language plpgsql immutable as $$
declare tot integer; sub integer;
begin
  tot := round(coalesce((select sum((i ->> 'amount')::numeric) from jsonb_array_elements(p_items) i), 0) * 100);
  if p_gst and coalesce(p_rate, 0) > 0 then
    sub := round(tot / (1 + p_rate / 100.0));
    return jsonb_build_object('subtotal', sub, 'gst', tot - sub, 'total', tot);
  end if;
  return jsonb_build_object('subtotal', tot, 'gst', 0, 'total', tot);
end $$;

create or replace function public._invoice_json(i public.subscription_invoices)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'number', i.number, 'issuedAt', i.issued_at, 'tenantId', i.tenant_id,
    'business', (select name from public.tenants where id = i.tenant_id), 'billTo', i.bill_to, 'seller', i.seller, 'items', i.items,
    'gstEnabled', i.gst_enabled, 'gstRate', i.gst_rate, 'subtotal', i.subtotal_paise / 100.0, 'gst', i.gst_paise / 100.0, 'total', i.total_paise / 100.0,
    'paid', i.paid_paise / 100.0, 'paymentRef', i.payment_ref, 'paidOn', i.paid_on, 'periodFrom', i.period_from, 'periodTo', i.period_to,
    'planName', i.plan_name, 'notes', i.notes);
$$;
revoke all on function public._invoice_totals(jsonb, boolean, numeric) from public, anon, authenticated;
revoke all on function public._invoice_json(public.subscription_invoices) from public, anon, authenticated;

-- ------------------------------------------------------------------ the price quote ----
-- whole months left in the running paid plan (at least 1 while it runs, at most 12)
create or replace function public._months_left(t uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select case when s.status = 'active' and s.current_period_end > now()
                               then least(12, greatest(1, ceil(extract(epoch from (s.current_period_end - now())) / 2592000.0)::integer)) else 0 end
                     from public.subscriptions s where s.tenant_id = t), 0);
$$;
revoke all on function public._months_left(uuid) from public, anon, authenticated;

-- p_renew: renewing / changing the plan in this payment.  p_keep: how many existing extra branches to keep (renewal only).
-- p_new: how many NEW branches are being added.  Returns the lines, the total and the new end date.
create or replace function public._billing_quote(t uuid, p_renew boolean, p_period text, p_keep integer, p_new integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tn public.tenants; s public.subscriptions; pl public.plans;
  bp numeric; extras integer; keep integer; newc integer := greatest(coalesce(p_new, 0), 0); ml integer; pm integer := 0; bm integer := 0;
  lines jsonb := '[]'::jsonb; total numeric := 0; plan_price numeric := 0; base timestamptz; new_end timestamptz;
begin
  select * into tn from public.tenants where id = t;
  if not found then raise exception 'Unknown business.'; end if;
  select * into s from public.subscriptions where tenant_id = t;
  bp := greatest(coalesce((select nullif(data ->> 'branchPrice', '')::numeric from public.platform_settings where key = 'config'), 0), 0);
  extras := greatest(tn.branch_limit - 1, 0);
  ml := public._months_left(t);
  if newc > 10 then raise exception 'You can add up to 10 branches at a time.'; end if;

  if p_renew then
    select * into pl from public.plans where period = p_period and active;
    if not found then raise exception 'Choose a plan.'; end if;
    pm := pl.months;
    plan_price := pl.price_paise / 100.0;
    keep := least(greatest(coalesce(p_keep, extras), 0), extras);
    bm := ml + pm;                                            -- a new branch is covered from today until the end of the NEW period
    base := case when s.status = 'active' and s.current_period_end > now() then s.current_period_end else now() end;
    new_end := base + make_interval(months => pm);
    lines := lines || jsonb_build_array(jsonb_build_object('label', pl.name || ' plan (' || pm || case when pm = 1 then ' month)' else ' months)' end, 'amount', plan_price));
    total := plan_price;
    if keep > 0 and bp > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object('label', 'Keep ' || keep || ' extra branch' || case when keep = 1 then '' else 'es' end
               || ' (₹' || to_char(bp, 'FM999,999,990') || ' per month × ' || pm || ' month' || case when pm = 1 then ')' else 's)' end, 'amount', keep * bp * pm));
      total := total + keep * bp * pm;
    end if;
  else
    if not (s.status = 'active' and ml > 0) then
      raise exception 'To add a branch your plan must be running. Choose "Renew my plan" in the same payment.';
    end if;
    keep := extras;
    bm := ml;
    new_end := s.current_period_end;
  end if;

  if newc > 0 and bp > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('label', newc || ' new extra branch' || case when newc = 1 then '' else 'es' end
             || ' (₹' || to_char(bp, 'FM999,999,990') || ' per month × ' || bm || ' month' || case when bm = 1 then ')' else 's)' end, 'amount', newc * bp * bm));
    total := total + newc * bp * bm;
  end if;

  return jsonb_build_object('renew', p_renew, 'period', coalesce(p_period, ''), 'planName', coalesce(pl.name, ''), 'planMonths', pm, 'planPrice', plan_price,
    'branchPrice', bp, 'extras', extras, 'keep', keep, 'newCount', newc, 'monthsLeft', ml, 'branchMonths', bm, 'lines', lines, 'total', total, 'newEnd', new_end);
end $$;
revoke all on function public._billing_quote(uuid, boolean, text, integer, integer) from public, anon, authenticated;

-- what the owner's Billing page asks for to draw the QR (same maths the request uses)
create or replace function public.billing_quote(p_renew boolean, p_period text, p_keep integer, p_new integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_tenant() is null or not public.is_admin() then raise exception 'Only the owner can do this.'; end if;
  return public._billing_quote(public.my_tenant(), coalesce(p_renew, false), nullif(p_period, ''), p_keep, p_new);
end $$;
revoke all on function public.billing_quote(boolean, text, integer, integer) from public, anon;
grant execute on function public.billing_quote(boolean, text, integer, integer) to authenticated;

-- ------------------------------------------------------------------ owner's request ----
create or replace function public.create_request(p_kind text, p_subject text, p_message text, p_payload jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.my_tenant(); rid uuid; pl jsonb := coalesce(p_payload, '{}'::jsonb); nm text;
  subj text := left(btrim(coalesce(p_subject, '')), 120); msg text := left(btrim(coalesce(p_message, '')), 1500);
  q jsonb; names jsonb := '[]'::jsonb; el jsonb; v_renew boolean; v_ref text; n integer; joined text;
begin
  if t is null or not public.is_admin() then raise exception 'Only the owner can send requests.'; end if;
  if p_kind not in ('branch', 'renewal', 'support') then raise exception 'Unknown request type.'; end if;
  if jsonb_typeof(pl) <> 'object' then raise exception 'Request details are not valid.'; end if;
  if (select count(*) from public.requests where tenant_id = t and status = 'pending') >= 10 then
    raise exception 'You already have 10 requests waiting. Please wait for our reply.';
  end if;

  if p_kind = 'branch' then
    nm := left(btrim(coalesce(pl ->> 'name', '')), 60);
    if char_length(nm) < 2 then raise exception 'Enter the name of the new branch.'; end if;
    if exists (select 1 from public.requests where tenant_id = t and kind = 'branch' and status = 'pending' and lower(payload ->> 'name') = lower(nm)) then
      raise exception 'You already asked for a branch with that name. Please wait for our reply.';
    end if;
    pl := jsonb_build_object('name', nm, 'address', left(btrim(coalesce(pl ->> 'address', '')), 200), 'phone', left(btrim(coalesce(pl ->> 'phone', '')), 20));
    subj := 'Extra branch: ' || nm;

  elsif p_kind = 'renewal' then
    v_renew := coalesce(pl ->> 'renew', 'true') <> 'false';
    if jsonb_typeof(coalesce(pl -> 'newBranches', '[]'::jsonb)) <> 'array' then raise exception 'Branch details are not valid.'; end if;
    for el in select * from jsonb_array_elements(coalesce(pl -> 'newBranches', '[]'::jsonb)) loop
      nm := left(btrim(coalesce(el ->> 'name', '')), 60);
      if char_length(nm) < 2 then raise exception 'Enter a name for every new branch.'; end if;
      names := names || jsonb_build_array(jsonb_build_object('name', nm, 'address', left(btrim(coalesce(el ->> 'address', '')), 200), 'phone', ''));
    end loop;
    n := jsonb_array_length(names);
    if not v_renew and n = 0 then raise exception 'Choose a plan renewal or add a branch.'; end if;
    q := public._billing_quote(t, v_renew, nullif(pl ->> 'period', ''), nullif(pl ->> 'keep', '')::integer, n);
    v_ref := left(btrim(coalesce(pl ->> 'reference', '')), 80);
    if (q ->> 'total')::numeric > 0 and char_length(v_ref) < 4 then raise exception 'Enter the UPI transaction ID (at least 4 characters).'; end if;
    pl := jsonb_build_object('renew', v_renew, 'period', coalesce(pl ->> 'period', ''), 'keep', q -> 'keep', 'newBranches', names, 'reference', v_ref,
                             'amount', left(btrim(coalesce(pl ->> 'amount', '')), 20), 'paidOn', left(btrim(coalesce(pl ->> 'paidOn', '')), 20), 'quote', q);
    subj := concat_ws(' + ', case when v_renew then 'Renew ' || coalesce(nullif(q ->> 'planName', ''), 'plan') end,
                             case when n > 0 then 'Add ' || n || ' branch' || case when n = 1 then '' else 'es' end end);
  else
    if subj = '' then raise exception 'Write a short subject.'; end if;
    if msg = '' then raise exception 'Write your message.'; end if;
    pl := '{}'::jsonb;
  end if;

  insert into public.requests (tenant_id, created_by, created_by_email, kind, subject, message, payload)
  values (t, auth.uid(), auth.jwt() ->> 'email', p_kind, subj, msg, pl) returning id into rid;

  joined := coalesce((select string_agg(x ->> 'name', ', ') from jsonb_array_elements(coalesce(pl -> 'newBranches', '[]'::jsonb)) x), coalesce(pl ->> 'name', ''));
  if p_kind = 'renewal' and not v_renew then
    perform public._fire_event('branch_received', t, jsonb_build_object('branch', joined, 'subject', subj), rid::text);
  else
    perform public._fire_event(p_kind || '_received', t, jsonb_build_object('branch', joined, 'subject', subj), rid::text);
  end if;
  return rid;
end $$;

-- ------------------------------------------------------------------ for you: list ------
create or replace function public.platform_list_requests(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'tenantId', r.tenant_id, 'business', t.name, 'ownerEmail', coalesce(t.owner_email, r.created_by_email), 'phone', t.phone,
              'kind', r.kind, 'status', r.status, 'subject', r.subject, 'message', r.message, 'payload', r.payload, 'createdAt', r.created_at,
              'decidedAt', r.decided_at, 'note', r.decision_note, 'amount', r.amount_paise / 100.0,
              'branchLimit', t.branch_limit, 'branchesUsed', (select count(*) from public.branches b where b.tenant_id = t.id and b.active),
              'periodEnd', s.current_period_end, 'subStatus', s.status)
              order by (r.status = 'pending') desc, r.created_at desc)
            from (select * from public.requests where p_status is null or status = p_status order by created_at desc limit 200) r
            join public.tenants t on t.id = r.tenant_id
            left join public.subscriptions s on s.tenant_id = r.tenant_id), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------ the invoice -------
create or replace function public._create_invoice(p_req public.requests, p_paid_paise integer, p_until timestamptz, p_old_end timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb; n integer; num text; tn public.tenants; biz jsonb; bt jsonb; seller jsonb; q jsonb; l jsonb; v_items jsonb := '[]'::jsonb;
  v_gst boolean; v_rate numeric; tots jsonb; nid uuid; v_from timestamptz; v_ref text; v_paid date;
begin
  select data into cfg from public.platform_settings where key = 'invoice' for update;
  cfg := coalesce(cfg, '{}'::jsonb);
  n := greatest(coalesce(nullif(cfg ->> 'next', '')::integer, 1), 1);
  insert into public.platform_settings (key, data) values ('invoice', jsonb_build_object('next', n + 1))
    on conflict (key) do update set data = public.platform_settings.data || jsonb_build_object('next', n + 1);
  num := coalesce(nullif(btrim(cfg ->> 'prefix'), ''), 'INV') || '-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(n::text, 4, '0');
  while exists (select 1 from public.subscription_invoices where number = num) loop
    n := n + 1; num := coalesce(nullif(btrim(cfg ->> 'prefix'), ''), 'INV') || '-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(n::text, 4, '0');
  end loop;

  select * into tn from public.tenants where id = p_req.tenant_id;
  biz := coalesce((select data from public.app_settings where tenant_id = tn.id and id = 'business'), '{}'::jsonb);
  bt := jsonb_build_object('name', coalesce(nullif(biz ->> 'name', ''), tn.name), 'address', coalesce(biz ->> 'address', ''), 'gstin', coalesce(biz ->> 'gstin', ''),
        'phone', coalesce(nullif(biz ->> 'phone', ''), tn.phone, ''), 'email', coalesce(nullif(biz ->> 'email', ''), tn.owner_email, ''));
  seller := jsonb_build_object('name', coalesce(cfg ->> 'name', ''), 'address', coalesce(cfg ->> 'address', ''), 'gstin', coalesce(cfg ->> 'gstin', ''), 'pan', coalesce(cfg ->> 'pan', ''),
        'phone', coalesce(cfg ->> 'phone', ''), 'email', coalesce(cfg ->> 'email', ''), 'terms', coalesce(cfg ->> 'terms', ''), 'footer', coalesce(cfg ->> 'footer', ''));

  q := p_req.payload -> 'quote';
  if q is not null and jsonb_typeof(q -> 'lines') = 'array' and jsonb_array_length(q -> 'lines') > 0 then
    for l in select * from jsonb_array_elements(q -> 'lines') loop
      v_items := v_items || jsonb_build_array(jsonb_build_object('description', left(l ->> 'label', 200), 'amount', round((l ->> 'amount')::numeric, 2)));
    end loop;
  else
    v_items := jsonb_build_array(jsonb_build_object('description', 'Eventora OS subscription', 'amount', round(p_paid_paise / 100.0, 2)));
  end if;

  v_gst := coalesce((cfg ->> 'gstEnabled')::boolean, false);
  v_rate := coalesce(nullif(cfg ->> 'gstRate', '')::numeric, 0);
  tots := public._invoice_totals(v_items, v_gst, v_rate);
  v_ref := left(coalesce(p_req.payload ->> 'reference', ''), 80);
  begin v_paid := nullif(p_req.payload ->> 'paidOn', '')::date; exception when others then v_paid := null; end;
  v_from := case when p_old_end is not null and p_old_end > now() then p_old_end else now() end;

  insert into public.subscription_invoices (tenant_id, request_id, number, bill_to, seller, items, gst_enabled, gst_rate, subtotal_paise, gst_paise, total_paise, paid_paise,
                                            payment_ref, paid_on, period_from, period_to, plan_name)
  values (tn.id, p_req.id, num, bt, seller, v_items, v_gst, v_rate, (tots ->> 'subtotal')::integer, (tots ->> 'gst')::integer, (tots ->> 'total')::integer,
          greatest(p_paid_paise, 0), v_ref, coalesce(v_paid, (now() at time zone 'Asia/Kolkata')::date),
          case when p_until is not null then v_from end, p_until, coalesce(q ->> 'planName', ''))
  returning id into nid;
  return nid;
end $$;
revoke all on function public._create_invoice(public.requests, integer, timestamptz, timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------------ you decide ---------
create or replace function public.platform_decide_request(p_id uuid, p_status text, p_note text default '', p_amount_paise integer default 0,
                                                          p_until timestamptz default null, p_period text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.requests; note text := left(btrim(coalesce(p_note, '')), 600); bn text; per text; pl jsonb; v_renew boolean; tn public.tenants;
  extras integer; v_keep integer; el jsonb; nm text; old_end timestamptz; paid integer; joined text; qtotal numeric;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_status not in ('approved', 'rejected', 'closed') then raise exception 'Unknown decision.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found then raise exception 'That request was not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already answered.'; end if;
  if coalesce(p_amount_paise, 0) < 0 then raise exception 'Amount cannot be negative.'; end if;

  if r.kind = 'branch' then
    -- older single-branch requests (before payments were added to Billing)
    bn := r.payload ->> 'name';
    if p_status = 'approved' then
      update public.tenants set branch_limit = least(branch_limit + 1, 200) where id = r.tenant_id;
      if coalesce(bn, '') <> '' and not exists (select 1 from public.branches b where b.tenant_id = r.tenant_id and lower(btrim(b.name)) = lower(btrim(bn))) then
        insert into public.branches (tenant_id, name, address, phone) values (r.tenant_id, bn, coalesce(r.payload ->> 'address', ''), coalesce(r.payload ->> 'phone', ''));
      end if;
      if coalesce(p_amount_paise, 0) > 0 then
        insert into public.subscription_payments (id, tenant_id, amount_paise, period) values ('manual-branch-' || gen_random_uuid()::text, r.tenant_id, p_amount_paise, 'extra-branch');
      end if;
      perform public._fire_event('branch_approved', r.tenant_id, jsonb_build_object('branch', coalesce(bn, ''), 'note', note), r.id::text);
    else
      perform public._fire_event('branch_rejected', r.tenant_id, jsonb_build_object('branch', coalesce(bn, ''), 'note', note), r.id::text);
    end if;

  elsif r.kind = 'renewal' then
    pl := r.payload;
    v_renew := coalesce(pl ->> 'renew', 'true') <> 'false';
    joined := coalesce((select string_agg(x ->> 'name', ', ') from jsonb_array_elements(coalesce(pl -> 'newBranches', '[]'::jsonb)) x), '');
    if p_status = 'approved' then
      select * into tn from public.tenants where id = r.tenant_id for update;
      old_end := (select current_period_end from public.subscriptions where tenant_id = r.tenant_id);
      qtotal := coalesce((pl -> 'quote' ->> 'total')::numeric, 0);
      paid := case when coalesce(p_amount_paise, 0) > 0 then p_amount_paise else round(qtotal * 100)::integer end;

      if v_renew then
        if p_until is null then raise exception 'Choose the date until which access should run.'; end if;
        per := coalesce(nullif(p_period, ''), nullif(pl ->> 'period', ''));
        if per is not null and not exists (select 1 from public.plans where period = per) then per := null; end if;
        perform public._grant_access_core(r.tenant_id, per, p_until, 'Renewal request approved', paid);
      elsif paid > 0 then
        insert into public.subscription_payments (id, tenant_id, amount_paise, period) values ('manual-branch-' || gen_random_uuid()::text, r.tenant_id, paid, 'extra-branch');
      end if;

      -- branches (requests made from the new Billing page carry "keep" / "newBranches")
      if pl ? 'keep' or pl ? 'newBranches' then
        extras := greatest(tn.branch_limit - 1, 0);
        if v_renew then
          v_keep := least(greatest(coalesce(nullif(pl ->> 'keep', '')::integer, extras), 0), extras);
          if v_keep < extras then
            -- extra branches that were not paid again are switched off (data is kept); the newest ones go first
            update public.tenants set branch_limit = 1 + v_keep where id = tn.id;
            update public.branches set active = false
             where id in (select b.id from public.branches b where b.tenant_id = tn.id and b.active and not b.is_main order by b.created_at asc offset v_keep);
          end if;
        end if;
        for el in select * from jsonb_array_elements(coalesce(pl -> 'newBranches', '[]'::jsonb)) loop
          nm := el ->> 'name';
          update public.tenants set branch_limit = least(branch_limit + 1, 200) where id = tn.id;
          if coalesce(nm, '') <> '' and not exists (select 1 from public.branches b where b.tenant_id = tn.id and lower(btrim(b.name)) = lower(btrim(nm))) then
            insert into public.branches (tenant_id, name, address, phone) values (tn.id, nm, coalesce(el ->> 'address', ''), coalesce(el ->> 'phone', ''));
          end if;
        end loop;
      end if;

      if paid > 0 then perform public._create_invoice(r, paid, case when v_renew then p_until end, old_end); end if;

      if v_renew then
        perform public._fire_event('renewal_approved', r.tenant_id, jsonb_build_object('until', to_char(p_until at time zone 'Asia/Kolkata', 'DD Mon YYYY'), 'note', note), r.id::text);
      else
        perform public._fire_event('branch_approved', r.tenant_id, jsonb_build_object('branch', joined, 'note', note), r.id::text);
      end if;
    else
      perform public._fire_event('renewal_rejected', r.tenant_id, jsonb_build_object('note', note), r.id::text);
    end if;

  else
    if note = '' then raise exception 'Write your reply.'; end if;
    perform public._fire_event('support_replied', r.tenant_id, jsonb_build_object('note', note, 'subject', r.subject), r.id::text);
  end if;

  update public.requests set status = p_status, decided_at = now(), decided_by = auth.uid(), decision_note = note,
         amount_paise = case when p_status = 'approved' then coalesce(nullif(p_amount_paise, 0), round(coalesce((payload -> 'quote' ->> 'total')::numeric, 0) * 100)::integer, 0) else 0 end
   where id = p_id;
end $$;

-- ------------------------------------------------------------------ invoices: read / edit ----
create or replace function public.my_invoices()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_tenant() is null or not public.is_admin() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(public._invoice_json(i) order by i.issued_at desc) from public.subscription_invoices i where i.tenant_id = public.my_tenant()), '[]'::jsonb);
end $$;

create or replace function public.platform_list_invoices()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(public._invoice_json(i) order by i.issued_at desc) from (select * from public.subscription_invoices order by issued_at desc limit 300) i), '[]'::jsonb);
end $$;

create or replace function public._pick_text(p jsonb, keys text[])
returns jsonb language plpgsql immutable as $$
declare k text; res jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return res; end if;
  foreach k in array keys loop
    if p ? k then res := res || jsonb_build_object(k, left(btrim(coalesce(p ->> k, '')), 400)); end if;
  end loop;
  return res;
end $$;
revoke all on function public._pick_text(jsonb, text[]) from public, anon, authenticated;

create or replace function public.platform_update_invoice(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.subscription_invoices; it jsonb; v_items jsonb; v_gst boolean; v_rate numeric; tots jsonb; v_num text;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  select * into inv from public.subscription_invoices where id = p_id for update;
  if not found then raise exception 'That invoice was not found.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Invoice details are missing.'; end if;

  v_items := coalesce(p -> 'items', inv.items);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) not between 1 and 20 then raise exception 'An invoice needs 1 to 20 lines.'; end if;
  for it in select * from jsonb_array_elements(v_items) loop
    if jsonb_typeof(it) <> 'object' or char_length(btrim(coalesce(it ->> 'description', ''))) not between 1 and 200 or coalesce(it ->> 'amount', '') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'Each line needs a description and an amount (0 or more).';
    end if;
  end loop;
  v_items := (select jsonb_agg(jsonb_build_object('description', left(btrim(i ->> 'description'), 200), 'amount', round((i ->> 'amount')::numeric, 2))) from jsonb_array_elements(v_items) i);
  v_gst := coalesce((p ->> 'gstEnabled')::boolean, inv.gst_enabled);
  v_rate := coalesce(nullif(p ->> 'gstRate', '')::numeric, inv.gst_rate);
  if v_rate < 0 or v_rate > 40 then raise exception 'GST rate must be between 0 and 40.'; end if;
  tots := public._invoice_totals(v_items, v_gst, v_rate);
  v_num := left(coalesce(nullif(btrim(p ->> 'number'), ''), inv.number), 30);

  update public.subscription_invoices set
    number = v_num, items = v_items, gst_enabled = v_gst, gst_rate = v_rate,
    bill_to = inv.bill_to || public._pick_text(p -> 'billTo', array['name', 'address', 'gstin', 'phone', 'email']),
    seller = inv.seller || public._pick_text(p -> 'seller', array['name', 'address', 'gstin', 'pan', 'phone', 'email', 'terms', 'footer']),
    subtotal_paise = (tots ->> 'subtotal')::integer, gst_paise = (tots ->> 'gst')::integer, total_paise = (tots ->> 'total')::integer,
    paid_paise = case when p ? 'paid' then round(greatest((p ->> 'paid')::numeric, 0) * 100)::integer else inv.paid_paise end,
    payment_ref = left(coalesce(p ->> 'paymentRef', inv.payment_ref), 80),
    paid_on = coalesce(nullif(p ->> 'paidOn', '')::date, inv.paid_on),
    issued_at = coalesce(nullif(p ->> 'issuedAt', '')::timestamptz, inv.issued_at),
    notes = left(coalesce(p ->> 'notes', inv.notes), 600), plan_name = left(coalesce(p ->> 'planName', inv.plan_name), 80), updated_at = now()
  where id = p_id;
exception when unique_violation then
  raise exception 'That invoice number is already used.';
end $$;

-- your own details on the invoice (name, address, GST number, GST on/off, rate, numbering)
create or replace function public.platform_get_invoice_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select data from public.platform_settings where key = 'invoice'), '{}'::jsonb);
end $$;

create or replace function public.platform_save_invoice_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare clean jsonb; v_prefix text; v_next integer; v_rate numeric;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Settings are missing.'; end if;
  clean := public._pick_text(p, array['name', 'address', 'gstin', 'pan', 'phone', 'email', 'terms', 'footer']);
  v_prefix := upper(regexp_replace(coalesce(p ->> 'prefix', 'INV'), '[^A-Za-z0-9]', '', 'g'));
  if v_prefix = '' then v_prefix := 'INV'; end if;
  v_rate := coalesce(nullif(p ->> 'gstRate', '')::numeric, 18);
  if v_rate < 0 or v_rate > 40 then raise exception 'GST rate must be between 0 and 40.'; end if;
  clean := clean || jsonb_build_object('prefix', left(v_prefix, 10), 'gstEnabled', coalesce((p ->> 'gstEnabled')::boolean, false), 'gstRate', v_rate);
  v_next := nullif(p ->> 'next', '')::integer;
  if v_next is not null then
    if v_next < 1 or v_next > 99999999 then raise exception 'The next invoice number must be 1 or more.'; end if;
    clean := clean || jsonb_build_object('next', v_next);
  end if;
  insert into public.platform_settings (key, data) values ('invoice', clean)
  on conflict (key) do update set data = public.platform_settings.data || excluded.data;
end $$;

revoke all on function public.create_request(text, text, text, jsonb) from public, anon;
revoke all on function public.platform_list_requests(text) from public, anon;
revoke all on function public.platform_decide_request(uuid, text, text, integer, timestamptz, text) from public, anon;
revoke all on function public.my_invoices() from public, anon;
revoke all on function public.platform_list_invoices() from public, anon;
revoke all on function public.platform_update_invoice(uuid, jsonb) from public, anon;
revoke all on function public.platform_get_invoice_settings() from public, anon;
revoke all on function public.platform_save_invoice_settings(jsonb) from public, anon;
grant execute on function public.create_request(text, text, text, jsonb) to authenticated;
grant execute on function public.platform_list_requests(text) to authenticated;
grant execute on function public.platform_decide_request(uuid, text, text, integer, timestamptz, text) to authenticated;
grant execute on function public.my_invoices() to authenticated;
grant execute on function public.platform_list_invoices() to authenticated;
grant execute on function public.platform_update_invoice(uuid, jsonb) to authenticated;
grant execute on function public.platform_get_invoice_settings() to authenticated;
grant execute on function public.platform_save_invoice_settings(jsonb) to authenticated;

-- ---- wording: the extra-branch fee is MONTHLY, and the owner is told where the invoice is
update public.message_rules set body = replace(body, 'Extra branch fee: ₹{branch_price}.', 'Extra branch fee: ₹{branch_price} per month for each branch.') where key = 'branch_received';
update public.message_rules set body = body || ' Your invoice is ready in Billing → Invoices.' where key = 'renewal_approved' and body not like '%Invoices%';
update public.message_rules set body = body || ' Your invoice is ready in Billing → Invoices.' where key = 'branch_approved' and body not like '%Invoices%';

notify pgrst, 'reload schema';


-- ============================== FINAL CHECK (must be all OK) ==============================
select 'platform_admins table exists' as check, case when to_regclass('public.platform_admins') is not null then 'OK' else 'MISSING' end
union all select 'plans table exists', case when to_regclass('public.plans') is not null then 'OK' else 'MISSING' end
union all select 'plan creation function exists', case when to_regprocedure('public.platform_upsert_plan(text,text,integer,integer,text,text[],boolean,boolean,integer)') is not null then 'OK' else 'MISSING' end
union all select 'super admin dashboard exists', case when to_regprocedure('public.platform_dashboard()') is not null then 'OK' else 'MISSING' end
union all select 'give-access function exists', case when to_regprocedure('public.platform_grant_access(uuid,text,timestamptz,text,integer)') is not null then 'OK' else 'MISSING' end
union all select 'at least one active plan', case when exists (select 1 from public.plans where active) then 'OK' else 'NO ACTIVE PLAN' end
union all select 'super admin login set (if NO, run make-platform-admin.sql)', case when exists (select 1 from public.platform_admins) then 'OK' else 'NO' end
union all select 'every business has a Main branch', case when not exists (select 1 from public.tenants t where not exists (select 1 from public.branches b where b.tenant_id = t.id and b.is_main)) then 'OK' else 'MISSING' end
union all select 'every bill has a branch', case when not exists (select 1 from public.quotes where branch_id is null) then 'OK' else 'MISSING' end
union all select 'messages, requests and rules exist', case when to_regclass('public.notifications') is not null and to_regclass('public.requests') is not null and (select count(*) from public.message_rules) >= 10 then 'OK' else 'MISSING' end
union all select 'add-owner function exists', case when to_regprocedure('public.platform_create_owner(uuid,text,text,text,text,text,timestamptz,integer,text,uuid)') is not null then 'OK' else 'MISSING' end
union all select 'branch + saved-item functions exist', case when to_regprocedure('public.save_branch(uuid,text,text,text,boolean)') is not null and to_regprocedure('public.save_presets(jsonb)') is not null then 'OK' else 'MISSING' end
union all select 'invoice table + billing quote exist', case when to_regclass('public.subscription_invoices') is not null and to_regprocedure('public.billing_quote(boolean,text,integer,integer)') is not null then 'OK' else 'MISSING' end;


-- ------------------------------ 23-enquiry-link-drafts ------------------------------
-- ============================================================================
-- Eventora OS — SQL file 23: customer enquiry link + "Draft" bills.
--
-- What this adds
--   1. A new bill status: 'draft'. A draft is a bill a customer filled in themselves through the business's
--      public link (https://your-site/#/enquiry/<business-slug>). It has no services and no price yet.
--      The owner / employee calls the customer, opens the draft, fills Step 2 and saves: it becomes a normal quotation.
--   2. enquiry_info(slug)      -> what the public form needs to show (business name, active branches). Anyone may call it.
--   3. submit_enquiry(slug, p) -> creates ONE new draft bill (its own bill number) for the business behind the slug.
--      Bill number, GST and PAN are never asked from the customer. Anyone may call it, so it is strictly validated and rate-limited.
--   4. Drafts never block the calendar (only 'confirmed' bills do) and are not counted as quotations in reports.
--
-- Safe to run again. Run it after file 16 (and after 21 / 22 if you use them). It replaces the employee-rules trigger function and the
-- bill read/update policies with the same rules as before plus one change each: employees can see drafts and can turn a draft into a quotation.
-- ============================================================================

-- ---- 1) allow the 'draft' status ------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.quotes'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.quotes drop constraint %I', c.conname);
  end loop;
  alter table public.quotes add constraint quotes_status_check check (status in ('draft', 'new', 'contacted', 'confirmed', 'archived'));
end $$;

-- how the enquiry came in (only used for the little "from website link" tag); the app reads it from pricing.source
create index if not exists quotes_draft_idx on public.quotes (tenant_id, status) where status = 'draft';

-- ---- 2) employees: a draft is visible to the employees of its branch, and filling it in (draft -> quotation) is always allowed ----
drop policy if exists "team read quotes" on public.quotes;
create policy "team read quotes" on public.quotes for select to authenticated
  using (tenant_id = public.my_tenant() and (public.is_admin()
         or (public.is_staff() and branch_id = public.my_branch() and (public.staff_can('viewAllBills') or created_by = auth.uid() or status = 'draft'))));

drop policy if exists "team update quotes" on public.quotes;
create policy "team update quotes" on public.quotes for update to authenticated
  using (tenant_id = public.my_tenant() and public.tenant_writable(tenant_id)
         and (public.is_admin() or (public.is_staff() and branch_id = public.my_branch() and (public.staff_can('viewAllBills') or created_by = auth.uid() or status = 'draft'))))
  with check (tenant_id = public.my_tenant() and public.tenant_writable(tenant_id));

create or replace function public.enforce_staff_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare keep text[] := array['payments', 'advancePaid', 'advanceAmount', 'balanceDue'];
begin
  if new.tenant_id is distinct from old.tenant_id then raise exception 'A bill cannot move to another business.'; end if;
  if current_setting('eventora.platform_op', true) = '1' and public.is_platform_admin() then return new; end if;
  if public.is_admin() then return new; end if;
  if not public.is_staff() then raise exception 'You do not have access.'; end if;
  if new.branch_id is distinct from old.branch_id then raise exception 'Only the owner can move a bill to another branch.'; end if;
  if new.reference is distinct from old.reference then raise exception 'The bill number cannot be changed.'; end if;
  if new.created_by is distinct from old.created_by or new.created_by_email is distinct from old.created_by_email then
    raise exception 'Who created the bill cannot be changed.';
  end if;
  -- turning a customer's draft into a quotation is part of the normal work, so it is not "marking as booked"
  if new.status is distinct from old.status and not (old.status = 'draft' and new.status = 'new') and not public.staff_can('markBooked') then
    raise exception 'Employees are not allowed to mark bills as booked or release them.';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(old.pricing -> 'payments', '[]'::jsonb)) o
             where not exists (select 1 from jsonb_array_elements(coalesce(new.pricing -> 'payments', '[]'::jsonb)) n where n ->> 'id' = o ->> 'id'))
     and not public.staff_can('removePayments') then
    raise exception 'Employees are not allowed to remove payments.';
  end if;
  if (new.customer_name, new.mobile, new.event_type, new.event_date, new.guests, new.customer_gst_number, new.hall, new.services, new.pricing - keep)
     is distinct from
     (old.customer_name, old.mobile, old.event_type, old.event_date, old.guests, old.customer_gst_number, old.hall, old.services, old.pricing - keep)
     and not (old.status = 'draft' and new.status = 'new')
     and not public.staff_can('editBills') then
    raise exception 'Employees are not allowed to edit bills.';
  end if;
  return new;
end $$;
drop trigger if exists enforce_staff_rules_trg on public.quotes;
create trigger enforce_staff_rules_trg before update on public.quotes for each row execute function public.enforce_staff_rules();

-- ---- 3) public: what the enquiry page shows ----------------------------------------------------
create or replace function public.enquiry_info(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t uuid; tn public.tenants; biz jsonb;
begin
  select * into tn from public.tenants where slug = lower(btrim(coalesce(p_slug, '')));
  if tn.id is null then return jsonb_build_object('found', false); end if;
  t := tn.id;
  select data into biz from public.app_settings where tenant_id = t and id = 'business';
  return jsonb_build_object(
    'found', true,
    'name', coalesce(nullif(btrim(biz ->> 'name'), ''), tn.name),
    'phone', coalesce(biz ->> 'phone', ''),
    'open', public.tenant_writable(t),
    'branches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.is_main desc, b.created_at)
                            from public.branches b where b.tenant_id = t and b.active), '[]'::jsonb));
end $$;
revoke all on function public.enquiry_info(text) from public;
grant execute on function public.enquiry_info(text) to anon, authenticated;

-- ---- 4) public: a customer submits the form -> one new draft bill ---------------------------------
create or replace function public.submit_enquiry(p_slug text, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t uuid; tn public.tenants; biz jsonb;
  v_name text; v_mobile text; v_email text; v_type text; v_guests integer; v_branch uuid; v_ref text; v_hall text;
  v_dates text[] := '{}'; v_slots jsonb := '{}'::jsonb; d text; s jsonb; v_first date; today date := (now() at time zone 'Asia/Kolkata')::date;
  v_pricing jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Please fill in the form.'; end if;
  -- hidden "website" field: real people leave it empty, simple bots fill it. Pretend it worked.
  if coalesce(btrim(p ->> 'website'), '') <> '' then return jsonb_build_object('ok', true, 'reference', ''); end if;

  select * into tn from public.tenants where slug = lower(btrim(coalesce(p_slug, '')));
  if tn.id is null then raise exception 'This link is not valid. Please ask the business for the correct link.'; end if;
  t := tn.id;
  if not public.tenant_writable(t) then raise exception 'This business is not taking online enquiries right now. Please call them directly.'; end if;

  v_name := btrim(coalesce(p ->> 'name', ''));
  if char_length(v_name) < 2 or char_length(v_name) > 80 then raise exception 'Please enter your name.'; end if;

  v_mobile := right(regexp_replace(coalesce(p ->> 'mobile', ''), '[^0-9]', '', 'g'), 10);
  if v_mobile !~ '^[6-9][0-9]{9}$' then raise exception 'Enter a valid 10-digit mobile number.'; end if;

  v_email := lower(btrim(coalesce(p ->> 'email', '')));
  if v_email <> '' and (char_length(v_email) > 120 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Enter a valid e-mail address.'; end if;

  v_type := btrim(coalesce(p ->> 'eventType', ''));
  if v_type = '' or char_length(v_type) > 60 then raise exception 'Choose the event type.'; end if;

  begin v_guests := (p ->> 'guests')::integer; exception when others then v_guests := null; end;
  if v_guests is null or v_guests < 1 or v_guests > 100000 then raise exception 'Enter the number of guests.'; end if;

  if jsonb_typeof(p -> 'dates') is distinct from 'array' or jsonb_array_length(p -> 'dates') < 1 then raise exception 'Choose at least one event date.'; end if;
  if jsonb_array_length(p -> 'dates') > 15 then raise exception 'Please choose at most 15 dates.'; end if;
  for d in select jsonb_array_elements_text(p -> 'dates') loop
    begin
      if d !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or d::date < today or d::date > today + 1830 then raise exception 'bad'; end if;
    exception when others then raise exception 'Choose event dates from today onwards.'; end;
    if not d = any (v_dates) then v_dates := v_dates || d; end if;
  end loop;
  select min(x::date) into v_first from unnest(v_dates) x;

  -- optional times, only kept when both are valid HH:MM
  if jsonb_typeof(p -> 'slots') = 'object' then
    foreach d in array v_dates loop
      s := p -> 'slots' -> d;
      if jsonb_typeof(s) = 'object' and coalesce(s ->> 'start', '') ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' and coalesce(s ->> 'end', '') ~ '^([01]?[0-9]|2[0-3]|24):[0-5][0-9]$' then
        v_slots := v_slots || jsonb_build_object(d, jsonb_build_object('start', s ->> 'start', 'end', s ->> 'end'));
      end if;
    end loop;
  end if;

  -- branch: the one chosen (must be active and belong to this business), else the Main branch
  begin v_branch := nullif(btrim(coalesce(p ->> 'branchId', '')), '')::uuid; exception when others then v_branch := null; end;
  if v_branch is not null and not exists (select 1 from public.branches b where b.id = v_branch and b.tenant_id = t and b.active) then v_branch := null; end if;
  if v_branch is null then
    select b.id into v_branch from public.branches b where b.tenant_id = t and b.active order by b.is_main desc, b.created_at limit 1;
  end if;
  if v_branch is null then raise exception 'This business is not taking online enquiries right now. Please call them directly.'; end if;

  -- anti-spam: 5 enquiries per mobile number per hour, 200 per business per hour
  if (select count(*) from public.quotes q where q.tenant_id = t and q.mobile = v_mobile and q.created_by is null and q.created_at > now() - interval '1 hour') >= 5 then
    raise exception 'We already received your details. The team will call you soon.';
  end if;
  if (select count(*) from public.quotes q where q.tenant_id = t and q.created_by is null and q.created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Too many enquiries right now. Please try again in a little while.';
  end if;

  select data into biz from public.app_settings where tenant_id = t and id = 'business';
  v_hall := coalesce(nullif(btrim(biz ->> 'name'), ''), tn.name, 'Eventora');

  v_pricing := jsonb_build_object(
    'foodPerPlate', 0, 'subtotal', 0, 'gstEnabled', true, 'gstRate', 5, 'gstAmount', 0,
    'gstNumber', coalesce(biz ->> 'gstin', ''), 'gstNumberVisible', true, 'customerGstNumberVisible', true, 'customerPanVisible', true,
    'showCostPerGuest', true, 'discountEnabled', false, 'discountAmount', 0, 'grandTotal', 0, 'costPerGuest', 0,
    'advancePaid', false, 'advanceAmount', 0, 'balanceDue', 0, 'payments', '[]'::jsonb,
    'eventDates', to_jsonb(v_dates), 'eventSlots', v_slots, 'customerEmail', v_email, 'source', 'enquiry-link');

  v_ref := public._next_number(true, t);

  insert into public.quotes (tenant_id, branch_id, reference, customer_name, mobile, event_type, event_date, guests, customer_gst_number, hall, services, pricing, status, created_by, created_by_email)
  values (t, v_branch, v_ref, v_name, v_mobile, v_type, v_first, v_guests, '', v_hall, '[]'::jsonb, v_pricing, 'draft', null, null);

  insert into public.activity_log (tenant_id, branch_id, action, reference, title, detail, data)
  values (t, v_branch, 'bill.created', v_ref, 'Enquiry ' || v_ref || ' received from the website link',
          v_name || ' · ' || v_type || ' · ' || v_guests || ' guests · saved as a draft',
          jsonb_build_object('customer', v_name, 'mobile', v_mobile, 'eventType', v_type, 'guests', v_guests, 'total', 0, 'dates', array_to_string(v_dates, ', ')));

  insert into public.notifications (tenant_id, kind, title, body, action_url, source, ref)
  values (t, 'info', 'New enquiry from ' || v_name,
          v_type || ' · ' || v_guests || ' guests · ' || v_mobile || '. Saved as draft ' || v_ref || ' — call the customer and complete the quotation.',
          '/admin/quotes/' || v_ref, 'auto', v_ref);

  return jsonb_build_object('ok', true, 'reference', v_ref);
end $$;
revoke all on function public.submit_enquiry(text, jsonb) from public;
grant execute on function public.submit_enquiry(text, jsonb) to anon, authenticated;

-- ---- check ---------------------------------------------------------------------------------
select 'draft status allowed' as item, case when exists (select 1 from pg_constraint where conname = 'quotes_status_check' and pg_get_constraintdef(oid) ilike '%draft%') then 'OK' else 'MISSING' end as status
union all select 'public enquiry form functions', case when to_regprocedure('public.enquiry_info(text)') is not null and to_regprocedure('public.submit_enquiry(text,jsonb)') is not null then 'OK' else 'MISSING' end
union all select 'visitors still cannot read bills', case when has_table_privilege('anon', 'public.quotes', 'SELECT') then 'PROBLEM' else 'OK' end
union all select 'visitors can use the enquiry form', case when has_function_privilege('anon', 'public.submit_enquiry(text,jsonb)', 'EXECUTE') then 'OK' else 'MISSING' end;
