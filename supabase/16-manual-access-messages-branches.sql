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

-- ============================== CHECK (every line must say OK) ==============================
select 'every business has a Main branch' as check,
       case when not exists (select 1 from public.tenants t where not exists (select 1 from public.branches b where b.tenant_id = t.id and b.is_main)) then 'OK' else 'MISSING' end
union all select 'every bill has a branch', case when not exists (select 1 from public.quotes where branch_id is null) then 'OK' else 'MISSING' end
union all select 'employees have a branch', case when not exists (select 1 from public.members where role = 'staff' and branch_id is null) then 'OK' else 'MISSING' end
union all select 'branch functions exist', case when to_regprocedure('public.save_branch(uuid,text,text,text,boolean)') is not null and to_regprocedure('public.list_branches()') is not null then 'OK' else 'MISSING' end
union all select 'booked_times takes a branch', case when to_regprocedure('public.booked_times(uuid)') is not null then 'OK' else 'MISSING' end
union all select 'messages tables exist', case when to_regclass('public.notifications') is not null and to_regclass('public.message_rules') is not null and to_regclass('public.requests') is not null then 'OK' else 'MISSING' end
union all select 'automatic rules loaded', case when (select count(*) from public.message_rules) >= 10 then 'OK' else 'MISSING' end
union all select 'add-owner functions exist', case when to_regprocedure('public.platform_create_owner(uuid,text,text,text,text,text,timestamptz,integer,text,uuid)') is not null then 'OK' else 'MISSING' end
union all select 'saved items functions exist', case when to_regprocedure('public.save_presets(jsonb)') is not null then 'OK' else 'MISSING' end
union all select 'self sign-up is closed', case when not coalesce((select (data ->> 'allowSelfSignup')::boolean from public.platform_settings where key = 'config'), false) then 'OK' else 'OPEN (switched on in Settings)' end;
