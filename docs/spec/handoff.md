# Handoff — 2026-09-06 (branch `share-live`, rebased on main after PR #13 merged)

Recap "Share ↗" now shows during a live round too (Kyle: "not just at the end"). Same image
path as the final share; the live pre-render is debounced 1.2 s because the card re-derives on
every saved hole; live files are `…-thru{N}.png`, title "Course — thru N"; the text fallback has
a live variant ("Adam leads by 1").

Verified in the preview (mobile preset, stubbed navigator.share): live card renders the button,
the tap shares one PNG file, no text. Note: with the preview pane hidden the card has no layout
width, the `offsetWidth < 200` guard fires, and the tap does nothing — that is the harness, not
the phone.

Tests 168 after the rebase on main (PR #13 merged), `npm run build` clean. Branches don't overlap: PR #13 (error boundary) touches
ErrorBoundary/router/main/Layout/Diagnostics/crash; this one touches RoundRecap + recapImage.

Still open: score history, Realtime channel-status handling, wake lock, DB backup, dry run.
