-- =====================================================================================
-- 22 - DATA BACKUP (export / import) + SUPER ADMIN "VIEW A CLIENT'S DASHBOARD"
--
--  1. Per-client switch (Super admin -> Data & clients). When ON, that client's owner sees
--     Settings -> "Backup & restore": Export all my data / Import my data.
--  2. Export / import is always limited to ONE business. Every row is stamped with the importing
--     business's own id, so data of different clients can never mix, and branches are matched
--     (same id, then same name, then Main) so each bill lands in its own branch.
--  3. Super admin: export every client's data / import every client's data (one business at a time,
--     matched by the business "slug"; a missing business is created, its owner login is added later).
--  4. Super admin: open any client's full dashboard (all branches) after typing YOUR login password again.
--     The password is checked by the DATABASE (5 wrong tries = 15 minute pause). While viewing, everything is
--     READ-ONLY (the database refuses changes), so you can never change a client's data by accident.
--
-- Run ONCE in Supabase -> SQL Editor, AFTER 21-custom-automation-and-branch-delete.sql.
-- Safe to run again. If you ever re-run 06, 08, 11, 16 or 21, run this file again afterwards.
-- Nothing is deleted or changed in your data.
-- =====================================================================================

do $$
begin
  if to_regprocedure('public.platform_delete_branch(uuid,uuid)') is null or to_regprocedure('public._aal_ok()') is null then
    raise exception 'Run files 01-21 first. Nothing was changed.';
  end if;
end $$;

create extension if not exists pgcrypto;

-- ===================================================================== 1) switch + view tables
alter table public.tenants add column if not exists backup_enabled boolean not null default false;

create table if not exists public.platform_view_as (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.platform_view_as enable row level security;
revoke all on public.platform_view_as from anon, authenticated;

create table if not exists public.platform_view_fail (
  user_id uuid primary key references auth.users(id) on delete cascade,
  fails integer not null default 0,
  last_fail timestamptz not null default now()
);
alter table public.platform_view_fail enable row level security;
revoke all on public.platform_view_fail from anon, authenticated;

-- ===================================================================== 2) "who am I looking at?"
-- The tenant a super admin is currently viewing (null for everybody else, and when the view has expired).
create or replace function public._viewing_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select v.tenant_id
    from public.platform_view_as v
   where v.user_id = auth.uid()
     and v.expires_at > now()
     and exists (select 1 from public.platform_admins p where p.user_id = auth.uid())
     and public._aal_ok()
   limit 1;
$$;
revoke all on function public._viewing_tenant() from public, anon;
grant execute on function public._viewing_tenant() to authenticated;

-- every "which business / which role" answer now understands the view, so ALL existing screens, policies and functions
-- show the viewed business exactly as its owner sees it (all branches included)
create or replace function public.my_tenant()
returns uuid language sql stable security definer set search_path = public as $$
  select case when public._aal_ok()
              then coalesce(public._viewing_tenant(), (select tenant_id from public.members where user_id = auth.uid() and active limit 1))
         end;
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select (public._viewing_tenant() is not null
          or exists (select 1 from public.members where user_id = auth.uid() and active and role = 'owner'))
         and public._aal_ok();
$$;
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public._viewing_tenant() is null
         and exists (select 1 from public.members where user_id = auth.uid() and active and role = 'staff')
         and public._aal_ok();
$$;

-- Is the plan / trial of this business running? (the old tenant_writable logic, unchanged)
create or replace function public._tenant_active(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select
      (s.status = 'trialing' and s.trial_ends_at + (case when s.autopay then interval '1 day' else interval '0' end) > now())
      or (s.status = 'active' and (s.current_period_end is null or s.current_period_end > now() - interval '2 days'))
      or (s.status = 'past_due' and s.current_period_end > now() - interval '3 days')
      or (s.status = 'cancelled' and s.current_period_end > now())
    from public.subscriptions s where s.tenant_id = t), false);
$$;
revoke all on function public._tenant_active(uuid) from public, anon, authenticated;

-- "Can this business create / change things?" is always NO while a super admin is only viewing
create or replace function public.tenant_writable(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public._tenant_active(t) and public._viewing_tenant() is null;
$$;

-- the screen's banner "plan ended" must describe the CLIENT's plan, not the read-only view
create or replace function public.get_subscription()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', s.status, 'plan', s.plan, 'period', s.period, 'trialEndsAt', s.trial_ends_at,
                            'currentPeriodEnd', s.current_period_end, 'writable', public._tenant_active(s.tenant_id),
                            'autopay', s.autopay, 'couponCode', s.coupon_code)
  from public.subscriptions s where s.tenant_id = public.my_tenant();
$$;

create or replace function public.my_context()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('role', public.my_role(), 'tenantId', public.my_tenant(), 'tenantName', t.name, 'slug', t.slug,
                            'platform', public.is_platform_admin(), 'viewing', public._viewing_tenant() is not null)
  from (select 1) x left join public.tenants t on t.id = public.my_tenant();
$$;

-- opening the bell while viewing must not mark the client's messages as read
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() or public._viewing_tenant() is not null then return; end if;
  update public.notifications set read_at = now()
   where tenant_id = public.my_tenant() and read_at is null and (p_ids is null or id = any (p_ids));
end $$;

-- ===================================================================== 3) read-only while viewing
create or replace function public._view_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('eventora.importing', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if public._viewing_tenant() is not null then
    raise exception 'You are only viewing this business. Changes are switched off while you look at a client''s dashboard. Press "Exit client view" first.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public._view_guard() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['quotes', 'catalog', 'app_settings', 'bill_counters', 'activity_log', 'branches', 'members', 'requests'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists view_guard_trg on public.%I', t);
      execute format('create trigger view_guard_trg before insert or update or delete on public.%I for each row execute function public._view_guard()', t);
    end if;
  end loop;
end $$;

-- the activity log stamps who / when: keep the ORIGINAL stamp while a backup is being restored
create or replace function public.activity_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('eventora.importing', true) = 'on' then
    if new.at is null then new.at := now(); end if;
    return new;
  end if;
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

-- ===================================================================== 4) super admin: open / leave a client's dashboard
create or replace function public.platform_view_start(p_tenant uuid, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); hash text; f public.platform_view_fail; ok boolean;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'That business was not found.'; end if;
  select * into f from public.platform_view_fail where user_id = uid;
  if found and f.fails >= 5 and f.last_fail > now() - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong passwords. Please wait 15 minutes and try again.');
  end if;
  select u.encrypted_password into hash from auth.users u where u.id = uid;
  ok := hash is not null and hash <> '' and crypt(coalesce(p_password, ''), hash) = hash;
  if not ok then
    insert into public.platform_view_fail (user_id, fails, last_fail) values (uid, 1, now())
    on conflict (user_id) do update
      set fails = case when public.platform_view_fail.last_fail > now() - interval '15 minutes' then public.platform_view_fail.fails + 1 else 1 end,
          last_fail = now();
    return jsonb_build_object('ok', false, 'error', 'Wrong password. Use the same password you sign in with.');
  end if;
  delete from public.platform_view_fail where user_id = uid;
  insert into public.platform_view_as (user_id, tenant_id, started_at, expires_at) values (uid, p_tenant, now(), now() + interval '3 hours')
  on conflict (user_id) do update set tenant_id = excluded.tenant_id, started_at = now(), expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.platform_view_end()
returns void language sql security definer set search_path = public as $$
  delete from public.platform_view_as where user_id = auth.uid();
$$;
revoke all on function public.platform_view_start(uuid, text) from public, anon;
revoke all on function public.platform_view_end() from public, anon;
grant execute on function public.platform_view_start(uuid, text) to authenticated;
grant execute on function public.platform_view_end() to authenticated;

-- ===================================================================== 5) the switch (per client)
create or replace function public.backup_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'enabled', coalesce((select t.backup_enabled from public.tenants t where t.id = public.my_tenant()), false),
    'viewing', public._viewing_tenant() is not null);
$$;
revoke all on function public.backup_status() from public, anon;
grant execute on function public.backup_status() to authenticated;

create or replace function public.platform_backup_flags()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('tenantId', t.id, 'enabled', t.backup_enabled)) from public.tenants t), '[]'::jsonb);
end $$;

-- p_tenants = null means every business
create or replace function public.platform_set_backup(p_tenants uuid[], p_enabled boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  update public.tenants set backup_enabled = coalesce(p_enabled, false) where p_tenants is null or id = any (p_tenants);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.platform_backup_flags() from public, anon;
revoke all on function public.platform_set_backup(uuid[], boolean) from public, anon;
grant execute on function public.platform_backup_flags() to authenticated;
grant execute on function public.platform_set_backup(uuid[], boolean) to authenticated;

-- ===================================================================== 6) export one business (internal builder)
create or replace function public._tenant_block(t uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tn public.tenants;
begin
  select * into tn from public.tenants where id = t;
  if not found then raise exception 'That business was not found.'; end if;
  return jsonb_build_object(
    'tenant', jsonb_build_object('name', tn.name, 'slug', tn.slug, 'businessType', tn.business_type, 'phone', tn.phone, 'branchLimit', tn.branch_limit),
    'branches',     coalesce((select jsonb_agg(to_jsonb(b) - 'tenant_id' order by b.created_at) from public.branches b where b.tenant_id = t), '[]'::jsonb),
    'catalog',      coalesce((select jsonb_agg(to_jsonb(c) - 'tenant_id') from public.catalog c where c.tenant_id = t), '[]'::jsonb),
    'settings',     coalesce((select jsonb_agg(to_jsonb(s) - 'tenant_id') from public.app_settings s where s.tenant_id = t), '[]'::jsonb),
    'quotes',       coalesce((select jsonb_agg(to_jsonb(q) - 'tenant_id' order by q.created_at) from public.quotes q where q.tenant_id = t), '[]'::jsonb),
    'activity',     coalesce((select jsonb_agg(to_jsonb(a) - 'tenant_id' order by a.at) from public.activity_log a where a.tenant_id = t), '[]'::jsonb),
    'billCounters', coalesce((select jsonb_agg(to_jsonb(c) - 'tenant_id') from public.bill_counters c where c.tenant_id = t), '[]'::jsonb));
end $$;
revoke all on function public._tenant_block(uuid) from public, anon, authenticated;

-- ===================================================================== 7) import into one business (internal)
-- Everything is stamped with t (the business being restored), whatever the file says, so businesses can never mix.
create or replace function public._import_block(t uuid, d jsonb, p_overwrite boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  bmap jsonb := '{}'::jsonb; main_id uuid; lim integer; used integer;
  b jsonb; x jsonb; nb uuid; oldid text;
  qrec public.quotes; arec public.activity_log; existing uuid;
  n_br integer := 0; n_br_merged integer := 0; n_set integer := 0;
  n_q_new integer := 0; n_q_upd integer := 0; n_q_skip integer := 0; n_act integer := 0;
begin
  if d is null or jsonb_typeof(d) <> 'object' then raise exception 'The backup file is not valid.'; end if;
  perform set_config('eventora.importing', 'on', true);
  perform set_config('eventora.platform_op', '1', true);

  select id into main_id from public.branches where tenant_id = t and is_main limit 1;
  select branch_limit into lim from public.tenants where id = t;
  if main_id is null then raise exception 'This business has no Main branch yet.'; end if;

  -- branches: same id -> same name -> Main branch -> create (within the plan's branch limit, otherwise bills go to Main)
  for b in select * from jsonb_array_elements(coalesce(d -> 'branches', '[]'::jsonb)) loop
    nb := null; oldid := b ->> 'id';
    if coalesce(oldid, '') ~* '^[0-9a-f-]{36}$' then
      select id into nb from public.branches where tenant_id = t and id = oldid::uuid;
    end if;
    if nb is null then
      select id into nb from public.branches where tenant_id = t and lower(btrim(name)) = lower(btrim(coalesce(b ->> 'name', '')));
    end if;
    if nb is null and coalesce((b ->> 'is_main')::boolean, false) then nb := main_id; end if;
    if nb is null then
      select count(*) into used from public.branches where tenant_id = t and active;
      if length(btrim(coalesce(b ->> 'name', ''))) >= 2 and (used < lim or not coalesce((b ->> 'active')::boolean, true)) then
        insert into public.branches (tenant_id, name, address, phone, is_main, active, created_at)
        values (t, left(btrim(b ->> 'name'), 60), coalesce(b ->> 'address', ''), coalesce(b ->> 'phone', ''), false,
                coalesce((b ->> 'active')::boolean, true), coalesce((b ->> 'created_at')::timestamptz, now()))
        returning id into nb;
        n_br := n_br + 1;
      else
        nb := main_id; n_br_merged := n_br_merged + 1;
      end if;
    end if;
    if oldid is not null then bmap := bmap || jsonb_build_object(oldid, nb); end if;
  end loop;

  -- catalog and settings (business profile, payments, bill numbering, saved items ...): the backup replaces the current ones
  for x in select * from jsonb_array_elements(coalesce(d -> 'catalog', '[]'::jsonb)) loop
    insert into public.catalog (tenant_id, id, categories, updated_at)
    values (t, coalesce(nullif(x ->> 'id', ''), 'default'), coalesce(x -> 'categories', '[]'::jsonb), now())
    on conflict (tenant_id, id) do update set categories = excluded.categories, updated_at = now();
  end loop;
  for x in select * from jsonb_array_elements(coalesce(d -> 'settings', '[]'::jsonb)) loop
    continue when coalesce(x ->> 'id', '') = '';
    insert into public.app_settings (tenant_id, id, data, updated_at)
    values (t, x ->> 'id', coalesce(x -> 'data', '{}'::jsonb), now())
    on conflict (tenant_id, id) do update set data = excluded.data, updated_at = now();
    n_set := n_set + 1;
  end loop;

  -- bills
  for x in select * from jsonb_array_elements(coalesce(d -> 'quotes', '[]'::jsonb)) loop
    continue when coalesce(btrim(x ->> 'reference'), '') = '';
    select id into existing from public.quotes where tenant_id = t and reference = x ->> 'reference';
    if existing is not null and not coalesce(p_overwrite, false) then n_q_skip := n_q_skip + 1; continue; end if;
    qrec := jsonb_populate_record(null::public.quotes, x - 'tenant_id');
    qrec.tenant_id := t;
    qrec.branch_id := coalesce((bmap ->> (x ->> 'branch_id'))::uuid, main_id);
    qrec.created_at := coalesce(qrec.created_at, now());
    qrec.status := coalesce(qrec.status, 'new');
    qrec.hall := coalesce(qrec.hall, 'Eventora');
    qrec.services := coalesce(qrec.services, '[]'::jsonb);
    if existing is not null then delete from public.quotes where id = existing; end if;
    if qrec.id is null or exists (select 1 from public.quotes where id = qrec.id) then qrec.id := gen_random_uuid(); end if;
    insert into public.quotes select (qrec).*;
    if existing is not null then n_q_upd := n_q_upd + 1; else n_q_new := n_q_new + 1; end if;
  end loop;

  -- activity history (keeps its original dates)
  for x in select * from jsonb_array_elements(coalesce(d -> 'activity', '[]'::jsonb)) loop
    continue when coalesce(x ->> 'title', '') = '' or coalesce(x ->> 'action', '') = '';
    arec := jsonb_populate_record(null::public.activity_log, x - 'tenant_id');
    arec.tenant_id := t;
    arec.branch_id := coalesce((bmap ->> (x ->> 'branch_id'))::uuid, main_id);
    arec.id := coalesce(arec.id, gen_random_uuid());
    arec.at := coalesce(arec.at, now());
    insert into public.activity_log select (arec).* on conflict (id) do nothing;
    if found then n_act := n_act + 1; end if;
  end loop;

  -- bill numbers: never go backwards, so a number is never handed out twice
  for x in select * from jsonb_array_elements(coalesce(d -> 'billCounters', '[]'::jsonb)) loop
    continue when coalesce(x ->> 'day', '') = '';
    insert into public.bill_counters (tenant_id, day, last_seq) values (t, (x ->> 'day')::date, coalesce((x ->> 'last_seq')::integer, 0))
    on conflict (tenant_id, day) do update set last_seq = greatest(public.bill_counters.last_seq, excluded.last_seq);
  end loop;

  perform set_config('eventora.importing', '', true);
  perform set_config('eventora.platform_op', '', true);
  return jsonb_build_object('billsAdded', n_q_new, 'billsReplaced', n_q_upd, 'billsSkipped', n_q_skip, 'branchesAdded', n_br,
                            'branchesMergedIntoMain', n_br_merged, 'settingsRestored', n_set, 'activityAdded', n_act);
end $$;
revoke all on function public._import_block(uuid, jsonb, boolean) from public, anon, authenticated;

-- ===================================================================== 8) owner: export / import MY business
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t uuid := public.my_tenant();
begin
  if t is null or not public.is_admin() then raise exception 'Only the owner can export the data.'; end if;
  if not (coalesce((select backup_enabled from public.tenants where id = t), false) or public._viewing_tenant() is not null) then
    raise exception 'Data export is not switched on for your business. Please ask the Eventora team to switch it on.';
  end if;
  return public._tenant_block(t);
end $$;

create or replace function public.import_my_data(p jsonb, p_overwrite boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_tenant(); my_slug text;
begin
  if t is null or not public.is_admin() then raise exception 'Only the owner can import data.'; end if;
  if public._viewing_tenant() is not null then raise exception 'Import is switched off while viewing a client.'; end if;
  if not coalesce((select backup_enabled from public.tenants where id = t), false) then
    raise exception 'Data import is not switched on for your business. Please ask the Eventora team to switch it on.';
  end if;
  if not public.my_tenant_writable() then raise exception 'Your access has ended. Contact Eventora to renew it.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The backup file is not valid.'; end if;
  select slug into my_slug from public.tenants where id = t;
  if lower(coalesce(p -> 'tenant' ->> 'slug', '')) <> my_slug then
    raise exception 'This backup file belongs to a different business, so it was not imported.';
  end if;
  return public._import_block(t, p, p_overwrite);
end $$;
revoke all on function public.export_my_data() from public, anon;
revoke all on function public.import_my_data(jsonb, boolean) from public, anon;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.import_my_data(jsonb, boolean) to authenticated;

-- ===================================================================== 9) super admin: every client, one business at a time
create or replace function public.platform_export_tenant(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return public._tenant_block(p_tenant)
      || jsonb_build_object('subscription', (select to_jsonb(s) - 'tenant_id' from public.subscriptions s where s.tenant_id = p_tenant));
end $$;

create or replace function public.platform_import_tenant(p jsonb, p_overwrite boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tslug text; t uuid; created boolean := false; tn jsonb; srec public.subscriptions; res jsonb; tname text;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if public._viewing_tenant() is not null then raise exception 'Press "Exit client view" first, then import.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The backup is not valid.'; end if;
  tn := p -> 'tenant';
  tslug := lower(btrim(coalesce(tn ->> 'slug', '')));
  if tslug = '' then raise exception 'The backup has no business name (slug).'; end if;
  select id, name into t, tname from public.tenants where slug = tslug;
  if t is null then
    insert into public.tenants (name, slug, business_type, phone, branch_limit)
    values (left(coalesce(nullif(btrim(tn ->> 'name'), ''), tslug), 120), tslug, coalesce(nullif(tn ->> 'businessType', ''), 'Banquet hall'),
            coalesce(tn ->> 'phone', ''), greatest(1, least(200, coalesce((tn ->> 'branchLimit')::integer, 1))))
    returning id, name into t, tname;
    created := true;
    if jsonb_typeof(p -> 'subscription') = 'object' then
      srec := jsonb_populate_record(null::public.subscriptions, (p -> 'subscription') || jsonb_build_object('tenant_id', t));
      srec.tenant_id := t;
      insert into public.subscriptions select (srec).* on conflict (tenant_id) do nothing;
    end if;
  end if;
  res := public._import_block(t, p, p_overwrite);
  return res || jsonb_build_object('business', tname, 'created', created);
end $$;
revoke all on function public.platform_export_tenant(uuid) from public, anon;
revoke all on function public.platform_import_tenant(jsonb, boolean) from public, anon;
grant execute on function public.platform_export_tenant(uuid) to authenticated;
grant execute on function public.platform_import_tenant(jsonb, boolean) to authenticated;

-- ===================================================================== check (the last rows must say OK)
select 'backup switch column' as what, case when exists (select 1 from information_schema.columns where table_name = 'tenants' and column_name = 'backup_enabled') then 'OK' else 'MISSING' end as status
union all select 'view-as table', case when to_regclass('public.platform_view_as') is not null then 'OK' else 'MISSING' end
union all select 'platform_view_start', case when to_regprocedure('public.platform_view_start(uuid,text)') is not null then 'OK' else 'MISSING' end
union all select 'export_my_data', case when to_regprocedure('public.export_my_data()') is not null then 'OK' else 'MISSING' end
union all select 'import_my_data', case when to_regprocedure('public.import_my_data(jsonb,boolean)') is not null then 'OK' else 'MISSING' end
union all select 'platform_import_tenant', case when to_regprocedure('public.platform_import_tenant(jsonb,boolean)') is not null then 'OK' else 'MISSING' end
union all select 'read-only guard on bills', case when exists (select 1 from pg_trigger where tgname = 'view_guard_trg' and tgrelid = 'public.quotes'::regclass) then 'OK' else 'MISSING' end;
