# Premium redesign (Midnight Navy + Electric Blue)

Nothing in the database, auth, routes, permissions or calculations was touched. Only presentation changed.

## How it works
- `src/index.css` holds the new palette. Token names were kept (the "gold" tokens are now Electric Blue), so every existing page re-themes at once.
- The sidebar, login brand panel and welcome screen use the `.sidebar-dark` class, which swaps the tokens to navy-friendly values inside that area.
- Motion is defined in `index.css` (fade-up, pop-in, toast-in, shimmer, drawer-in) and disabled by the user's "reduce motion" setting.

## New / changed
- `components/Shell.tsx`: branded loader, welcome splash (once per sign-in, skippable), Ctrl+K search (real bills + pages), notifications (real: plan status, events in 7 days, balance to collect), profile menu.
- `components/ui.tsx`: Button `loading` prop + press feedback, shimmer `Skeleton` / `PageSkeleton` (the old `Spinner` now shows skeletons), `CountText` number count-up, animated toasts and modals.
- `layouts/AdminLayout.tsx`: navy sidebar with Workspace / Management groups, breadcrumb top bar, page fade transition.
- `pages/Login.tsx`: split brand panel, password show/hide, loading button.
- `index.html`: branded first-load screen (Inter only; Playfair removed).
- Dashboard: skeleton loading, animated KPI numbers, blue charts.

## Deliberately NOT added (not real in this app)
Customers, POS, Inventory, Branch selector, Website management, Support, business-type switching, remember-me, forgot-password. Adding menu items for modules that do not exist would be dummy UI. Forgot-password needs a Supabase recovery redirect that conflicts with the hash routing and should be built and tested separately.
