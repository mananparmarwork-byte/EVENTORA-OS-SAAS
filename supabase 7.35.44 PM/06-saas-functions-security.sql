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
