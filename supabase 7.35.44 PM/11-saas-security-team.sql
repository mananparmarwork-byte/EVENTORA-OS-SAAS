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
