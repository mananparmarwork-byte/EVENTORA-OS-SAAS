# Update 18: clients' mobile numbers, Home to-do list, Payments list, auto-delete

Run order: SQL file 18 (after 16) -> redeploy the `platform-owners` function -> push the website code.

## What changed
* **Mobile number is required** for: Request access (public page), Add owner, editing a business, and every owner request (renewal, extra branch, message). Owners' own number is pre-filled and saved on the business.
  Everywhere you see a client (Home, Requests, Clients, Payments, Manage) there is the number with **Call** and **WhatsApp** buttons.
* **Super admin has 6 tabs:** Home, Requests, Clients, Payments, Messages (with Automatic reminders inside), Settings (with Plans and Coupons inside).
* **Home:** received this month, still to collect, overdue, waiting for you; the list of clients to collect from (Remind on WhatsApp + Mark as paid); trials to follow up; latest payments.
* **Mark as paid:** amount, date, method, reference and the new end date in one step, then a receipt you can send on WhatsApp. Saved in **Payments** (filter by month/method, search, export CSV, receipt per payment).
* **Clients:** one list of every business with mobile, plan, status, paid so far, joined date; filters; "No mobile" filter; export CSV.
* **Requests:** mobile number on every row, Delete button, "Clear answered" button, and automatic deletion of answered requests (Settings -> Auto-delete, default 7 days). Payments are never deleted with a request.
* Old autopay wording (Renewing, Payment failed, Cancelling) is gone from the new screens.
