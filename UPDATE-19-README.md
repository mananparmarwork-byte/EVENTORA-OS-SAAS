# Update 19: billing with UPI QR, monthly branch fee, automatic invoices

This was added on top of `Eventora_Os_FINAL` (your other account's version). Nothing from update 18 was removed:
mobile number is still required, Home / Clients / Payments tabs, Mark as paid, auto-delete of answered requests all stay.

## Run order (live project)
1. SQL Editor: file 16 (done) and 18-clients-payments-cleanup.sql (run it first if you have not), then **`supabase/19-billing-qr-invoices.sql`**. Every line of the final result must say OK.
2. No Edge Function changes in this update.
3. Push the website code to GitHub.
4. Super admin → Settings: set **Extra branch fee (₹ per MONTH)** and fill in **Invoice details** (your name, address, GST number later, GST on/off).
Do not run RUN-THIS-ALL-IN-ONE.sql on the live project.

## What the owner sees (Billing)
* Choose any mix of: **Renew / change plan**, **Keep my extra branches**, **Add extra branches** (a name for each). The mobile number field is still required.
* The page shows the breakdown, the total, and a **UPI QR with the exact amount**. Only the branch amount if the plan is already running; one combined QR if renewing too.
* The page says the branch fee is a **monthly** cost, not one-time.
* Owner pays, enters the UPI transaction ID, presses **Send request**. Invoices appear on the Billing page with a PDF download.

## How the branch fee is worked out (by the database)
* Plan running, adding a branch: monthly fee × months left in the plan (whole months, at least 1, at most 12).
* Renewing: plan price + monthly fee × plan months for every extra branch kept + monthly fee × (months left + plan months) for every new branch.
* Extra branches that are not paid again at renewal are switched off when you approve (bills and data are kept; the newest branch goes first).

## What you see
* **Requests**: breakdown, branch names, transaction ID, mobile with Call / WhatsApp, and the date the plan ends. The new end date is suggested for you. **Approve** → plan, branch slots and new branches are set, the owner is notified, the payment is saved in **Payments** (method and reference filled in) and an **invoice is created automatically**.
* **Payments tab → Invoices**: every invoice with **Edit** (bill-to details, lines, number, date, paid amount, notes, GST on/off and rate, your own details) and PDF download.
* **GST is optional (off by default)** and always treated as included in the price, so the QR amount and what the owner paid never change.

## Not built
* "Mark as paid" (the manual payment form) does not create an invoice. Only approved owner requests do.
* RUN-THIS-ALL-IN-ONE.sql was not updated.
* Not click-tested against a live Supabase. SQL 19 was only read through, not executed. Test on a test project first.
