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
