# Redesign: Midnight Navy + Electric Blue (presentation only)

No data, auth, routes, permissions or calculations changed. Token names are unchanged ("gold" now means Electric Blue).

* `src/index.css`: new palette, Inter font, `.sidebar-dark`, `.card-glow`, `.lift`, animations (entrance animations use fill-mode `backwards`; page transition is opacity only), `.skeleton`, reduced-motion support.
* `index.html`: navy theme colour, branded first-load screen, Playfair removed.
* `Logo.tsx` + `assets/logo-text-dark.png`: `onDark` prop.
* `ui.tsx`: Button `loading`, new focus ring, `Skeleton`, shimmer `Spinner`, `PageSkeleton`, `CountText`, slide-in toasts, **Modal rendered through a portal**.
* `components/Shell.tsx`: `BrandedLoader`, `WelcomeSplash`, `CommandSearch` (Ctrl/⌘+K), `NotificationsMenu` (real items only), `ProfileMenu`, `friendlyName`.
* `AdminLayout.tsx`: navy sidebar with Workspace / Management groups, mobile drawer, blurred top bar, "Overview" renamed "Dashboard". The branch switcher is kept.
* `Login.tsx`: split layout, show/hide password, welcome splash flag. MFA flow unchanged.
* TimePicker is rendered through a portal (clock fix). Overview, Calendar, Estimator, Settings colour tweaks.
