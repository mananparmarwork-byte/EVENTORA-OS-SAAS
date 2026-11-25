-- =====================================================================================
-- 19 - COLLECTIONS: pending / upcoming payments, days left, money collected, renewal reminders,
--      recording payments you received (UPI / cash / bank), follow-up history.
--      Run ONCE in Supabase -> SQL Editor, AFTER 18-billing-qr-invoices.sql. Safe to run again.
--      (Files 16, 17 and 18 already exist in this project, so this one is number 19.)
-- =====================================================================================

alter table public.subscription_payments add column if not exists method text;
alter table public.subscription_payments add column if not exists note text;
alter table public.subscriptions add column if not exists contact_phone text not null default '';

-- what you did about each customer: reminders sent, calls, notes, payments collected
create table if not exists public.collection_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  action text not null check (action in ('email', 'whatsapp', 'copy', 'call', 'note', 'collected')),
  note text not null default '',
  promise_date date,
  created_at timestamptz not null default now()
);
create index if not exists collection_log_tenant_idx on public.collection_log (tenant_id, created_at desc);
alter table public.collection_log enable row level security;
revoke all on public.collection_log from anon, authenticated;     -- only the functions below can touch it

-- ------------------------------------------------------------ one row per business ----
-- bucket: overdue | due_soon (0-7 days) | upcoming (8-30 days) | autopay (older accounts, 0-30 days) | later | none
create or replace function public.platform_collections()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((
    with o as (
      select * from jsonb_to_recordset(public.platform_subscription_overview()) as x(
        id uuid, name text, "ownerEmail" text, state text, period text, "planName" text, "endsAt" timestamptz,
        "daysLeft" int, autopay boolean, "lastPaymentAt" timestamptz, "paymentsCount" int, renewals int, paid numeric, note text)),
    lp as (
      select distinct on (tenant_id) tenant_id, amount_paise
        from public.subscription_payments order by tenant_id, paid_at desc),
    lg as (
      select tenant_id,
             count(*) filter (where action in ('email', 'whatsapp', 'copy')) as reminders,
             max(created_at) filter (where action in ('email', 'whatsapp', 'copy')) as last_reminder,
             max(created_at) as last_followup,
             (array_agg(promise_date order by created_at desc) filter (where promise_date is not null))[1] as promise
        from public.collection_log group by tenant_id),
    r as (
      select o.*, pl.months as plan_months, pl.price_paise, lp.amount_paise as last_amount,
             coalesce(nullif(s.contact_phone, ''), nullif(t.phone, ''), '') as phone,
             lg.reminders, lg.last_reminder, lg.last_followup, lg.promise,
             case
               when o.state in ('lapsed', 'past_due', 'trial_ended') then 'overdue'
               when o.state in ('manual_renew', 'cancelling', 'trial', 'free_access') and o."daysLeft" between 0 and 7 then 'due_soon'
               when o.state in ('manual_renew', 'cancelling', 'trial', 'free_access') and o."daysLeft" between 8 and 30 then 'upcoming'
               when o.state = 'renewing' and o."daysLeft" between 0 and 30 then 'autopay'
               when o.state in ('manual_renew', 'cancelling', 'trial', 'renewing') and o."daysLeft" between 31 and 3649 then 'later'
               else 'none' end as bucket
        from o
        left join public.plans pl on pl.period = o.period
        left join public.subscriptions s on s.tenant_id = o.id
        left join public.tenants t on t.id = o.id
        left join lp on lp.tenant_id = o.id
        left join lg on lg.tenant_id = o.id)
    select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'ownerEmail', r."ownerEmail", 'phone', r.phone, 'state', r.state, 'bucket', r.bucket,
        'period', r.period, 'planName', r."planName", 'endsAt', r."endsAt", 'daysLeft', r."daysLeft", 'autopay', coalesce(r.autopay, false),
        'amountDue', coalesce(r.price_paise, r.last_amount, 0) / 100.0, 'planMonths', coalesce(r.plan_months, 1),
        'lastPaymentAt', r."lastPaymentAt", 'lastAmount', case when r.last_amount is null then null else r.last_amount / 100.0 end,
        'paymentsCount', r."paymentsCount", 'renewals', r.renewals, 'paid', r.paid, 'note', coalesce(r.note, ''),
        'reminders', coalesce(r.reminders, 0), 'lastReminderAt', r.last_reminder, 'lastFollowupAt', r.last_followup, 'promiseDate', r.promise)
      order by r."endsAt" nulls last, r.name)
    from r), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------ money collected ----
create or replace function public.platform_collected_payments(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', x.id, 'tenantId', x.tenant_id, 'tenant', x.tname, 'ownerEmail', x.owner_email, 'amount', x.amount_paise / 100.0,
        'planName', x.pname, 'paidAt', x.paid_at, 'offline', x.offline,
        'method', case when not x.offline then 'Razorpay' else coalesce(nullif(x.method, ''), 'Offline') end,
        'note', coalesce(x.note, ''), 'renewal', x.is_renewal) order by x.paid_at desc)
      from (
        select p.id, p.tenant_id, t.name as tname, p.amount_paise, coalesce(pl.name, p.period) as pname, p.paid_at,
               p.id like 'manual-%' as offline, p.method, p.note,
               (select m.email from public.members m where m.tenant_id = t.id and m.role = 'owner' limit 1) as owner_email,
               p.paid_at > (select min(q.paid_at) from public.subscription_payments q where q.tenant_id = p.tenant_id) as is_renewal
          from public.subscription_payments p
          join public.tenants t on t.id = p.tenant_id
          left join public.plans pl on pl.period = p.period
         where (p_from is null or p.paid_at >= p_from) and (p_to is null or p.paid_at < p_to)
         order by p.paid_at desc limit 3000) x), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------ record a payment you received ----
-- New end date = (the later of now and the current end date) + the plan's months. Returns the new end date.
create or replace function public.platform_record_collection(p_tenant uuid, p_period text, p_amount_paise integer, p_paid_on date, p_method text, p_note text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  pl record; sub record; base timestamptz; new_end timestamptz; paid_ts timestamptz;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  how text := left(btrim(coalesce(p_method, '')), 30);
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'Unknown business.'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 then raise exception 'Enter the amount you received (more than 0).'; end if;
  if p_amount_paise >= 100000000 then raise exception 'That amount is too large.'; end if;
  select * into pl from public.plans where period = p_period;
  if not found then raise exception 'Unknown plan.'; end if;
  if p_paid_on is not null and p_paid_on > today then raise exception 'The received date cannot be in the future.'; end if;

  insert into public.subscriptions (tenant_id) values (p_tenant) on conflict (tenant_id) do nothing;
  select * into sub from public.subscriptions where tenant_id = p_tenant;

  base := greatest(now(),
            case when sub.status in ('active', 'cancelled', 'past_due') then sub.current_period_end
                 when sub.status = 'trialing' then sub.trial_ends_at end);
  new_end := base + make_interval(months => greatest(coalesce(pl.months, 1), 1));
  paid_ts := case when p_paid_on is null or p_paid_on = today then now() else ((p_paid_on::timestamp + interval '12 hours') at time zone 'Asia/Kolkata') end;

  update public.subscriptions
     set status = 'active', period = p_period, current_period_end = new_end, manual_access = false, updated_at = now()
   where tenant_id = p_tenant;

  insert into public.subscription_payments (id, tenant_id, amount_paise, period, paid_at, method, note)
  values ('manual-' || gen_random_uuid()::text, p_tenant, p_amount_paise, p_period, paid_ts, nullif(how, ''), left(btrim(coalesce(p_note, '')), 300));

  insert into public.collection_log (tenant_id, action, note)
  values (p_tenant, 'collected', left('Rs ' || (p_amount_paise / 100.0)::text || case when how <> '' then ' via ' || how else '' end ||
                                      case when btrim(coalesce(p_note, '')) <> '' then ' - ' || btrim(p_note) else '' end, 300));
  return new_end;
end $$;

-- ------------------------------------------------------------ follow-ups ----
create or replace function public.platform_log_followup(p_tenant uuid, p_action text, p_note text default '', p_promise date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_action is null or p_action not in ('email', 'whatsapp', 'copy', 'call', 'note') then raise exception 'Unknown follow-up type.'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'Unknown business.'; end if;
  insert into public.collection_log (tenant_id, action, note, promise_date)
  values (p_tenant, p_action, left(btrim(coalesce(p_note, '')), 300), p_promise);
end $$;

create or replace function public.platform_followups(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'action', f.action, 'note', f.note, 'promiseDate', f.promise_date, 'at', f.created_at) order by f.created_at desc)
      from (select * from public.collection_log where tenant_id = p_tenant order by created_at desc limit 50) f), '[]'::jsonb);
end $$;

create or replace function public.platform_set_phone(p_tenant uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then raise exception 'Unknown business.'; end if;
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
select 'collection_log table' as check, case when to_regclass('public.collection_log') is not null then 'OK' else 'MISSING' end as result
union all select 'platform_collections', case when to_regprocedure('public.platform_collections()') is not null then 'OK' else 'MISSING' end
union all select 'platform_collected_payments', case when to_regprocedure('public.platform_collected_payments(timestamptz,timestamptz)') is not null then 'OK' else 'MISSING' end
union all select 'platform_record_collection', case when to_regprocedure('public.platform_record_collection(uuid,text,integer,date,text,text)') is not null then 'OK' else 'MISSING' end
union all select 'platform_log_followup', case when to_regprocedure('public.platform_log_followup(uuid,text,text,date)') is not null then 'OK' else 'MISSING' end
union all select 'platform_followups', case when to_regprocedure('public.platform_followups(uuid)') is not null then 'OK' else 'MISSING' end
union all select 'platform_set_phone', case when to_regprocedure('public.platform_set_phone(uuid,text)') is not null then 'OK' else 'MISSING' end
union all select 'new columns', case when (select count(*) from information_schema.columns where table_schema = 'public' and (
    (table_name = 'subscription_payments' and column_name in ('method', 'note')) or (table_name = 'subscriptions' and column_name = 'contact_phone'))) = 3 then 'OK' else 'MISSING' end;
