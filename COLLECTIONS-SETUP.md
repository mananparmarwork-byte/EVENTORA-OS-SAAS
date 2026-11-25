# Collections (Super admin) — set-up

Super admin → **Collections** shows who has to pay you, when, and what you have collected. Payments you record with **Collect** appear here.

1. **SQL** — Supabase → SQL Editor → run `supabase/19-collections.sql` (after 18). Every line of the final result must say **OK**.
   (Numbered 19 because files 16, 17 and 18 already exist in this project.)
2. **E-mail reminders (optional)** — `supabase functions deploy send-payment-reminder` (keep JWT verification ON).
   Secrets, same as `send-reminders`: `RESEND_API_KEY`, `REMINDER_FROM`, `APP_URL`.
   Without it, WhatsApp and Copy reminders still work.
3. **Rebuild and publish** the website (`npm run build`, or push to GitHub).

How to use: pick a tab (Pending, Due in 7 days, Upcoming, Autopay due, Collected, All customers), order/group the list, send reminders (single or ticked rows),
and press **Collect** when a customer pays you by UPI, cash or bank transfer. The plan end date moves forward automatically. **Export for Excel** downloads the current view.
