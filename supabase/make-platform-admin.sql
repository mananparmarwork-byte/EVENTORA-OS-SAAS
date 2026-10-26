-- Makes ONE login the software owner (the super admin who sees "Super admin" in the sidebar).
-- 1) Change the email below to the login you use. 2) Run in Supabase -> SQL Editor. 3) Sign out of the app and sign in again.
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = lower('PUT-YOUR-LOGIN-EMAIL-HERE')
on conflict do nothing;

-- should show 1 row = it worked. 0 rows = that email is not a registered login (check Authentication -> Users).
select u.email, 'software owner' as role from public.platform_admins p join auth.users u on u.id = p.user_id;
