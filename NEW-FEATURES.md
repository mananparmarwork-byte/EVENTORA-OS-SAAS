# Eventora OS — manual access, messages, multi-branch, custom items

Everything below was added on top of your last version. **Nothing was deleted from your database**; the old Razorpay pages
were moved to `_unused_earlier_files/razorpay-flow/` (the Razorpay SQL and Edge Functions are still in the project, just not used by any screen).

## 1. One-time set-up (in this order)

1. **SQL** — Supabase → SQL Editor → run `supabase/16-manual-access-messages-branches.sql` (or, on a fresh project, the updated `RUN-THIS-ALL-IN-ONE.sql`).
   The last result must say **OK** on every line. Existing bills/employees are moved into each business's "Main branch" automatically.
2. **Edge Functions** (needs the Supabase CLI, same as `manage-staff`):
   ```
   supabase functions deploy platform-owners        # Super admin → Add owner / reset owner password
   supabase functions deploy manage-staff           # re-deploy: employees can now be given a branch
   supabase functions deploy send-message-emails --no-verify-jwt     # OPTIONAL: e-mail copies of messages
   ```
   For e-mail: set secrets `RESEND_API_KEY`, `REMINDER_FROM`, `APP_URL`, `CRON_SECRET` (same ones `send-reminders` uses).
3. **Supabase → Authentication → Providers → Email**: turn **off "Allow new users to sign up"** (owners are now created only by you; the function still works).
4. Sign in as Super admin → **Settings** → fill in your WhatsApp, UPI ID, payee name, bank details and the extra-branch fee. These appear on every owner's Billing page and in reminders.
5. Optional: `supabase/17-auto-messages-cron.sql` (needs the `pg_cron` extension) creates the automatic reminders every morning even if nobody opens the app.

## 2. What changed

### Manual access (replaces payments)
* **Super admin → Add owner** (top right): business name + type, owner email, password (Generate button), mobile, and access (free trial, or until a date; free or "they paid me ₹X").
  It creates the login, the business, its Main branch, the access, and sends the welcome message. You get a ready-to-send login text (Copy / WhatsApp / Email).
  Choose "Another owner for a business" to add one more owner login to an existing business.
* **Manage customer** now also has: edit business name/type/mobile, **branch slots**, **reset owner password**, and **send a message**.
* Owners no longer pay in the app. **Billing** shows their plan status, *how to pay you* (UPI/bank/WhatsApp from your Settings), and a **Request renewal** form (plan + payment reference).
  The request appears in **Super admin → Requests**; you press **Approve**, choose the end date, and access starts. The owner gets a notification.
* Landing/Sign-up/Buy pages now say **Request access**. The visitor's details land in **Requests → Access leads**, with a **Create owner** button that pre-fills Add owner.
* Self sign-up is blocked in the database (switch in Settings, default off).

### Messages and automation (Super admin → Messages / Automation / Requests)
* **Messages → Compose**: send to *everyone*, a *group* (money to collect, ending in 7/30 days, locked, on trial, active, multi-branch) or *chosen businesses*.
  Templates, `{business} {plan} {end_date} {days_left} {amount} {upi} …` placeholders, live preview, optional e-mail, and **WhatsApp buttons** (one tap per business, message pre-filled) after sending.
  **Sent** shows history and how many have read it. **Templates** are editable (7 built in: payment reminder, plan ending, expired, thanks, new feature, maintenance, festival).
* **Automation**: switch on/off and rewrite: trial ending, trial ended, plan ending in 7 / 3 days, plan ends today, plan ended, still not renewed after 7 days, welcome, access given,
  **auto-replies** when an owner sends a renewal / branch / support request, and approval/decline notices. Each is sent once per plan end date.
* Owners get a **bell** in the header and a **Messages** page (inbox + "Contact Eventora" with your replies).

### Multi-branch
* Every business has a **Main branch**. Owner → **Branches** page: bills, booked and collected per branch, edit, switch off.
* **Request another branch** → goes to *Super admin → Requests*. **Approve** (optionally record the fee you received) → the slot is added and the branch is created.
  You can also set the number of branch slots directly in Manage customer. Without a free slot the owner cannot create a branch (enforced by the database).
* Employees belong to **one branch** (chosen when you add them, changeable in Settings → Team). The database only shows them that branch's bills and booked times, and only lets them create bills there.
* The owner sees a **branch switcher** in the header (only when there is more than one branch): one branch, or **All branches (combined)**. Overview, Bills, Calendar, Reports and Activity follow it.
  In combined mode Overview shows a **Branch comparison** table. Calendar clash-checking is per branch.
* A single-branch business sees no branch controls at all.

### Quotation: custom items
* In **Other Services** there is now **Add your own item**: name + cost + how it is charged (fixed / per unit / per guest). Tick **Save for next time** and it appears under
  **Your saved items**; tap one to add it, then change the cost for that quotation. Works for owners and employees. Custom items are included in totals, GST, the PDF and the saved bill.

## 3. Things to know
* If you re-run an old SQL file (06, 08, 11, 13, 15), run `16-…` again afterwards.
* The WhatsApp channel opens WhatsApp with the text ready (you press Send). Fully automatic WhatsApp needs the paid WhatsApp Business API, which is not included.
* Not built (tell me if you want them): moving an existing bill to another branch, per-branch GST/address on the PDF, per-branch catalog prices.
* I could not run the app here (no internet for `npm install`, no Postgres). The TypeScript was checked against stubbed library types and the SQL was reviewed line by line against your existing tables and functions (it has not been executed),
  but please run the SQL on a **test Supabase project first** and click through each flow once.
