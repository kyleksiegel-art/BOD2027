# Handoff — 2026-09-05 (branch `error-boundary`)

Error boundary, the next item from today's reliability ranking.

- `src/components/ErrorBoundary.tsx`: `CrashPanel` (Reload / Home / "What happened" details,
  copy says saved scores and drafts are not lost). Two router `errorElement`s: a pathless route
  under Layout keeps the tab bar up when a page throws; the root route replaces react-router's
  default "Unexpected Application Error!" for a Layout crash. `AppErrorBoundary` wraps the router.
- `src/lib/crash.ts`: last crash → `sync_meta['last_crash']`; Diagnostics shows it + Clear, and
  includes it in "Copy state as JSON".
- Dev-only `?crash=route` / `?crash=shell` triggers; stripped from the prod bundle (checked).

Verified in the preview: both panels render, both record, tab bar survives the route case,
navigating away recovers. Tests 167, `npm run build` clean.

Earlier today (merged): PR #11 Enter drafts/current hole/advance; PR #12 recap Share as image
(verified on Kyle's iPhone). Still open: score history, Realtime channel-status handling,
wake lock, DB backup, four-phone dry run + pre-trip chores.
