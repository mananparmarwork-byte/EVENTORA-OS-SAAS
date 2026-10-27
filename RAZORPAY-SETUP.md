# Razorpay setup for Eventora (step by step)

The Razorpay code is already in the project (buy page, autopay, renewals, webhook). You only have to
connect YOUR Razorpay account to it. Do everything in **Test mode first**. No real money moves in Test mode.

You need: a Razorpay account, a Supabase project (yours is `sncogkdvguzvxeatvenc`), and Node.js on your computer.

## Step 1. Razorpay account
1. Sign up at razorpay.com and finish the account details (KYC is needed before Live mode, not for Test mode).
2. In the Razorpay dashboard, switch the toggle at the top to **Test Mode**.
3. Open the **Subscriptions** section and activate it. If it asks for approval, request it now: for Live mode,
   Razorpay must enable Subscriptions for your account (this can take a few days). Test mode works straight away.

## Step 2. Get the keys
1. Dashboard -> **Account & Settings -> API Keys -> Generate Key** (in Test mode).
2. Copy the **Key Id** (starts with `rzp_test_`) and the **Key Secret** (shown once, save it).
3. Never put these in the website code, GitHub or a message. They go only into Supabase secrets (Step 4).

## Step 3. Make a webhook secret
1. Think of a long random password (30+ letters and numbers). This is your **webhook secret**. Write it down.
2. Dashboard -> **Account & Settings -> Webhooks -> Add New Webhook**.
3. Webhook URL: `https://sncogkdvguzvxeatvenc.supabase.co/functions/v1/razorpay-webhook`
4. Secret: the password from step 1.
5. Tick these events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`,
   `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`.
6. Save.

## Step 4. Put the three secrets in Supabase
Supabase -> your project -> **Edge Functions -> Secrets** (or run the commands below on your computer):
```
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
supabase secrets set RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
supabase secrets set RAZORPAY_WEBHOOK_SECRET=your-long-webhook-password
```
Optional, for reminder emails later: `RESEND_API_KEY`, `REMINDER_FROM`, `APP_URL`, `CRON_SECRET` (see SAAS-SETUP.md).

## Step 5. Deploy the functions
On your computer, in the project folder:
```
npm install -g supabase
supabase login
supabase link --project-ref sncogkdvguzvxeatvenc
supabase functions deploy create-checkout
supabase functions deploy manage-subscription
supabase functions deploy create-purchase --no-verify-jwt
supabase functions deploy razorpay-webhook --no-verify-jwt
```
Run the database file first if you have not: `supabase/RUN-THIS-ALL-IN-ONE.sql` (see SAAS-SETUP.md).

## Step 6. Test it (Test mode, no real money)
1. Open your website `/#/buy`, choose a plan, enter a throw-away email, pay.
   Test UPI: `success@razorpay`. Test card: `4111 1111 1111 1111`, any future date, any CVV (OTP `1234` if asked).
   Razorpay's own test-details page lists the current ones.
2. After paying, the thank-you page lets you set a password and opens the new business.
3. Sign in as super admin -> **Super admin -> Dashboard**: the payment appears under "Latest payments" and the
   customer shows as **Renewing (autopay on)** in **Subscriptions & access**.
4. In Razorpay -> Webhooks, open your webhook -> its log should show events with a green 200 reply.
   Red or 4xx: the webhook secret in Supabase does not match the one in Razorpay.

## Step 7. Go live (only after the test works)
1. Razorpay: switch to **Live Mode**, complete KYC, generate **Live** keys (`rzp_live_...`).
2. Create the same webhook again in Live mode (new secret if you like).
3. Replace the three Supabase secrets with the Live values, then deploy the functions again (Step 5).
4. Make one real purchase with a small-price plan to confirm, then refund it from Razorpay if you wish.

## If something does not work
| Problem | What it usually means |
|---|---|
| Buy page says it could not start payment | Secrets missing or wrong in Supabase, or functions not deployed. |
| Payment succeeds but the customer is not activated | Webhook not added, wrong secret, or events not ticked. Check the webhook log in Razorpay. |
| "Subscriptions not enabled" style error from Razorpay | Razorpay has not activated Subscriptions on your account yet. |
| A plan you created cannot be bought | Plan is switched off, or the price is under Rs 1. |
