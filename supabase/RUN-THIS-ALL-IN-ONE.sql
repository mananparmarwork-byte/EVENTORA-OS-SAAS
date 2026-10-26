-- =====================================================================================
-- EVENTORA: ALL SaaS + PLANS SETUP IN ONE FILE
-- Paste this WHOLE file into Supabase -> SQL Editor -> New query, then click Run (once).
-- It runs 05, 06, 08, 11, 13 and 14 in the right order. The last result must show only OK.
-- If anything fails, NOTHING is changed: send me the red error text.
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

-- ============================== FINAL CHECK (must be all OK) ==============================
select 'platform_admins table exists' as check, case when to_regclass('public.platform_admins') is not null then 'OK' else 'MISSING' end
union all select 'plans table exists', case when to_regclass('public.plans') is not null then 'OK' else 'MISSING' end
union all select 'plan creation function exists', case when to_regprocedure('public.platform_upsert_plan(text,text,integer,integer,text,text[],boolean,boolean,integer)') is not null then 'OK' else 'MISSING' end
union all select 'at least one active plan', case when exists (select 1 from public.plans where active) then 'OK' else 'NO ACTIVE PLAN' end
union all select 'super admin login set (if NO, run make-platform-admin.sql)', case when exists (select 1 from public.platform_admins) then 'OK' else 'NO' end;
