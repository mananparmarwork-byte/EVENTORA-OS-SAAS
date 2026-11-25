# Manual billing (no online payment gateway)

Customers pay you directly (UPI, bank transfer or cash). You record it in **Super admin → Collections → Collect**.

* Owners see how to pay and send a renewal request in **Billing** (UPI QR with the exact amount, from Super admin → Settings). You approve it under **Requests**, or record it directly with **Collect**.
* **Removed:** edge functions `create-checkout`, `create-purchase`, `manage-subscription`, `razorpay-webhook`, `_shared.ts`; `RAZORPAY-SETUP.md`; the old Buy/Welcome pages; the `createPurchase`, `startCheckout`, `cancelAutopay` methods.
* **Kept:** all database tables and columns (nothing dropped), `send-reminders`, `manage-staff`, `platform-owners`, `send-message-emails`, `send-payment-reminder`, `purchaseStatus`, `savePurchaseProfile`, `redeemCoupon`, `checkCoupon`.
* In Supabase you can delete the four old functions from the dashboard (Edge Functions) — they are no longer used.
* Older SQL files and `SAAS-SETUP.md` still describe the old gateway; ignore those parts.
