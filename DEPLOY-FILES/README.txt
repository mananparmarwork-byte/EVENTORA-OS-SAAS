Ready-to-use copies of what you deploy in Supabase (the same files also exist inside supabase/).

sql/                      run in Supabase -> SQL Editor, in this order:
   16-manual-access-messages-branches.sql   (already run on the live project, includes the trigger fix)
   18-clients-payments-cleanup.sql           (new: mobile numbers, payments list, mark as paid, auto-delete)
   17-auto-messages-cron.sql                 (optional: daily automatic reminders, needs pg_cron)
edge-functions/           paste into Supabase -> Edge Functions (name = file name without .ts)
   platform-owners.ts  (updated: mobile number required)   manage-staff.ts   send-message-emails.ts (optional)
Website code: everything else in this zip. Copy src/, supabase/ etc. into your GitHub repo and push.
