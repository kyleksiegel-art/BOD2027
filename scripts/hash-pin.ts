// Generate the argon2id hash the pin-verify Edge Function checks against.
//
//   npx tsx scripts/hash-pin.ts 271828
//
// Then set it as a Supabase secret (production) or put it in supabase/functions/.env
// (local). The PIN itself is never stored anywhere -- only this hash.
//
// Parameters are OWASP's second recommended argon2id configuration (m=19 MiB, t=3, p=1),
// which is what the Edge Function's memory budget comfortably allows.
import { argon2id } from 'hash-wasm'

const pin = process.argv[2]
if (!pin || !/^\d{6}$/.test(pin)) {
  console.error('Usage: npx tsx scripts/hash-pin.ts <six-digit-pin>')
  process.exit(1)
}

const salt = new Uint8Array(16)
crypto.getRandomValues(salt)

const hash = await argon2id({
  password: pin,
  salt,
  parallelism: 1,
  iterations: 3,
  memorySize: 19456,
  hashLength: 32,
  outputType: 'encoded',
})

console.log(hash)
