-- Eventora OS — SQL file 12: check security & team rules. Every row should say OK.
select 'visitors cannot read bills' as item, case when has_table_privilege('anon','public.quotes','SELECT') then 'PROBLEM' else 'OK' end as status
union all select 'visitors cannot read settings', case when has_table_privilege('anon','public.app_settings','SELECT') then 'PROBLEM' else 'OK' end
union all select 'visitors cannot read catalog', case when has_table_privilege('anon','public.catalog','SELECT') then 'PROBLEM' else 'OK' end
union all select 'visitors cannot save bills', case when has_function_privilege('anon','public.create_quote(jsonb,text)','EXECUTE') then 'PROBLEM' else 'OK' end
union all select 'visitors cannot see booked times', case when has_function_privilege('anon','public.booked_times()','EXECUTE') then 'PROBLEM' else 'OK' end
union all select 'visitors cannot read the catalog function', case when has_function_privilege('anon','public.get_catalog()','EXECUTE') then 'PROBLEM' else 'OK' end
union all select 'only the owner can delete bills', case when (select count(*) from pg_policies where tablename = 'quotes' and cmd = 'DELETE' and qual like '%is_admin()%' and qual not like '%is_staff%') = 1 then 'OK' else 'PROBLEM - run file 11' end
union all select 'column quotes.created_by', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quotes' and column_name = 'created_by') then 'OK' else 'MISSING' end
union all select 'column quotes.customer_gst_number', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quotes' and column_name = 'customer_gst_number') then 'OK' else 'MISSING' end
union all select 'two-step gate (_aal_ok) exists', case when to_regprocedure('public._aal_ok()') is not null then 'OK' else 'MISSING - run file 11' end
union all select 'RLS enabled on quotes', case when (select relrowsecurity from pg_class where oid = 'public.quotes'::regclass) then 'OK' else 'PROBLEM' end
union all select 'each business sees only its own data (policy uses my_tenant)', case when exists (select 1 from pg_policies where tablename = 'quotes' and cmd = 'SELECT' and qual like '%my_tenant()%') then 'OK' else 'PROBLEM' end;
