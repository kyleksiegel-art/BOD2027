# Handoff — 2026-11-08 (radio call: broadcast voice)
- Branch `radio-call-broadcast-voice`: the radio call reads in an ElevenLabs voice when there's
  signal; the phone's own voice otherwise. Templates still write every word.
- New Edge Function `supabase/functions/radio-voice` (open to anon, 6,000-char cap, 503 until
  configured). **Kyle to do:** ElevenLabs account, pick a voice, then
  `supabase secrets set ELEVENLABS_API_KEY=… ELEVENLABS_VOICE_ID=…` and
  `supabase functions deploy radio-voice`. Set a usage limit in the ElevenLabs dashboard.
- Client: `src/lib/speech/broadcast.ts` + `useRadioPlayer` (prime audio/speech in the tap, 15 s
  timeout, fallback). Audio saved per call in `sync_meta` for replays, pruned with the log.
- ~10 lines carry v3 cues ([excited], [laughs]…); stripped for the phone voice and on screen.
- Merged earlier today: PR #62, every radio line pool doubled.
- `vitest run --dir src` → 266, `npm run build` clean. Desktop browser: fallback path and a faked
  voice response both verified. **Not verified on an iPhone or against the real ElevenLabs API.**
- Pre-trip checklist (late January, real phones) unchanged; add: one radio call with signal
  (broadcast voice) and one in airplane mode (phone voice).
