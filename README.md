# Board of Directors — Streamsong 2027

Live golf trip tournament web app for The Board of Directors' 2027 trip to Streamsong Resort (Feb 4–7, 2027). Offline-capable PWA, deployed to Netlify, backed by Supabase.

**Status: Phase 0 — spec only, no code yet.**

## Where to start

- The authoritative spec lives in [`docs/spec/brief.md`](docs/spec/brief.md). It is the source of truth. If it disagrees with any other document in this repo, the brief wins.
- Architecture, data-layering rule, and conventions live in [`CLAUDE.md`](CLAUDE.md). Kept current so future sessions don't re-derive them from source.
- Every decision made outside the brief is logged in [`docs/spec/decisions.md`](docs/spec/decisions.md), including places where two requirements appeared to conflict and how they were resolved.
- Phase-by-phase acceptance evidence: [`docs/spec/acceptance-checklist.md`](docs/spec/acceptance-checklist.md).
- Session handoff (short): [`docs/spec/handoff.md`](docs/spec/handoff.md). This is what the next session reads first.

## The rest of this file will fill in as the build progresses

- Local setup, env vars, and required tools (Phase 1)
- Running tests (Phase 3)
- Supabase project setup and migrations (Phase 2)
- PIN threat model, admin PIN recovery (Phase 5)
- **iOS install-then-unlock instruction** (Phase 6) — install to the home screen before unlocking, on hotel wifi, before each round
- Deployment notes and custom-domain instructions (Phase 1 / Phase 9)
- Anon-key safety analysis (Phase 5)
