// The radio call's broadcast voice (Kyle 2026-11-08). The app builds the call from its own
// templates; this function only turns that text into speech with ElevenLabs and returns the MP3.
// It writes nothing. ElevenLabs reads exactly what it's sent: it does not write any of the call.
//
// It lives here, not in the app, so the ElevenLabs key never reaches a phone. Like pin-verify it
// is called with the anon key and is open to anyone who has the app (the triple tap has no PIN,
// on purpose). The spend is bounded by the length cap below and the ElevenLabs plan's own monthly
// limit, which is the accepted risk for a four-person trip.
//
// Secrets: ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID (required); ELEVENLABS_MODEL_ID (optional,
// default eleven_v3, the model that acts out the [excited] / [laughs] / [whispers] cues). With
// either required secret missing it answers 503, and the phone just uses its own voice.

const MAX_LINES = 80
const MAX_LINE_CHARS = 1000
const MAX_TOTAL_CHARS = 6000 // a long trip finale is ~3000; this is the spend cap per call
const CHUNK_CHARS = 2500 // under the per-request text limit
const OUTPUT_FORMAT = 'mp3_44100_96' // ~0.7 MB a minute: twenty saved calls stay small

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })
}

/** Whole lines, packed into requests under the per-request limit, in order. */
function chunks(lines: string[]): string[] {
  const out: string[] = []
  let cur = ''
  for (const line of lines) {
    const next = cur ? `${cur}\n${line}` : line
    if (next.length > CHUNK_CHARS && cur) {
      out.push(cur)
      cur = line
    } else cur = next
  }
  if (cur) out.push(cur)
  return out
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const apiKey = Deno.env.get('ELEVENLABS_API_KEY')
  const voiceId = Deno.env.get('ELEVENLABS_VOICE_ID')
  const modelId = Deno.env.get('ELEVENLABS_MODEL_ID') || 'eleven_v3'
  if (!apiKey || !voiceId) return json({ error: 'Broadcast voice is not configured.' }, 503)

  const body = (await req.json().catch(() => null)) as { lines?: unknown } | null
  const lines = body?.lines
  if (
    !Array.isArray(lines) ||
    lines.length === 0 ||
    lines.length > MAX_LINES ||
    !lines.every((l) => typeof l === 'string' && l.trim().length > 0 && l.length <= MAX_LINE_CHARS)
  ) {
    return json({ error: 'Send { lines: string[] }.' }, 400)
  }
  const text = lines as string[]
  if (text.reduce((n, l) => n + l.length, 0) > MAX_TOTAL_CHARS) return json({ error: 'Call too long.' }, 413)

  let parts: ArrayBuffer[]
  try {
    parts = await Promise.all(
      chunks(text).map(async (chunk) => {
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`,
          {
            method: 'POST',
            headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
            body: JSON.stringify({ text: chunk, model_id: modelId }),
          },
        )
        if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`)
        return await res.arrayBuffer()
      }),
    )
  } catch (e) {
    // The phone falls back to its own voice on any non-200; the detail is for the function logs.
    console.error(String(e))
    return json({ error: 'Voice unavailable.' }, 502)
  }

  // MP3 frames concatenate cleanly, so the chunks play back as one clip.
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const audio = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    audio.set(new Uint8Array(p), at)
    at += p.byteLength
  }
  return new Response(audio, {
    status: 200,
    headers: { ...CORS, 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
  })
})
