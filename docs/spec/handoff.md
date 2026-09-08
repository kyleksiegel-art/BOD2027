# Handoff — 2026-09-07 (Phase 9 — Polish)

- Branch `phase-9-polish` off `main`. **No schema/scoring change; photos out of scope** (Kyle).
- **Code-split**: routes `React.lazy` (Home eager), one Suspense in `RouteFrame`; vendors via
  `manualChunks`; `modern-screenshot` now a dynamic import in `recapImage.ts`. Main chunk
  **847 KB → 118 KB**, Vite size warning gone. Verified live, no console errors. See CLAUDE.md §"Phase 9".
- **Fixed stale dark-mode metadata** (app is light-only since Aug): `index.html` dropped
  `class="dark"`, theme-color/status-bar and PWA manifest colors → `#e9e1d0` (--ground).
- **Hero LCP**: preload in `index.html` + `fetchPriority="high"` → LCP-discovery all-green.
- Removed orphan `public/ctp-inline.html` (was deployed + precached).
- **README** finished (env vars, offline, deployment, custom domain).
- **Lighthouse (real run, mobile, prod build): Accessibility 100 ✓**, SEO 92, Perf **75**,
  BP 81 (only `is-on-https`, a localhost artifact → ~100 on Netlify). TBT 20 ms, CLS 0.
- **Perf ≥ 90 NOT met in lab, left on purpose.** Gap is FCP 3.2 s / LCP 5.1 s over simulated
  Slow-4G — the SPA boot cost, not assets (hero is 42 KB AVIF, bundle split). Crossing it needs
  **prerendering Home (SSG)** — a real change, **Kyle's call**, not a polish item. Installed PWA
  serves from SW precache (instant); prod adds Brotli/HTTP-2/CDN.
- `vitest run` → 184. `tsc -b` + `npm run build` clean, no warning. Not yet committed/pushed.
- **Still owed, on hardware:** production `main` deploy + on-device Lighthouse; the iPhone checks
  (PWA install/update, Share sheets, offline full round). Real player indexes + Bone Valley card.
