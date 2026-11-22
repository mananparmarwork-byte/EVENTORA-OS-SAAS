-- Eventora OS — SQL file 10: check billing setup. Every row should say OK.
select 'table ' || t as item, case when to_regclass('public.' || t) is not null then 'OK' else 'MISSING - run 08' end as status
from unnest(array['plans','coupons','coupon_redemptions','subscription_payments','reminder_log','razorpay_plan_variants','platform_settings']) t
union all
select 'function ' || f, case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = f) then 'OK' else 'MISSING - run 08' end
from unnest(array['get_plans','check_coupon','checkout_price','redeem_free_days','apply_coupon_usage','due_reminders','mark_reminder_sent','platform_save_plan','platform_save_coupon','platform_save_settings','platform_get_settings']) f
union all
select 'plan ' || period || ' = Rs ' || (price_paise / 100), 'OK' from public.plans
union all
select 'free trial length (days)', coalesce((select data ->> 'trial_days' from public.platform_settings where key = 'general'), 'NOT SET');
