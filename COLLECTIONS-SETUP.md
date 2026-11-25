# Super admin → Collections (setup)

New tab **Collections** in the Super admin panel (next to Dashboard).

## What it does
- **Pending** – ended / payment failed / trial over and never paid, with the amount due.
- **Due in 7 days** and **Upcoming (8–30 days)** – manual-pay customers about to expire. **Autopay due** is shown separately (Razorpay charges these itself).
- **Collected** – every payment received (Razorpay + ones you record), filter by this month / last month / last 30 days / all time / custom dates.
- **Days left**, last payment, number of reminders sent, and "promised to pay on" date for every customer.
- **Reminders** – Email (one click, or many at once), WhatsApp (opens a ready message), Copy text. Each one is logged.
- **Collect** – you received cash/UPI/bank money: records it in your revenue AND extends the plan by the plan length.
- **History** – log calls/notes, save the customer's WhatsApp number, set a promised date.
- **Sequence** – order by days left, amount, plan, name, last payment, reminders sent, promised date; flip high/low; group by plan, status or due period; filter by plan.
- **Export for Excel** – CSV of the current view (or only the ticked rows).

## Setup (3 steps, once)
1. Supabase → SQL Editor → run `supabase/16-collections.sql` (after 15). Every line of the check must say OK.
2. Deploy the email function (only needed for the Email buttons):
   `supabase functions deploy send-payment-reminder`
   It uses the same secrets as `send-reminders`: `RESEND_API_KEY`, `REMINDER_FROM`, `APP_URL`. Keep JWT verification ON.
3. Rebuild / redeploy the website.

WhatsApp and Copy work without step 2.

## Notes
- Amount due = the customer's current plan price (falls back to their last payment).
- "Collect" starts the new period from today, or from the current end date if the plan is still running.
- Not available on the Hostinger backend (same as the rest of Super admin).
