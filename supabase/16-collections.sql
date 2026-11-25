-- =====================================================================================
-- 16 - SUPER ADMIN COLLECTIONS: pending / upcoming / collected payments, renewal reminders, follow-up log,
--      "I collected the money" (records the payment AND extends the plan).
--      Run ONCE in Supabase -> SQL Editor, AFTER 15-super-admin-dashboard.sql. Safe to run again.
-- =====================================================================================

-- how an offline payment was received, and a note about it
alter table public.subscription_payments add column if not exists method text;
alter table public.subscription_payments add column if not exists note text;
-- your contact number for the customer (used for WhatsApp reminders)
alter table public.subscriptions add column if not exists contact_phone text not null default '';

-- every reminder you sent / call you made / promise a customer gave
create table if not exists public.collection_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  action text not null check (action in ('email', 'whatsapp', 'copy', 'call', 'note', 'collected')),
  note text not null default '',
  promise_date date,                       -- "customer said they will pay on this date"
  created_at timestamptz not null default now()
);
create index if not exists collection_log_tenant_idx on public.collection_log (tenant_id, created_at desc);
alter table public.collection_log enable row level security;
revoke all on public.collection_log from anon, authenticated;

-- ------------------------------------------------------------ one row per business, money view ----
-- bucket: overdue (ended / failed / never paid) | due_soon (ends in 0-7 days, pays by hand) | upcoming (8-30 days, pays by hand)
--         | autopay (Razorpay will charge it, ends within 30 days) | later (more than 30 days away) | none (free / no plan)
create or replace function public.platform_collections()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rows jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  rows := public.platform_subscription_overview();
  return coalesce((
    with r as (
      select * from jsonb_to_recordset(rows) as x(id uuid, name text, slug text, "ownerEmail" text, state text, period text, "planName" text,
        "endsAt" timestamptz, "daysLeft" int, autopay boolean, "paymentsCount" int, renewals int, paid numeric, "lastPaymentAt" timestamptz, note text)),
    lp as (select distinct on (tenant_id) tenant_id, amount_paise from public.subscription_payments order by tenant_id, paid_at desc),
    x as (
      select r.*, coalesce(pl.price_paise, lp.amount_paise, 0) / 100.0 as due, coalesce(pl.months, 1) as months,
             lp.amount_paise / 100.0 as last_amount, coalesce(s.contact_phone, '') as phone,
             case
               when r.state in ('lapsed', 'past_due', 'trial_ended') then 'overdue'
               when r.state in ('manual_renew', 'cancelling', 'trial', 'free_access') and r."daysLeft" between 0 and 7 then 'due_soon'
               when r.state in ('manual_renew', 'cancelling', 'trial', 'free_access') and r."daysLeft" between 8 and 30 then 'upcoming'
               when r.state = 'renewing' and r."daysLeft" between 0 and 30 then 'autopay'
               when r.state in ('manual_renew', 'cancelling', 'trial', 'renewing') and r."daysLeft" > 30 and r."daysLeft" < 3650 then 'later'
               else 'none' end as bucket
        from r
        left join public.subscriptions s on s.tenant_id = r.id
        left join public.plans pl on pl.period = r.period
        left join lp on lp.tenant_id = r.id)
    select jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'ownerEmail', x."ownerEmail", 'phone', x.phone, 'state', x.state, 'bucket', x.bucket,
        'period', x.period, 'planName', x."planName", 'endsAt', x."endsAt", 'daysLeft', x."daysLeft", 'autopay', x.autopay,
        'amountDue', x.due, 'planMonths', x.months, 'lastPaymentAt', x."lastPaymentAt", 'lastAmount', x.last_amount,
        'paymentsCount', x."paymentsCount", 'renewals', x.renewals, 'paid', x.paid, 'note', x.note,
        'reminders', (select count(*) from public.collection_log l where l.tenant_id = x.id and l.action in ('email', 'whatsapp', 'copy')),
        'lastReminderAt', (select max(l.created_at) from public.collection_log l where l.tenant_id = x.id and l.action in ('email', 'whatsapp', 'copy')),
        'lastFollowupAt', (select max(l.created_at) from public.collection_log l where l.tenant_id = x.id),
        'promiseDate', (select l.promise_date from public.collection_log l where l.tenant_id = x.id and l.promise_date is not null order by l.created_at desc limit 1))
      order by x."endsAt" nulls last)
    from x), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------ the collected-money ledger ----
create or replace function public.platform_collected_payments(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', p.id, 'tenantId', p.tenant_id, 'tenant', t.name,
        'ownerEmail', (select m.email from public.members m where m.tenant_id = t.id and m.role = 'owner' limit 1),
        'amount', p.amount_paise / 100.0, 'planName', coalesce(pl.name, p.period), 'paidAt', p.paid_at,
        'offline', p.id like 'manual-%', 'method', case when p.id like 'manual-%' then coalesce(nullif(p.method, ''), 'Offline') else 'Razorpay' end,
        'note', coalesce(p.note, ''),
        'renewal', p.paid_at > (select min(q.paid_at) from public.subscription_payments q where q.tenant_id = p.tenant_id))
      order by p.paid_at desc)
      from (select * from public.subscription_payments
             where (p_from is null or paid_at >= p_from) and (p_to is null or paid_at < p_to)
             order by paid_at desc limit 3000) p
      join public.tenants t on t.id = p.tenant_id
      left join public.plans pl on pl.period = p.period), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------ "I collected the money" ----
-- Records the payment in your revenue AND extends the plan by the plan's length.
-- The new period starts from today (or from the current end date, if the plan is still running), so nobody loses days.
create or replace function public.platform_record_collection(
  p_tenant uuid, p_period text, p_amount_paise integer, p_paid_on date, p_method text, p_note text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare cur record; mths integer; base timestamptz; new_end timestamptz; per text; paid timestamptz;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'Unknown business.'; end if;
  if coalesce(p_amount_paise, 0) <= 0 then raise exception 'Enter the amount you received.'; end if;
  if p_amount_paise > 100000000 then raise exception 'That amount looks too large.'; end if;

  insert into public.subscriptions (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  select * into cur from public.subscriptions where tenant_id = p_tenant;
  per := coalesce(nullif(p_period, ''), cur.period);
  select months into mths from public.plans where period = per;
  if mths is null then raise exception 'Unknown plan.'; end if;

  base := greatest(now(),
            case when cur.status in ('active', 'cancelled', 'past_due') then cur.current_period_end
                 when cur.status = 'trialing' then cur.trial_ends_at end);
  new_end := base + make_interval(months => mths);

  paid := least(now(), coalesce(p_paid_on, current_date)::timestamptz + interval '12 hours');
  if p_paid_on is not null and p_paid_on > current_date then raise exception 'The payment date cannot be in the future.'; end if;

  update public.subscriptions
     set status = 'active', period = per, current_period_end = new_end, manual_access = false, updated_at = now()
   where tenant_id = p_tenant;
  insert into public.subscription_payments (id, tenant_id, amount_paise, period, paid_at, method, note)
  values ('manual-' || gen_random_uuid()::text, p_tenant, p_amount_paise, per, paid, left(coalesce(p_method, ''), 30), left(coalesce(p_note, ''), 300));
  insert into public.collection_log (tenant_id, action, note)
  values (p_tenant, 'collected', left('Received Rs ' || (p_amount_paise / 100.0)::text || ' (' || coalesce(nullif(p_method, ''), 'offline') || ')', 300));
  return new_end;
end $$;

-- ------------------------------------------------------------ follow-up log + phone ----
create or replace function public.platform_log_followup(p_tenant uuid, p_action text, p_note text, p_promise date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_action not in ('email', 'whatsapp', 'copy', 'call', 'note') then raise exception 'Unknown action.'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'Unknown business.'; end if;
  insert into public.collection_log (tenant_id, action, note, promise_date) values (p_tenant, p_action, left(coalesce(p_note, ''), 300), p_promise);
end $$;

create or replace function public.platform_followups(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'action', l.action, 'note', l.note, 'promiseDate', l.promise_date, 'at', l.created_at) order by l.created_at desc)
                     from (select * from public.collection_log where tenant_id = p_tenant order by created_at desc limit 50) l), '[]'::jsonb);
end $$;

create or replace function public.platform_set_phone(p_tenant uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  insert into public.subscriptions (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  update public.subscriptions set contact_phone = left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20), updated_at = now() where tenant_id = p_tenant;
end $$;

revoke all on function public.platform_collections() from public, anon;
revoke all on function public.platform_collected_payments(timestamptz, timestamptz) from public, anon;
revoke all on function public.platform_record_collection(uuid, text, integer, date, text, text) from public, anon;
revoke all on function public.platform_log_followup(uuid, text, text, date) from public, anon;
revoke all on function public.platform_followups(uuid) from public, anon;
revoke all on function public.platform_set_phone(uuid, text) from public, anon;
grant execute on function public.platform_collections() to authenticated;
grant execute on function public.platform_collected_payments(timestamptz, timestamptz) to authenticated;
grant execute on function public.platform_record_collection(uuid, text, integer, date, text, text) to authenticated;
grant execute on function public.platform_log_followup(uuid, text, text, date) to authenticated;
grant execute on function public.platform_followups(uuid) to authenticated;
grant execute on function public.platform_set_phone(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- check: every line must say OK
select 'collections function exists' as check, case when to_regprocedure('public.platform_collections()') is not null then 'OK' else 'MISSING' end
union all select 'collected ledger exists', case when to_regprocedure('public.platform_collected_payments(timestamptz,timestamptz)') is not null then 'OK' else 'MISSING' end
union all select 'record collection exists', case when to_regprocedure('public.platform_record_collection(uuid,text,integer,date,text,text)') is not null then 'OK' else 'MISSING' end
union all select 'follow-up log exists', case when to_regclass('public.collection_log') is not null then 'OK' else 'MISSING' end
union all select 'new columns exist', case when (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'subscription_payments' and column_name in ('method', 'note')) or (table_name = 'subscriptions' and column_name = 'contact_phone'))) = 3 then 'OK' else 'MISSING' end;
