# Eventora OS — v4 changes
1. Supabase -> SQL Editor: run `supabase/21-custom-automation-and-branch-delete.sql` once (the last 3 rows must say OK). Then push the code to GitHub.
2. Billing: customers only scan the QR, pay the fixed amount and type the UPI transaction ID. Amount-paid and paid-on fields are gone (amount comes from the quote, date = today).
3. Super admin -> Manage customer -> Branches: delete a branch (bills and employees move to that customer's Main branch). Customers have no delete option.
4. Super admin -> Automation: "New automation" creates your own messages (before/after plan end, trial/paid/everyone, e-mail optional); custom ones can be edited and deleted.
5. Reports: All / Paid / Unpaid filter, mobile + e-mail columns (table, CSV, PDF), per-row WhatsApp / e-mail payment request or reminder, and "Send payment requests" for everyone who owes money.
6. New bill form has an optional customer e-mail (saved inside the bill, no extra SQL).
Not built or run here (no npm access): run `npm install && npm run build` and click through once.
