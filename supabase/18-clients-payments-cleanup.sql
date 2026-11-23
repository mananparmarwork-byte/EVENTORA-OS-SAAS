-- =====================================================================================
-- 18) Eventora OS: clients' mobile numbers, payments ledger, "mark as paid", auto-delete of answered requests
-- Run this AFTER file 16 (and 17 if you use it). Safe to run twice. Nothing is deleted from your data.
-- =====================================================================================
do $$
begin
  if to_regprocedure('public.platform_decide_request(uuid,text,text,integer,timestamptz,text)') is null
     or to_regprocedure('public.create_request(text,text,text,jsonb)') is null then
    raise exception 'Run file 16 first. Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------- 1) payment details ----
alter table public.subscription_payments add column if not exists method text;
alter table public.subscription_payments add column if not exists reference text;
alter table public.subscription_payments add column if not exists note text;

-- ---------------------------------------------------------------- 2) settings: auto-delete ----
-- requestKeepDays: delete answered requests (and finished access leads) this many days after you answered them.
--   -1 = never, 0 = right away. Default 7. The payment itself stays in the Payments list.
update public.platform_settings set data = data || jsonb_build_object('requestKeepDays', 7)
 where key = 'config' and (data ->> 'requestKeepDays') is null;

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
  if (p ->> 'requestKeepDays') is not null then
    clean := clean || jsonb_build_object('requestKeepDays', least(greatest(coalesce(nullif(p ->> 'requestKeepDays', '')::integer, 7), -1), 365));
  end if;
  insert into public.platform_settings (key, data) values ('config', clean)
  on conflict (key) do update set data = public.platform_settings.data || excluded.data;
end $$;

create or replace function public._purge_requests()
returns void language plpgsql security definer set search_path = public as $$
declare d integer := coalesce((select nullif(data ->> 'requestKeepDays', '')::integer from public.platform_settings where key = 'config'), 7);
begin
  if d is null or d < 0 then return; end if;
  delete from public.requests where status <> 'pending' and decided_at is not null and decided_at <= now() - make_interval(days => d);
  delete from public.access_leads where status = 'done' and created_at <= now() - make_interval(days => d);
end $$;
revoke all on function public._purge_requests() from public, anon, authenticated;

create or replace function public.platform_purge_requests()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  perform public._purge_requests();
end $$;

create or replace function public.platform_delete_request(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  delete from public.requests where id = p_id;
end $$;

-- "Clear answered": removes every answered request and every finished access lead right now. Waiting ones stay.
create or replace function public.platform_clear_answered()
returns integer language plpgsql security definer set search_path = public as $$
declare a integer; b integer;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  delete from public.requests where status <> 'pending'; get diagnostics a = row_count;
  delete from public.access_leads where status = 'done'; get diagnostics b = row_count;
  return a + b;
end $$;

create or replace function public.platform_set_lead(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_status = 'delete' then delete from public.access_leads where id = p_id; return; end if;
  if p_status not in ('new', 'contacted', 'done') then raise exception 'Unknown status.'; end if;
  update public.access_leads set status = p_status where id = p_id;
  perform public._purge_requests();
end $$;

-- ---------------------------------------------------------------- 3) mobile number is required ----
create or replace function public.submit_access_lead(p_name text, p_business text, p_phone text, p_email text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text := left(btrim(coalesce(p_name, '')), 80); ph text := left(btrim(coalesce(p_phone, '')), 20); em text := lower(left(btrim(coalesce(p_email, '')), 120));
begin
  if char_length(nm) < 2 then raise exception 'Please enter your name.'; end if;
  if char_length(regexp_replace(ph, '[^0-9]', '', 'g')) < 10 then raise exception 'Please enter your mobile number (at least 10 digits) so we can call you.'; end if;
  if (select count(*) from public.access_leads where created_at > now() - interval '1 hour') > 100 then raise exception 'Too many requests right now. Please WhatsApp us instead.'; end if;
  if exists (select 1 from public.access_leads where created_at > now() - interval '10 minutes' and ((ph <> '' and phone = ph) or (em <> '' and email = em))) then return; end if;
  insert into public.access_leads (name, business, phone, email, message)
  values (nm, left(btrim(coalesce(p_business, '')), 80), ph, em, left(btrim(coalesce(p_message, '')), 600));
end $$;

create or replace function public.create_request(p_kind text, p_subject text, p_message text, p_payload jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_tenant(); rid uuid; pl jsonb := coalesce(p_payload, '{}'::jsonb); nm text; ph text; subj text := left(btrim(coalesce(p_subject, '')), 120); msg text := left(btrim(coalesce(p_message, '')), 1500);
begin
  if t is null or not public.is_admin() then raise exception 'Only the owner can send requests.'; end if;
  ph := left(btrim(coalesce(pl ->> 'contact', '')), 20);
  if ph = '' then ph := coalesce((select phone from public.tenants where id = t), ''); end if;
  if char_length(regexp_replace(ph, '[^0-9]', '', 'g')) < 10 then raise exception 'Please enter your mobile number (at least 10 digits) so we can call you.'; end if;
  update public.tenants set phone = ph where id = t and coalesce(phone, '') <> ph;
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
  pl := pl || jsonb_build_object('contact', ph);
  insert into public.requests (tenant_id, created_by, created_by_email, kind, subject, message, payload)
  values (t, auth.uid(), auth.jwt() ->> 'email', p_kind, subj, msg, pl) returning id into rid;
  -- the automatic reply (editable in Super admin -> Automation)
  perform public._fire_event(p_kind || '_received', t, jsonb_build_object('branch', coalesce(pl ->> 'name', ''), 'subject', subj), rid::text);
  return rid;
end $$;

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
  if char_length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 10 then raise exception 'Enter the owner mobile number (at least 10 digits).'; end if;
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
      if coalesce(p_amount_paise, 0) > 0 then
        update public.subscription_payments set method = 'UPI / bank (owner request)', reference = left(coalesce(r.payload ->> 'reference', ''), 80)
         where id = (select id from public.subscription_payments where tenant_id = r.tenant_id and id like 'manual-%' and method is null order by paid_at desc limit 1);
      end if;
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
  perform public._purge_requests();
end $$;

create or replace function public.platform_update_tenant(p_tenant uuid, p_name text, p_type text, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Enter the business name.'; end if;
  if char_length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 10 then raise exception 'Enter the mobile number (at least 10 digits).'; end if;
  update public.tenants set name = left(btrim(p_name), 80), business_type = left(btrim(coalesce(nullif(p_type, ''), business_type)), 40), phone = left(btrim(p_phone), 20) where id = p_tenant;
  if not found then raise exception 'Unknown business.'; end if;
end $$;

-- the owner's own saved mobile number (pre-fills the request forms)
create or replace function public.my_contact_phone()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select phone from public.tenants where id = public.my_tenant()), '');
$$;

-- ---------------------------------------------------------------- 4) payments list + "mark as paid" ----
create or replace function public.platform_list_payments(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'tenantId', p.tenant_id, 'business', t.name, 'phone', t.phone, 'ownerEmail', t.owner_email,
      'amount', p.amount_paise / 100.0, 'period', p.period,
      'planName', coalesce(pl.name, case when p.period = 'extra-branch' then 'Extra branch' else p.period end),
      'paidAt', p.paid_at, 'offline', p.id like 'manual-%',
      'method', coalesce(p.method, case when p.id like 'manual-%' then 'Manual' else 'Razorpay' end),
      'reference', coalesce(p.reference, ''), 'note', coalesce(p.note, '')) order by p.paid_at desc)
    from (select * from public.subscription_payments
           where (p_from is null or (paid_at at time zone 'Asia/Kolkata')::date >= p_from)
             and (p_to is null or (paid_at at time zone 'Asia/Kolkata')::date <= p_to)
           order by paid_at desc limit 3000) p
    join public.tenants t on t.id = p.tenant_id
    left join public.plans pl on pl.period = p.period), '[]'::jsonb);
end $$;

-- One step: record the money you received AND (optionally) extend their plan.
create or replace function public.platform_record_payment(p_tenant uuid, p_amount_paise integer, p_paid_on date, p_method text, p_reference text,
                                                          p_period text, p_until timestamptz, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare pid text := 'manual-' || gen_random_uuid()::text; per text; paid timestamptz; today date := (now() at time zone 'Asia/Kolkata')::date;
        meth text := left(btrim(coalesce(nullif(p_method, ''), 'Other')), 40);
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'Unknown business.'; end if;
  if coalesce(p_amount_paise, 0) <= 0 then raise exception 'Enter the amount you received.'; end if;
  if p_paid_on is not null and p_paid_on > today then raise exception 'The payment date cannot be in the future.'; end if;
  if p_period is not null and p_period <> '' and not exists (select 1 from public.plans where period = p_period) then raise exception 'Unknown plan.'; end if;
  paid := case when p_paid_on is null or p_paid_on = today then now() else ((p_paid_on::timestamp + time '12:00') at time zone 'Asia/Kolkata') end;

  if p_until is not null then
    -- extends access; the money is recorded below, so no amount is passed here
    perform public._grant_access_core(p_tenant, p_period, p_until, left(coalesce(p_note, ''), 300), 0);
    perform public._fire_event('access_granted', p_tenant, '{}'::jsonb, to_char(p_until, 'YYYY-MM-DD"T"HH24:MI:SS') || '-' || gen_random_uuid()::text);
  end if;
  select coalesce(nullif(p_period, ''), (select period from public.subscriptions where tenant_id = p_tenant)) into per;
  insert into public.subscription_payments (id, tenant_id, amount_paise, period, paid_at, method, reference, note)
  values (pid, p_tenant, p_amount_paise, per, paid, meth, left(btrim(coalesce(p_reference, '')), 80), left(btrim(coalesce(p_note, '')), 300));
  return pid;
end $$;

-- ---------------------------------------------------------------- 5) permissions ----
revoke all on function public.platform_save_config(jsonb) from public, anon;
revoke all on function public.platform_purge_requests() from public, anon;
revoke all on function public.platform_delete_request(uuid) from public, anon;
revoke all on function public.platform_clear_answered() from public, anon;
revoke all on function public.platform_set_lead(uuid, text) from public, anon;
revoke all on function public.submit_access_lead(text, text, text, text, text) from public;
revoke all on function public.create_request(text, text, text, jsonb) from public, anon;
revoke all on function public.platform_create_owner(uuid, text, text, text, text, text, timestamptz, integer, text, uuid) from public, anon;
revoke all on function public.platform_decide_request(uuid, text, text, integer, timestamptz, text) from public, anon;
revoke all on function public.platform_update_tenant(uuid, text, text, text) from public, anon;
revoke all on function public.my_contact_phone() from public, anon;
revoke all on function public.platform_list_payments(date, date) from public, anon;
revoke all on function public.platform_record_payment(uuid, integer, date, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.platform_save_config(jsonb) to authenticated;
grant execute on function public.platform_purge_requests() to authenticated;
grant execute on function public.platform_delete_request(uuid) to authenticated;
grant execute on function public.platform_clear_answered() to authenticated;
grant execute on function public.platform_set_lead(uuid, text) to authenticated;
grant execute on function public.submit_access_lead(text, text, text, text, text) to anon, authenticated;
grant execute on function public.create_request(text, text, text, jsonb) to authenticated;
grant execute on function public.platform_create_owner(uuid, text, text, text, text, text, timestamptz, integer, text, uuid) to authenticated;
grant execute on function public.platform_decide_request(uuid, text, text, integer, timestamptz, text) to authenticated;
grant execute on function public.platform_update_tenant(uuid, text, text, text) to authenticated;
grant execute on function public.my_contact_phone() to authenticated;
grant execute on function public.platform_list_payments(date, date) to authenticated;
grant execute on function public.platform_record_payment(uuid, integer, date, text, text, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------- 6) daily clean-up (only if pg_cron is switched on) ----
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('eventora-purge-requests', '45 3 * * *', 'select public._purge_requests()');
  end if;
end $$;

notify pgrst, 'reload schema';

-- check: every line must say OK
select 'payments list' as check, case when to_regprocedure('public.platform_list_payments(date,date)') is not null then 'OK' else 'MISSING' end as result
union all select 'mark as paid', case when to_regprocedure('public.platform_record_payment(uuid,integer,date,text,text,text,timestamptz,text)') is not null then 'OK' else 'MISSING' end
union all select 'auto-delete', case when to_regprocedure('public._purge_requests()') is not null then 'OK' else 'MISSING' end
union all select 'payment columns', case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'subscription_payments' and column_name in ('method', 'reference', 'note')) = 3 then 'OK' else 'MISSING' end
union all select 'mobile required (requests)', case when pg_get_functiondef('public.create_request(text,text,text,jsonb)'::regprocedure) like '%mobile number%' then 'OK' else 'OLD VERSION' end
union all select 'mobile required (leads)', case when pg_get_functiondef('public.submit_access_lead(text,text,text,text,text)'::regprocedure) like '%mobile number%' then 'OK' else 'OLD VERSION' end;
