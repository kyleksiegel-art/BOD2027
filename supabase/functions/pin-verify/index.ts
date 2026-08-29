// PIN verification. This is an Edge Function and not an RPC on purpose (brief §Auth):
// a SECURITY DEFINER function called with the anon key cannot see a trustworthy client
// IP -- `x-forwarded-for` reaching Postgres is whatever the caller typed -- so per-IP
// limiting inside the database would be theater. Here the platform sets the header at
// the edge, so throttling has something real to count.
//
// THREAT MODEL, stated honestly: a shared 4-digit PIN gates /admin for
// a four-person golf trip. argon2id at OWASP's recommended parameters plus layered
// throttling makes online guessing impractical. It is not, and is not described as,
// resistance against someone who obtains the server secret or a device's local storage.
import { argon2Verify } from 'npm:hash-wasm@4.12.0'
import { createClient } from 'npm:@supabase/supabase-js@2'

// Sessions run through the end of the trip and no further.
const DEFAULT_EXPIRES_AT = '2027-02-08T23:59:59-05:00'

// One string for every failure mode. A distinct "unknown PIN" vs "malformed request"
// message would turn this endpoint into an oracle.
const GENERIC_FAILURE = 'Incorrect PIN.'

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

/**
 * The platform appends to x-forwarded-for, so the left-most entry is the closest thing
 * to a real client IP available here. A client can still prepend a bogus entry; the
 * consequence is that an attacker throttles a fictional IP instead of their own, which
 * is exactly why the global brake below exists as a second layer.
 */
function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  return first && first.length > 0 ? first : null
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const pinHash = Deno.env.get('APP_PIN_ARGON2_HASH')
  if (!pinHash) {
    // A missing secret is an operator error, not a wrong PIN -- say so rather than
    // silently rejecting every correct PIN in the cart on Saturday morning.
    return json({ error: 'PIN is not configured on the server.' }, 503)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const ip = clientIp(req)

  // 1. Throttle gate BEFORE doing any argon2 work, so a flood costs us a cheap query
  //    rather than 19 MiB of hashing per attempt.
  const { data: gate, error: gateError } = await admin.rpc('rpc_pin_gate', { p_ip: ip })
  if (gateError) return json({ error: 'PIN check unavailable.' }, 503)
  if (gate && gate.allowed === false) {
    return json(
      {
        error:
          gate.scope === 'global'
            ? 'Too many PIN attempts across all devices. Try again shortly.'
            : 'Too many PIN attempts from this device. Try again shortly.',
        retry_after: gate.retry_after,
      },
      429,
    )
  }

  let pin: unknown
  try {
    pin = (await req.json())?.pin
  } catch {
    pin = undefined
  }

  // Well-formedness only — a cheap gate so a garbage body never costs an argon2 verify.
  // Deliberately a RANGE, not a fixed length: the stored hash is what actually decides,
  // so changing the PIN's length is a client constant plus a new hash, never a redeploy
  // of this function. See docs/spec/decisions.md §"PIN length is 4, not 6".
  const wellFormed = typeof pin === 'string' && /^\d{4,8}$/.test(pin)
  const ok = wellFormed ? await argon2Verify({ password: pin as string, hash: pinHash }) : false

  await admin.rpc('rpc_record_pin_attempt', { p_ip: ip, p_success: ok })

  if (!ok) return json({ error: GENERIC_FAILURE }, 401)

  // 2. Mint 256 bits of CSPRNG output (the brief's floor is 128) and persist only its
  //    digest, so a leaked `sessions` table grants nobody anything.
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(raw)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const expiresAt = Deno.env.get('APP_SESSION_EXPIRES_AT') ?? DEFAULT_EXPIRES_AT

  const { error: sessionError } = await admin.rpc('rpc_create_session', {
    token_hash: await sha256Hex(token),
    expires_at: expiresAt,
  })
  if (sessionError) return json({ error: 'Could not start a session.' }, 503)

  // Hand back the LOCAL-offline PIN hash (bcrypt, cost 10 — see docs/spec/decisions.md
  // §"PIN size and hash") so a device that has unlocked online once can re-unlock with no
  // signal (the iOS install-then-unlock case). It is disclosed only to a caller who just
  // proved they know the PIN, and its threat model already says "brute-forceable — accepted
  // tradeoff." Absent secret ⇒ offline unlock simply stays unavailable; online is unaffected.
  const offlineHash = Deno.env.get('APP_PIN_BCRYPT_HASH') ?? null

  return json({ token, expires_at: expiresAt, pin_bcrypt_hash: offlineHash }, 200)
})
