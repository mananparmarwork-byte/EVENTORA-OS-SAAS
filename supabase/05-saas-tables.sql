-- ============================================================================
-- Eventora OS — SQL file 5: multi-tenant (SaaS) tables.
-- Run AFTER 01-04. Safe to run again. Your existing bills/settings become the FIRST business ("eventora").
-- ============================================================================

-- A business that uses the software (a venue / banquet).
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  created_at timestamptz not null default now()
);

-- Who belongs to which business (owner or employee). One login = one business.
create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists members_tenant_idx on public.members (tenant_id);

-- The plan each business pays for.
create table if not exists public.subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan text not null default 'pro',
  period text not null default 'monthly' check (period in ('monthly', 'quarterly', 'yearly')),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  provider text,
  provider_subscription_id text,
  updated_at timestamptz not null default now()
);

-- You (the software owner): can see and manage every business.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ---- move the existing single-business data into the first business ---------
do $$
declare tid uuid;
begin
  if not exists (select 1 from public.tenants) and exists (select 1 from public.admin_users) then
    insert into public.tenants (name, slug)
    values (coalesce((select data ->> 'name' from public.app_settings where id = 'business'), 'Eventora'), 'eventora')
    returning id into tid;
    insert into public.members (user_id, tenant_id, role, email)
      select a.user_id, tid, 'owner', u.email from public.admin_users a join auth.users u on u.id = a.user_id on conflict do nothing;
    insert into public.members (user_id, tenant_id, role, email, active)
      select s.user_id, tid, 'staff', s.email, s.active from public.staff_users s on conflict do nothing;
    insert into public.subscriptions (tenant_id, status, period, current_period_end)
      values (tid, 'active', 'yearly', now() + interval '100 years');
    insert into public.platform_admins (user_id) select user_id from public.admin_users on conflict do nothing;
  end if;
end $$;

-- ---- every business table now carries its business id -----------------------
alter table public.quotes        add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.catalog       add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.app_settings  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.activity_log  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;
alter table public.bill_counters add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

update public.quotes        set tenant_id = (select id from public.tenants order by created_at limit 1) where tenant_id is null;
update public.catalog       set tenant_id = (select id from public.tenants order by created_at limit 1) where tenant_id is null;
update public.app_settings  set tenant_id = (select id from public.tenants order by created_at limit 1) where tenant_id is null;
update public.activity_log  set tenant_id = (select id from public.tenants order by created_at limit 1) where tenant_id is null;
update public.bill_counters set tenant_id = (select id from public.tenants order by created_at limit 1) where tenant_id is null;

alter table public.quotes        alter column tenant_id set not null;
alter table public.catalog       alter column tenant_id set not null;
alter table public.app_settings  alter column tenant_id set not null;
alter table public.bill_counters alter column tenant_id set not null;

-- bill numbers only have to be unique inside one business
alter table public.quotes drop constraint if exists quotes_reference_key;
create unique index if not exists quotes_tenant_reference_uq on public.quotes (tenant_id, reference);
create index if not exists quotes_tenant_idx on public.quotes (tenant_id, created_at desc);
create index if not exists activity_tenant_idx on public.activity_log (tenant_id, at desc);

-- primary keys that include the business
do $$ begin
  if not exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
                 where i.indrelid = 'public.catalog'::regclass and i.indisprimary and a.attname = 'tenant_id') then
    alter table public.catalog drop constraint catalog_pkey;
    alter table public.catalog add primary key (tenant_id, id);
  end if;
  if not exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
                 where i.indrelid = 'public.app_settings'::regclass and i.indisprimary and a.attname = 'tenant_id') then
    alter table public.app_settings drop constraint app_settings_pkey;
    alter table public.app_settings add primary key (tenant_id, id);
  end if;
  if not exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
                 where i.indrelid = 'public.bill_counters'::regclass and i.indisprimary and a.attname = 'tenant_id') then
    alter table public.bill_counters drop constraint bill_counters_pkey;
    alter table public.bill_counters add primary key (tenant_id, day);
  end if;
end $$;

alter table public.tenants enable row level security;
alter table public.members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.platform_admins enable row level security;
