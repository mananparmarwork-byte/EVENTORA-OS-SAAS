# Eventora OS - v5 changes

## 0. Run this once
Supabase -> SQL Editor -> paste and run `supabase/22-backup-and-view-clients.sql` (the last rows must say OK).
Then push the code to GitHub as usual. (If you ever re-run 06, 08, 11, 16 or 21 later, run 22 again afterwards.)

## 1. Preview PDF before saving or downloading (everywhere)
One shared preview window (`src/components/PdfPreview.tsx`). Nothing is downloaded or saved until you press a button inside it.
* New bill / quotation: **Preview final PDF** button. The preview has **Save quotation** (or Save changes), Download PDF, Open full screen, Close.
* Saved bill: Preview quotation / Preview invoice.
* Reports: Preview PDF report. Billing: Preview on each invoice. Super admin -> Invoices: Preview on the list, and Preview inside Edit invoice (with Save invoice).
* Settings -> Business: Preview sample PDF.

## 2. Backup & restore per client (Settings -> Backup & restore)
* Hidden by default. Super admin -> **Data & clients**: switch "Backup & restore" on per client (or "Backup on for all").
* Export = one .json file with everything of that business: all branches, bills, payments, catalog, settings, activity, bill numbers.
* Import = pick that file. Settings/catalog are restored from the file; bills that already exist are kept (option: replace them).
* A file from another business is refused. Employee logins are not in the file (they are accounts).

## 3. Super admin -> Data & clients
* **View a client's dashboard**: choose the business, type your login password, and you see their full dashboard (every branch) exactly as they do.
  The database checks the password (5 wrong tries = 15 minute pause). It is READ-ONLY: the database refuses every change while you view.
  The yellow bar at the top has **Exit client view**. A view ends by itself after 3 hours, and at every new sign-in.
* **Export all clients' data** / **Import all clients' data**: one business at a time, each stamped with its own business id only,
  branches matched by id, then name, then Main. Businesses are matched by their short name (slug); a missing one is created again
  and you add its owner with "Add owner". Plans, prices and access dates of existing businesses are never changed by an import.

## Not built or run here (no npm access)
Run `npm install && npm run build` once and click through: New bill -> Preview, a saved bill -> Preview, Settings -> Backup (after switching it on),
Super admin -> Data & clients -> View a client's dashboard.
