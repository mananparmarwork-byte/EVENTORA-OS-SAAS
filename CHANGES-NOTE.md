# Eventora OS: handoff note (read this first)

Use this note to understand the final state of the project in `Eventora_Os_FINAL.zip`. Written 23 Nov 2026.

## 1. What the project is
Eventora OS is a multi-tenant SaaS for banquet halls, party plots, restaurants and event companies: quotation/bill builder with PDF, calendar and clash checking, reports, staff accounts.
Stack: Vite + React + TypeScript + Tailwind, TanStack Query, wouter, @react-pdf/renderer; backend is Supabase (Postgres with row-level security, RPC functions, Edge Functions); hosted on GitHub Pages through GitHub Actions.
Two roles of people: the **software owner** (the user, "Super admin", sells access) and **business owners** (their customers, with employees under them).
Payments are **manual now**: owners pay the software owner by UPI/bank and request renewal; Razorpay is no longer used (its old SQL, functions and pages are kept but unused, see `_unused_earlier_files/`).

## 2. History of this work, in order
1. **File 16** (manual access, messages, multi-branch, custom quotation items) was written in an earlier session; see `NEW-FEATURES.md`. It had never been executed.
2. When run on the live Supabase it failed: `P0001 You do not have access ... enforce_staff_rules()`. Cause: the one-time backfill `update public.quotes set branch_id ...` fires the employee-rules trigger, and the SQL Editor has no signed-in user. **Fix:** the backfill is now wrapped in `alter table public.quotes disable trigger enforce_staff_rules_trg; ... enable trigger ...`. After the fix, file 16 ran successfully (all lines OK).
3. **File 17** (optional daily auto-reminders via pg_cron) needed no change. It calls `public._run_auto_messages()` daily at 03:30 UTC (9:00 IST).
4. Edge Functions deployed through the Supabase dashboard editor (not the CLI): `platform-owners` (new), `manage-staff` (updated), `send-message-emails` (optional).
5. The user found the Super admin dashboard confusing (8 tabs, leftover autopay wording, no payment record). **Update 18** (this release) redesigns it and adds the items below.

## 3. What update 18 added
* **Mobile number mandatory** (>= 10 digits) in: public Request access form, Add owner, editing a business, and all owner requests (renewal, extra branch, message). Enforced in the UI and in SQL (`submit_access_lead`, `create_request`, `platform_create_owner`, `platform_update_tenant`) and in the `platform-owners` Edge Function. The owner's number is saved on `tenants.phone` and shown pre-filled next time. Everywhere a client appears there are **Call** (`tel:`) and **WhatsApp** buttons (`src/components/Contact.tsx`).
* **Super admin = 6 tabs:** Home, Requests, Clients, Payments, Messages (Send + Automatic reminders inside), Settings (Plans and Coupons inside collapsible sections).
* **Home** (`PlatformHome.tsx`): KPIs (received this month, still to collect, overdue, waiting for reply), requests/leads waiting, "Money to collect" list with Remind-on-WhatsApp and Mark as paid, trials to follow up, latest payments.
* **Clients** (`PlatformClients.tsx`): one directory of every business: mobile, type, branches, plan, status, paid so far, joined; filters including "No mobile"; CSV export; opens the existing Manage modal.
* **Payments** (`PlatformPayments.tsx`): full ledger (date, client + mobile, plan, method, reference, amount), month/method filters, search, CSV export, receipt per payment (WhatsApp/copy). **Mark as paid** modal records amount, date, method (UPI/Cash/Bank transfer/Cheque/Other), reference and optionally extends the plan, then offers a receipt.
* **Requests**: mobile number on every row, Delete button, "Clear answered" button, and **auto-delete** of answered requests and finished access leads (Settings -> "Auto-delete answered requests": never / right after / 7 / 30 / 90 days; default 7). Payments are never deleted with a request. Purge runs when Home/Requests open, when a request is answered, and daily if pg_cron is on.
* New client statuses (replace the autopay-era ones in the new screens): Overdue, Due soon (<= 7 days), Active, On trial, Trial ended, Free access (`platformShared.ts`).

## 4. Files added / changed in update 18
SQL: `supabase/18-clients-payments-cleanup.sql` (new; run after 16). It adds columns `method`, `reference`, `note` to `subscription_payments`; setting `requestKeepDays` in `platform_settings.config`; functions `_purge_requests`, `platform_purge_requests`, `platform_delete_request`, `platform_clear_answered`, `platform_list_payments`, `platform_record_payment`, `my_contact_phone`; re-creates `platform_save_config`, `platform_set_lead`, `platform_update_tenant`, and the patched `submit_access_lead`, `create_request`, `platform_create_owner`, `platform_decide_request` (the last also copies the renewal reference onto the payment). Ends with an OK/MISSING check list.
Edge Function: `supabase/functions/platform-owners/index.ts` (phone check added before the login is created).
New React files: `src/components/Contact.tsx`, `src/components/MobileField.tsx`, `src/lib/phone.ts`, `src/pages/admin/PlatformHome.tsx`, `PlatformClients.tsx`, `PlatformPayments.tsx`, `platformShared.ts`.
Changed: `PlatformPage.tsx` (6 tabs), `PlatformOwners.tsx` (requests, leads, add owner, settings), `PlatformDashboard.tsx` (ManageModal exported, contact row + Mark as paid), `PlatformOwnerTools.tsx`, `BillingPage.tsx`, `BranchesPage.tsx`, `MessagesPage.tsx`, `RequestAccess.tsx`, `lib/types.ts`, `lib/backendExt.ts`, `lib/apiExt.ts`.
The old `PlatformDashboard` analytics/Subscriptions components still exist in the code but are no longer reachable from the UI.

## 5. How to deploy (state at the time of writing)
1. SQL Editor: file 16 (done, patched version), then **18** (pending), optional 17. Do not run `RUN-THIS-ALL-IN-ONE.sql` on the live project (fresh projects only, and it lacks the trigger fix).
2. Edge Functions (dashboard): paste `platform-owners.ts` (update/create), `manage-staff.ts`, optional `send-message-emails.ts` (Verify JWT off; secrets RESEND_API_KEY, REMINDER_FROM, APP_URL, CRON_SECRET).
3. Push the website code to GitHub; Actions rebuilds the site.
4. Super admin -> Settings: fill WhatsApp, UPI, payee, bank, branch fee, auto-delete choice.
5. Test once: Add owner, owner sign-in, Request renewal -> Mark as paid / approve, Branch request, Payments list.
Secrets (Supabase URL/keys) are not in the zip; they live in GitHub secrets and the Supabase dashboard.

## 6. Verification status (be honest about this)
* `tsc --noEmit` and `vite build` both pass on the final code (dependencies installed with npm).
* SQL 18 was syntax-checked with the real PostgreSQL parser (including every PL/pgSQL body) but **not executed**. File 16 (with the fix) was executed by the user successfully.
* The screens have **not** been click-tested against a live Supabase. Test on a test project first.

## 7. Known limits / ideas not built
Moving an existing bill to another branch; per-branch GST/address on the PDF; per-branch prices; fully automatic WhatsApp (needs the paid WhatsApp Business API; today it opens WhatsApp with the text ready); deleting a wrongly entered payment; PDF receipts (text receipts only).

---
## 8. Update 19 (added after this note was written)
Merged into this project: UPI-QR billing, monthly extra-branch fee, automatic invoices. See `UPDATE-19-README.md`.
* New SQL: `supabase/19-billing-qr-invoices.sql` (run after 18). It re-creates `create_request`, `platform_list_requests` and `platform_decide_request` on top of file 18's versions (mobile number check, payment method/reference, auto-purge are kept) and adds `subscription_invoices`, `billing_quote`, `my_invoices`, `platform_list_invoices`, `platform_update_invoice`, `platform_get/save_invoice_settings`, and the `invoice` row in `platform_settings`.
* New React files: `src/components/UpiQr.tsx`, `src/pdf/InvoiceDocument.tsx`, `src/pages/admin/PlatformInvoices.tsx` (Invoices list/edit + invoice settings card).
* Changed: `BillingPage.tsx` (rewritten: plan/branch builder, QR, invoices, still asks for mobile), `BranchesPage.tsx` (the request form is gone; "Add a paid branch" opens Billing), `PlatformOwners.tsx` (approval window shows the breakdown; invoice settings in Settings; fee label "per MONTH"), `PlatformPage.tsx` (Payments tab has a Payments / Invoices switch), `lib/{types,backendExt,apiExt}.ts`, `pdf/generate.tsx`.
* Request payload shape for `renewal`: `{ contact, renew, period, keep, newBranches:[{name}], reference, amount, paidOn, quote:{lines,total,...} }` (older requests without `quote` still work).
