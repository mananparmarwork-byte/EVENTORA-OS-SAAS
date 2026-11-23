-- =====================================================================================
-- 19 - BILLING: UPI QR with the exact amount, monthly extra-branch fee, one request for
--      "renew plan + add branches", and an automatic invoice when you approve.
--
--  * Extra branch = a MONTHLY fee per branch (Super admin -> Settings -> "Extra branch fee per month").
--  * Owner on an active plan adds a branch  -> pays  fee x months left in the plan.
--  * Owner renews                            -> pays  plan price + fee x plan months for every extra branch kept
--                                               (+ fee x (months left + plan months) for each NEW branch).
--  * Extra branches that are NOT paid again at renewal are switched off (their data is kept).
--  * When you approve, an invoice is created automatically (GST optional, everything editable by you).
--
-- Run ONCE in Supabase -> SQL Editor, AFTER file 16 and 18-clients-payments-cleanup.sql. Safe to run again.
-- It keeps everything from file 18: mobile number required, payment method/reference on payments, auto-delete of answered requests.
-- =====================================================================================

do $$
begin
  if to_regclass('public.branches') is null or to_regprocedure('public.create_request(text,text,text,jsonb)') is null
     or to_regprocedure('public.platform_record_payment(uuid,integer,date,text,text,text,timestamptz,text)') is null
     or to_regprocedure('public._purge_requests()') is null then
    raise exception 'Run file 16 and then 18-clients-payments-cleanup.sql first. Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------- invoice settings ----
insert into public.platform_settings (key, data) values ('invoice', jsonb_build_object(
  'prefix', 'INV', 'next', 1, 'name', '', 'address', '', 'gstin', '', 'pan', '', 'phone', '', 'email', '',
  'terms', 'Software subscription. Access is activated after payment is confirmed.', 'footer', 'Thank you for choosing Eventora OS.',
  'gstEnabled', false, 'gstRate', 18)) on conflict (key) do nothing;

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid,
  number text not null unique,
  issued_at timestamptz not null default now(),
  bill_to jsonb not null default '{}'::jsonb,
  seller jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,          -- [{description, amount (rupees)}]
  gst_enabled boolean not null default false,
  gst_rate numeric not null default 0,
  subtotal_paise integer not null default 0,
  gst_paise integer not null default 0,
  total_paise integer not null default 0,
  paid_paise integer not null default 0,
  payment_ref text not null default '',
  paid_on date,
  period_from timestamptz,
  period_to timestamptz,
  plan_name text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscription_invoices_tenant_idx on public.subscription_invoices (tenant_id, issued_at desc);
alter table public.subscription_invoices enable row level security;
revoke all on public.subscription_invoices from anon, authenticated;

-- GST on an invoice is OPTIONAL and always "included in the price" (the amount the owner paid does not change):
-- with GST on, the total is split into taxable value + GST.
create or replace function public._invoice_totals(p_items jsonb, p_gst boolean, p_rate numeric)
returns jsonb language plpgsql immutable as $$
declare tot integer; sub integer;
begin
  tot := round(coalesce((select sum((i ->> 'amount')::numeric) from jsonb_array_elements(p_items) i), 0) * 100);
  if p_gst and coalesce(p_rate, 0) > 0 then
    sub := round(tot / (1 + p_rate / 100.0));
    return jsonb_build_object('subtotal', sub, 'gst', tot - sub, 'total', tot);
  end if;
  return jsonb_build_object('subtotal', tot, 'gst', 0, 'total', tot);
end $$;

create or replace function public._invoice_json(i public.subscription_invoices)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'number', i.number, 'issuedAt', i.issued_at, 'tenantId', i.tenant_id,
    'business', (select name from public.tenants where id = i.tenant_id), 'billTo', i.bill_to, 'seller', i.seller, 'items', i.items,
    'gstEnabled', i.gst_enabled, 'gstRate', i.gst_rate, 'subtotal', i.subtotal_paise / 100.0, 'gst', i.gst_paise / 100.0, 'total', i.total_paise / 100.0,
    'paid', i.paid_paise / 100.0, 'paymentRef', i.payment_ref, 'paidOn', i.paid_on, 'periodFrom', i.period_from, 'periodTo', i.period_to,
    'planName', i.plan_name, 'notes', i.notes);
$$;
revoke all on function public._invoice_totals(jsonb, boolean, numeric) from public, anon, authenticated;
revoke all on function public._invoice_json(public.subscription_invoices) from public, anon, authenticated;

-- ------------------------------------------------------------------ the price quote ----
-- whole months left in the running paid plan (at least 1 while it runs, at most 12)
create or replace function public._months_left(t uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select case when s.status = 'active' and s.current_period_end > now()
                               then least(12, greatest(1, ceil(extract(epoch from (s.current_period_end - now())) / 2592000.0)::integer)) else 0 end
                     from public.subscriptions s where s.tenant_id = t), 0);
$$;
revoke all on function public._months_left(uuid) from public, anon, authenticated;

-- p_renew: renewing / changing the plan in this payment.  p_keep: how many existing extra branches to keep (renewal only).
-- p_new: how many NEW branches are being added.  Returns the lines, the total and the new end date.
create or replace function public._billing_quote(t uuid, p_renew boolean, p_period text, p_keep integer, p_new integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tn public.tenants; s public.subscriptions; pl public.plans;
  bp numeric; extras integer; keep integer; newc integer := greatest(coalesce(p_new, 0), 0); ml integer; pm integer := 0; bm integer := 0;
  lines jsonb := '[]'::jsonb; total numeric := 0; plan_price numeric := 0; base timestamptz; new_end timestamptz;
begin
  select * into tn from public.tenants where id = t;
  if not found then raise exception 'Unknown business.'; end if;
  select * into s from public.subscriptions where tenant_id = t;
  bp := greatest(coalesce((select nullif(data ->> 'branchPrice', '')::numeric from public.platform_settings where key = 'config'), 0), 0);
  extras := greatest(tn.branch_limit - 1, 0);
  ml := public._months_left(t);
  if newc > 10 then raise exception 'You can add up to 10 branches at a time.'; end if;

  if p_renew then
    select * into pl from public.plans where period = p_period and active;
    if not found then raise exception 'Choose a plan.'; end if;
    pm := pl.months;
    plan_price := pl.price_paise / 100.0;
    keep := least(greatest(coalesce(p_keep, extras), 0), extras);
    bm := ml + pm;                                            -- a new branch is covered from today until the end of the NEW period
    base := case when s.status = 'active' and s.current_period_end > now() then s.current_period_end else now() end;
    new_end := base + make_interval(months => pm);
    lines := lines || jsonb_build_array(jsonb_build_object('label', pl.name || ' plan (' || pm || case when pm = 1 then ' month)' else ' months)' end, 'amount', plan_price));
    total := plan_price;
    if keep > 0 and bp > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object('label', 'Keep ' || keep || ' extra branch' || case when keep = 1 then '' else 'es' end
               || ' (₹' || to_char(bp, 'FM999,999,990') || ' per month × ' || pm || ' month' || case when pm = 1 then ')' else 's)' end, 'amount', keep * bp * pm));
      total := total + keep * bp * pm;
    end if;
  else
    if not (s.status = 'active' and ml > 0) then
      raise exception 'To add a branch your plan must be running. Choose "Renew my plan" in the same payment.';
    end if;
    keep := extras;
    bm := ml;
    new_end := s.current_period_end;
  end if;

  if newc > 0 and bp > 0 then
    lines := lines || jsonb_build_array(jsonb_build_object('label', newc || ' new extra branch' || case when newc = 1 then '' else 'es' end
             || ' (₹' || to_char(bp, 'FM999,999,990') || ' per month × ' || bm || ' month' || case when bm = 1 then ')' else 's)' end, 'amount', newc * bp * bm));
    total := total + newc * bp * bm;
  end if;

  return jsonb_build_object('renew', p_renew, 'period', coalesce(p_period, ''), 'planName', coalesce(pl.name, ''), 'planMonths', pm, 'planPrice', plan_price,
    'branchPrice', bp, 'extras', extras, 'keep', keep, 'newCount', newc, 'monthsLeft', ml, 'branchMonths', bm, 'lines', lines, 'total', total, 'newEnd', new_end);
end $$;
revoke all on function public._billing_quote(uuid, boolean, text, integer, integer) from public, anon, authenticated;

-- what the owner's Billing page asks for to draw the QR (same maths the request uses)
create or replace function public.billing_quote(p_renew boolean, p_period text, p_keep integer, p_new integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_tenant() is null or not public.is_admin() then raise exception 'Only the owner can do this.'; end if;
  return public._billing_quote(public.my_tenant(), coalesce(p_renew, false), nullif(p_period, ''), p_keep, p_new);
end $$;
revoke all on function public.billing_quote(boolean, text, integer, integer) from public, anon;
grant execute on function public.billing_quote(boolean, text, integer, integer) to authenticated;

-- ------------------------------------------------------------------ owner's request ----
create or replace function public.create_request(p_kind text, p_subject text, p_message text, p_payload jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.my_tenant(); rid uuid; pl jsonb := coalesce(p_payload, '{}'::jsonb); nm text;
  subj text := left(btrim(coalesce(p_subject, '')), 120); msg text := left(btrim(coalesce(p_message, '')), 1500);
  q jsonb; names jsonb := '[]'::jsonb; el jsonb; v_renew boolean; v_ref text; n integer; joined text; ph text;
begin
  if t is null or not public.is_admin() then raise exception 'Only the owner can send requests.'; end if;
  -- the owner's mobile number is required (so you can call them); it is remembered on the business
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
    v_renew := coalesce(pl ->> 'renew', 'true') <> 'false';
    if jsonb_typeof(coalesce(pl -> 'newBranches', '[]'::jsonb)) <> 'array' then raise exception 'Branch details are not valid.'; end if;
    for el in select * from jsonb_array_elements(coalesce(pl -> 'newBranches', '[]'::jsonb)) loop
      nm := left(btrim(coalesce(el ->> 'name', '')), 60);
      if char_length(nm) < 2 then raise exception 'Enter a name for every new branch.'; end if;
      names := names || jsonb_build_array(jsonb_build_object('name', nm, 'address', left(btrim(coalesce(el ->> 'address', '')), 200), 'phone', ''));
    end loop;
    n := jsonb_array_length(names);
    if not v_renew and n = 0 then raise exception 'Choose a plan renewal or add a branch.'; end if;
    q := public._billing_quote(t, v_renew, nullif(pl ->> 'period', ''), nullif(pl ->> 'keep', '')::integer, n);
    v_ref := left(btrim(coalesce(pl ->> 'reference', '')), 80);
    if (q ->> 'total')::numeric > 0 and char_length(v_ref) < 4 then raise exception 'Enter the UPI transaction ID (at least 4 characters).'; end if;
    pl := jsonb_build_object('renew', v_renew, 'period', coalesce(pl ->> 'period', ''), 'keep', q -> 'keep', 'newBranches', names, 'reference', v_ref,
                             'amount', left(btrim(coalesce(pl ->> 'amount', '')), 20), 'paidOn', left(btrim(coalesce(pl ->> 'paidOn', '')), 20), 'quote', q);
    subj := concat_ws(' + ', case when v_renew then 'Renew ' || coalesce(nullif(q ->> 'planName', ''), 'plan') end,
                             case when n > 0 then 'Add ' || n || ' branch' || case when n = 1 then '' else 'es' end end);
  else
    if subj = '' then raise exception 'Write a short subject.'; end if;
    if msg = '' then raise exception 'Write your message.'; end if;
    pl := '{}'::jsonb;
  end if;

  pl := pl || jsonb_build_object('contact', ph);
  insert into public.requests (tenant_id, created_by, created_by_email, kind, subject, message, payload)
  values (t, auth.uid(), auth.jwt() ->> 'email', p_kind, subj, msg, pl) returning id into rid;

  joined := coalesce((select string_agg(x ->> 'name', ', ') from jsonb_array_elements(coalesce(pl -> 'newBranches', '[]'::jsonb)) x), coalesce(pl ->> 'name', ''));
  if p_kind = 'renewal' and not v_renew then
    perform public._fire_event('branch_received', t, jsonb_build_object('branch', joined, 'subject', subj), rid::text);
  else
    perform public._fire_event(p_kind || '_received', t, jsonb_build_object('branch', joined, 'subject', subj), rid::text);
  end if;
  return rid;
end $$;

-- ------------------------------------------------------------------ for you: list ------
create or replace function public.platform_list_requests(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'tenantId', r.tenant_id, 'business', t.name, 'ownerEmail', coalesce(t.owner_email, r.created_by_email), 'phone', t.phone,
              'kind', r.kind, 'status', r.status, 'subject', r.subject, 'message', r.message, 'payload', r.payload, 'createdAt', r.created_at,
              'decidedAt', r.decided_at, 'note', r.decision_note, 'amount', r.amount_paise / 100.0,
              'branchLimit', t.branch_limit, 'branchesUsed', (select count(*) from public.branches b where b.tenant_id = t.id and b.active),
              'periodEnd', s.current_period_end, 'subStatus', s.status)
              order by (r.status = 'pending') desc, r.created_at desc)
            from (select * from public.requests where p_status is null or status = p_status order by created_at desc limit 200) r
            join public.tenants t on t.id = r.tenant_id
            left join public.subscriptions s on s.tenant_id = r.tenant_id), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------------ the invoice -------
create or replace function public._create_invoice(p_req public.requests, p_paid_paise integer, p_until timestamptz, p_old_end timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb; n integer; num text; tn public.tenants; biz jsonb; bt jsonb; seller jsonb; q jsonb; l jsonb; v_items jsonb := '[]'::jsonb;
  v_gst boolean; v_rate numeric; tots jsonb; nid uuid; v_from timestamptz; v_ref text; v_paid date;
begin
  select data into cfg from public.platform_settings where key = 'invoice' for update;
  cfg := coalesce(cfg, '{}'::jsonb);
  n := greatest(coalesce(nullif(cfg ->> 'next', '')::integer, 1), 1);
  insert into public.platform_settings (key, data) values ('invoice', jsonb_build_object('next', n + 1))
    on conflict (key) do update set data = public.platform_settings.data || jsonb_build_object('next', n + 1);
  num := coalesce(nullif(btrim(cfg ->> 'prefix'), ''), 'INV') || '-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(n::text, 4, '0');
  while exists (select 1 from public.subscription_invoices where number = num) loop
    n := n + 1; num := coalesce(nullif(btrim(cfg ->> 'prefix'), ''), 'INV') || '-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(n::text, 4, '0');
  end loop;

  select * into tn from public.tenants where id = p_req.tenant_id;
  biz := coalesce((select data from public.app_settings where tenant_id = tn.id and id = 'business'), '{}'::jsonb);
  bt := jsonb_build_object('name', coalesce(nullif(biz ->> 'name', ''), tn.name), 'address', coalesce(biz ->> 'address', ''), 'gstin', coalesce(biz ->> 'gstin', ''),
        'phone', coalesce(nullif(biz ->> 'phone', ''), tn.phone, ''), 'email', coalesce(nullif(biz ->> 'email', ''), tn.owner_email, ''));
  seller := jsonb_build_object('name', coalesce(cfg ->> 'name', ''), 'address', coalesce(cfg ->> 'address', ''), 'gstin', coalesce(cfg ->> 'gstin', ''), 'pan', coalesce(cfg ->> 'pan', ''),
        'phone', coalesce(cfg ->> 'phone', ''), 'email', coalesce(cfg ->> 'email', ''), 'terms', coalesce(cfg ->> 'terms', ''), 'footer', coalesce(cfg ->> 'footer', ''));

  q := p_req.payload -> 'quote';
  if q is not null and jsonb_typeof(q -> 'lines') = 'array' and jsonb_array_length(q -> 'lines') > 0 then
    for l in select * from jsonb_array_elements(q -> 'lines') loop
      v_items := v_items || jsonb_build_array(jsonb_build_object('description', left(l ->> 'label', 200), 'amount', round((l ->> 'amount')::numeric, 2)));
    end loop;
  else
    v_items := jsonb_build_array(jsonb_build_object('description', 'Eventora OS subscription', 'amount', round(p_paid_paise / 100.0, 2)));
  end if;

  v_gst := coalesce((cfg ->> 'gstEnabled')::boolean, false);
  v_rate := coalesce(nullif(cfg ->> 'gstRate', '')::numeric, 0);
  tots := public._invoice_totals(v_items, v_gst, v_rate);
  v_ref := left(coalesce(p_req.payload ->> 'reference', ''), 80);
  begin v_paid := nullif(p_req.payload ->> 'paidOn', '')::date; exception when others then v_paid := null; end;
  v_from := case when p_old_end is not null and p_old_end > now() then p_old_end else now() end;

  insert into public.subscription_invoices (tenant_id, request_id, number, bill_to, seller, items, gst_enabled, gst_rate, subtotal_paise, gst_paise, total_paise, paid_paise,
                                            payment_ref, paid_on, period_from, period_to, plan_name)
  values (tn.id, p_req.id, num, bt, seller, v_items, v_gst, v_rate, (tots ->> 'subtotal')::integer, (tots ->> 'gst')::integer, (tots ->> 'total')::integer,
          greatest(p_paid_paise, 0), v_ref, coalesce(v_paid, (now() at time zone 'Asia/Kolkata')::date),
          case when p_until is not null then v_from end, p_until, coalesce(q ->> 'planName', ''))
  returning id into nid;
  return nid;
end $$;
revoke all on function public._create_invoice(public.requests, integer, timestamptz, timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------------ you decide ---------
create or replace function public.platform_decide_request(p_id uuid, p_status text, p_note text default '', p_amount_paise integer default 0,
                                                          p_until timestamptz default null, p_period text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.requests; note text := left(btrim(coalesce(p_note, '')), 600); bn text; per text; pl jsonb; v_renew boolean; tn public.tenants;
  extras integer; v_keep integer; el jsonb; nm text; old_end timestamptz; paid integer; joined text; qtotal numeric;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p_status not in ('approved', 'rejected', 'closed') then raise exception 'Unknown decision.'; end if;
  select * into r from public.requests where id = p_id for update;
  if not found then raise exception 'That request was not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already answered.'; end if;
  if coalesce(p_amount_paise, 0) < 0 then raise exception 'Amount cannot be negative.'; end if;

  if r.kind = 'branch' then
    -- older single-branch requests (before payments were added to Billing)
    bn := r.payload ->> 'name';
    if p_status = 'approved' then
      update public.tenants set branch_limit = least(branch_limit + 1, 200) where id = r.tenant_id;
      if coalesce(bn, '') <> '' and not exists (select 1 from public.branches b where b.tenant_id = r.tenant_id and lower(btrim(b.name)) = lower(btrim(bn))) then
        insert into public.branches (tenant_id, name, address, phone) values (r.tenant_id, bn, coalesce(r.payload ->> 'address', ''), coalesce(r.payload ->> 'phone', ''));
      end if;
      if coalesce(p_amount_paise, 0) > 0 then
        insert into public.subscription_payments (id, tenant_id, amount_paise, period, method, reference)
        values ('manual-branch-' || gen_random_uuid()::text, r.tenant_id, p_amount_paise, 'extra-branch', 'UPI / bank (owner request)', left(coalesce(r.payload ->> 'reference', ''), 80));
      end if;
      perform public._fire_event('branch_approved', r.tenant_id, jsonb_build_object('branch', coalesce(bn, ''), 'note', note), r.id::text);
    else
      perform public._fire_event('branch_rejected', r.tenant_id, jsonb_build_object('branch', coalesce(bn, ''), 'note', note), r.id::text);
    end if;

  elsif r.kind = 'renewal' then
    pl := r.payload;
    v_renew := coalesce(pl ->> 'renew', 'true') <> 'false';
    joined := coalesce((select string_agg(x ->> 'name', ', ') from jsonb_array_elements(coalesce(pl -> 'newBranches', '[]'::jsonb)) x), '');
    if p_status = 'approved' then
      select * into tn from public.tenants where id = r.tenant_id for update;
      old_end := (select current_period_end from public.subscriptions where tenant_id = r.tenant_id);
      qtotal := coalesce((pl -> 'quote' ->> 'total')::numeric, 0);
      paid := case when coalesce(p_amount_paise, 0) > 0 then p_amount_paise else round(qtotal * 100)::integer end;

      if v_renew then
        if p_until is null then raise exception 'Choose the date until which access should run.'; end if;
        per := coalesce(nullif(p_period, ''), nullif(pl ->> 'period', ''));
        if per is not null and not exists (select 1 from public.plans where period = per) then per := null; end if;
        perform public._grant_access_core(r.tenant_id, per, p_until, 'Renewal request approved', paid);
        if paid > 0 then
          update public.subscription_payments set method = 'UPI / bank (owner request)', reference = left(coalesce(pl ->> 'reference', ''), 80)
           where id = (select id from public.subscription_payments where tenant_id = r.tenant_id and id like 'manual-%' and method is null order by paid_at desc limit 1);
        end if;
      elsif paid > 0 then
        insert into public.subscription_payments (id, tenant_id, amount_paise, period, method, reference)
        values ('manual-branch-' || gen_random_uuid()::text, r.tenant_id, paid, 'extra-branch', 'UPI / bank (owner request)', left(coalesce(pl ->> 'reference', ''), 80));
      end if;

      -- branches (requests made from the new Billing page carry "keep" / "newBranches")
      if pl ? 'keep' or pl ? 'newBranches' then
        extras := greatest(tn.branch_limit - 1, 0);
        if v_renew then
          v_keep := least(greatest(coalesce(nullif(pl ->> 'keep', '')::integer, extras), 0), extras);
          if v_keep < extras then
            -- extra branches that were not paid again are switched off (data is kept); the newest ones go first
            update public.tenants set branch_limit = 1 + v_keep where id = tn.id;
            update public.branches set active = false
             where id in (select b.id from public.branches b where b.tenant_id = tn.id and b.active and not b.is_main order by b.created_at asc offset v_keep);
          end if;
        end if;
        for el in select * from jsonb_array_elements(coalesce(pl -> 'newBranches', '[]'::jsonb)) loop
          nm := el ->> 'name';
          update public.tenants set branch_limit = least(branch_limit + 1, 200) where id = tn.id;
          if coalesce(nm, '') <> '' and not exists (select 1 from public.branches b where b.tenant_id = tn.id and lower(btrim(b.name)) = lower(btrim(nm))) then
            insert into public.branches (tenant_id, name, address, phone) values (tn.id, nm, coalesce(el ->> 'address', ''), coalesce(el ->> 'phone', ''));
          end if;
        end loop;
      end if;

      if paid > 0 then perform public._create_invoice(r, paid, case when v_renew then p_until end, old_end); end if;

      if v_renew then
        perform public._fire_event('renewal_approved', r.tenant_id, jsonb_build_object('until', to_char(p_until at time zone 'Asia/Kolkata', 'DD Mon YYYY'), 'note', note), r.id::text);
      else
        perform public._fire_event('branch_approved', r.tenant_id, jsonb_build_object('branch', joined, 'note', note), r.id::text);
      end if;
    else
      perform public._fire_event('renewal_rejected', r.tenant_id, jsonb_build_object('note', note), r.id::text);
    end if;

  else
    if note = '' then raise exception 'Write your reply.'; end if;
    perform public._fire_event('support_replied', r.tenant_id, jsonb_build_object('note', note, 'subject', r.subject), r.id::text);
  end if;

  update public.requests set status = p_status, decided_at = now(), decided_by = auth.uid(), decision_note = note,
         amount_paise = case when p_status = 'approved' then coalesce(nullif(p_amount_paise, 0), round(coalesce((payload -> 'quote' ->> 'total')::numeric, 0) * 100)::integer, 0) else 0 end
   where id = p_id;
  perform public._purge_requests();
end $$;

-- ------------------------------------------------------------------ invoices: read / edit ----
create or replace function public.my_invoices()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_tenant() is null or not public.is_admin() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(public._invoice_json(i) order by i.issued_at desc) from public.subscription_invoices i where i.tenant_id = public.my_tenant()), '[]'::jsonb);
end $$;

create or replace function public.platform_list_invoices()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select jsonb_agg(public._invoice_json(i) order by i.issued_at desc) from (select * from public.subscription_invoices order by issued_at desc limit 300) i), '[]'::jsonb);
end $$;

create or replace function public._pick_text(p jsonb, keys text[])
returns jsonb language plpgsql immutable as $$
declare k text; res jsonb := '{}'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return res; end if;
  foreach k in array keys loop
    if p ? k then res := res || jsonb_build_object(k, left(btrim(coalesce(p ->> k, '')), 400)); end if;
  end loop;
  return res;
end $$;
revoke all on function public._pick_text(jsonb, text[]) from public, anon, authenticated;

create or replace function public.platform_update_invoice(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.subscription_invoices; it jsonb; v_items jsonb; v_gst boolean; v_rate numeric; tots jsonb; v_num text;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  select * into inv from public.subscription_invoices where id = p_id for update;
  if not found then raise exception 'That invoice was not found.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Invoice details are missing.'; end if;

  v_items := coalesce(p -> 'items', inv.items);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) not between 1 and 20 then raise exception 'An invoice needs 1 to 20 lines.'; end if;
  for it in select * from jsonb_array_elements(v_items) loop
    if jsonb_typeof(it) <> 'object' or char_length(btrim(coalesce(it ->> 'description', ''))) not between 1 and 200 or coalesce(it ->> 'amount', '') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'Each line needs a description and an amount (0 or more).';
    end if;
  end loop;
  v_items := (select jsonb_agg(jsonb_build_object('description', left(btrim(i ->> 'description'), 200), 'amount', round((i ->> 'amount')::numeric, 2))) from jsonb_array_elements(v_items) i);
  v_gst := coalesce((p ->> 'gstEnabled')::boolean, inv.gst_enabled);
  v_rate := coalesce(nullif(p ->> 'gstRate', '')::numeric, inv.gst_rate);
  if v_rate < 0 or v_rate > 40 then raise exception 'GST rate must be between 0 and 40.'; end if;
  tots := public._invoice_totals(v_items, v_gst, v_rate);
  v_num := left(coalesce(nullif(btrim(p ->> 'number'), ''), inv.number), 30);

  update public.subscription_invoices set
    number = v_num, items = v_items, gst_enabled = v_gst, gst_rate = v_rate,
    bill_to = inv.bill_to || public._pick_text(p -> 'billTo', array['name', 'address', 'gstin', 'phone', 'email']),
    seller = inv.seller || public._pick_text(p -> 'seller', array['name', 'address', 'gstin', 'pan', 'phone', 'email', 'terms', 'footer']),
    subtotal_paise = (tots ->> 'subtotal')::integer, gst_paise = (tots ->> 'gst')::integer, total_paise = (tots ->> 'total')::integer,
    paid_paise = case when p ? 'paid' then round(greatest((p ->> 'paid')::numeric, 0) * 100)::integer else inv.paid_paise end,
    payment_ref = left(coalesce(p ->> 'paymentRef', inv.payment_ref), 80),
    paid_on = coalesce(nullif(p ->> 'paidOn', '')::date, inv.paid_on),
    issued_at = coalesce(nullif(p ->> 'issuedAt', '')::timestamptz, inv.issued_at),
    notes = left(coalesce(p ->> 'notes', inv.notes), 600), plan_name = left(coalesce(p ->> 'planName', inv.plan_name), 80), updated_at = now()
  where id = p_id;
exception when unique_violation then
  raise exception 'That invoice number is already used.';
end $$;

-- your own details on the invoice (name, address, GST number, GST on/off, rate, numbering)
create or replace function public.platform_get_invoice_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  return coalesce((select data from public.platform_settings where key = 'invoice'), '{}'::jsonb);
end $$;

create or replace function public.platform_save_invoice_settings(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare clean jsonb; v_prefix text; v_next integer; v_rate numeric;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Settings are missing.'; end if;
  clean := public._pick_text(p, array['name', 'address', 'gstin', 'pan', 'phone', 'email', 'terms', 'footer']);
  v_prefix := upper(regexp_replace(coalesce(p ->> 'prefix', 'INV'), '[^A-Za-z0-9]', '', 'g'));
  if v_prefix = '' then v_prefix := 'INV'; end if;
  v_rate := coalesce(nullif(p ->> 'gstRate', '')::numeric, 18);
  if v_rate < 0 or v_rate > 40 then raise exception 'GST rate must be between 0 and 40.'; end if;
  clean := clean || jsonb_build_object('prefix', left(v_prefix, 10), 'gstEnabled', coalesce((p ->> 'gstEnabled')::boolean, false), 'gstRate', v_rate);
  v_next := nullif(p ->> 'next', '')::integer;
  if v_next is not null then
    if v_next < 1 or v_next > 99999999 then raise exception 'The next invoice number must be 1 or more.'; end if;
    clean := clean || jsonb_build_object('next', v_next);
  end if;
  insert into public.platform_settings (key, data) values ('invoice', clean)
  on conflict (key) do update set data = public.platform_settings.data || excluded.data;
end $$;

revoke all on function public.create_request(text, text, text, jsonb) from public, anon;
revoke all on function public.platform_list_requests(text) from public, anon;
revoke all on function public.platform_decide_request(uuid, text, text, integer, timestamptz, text) from public, anon;
revoke all on function public.my_invoices() from public, anon;
revoke all on function public.platform_list_invoices() from public, anon;
revoke all on function public.platform_update_invoice(uuid, jsonb) from public, anon;
revoke all on function public.platform_get_invoice_settings() from public, anon;
revoke all on function public.platform_save_invoice_settings(jsonb) from public, anon;
grant execute on function public.create_request(text, text, text, jsonb) to authenticated;
grant execute on function public.platform_list_requests(text) to authenticated;
grant execute on function public.platform_decide_request(uuid, text, text, integer, timestamptz, text) to authenticated;
grant execute on function public.my_invoices() to authenticated;
grant execute on function public.platform_list_invoices() to authenticated;
grant execute on function public.platform_update_invoice(uuid, jsonb) to authenticated;
grant execute on function public.platform_get_invoice_settings() to authenticated;
grant execute on function public.platform_save_invoice_settings(jsonb) to authenticated;

-- ---- wording: the extra-branch fee is MONTHLY, and the owner is told where the invoice is
update public.message_rules set body = replace(body, 'Extra branch fee: ₹{branch_price}.', 'Extra branch fee: ₹{branch_price} per month for each branch.') where key = 'branch_received';
update public.message_rules set body = body || ' Your invoice is ready in Billing → Invoices.' where key = 'renewal_approved' and body not like '%Invoices%';
update public.message_rules set body = body || ' Your invoice is ready in Billing → Invoices.' where key = 'branch_approved' and body not like '%Invoices%';

notify pgrst, 'reload schema';

-- ============================== CHECK (every line must say OK) ==============================
select 'invoice table exists' as check, case when to_regclass('public.subscription_invoices') is not null then 'OK' else 'MISSING' end
union all select 'billing quote function exists', case when to_regprocedure('public.billing_quote(boolean,text,integer,integer)') is not null then 'OK' else 'MISSING' end
union all select 'invoice settings exist', case when exists (select 1 from public.platform_settings where key = 'invoice') then 'OK' else 'MISSING' end
union all select 'mobile required (requests)', case when pg_get_functiondef('public.create_request(text,text,text,jsonb)'::regprocedure) like '%mobile number%' then 'OK' else 'OLD VERSION' end
union all select 'keeps auto-delete after answering', case when pg_get_functiondef('public.platform_decide_request(uuid,text,text,integer,timestamptz,text)'::regprocedure) like '%_purge_requests%' then 'OK' else 'OLD VERSION' end
union all select 'update invoice function exists', case when to_regprocedure('public.platform_update_invoice(uuid,jsonb)') is not null then 'OK' else 'MISSING' end;
