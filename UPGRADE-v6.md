# Eventora OS — update v6: customer enquiry link, Draft bills, optional PAN

## Do these once
1. **Supabase → SQL Editor → New query → paste `supabase/23-enquiry-link-drafts.sql` → Run.** The last table must say OK on every row.
   (Or re-run `RUN-THIS-ALL-IN-ONE.sql`; file 23 is at the end of it.) Safe to run again.
2. Push the code to GitHub as usual (the deploy workflow rebuilds the site). The PAN field and the Drafts tab need only this; the SQL is needed for the public form.

## 1. PAN number (optional, like GST)
- New field **Customer PAN number** next to Customer GST number (Step 1). Optional; if filled it must look like `ABCDE1234F`.
- Printed on the quotation / invoice under the customer's GSTIN, with a switch **Show customer PAN on the bill** (same place as the GSTIN switch).
- Shown on the bill detail page and recorded in Activity when edited. Stored inside the bill's pricing data (no new column).

## 2. Customer enquiry link (SaaS: every business has its own)
- **Settings → Enquiry link** shows your link, e.g. `https://yoursite/#/enquiry/<your-business-slug>`, with Copy, Open, a ready "button" snippet and an "embed the form" (iframe) snippet for your website.
- Customers see the same Event-details form **without Bill number, GST and PAN** (and without any prices): name, mobile, e-mail (optional), event type, guests, event date (+ optional time), and Branch if you have more than one.
- Each submission is saved as **its own new bill (own bill number) with status Draft**, in the right branch, and you get a notification (bell) "New enquiry from …".
- Nothing about your other customers is ever shown to the visitor; the form can only add a draft. It is protected against spam (hidden trap field; max 5 enquiries per mobile number per hour; 200 per business per hour) and is switched off automatically when a business's plan has ended.

## 3. Drafts → Quotations
- **Quotations → Drafts** tab (with an orange counter) lists the drafts. Open one: customer details, **Call** and **WhatsApp** buttons.
- **Complete quotation** opens the normal bill form with the customer's details filled in. Check the details with the customer, choose the services in Step 2 and press **Save changes**: the draft becomes a normal quotation (status Enquiry). Saved without any service, it stays a draft.
- Drafts do not count as quotations, bookings or revenue in Overview / Reports, and do not block the calendar. Employees of that branch can see and complete drafts.

## Honest notes
- This update was written and type-checked against stubs only; the sandbox had no internet for `npm install`. Run `npm install && npm run build` once and click through: open the link in a private window, submit, then find the draft.
- The enquiry link works with the Supabase backend. The Hostinger PHP backend does not have it yet (the page shows a clear message).
