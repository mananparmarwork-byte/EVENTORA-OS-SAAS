-- 21 - CUSTOM AUTOMATIONS + SUPER-ADMIN-ONLY BRANCH DELETE.
-- Run once in Supabase -> SQL Editor (after file 16). Safe to run again.
--
-- 1) You can now create your own automatic messages (any text, any number of days before / after a plan ends,
--    for trials, paid plans or everyone) and delete the ones you created. Built-in ones can only be edited.
-- 2) Only the software owner (platform admin) can delete a branch. The customer has no delete function at all.
--    Bills and employees of a deleted branch move to the customer's Main branch, so no data is lost.

-- ===================================================================== 1) custom automations =====
alter table public.message_rules add column if not exists custom boolean not null default false;

create or replace function public.platform_list_rules()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'description', description, 'trigger', trigger, 'appliesTo', applies_to, 'days', days, 'enabled', enabled,
            'title', title, 'body', body, 'kind', kind, 'channels', channels, 'custom', custom,
            'sent', (select count(*) from public.notifications n where n.rule_key = m.key)) order by sort, key) from public.message_rules m), '[]'::jsonb);
end $$;

-- create (p_key null) or edit (p_key given) one of YOUR OWN automatic messages
create or replace function public.platform_save_custom_rule(p_key text, p_label text, p_trigger text, p_applies_to text, p_days integer, p_enabled boolean,
                                                            p_title text, p_body text, p_kind text, p_channels text[])
returns text language plpgsql security definer set search_path = public as $$
declare ch text[]; k text := p_key; lbl text := left(btrim(coalesce(p_label, '')), 80);
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if char_length(lbl) < 2 then raise exception 'Give this automation a name.'; end if;
  if p_trigger not in ('before_end', 'after_end') then raise exception 'Choose before or after the plan ends.'; end if;
  if p_applies_to not in ('any', 'trial', 'paid') then raise exception 'Choose who it applies to.'; end if;
  if p_days is null or p_days < 0 or p_days > 365 then raise exception 'Days must be between 0 and 365.'; end if;
  if char_length(btrim(coalesce(p_title, ''))) < 1 or char_length(btrim(coalesce(p_body, ''))) < 1 then raise exception 'Write the title and the message.'; end if;
  ch := array(select distinct c from unnest(coalesce(p_channels, array['app'])) c where c in ('app', 'email'));
  if not ('app' = any (ch)) then ch := ch || array['app']; end if;
  if k is null then
    k := 'custom-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    insert into public.message_rules (key, label, description, trigger, applies_to, days, enabled, title, body, kind, action_url, channels, sort, custom)
    values (k, lbl, 'Your own automatic message.', p_trigger, p_applies_to, p_days, coalesce(p_enabled, true), left(btrim(p_title), 160), left(btrim(p_body), 1500),
            case when p_kind in ('info', 'reminder', 'warning', 'payment', 'plan', 'branch', 'reply', 'success') then p_kind else 'reminder' end,
            '/admin/billing', ch, 500, true);
  else
    update public.message_rules set label = lbl, trigger = p_trigger, applies_to = p_applies_to, days = p_days, enabled = coalesce(p_enabled, true),
           title = left(btrim(p_title), 160), body = left(btrim(p_body), 1500),
           kind = case when p_kind in ('info', 'reminder', 'warning', 'payment', 'plan', 'branch', 'reply', 'success') then p_kind else kind end,
           channels = ch, updated_at = now()
     where key = k and custom;
    if not found then raise exception 'That automation was not found, or it is a built-in one.'; end if;
  end if;
  return k;
end $$;

create or replace function public.platform_delete_rule(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  delete from public.message_rules where key = p_key and custom;
  if not found then raise exception 'Only automations you created can be deleted. Built-in ones can be switched off.'; end if;
end $$;

-- the clock-based reminders: built-in rules keep their "closest one" behaviour, custom rules each fire once per plan end date
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
   where enabled and not custom and trigger = 'before_end' and dl between 0 and days and (applies_to = 'any' or (applies_to = 'trial') = is_trial)
   order by days asc limit 1;
  if found then
    nid := public._notify(t, r.kind, public._render(r.title, v), btrim(public._render(r.body, v)), r.action_url, 'auto', null, r.key,
                          to_char(eff at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), r.channels @> array['email']);
    if nid is not null then n := n + 1; end if;
  end if;

  select * into r from public.message_rules
   where enabled and not custom and trigger = 'after_end' and -dl >= days and -dl <= 45 and (applies_to = 'any' or (applies_to = 'trial') = is_trial)
   order by days desc limit 1;
  if found then
    nid := public._notify(t, r.kind, public._render(r.title, v), btrim(public._render(r.body, v)), r.action_url, 'auto', null, r.key,
                          to_char(eff at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), r.channels @> array['email']);
    if nid is not null then n := n + 1; end if;
  end if;

  for r in select * from public.message_rules
            where enabled and custom and (applies_to = 'any' or (applies_to = 'trial') = is_trial)
              and ((trigger = 'before_end' and dl between 0 and days) or (trigger = 'after_end' and -dl >= days and -dl <= 90))
  loop
    nid := public._notify(t, r.kind, public._render(r.title, v), btrim(public._render(r.body, v)), r.action_url, 'auto', null, r.key,
                          to_char(eff at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), r.channels @> array['email']);
    if nid is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public._auto_for_tenant(uuid) from public, anon, authenticated;

-- ===================================================================== 2) branch delete: software owner only =====
-- lets the platform-admin bypass the "employee rules" trigger while moving bills (only inside platform_delete_branch)
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

-- all branches of one business (for the Super admin "Manage customer" window)
create or replace function public.platform_list_branches(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'phone', b.phone, 'isMain', b.is_main, 'active', b.active,
            'createdAt', b.created_at,
            'bills', (select count(*) from public.quotes q where q.branch_id = b.id),
            'staff', (select count(*) from public.members m where m.tenant_id = p_tenant and m.role = 'staff' and m.branch_id = b.id))
            order by b.is_main desc, b.created_at) from public.branches b where b.tenant_id = p_tenant), '[]'::jsonb);
end $$;

-- delete one branch. The Main branch can never be deleted. Its bills and employees move to the Main branch.
create or replace function public.platform_delete_branch(p_tenant uuid, p_branch uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.branches; main_id uuid; moved integer := 0; staff_moved integer := 0;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  select * into b from public.branches where id = p_branch and tenant_id = p_tenant;
  if not found then raise exception 'That branch was not found.'; end if;
  if b.is_main then raise exception 'The Main branch cannot be deleted.'; end if;
  select id into main_id from public.branches where tenant_id = p_tenant and is_main limit 1;
  if main_id is null then raise exception 'This business has no Main branch.'; end if;
  perform set_config('eventora.platform_op', '1', true);
  update public.quotes set branch_id = main_id where branch_id = p_branch;
  get diagnostics moved = row_count;
  update public.members set branch_id = main_id where branch_id = p_branch;
  get diagnostics staff_moved = row_count;
  update public.activity_log set branch_id = main_id where branch_id = p_branch;
  delete from public.branches where id = p_branch;
  perform set_config('eventora.platform_op', '', true);
  return jsonb_build_object('name', b.name, 'billsMoved', moved, 'staffMoved', staff_moved);
end $$;

revoke all on function public.platform_save_custom_rule(text, text, text, text, integer, boolean, text, text, text, text[]) from public, anon;
revoke all on function public.platform_delete_rule(text) from public, anon;
revoke all on function public.platform_list_branches(uuid) from public, anon;
revoke all on function public.platform_delete_branch(uuid, uuid) from public, anon;
grant execute on function public.platform_save_custom_rule(text, text, text, text, integer, boolean, text, text, text, text[]) to authenticated;
grant execute on function public.platform_delete_rule(text) to authenticated;
grant execute on function public.platform_list_branches(uuid) to authenticated;
grant execute on function public.platform_delete_branch(uuid, uuid) to authenticated;

select 'custom rules column' as what, case when exists (select 1 from information_schema.columns where table_name = 'message_rules' and column_name = 'custom') then 'OK' else 'MISSING' end as status
union all select 'platform_delete_branch', case when to_regprocedure('public.platform_delete_branch(uuid,uuid)') is not null then 'OK' else 'MISSING' end
union all select 'platform_save_custom_rule', case when to_regprocedure('public.platform_save_custom_rule(text,text,text,text,integer,boolean,text,text,text,text[])') is not null then 'OK' else 'MISSING' end;
