# Eventora OS as a subscription SaaS (one database, many businesses, login-only and secured)

## What you have
- **Sales page** (`/`) with pricing and "Start free trial"; **signup** creates a business + owner login + free trial (length set by you).
- **Separate data per business** enforced by the database: each business sees only its own bills, catalog, settings, employees and activity.
- **Login-only:** visitors can read and save nothing of any business (no public estimator page). Only the sales page, pricing and signup are public.
- **Subscriptions with autopay** through Razorpay (monthly / quarterly / yearly), **plans, prices, coupons and free-trial length controlled by you** in "All businesses", software **locks** when a plan ends, **reminders** (in-app + email).
- **Team security (owner controls):**
  - Employees can **never delete bills** (owner only, enforced by the database; there is no switch).
  - Every bill records **who created it**; owner switch "See bills made by others" (off = an employee sees only their own bills).
  - Owner **adds, deletes and resets passwords of employees inside the app** (Settings -> Team). Passwords: 10+ characters with a letter and a number.
  - **Two-step verification** (authenticator app) for owners and employees: My account -> Two-step verification. Once on, the **database itself** refuses access until the code is entered.
  - **My account** page: change password, sign out on all devices.
  - Auto sign-out after 30 minutes idle; 5 wrong passwords -> 30-second pause.
  - Everything employees do is written to **Activity** (owner only).
- Your existing data became the first business (web name `eventora`); you are its owner and the software owner.

## 1. Database (Supabase -> SQL Editor, each file as a new query, in this order)
`01` -> `02` -> `03` (already done) -> `05-saas-tables` -> `06-saas-functions-security` -> `07-saas-check` -> `08-saas-billing` -> `10-billing-check` -> **`11-saas-security-team`** -> **`12-security-check`**.
- Every check file must show only OK.
- **Always run `11` last.** If you ever re-run `06` or `08`, run `11` again afterwards.
- Take a backup first (Database -> Backups): files 05 and 11 change keys and rules.
- Optional, for reminder emails: `09-reminder-cron.sql`.

## 2. Supabase dashboard settings (Authentication)
- **Keep "Allow new users to sign up" ON.** (Unlike a single-business install, a SaaS needs signups. A new signup can only create its own empty business; it can never see anyone else's data.)
- **Email -> Confirm email: ON** (recommended). Signup still works: the business is created at the person's first sign-in after confirming. Accounts the owner creates for employees are pre-verified.
- **Password strength:** minimum length 10, require letters and digits; leaked-password protection if your plan has it.
- **Multi-factor -> TOTP** enabled (default).
- **Attack protection -> CAPTCHA** on sign-up (strongly recommended on a public signup form). Shorter JWT expiry is optional.
- URL Configuration: Site URL = your website address.

## 3. Edge functions (Supabase CLI on your computer, or Dashboard -> Edge Functions)
```
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy manage-staff
supabase functions deploy create-checkout
supabase functions deploy manage-subscription
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy send-reminders --no-verify-jwt
```
`manage-staff` holds the secret key on the server so the key is never in the website. Nothing to configure for it.

## 4. Razorpay: autopay for subscriptions
1. Create a Razorpay account, finish KYC, ask Razorpay to enable **Subscriptions**. Work in **Test mode** first.
2. You do NOT create plans by hand: a Razorpay plan is created automatically the first time each price is used. Prices are set in the app.
3. Secrets (`supabase secrets set NAME=value`): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
4. Razorpay -> Settings -> Webhooks -> add `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook` with the same secret and events: subscription.authenticated, activated, charged, pending, halted, cancelled, completed.
5. Customer flow: Billing -> choose plan -> "Set up autopay" -> approves UPI AutoPay / card / e-mandate once -> Razorpay debits every period by itself. If they subscribe during a free trial, the first payment waits until the trial ends. A failed debit marks them overdue; unpaid for 3 days -> locked.

## 5. Your control panel ("All businesses" in the sidebar, only you see it)
- **Businesses:** status, autopay, amount paid, coupon used. Buttons: +7 d, +30 d (extra free time), Activate (free access), Suspend.
- **Plans & prices:** monthly / quarterly / yearly price, or switch a plan off. Existing autopay customers keep their old price until they re-subscribe.
- **Coupons:** percent off, rupees off or free days; limit to one plan, total uses, last day; one use per business.
- **Free trial:** days given to new businesses (0 = none). Ends by itself.

## 6. When a plan ends
- **Locked:** the owner can only open Billing and My account; employees see "Subscription ended". Data stays safe; the database also refuses all writes.
- **Reminders:** in-app banner from 7 days before; emails 7, 3, 1 day before and on the day (not for autopay customers; Razorpay notifies them). Email needs a Resend account + verified domain, secrets `RESEND_API_KEY`, `REMINDER_FROM`, `APP_URL`, `CRON_SECRET`, and file 09.

## 7. What is enforced where
| Rule | Enforced by |
|---|---|
| Nothing visible or savable without signing in | database (visitors have no rights) + login gate |
| Each business sees only its own data | database (row-level security by business) |
| Employees can never delete bills | database policy (owner only) |
| Employee sees only own bills (switch) | database policy |
| Who created each bill is recorded and locked | database function + trigger |
| Add / delete / reset employees | Edge Function, owner + 2-step checked server-side, same business only |
| Two-step verification | database (`aal2` required once a factor is verified) |
| Locked after plan ends | database (writes refused) + app (screens) |
| Auto sign-out, sign out everywhere, wrong-password pause | app |

## 8. Test checklist
1. Sign up a new business in a private window -> trial banner; make a bill.
2. Settings -> Team: add an employee (10+ char password); sign in as them in another browser; check they cannot delete a bill and see only their own bills when "See bills made by others" is off.
3. My account -> turn on two-step verification; sign out and in again; confirm the code is asked.
4. In another private window sign up a second business: it must not see the first one's bills.
5. All businesses -> Free trial: set 1 day, sign up another, confirm it locks after expiry (or Suspend).
6. Coupons: make a 20% and a 30-free-days coupon; use them from a test business's Billing page.
7. Razorpay TEST mode: subscribe; confirm status Active + autopay ON; press "Turn off autopay".

## Honest notes
- Not built or run here (no npm / network). SQL and functions were written carefully but **not executed**. Run the check files and test with throwaway businesses (and Razorpay Test mode) before real customers.
- Razorpay rules (UPI AutoPay limits, e-mandate availability, minimum amounts, `start_at` behaviour) change: confirm in their current docs.
- A discount coupon applies to every autopay payment of that subscription, not only the first.
- Lost phone with two-step on: for an employee, the owner can delete and re-create the login; for an owner, remove the factor in Supabase -> Authentication -> Users.
- The public customer estimator was removed (login-only, as in your uploaded version). It can be re-added as an opt-in per business if you want it.
- Hostinger/PHP stays single-business; SaaS needs Supabase.
- Legal and tax (terms, privacy, GST on your invoices, refund policy) are not included: get them reviewed.
- Not yet built: per-plan feature limits (only an employee cap of 20), custom domains, invoices for your own subscription sales, data-export button.
