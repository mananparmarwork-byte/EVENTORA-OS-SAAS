-- 20 - NEW PLAN PRICES (main branch). Run once in Supabase -> SQL Editor. Safe to run again.
-- Monthly 1,799 | 6 months 10,194 (1,699 a month) | 12 months 17,999 (about 1,500 a month).
-- The per-branch rates (1,349 / 1,249 / 1,149 a month) are shown on the website; see the note in the chat about the Billing page.
update public.plans set price_paise = 179900 where months = 1;
update public.plans set price_paise = 1019400 where months = 6;
update public.plans set price_paise = 1799900 where months = 12;
select period, name, months, price_paise / 100.0 as price_rupees from public.plans order by months;
