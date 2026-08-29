// Generate the two PIN hashes the app checks against.
//
//   npx tsx scripts/hash-pin.ts 1922
//
// Prints TWO secrets:
//   APP_PIN_ARGON2_HASH  — the online check inside the pin-verify Edge Function.
//   APP_PIN_BCRYPT_HASH  — the OFFLINE fallback (Phase 6b). The Edge Function returns this
//                          to a caller who just unlocked, so their device can re-unlock with
//                          no signal (docs/spec/decisions.md §"PIN size and hash"). bcrypt
//                          cost 10, verified in the browser by bcryptjs.
//
// Set BOTH as Supabase secrets (production) or put both in supabase/functions/.env (local).
// The PIN itself is never stored anywhere -- only these hashes.
//
// argon2 params are OWASP's second recommended argon2id configuration (m=19 MiB, t=3, p=1),
// which is what the Edge Function's memory budget comfortably allows.
import { argon2id } from 'hash-wasm'
import { hashSync } from 'bcryptjs'

const pin = process.argv[2]
if (!pin || !/^\d{4,8}$/.test(pin)) {
  console.error('Usage: npx tsx scripts/hash-pin.ts <pin>   (4-8 digits)')
  process.exit(1)
}

const salt = new Uint8Array(16)
crypto.getRandomValues(salt)

const argonHash = await argon2id({
  password: pin,
  salt,
  parallelism: 1,
  iterations: 3,
  memorySize: 19456,
  hashLength: 32,
  outputType: 'encoded',
})

const bcryptHash = hashSync(pin, 10)

console.log(`APP_PIN_ARGON2_HASH='${argonHash}'`)
console.log(`APP_PIN_BCRYPT_HASH='${bcryptHash}'`)
