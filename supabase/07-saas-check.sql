-- Eventora OS — SQL file 7: check the SaaS setup. Every row should say OK.
select 'table ' || t as item, case when to_regclass('public.' || t) is not null then 'OK' else 'MISSING - run 05' end as status
from unnest(array['tenants','members','subscriptions','platform_admins']) t
union all
select 'function ' || f, case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'OK' else 'MISSING - run 06' end
from unnest(array['my_tenant','my_context','tenant_writable','create_tenant','create_quote','get_catalog','get_setting','save_setting','booked_times','get_subscription','platform_list_tenants','platform_set_subscription','public_tenant']) f
union all
select 'first business: ' || t.slug || ' (' || coalesce(s.status, 'no subscription') || ')', 'OK' from public.tenants t left join public.subscriptions s on s.tenant_id = t.id
union all
select 'owner mp1072005@gmail.com is software owner (platform admin)', case when exists (select 1 from public.platform_admins p join auth.users u on u.id = p.user_id where u.email = 'mp1072005@gmail.com') then 'OK' else 'NO - run: insert into public.platform_admins select id from auth.users where email = ''mp1072005@gmail.com'';' end;
